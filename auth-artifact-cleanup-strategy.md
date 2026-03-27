# Auth Artifact Cleanup Strategy

## Goal

Add cleanup for:

- expired `auth_login_transactions`
- expired or consumed `auth_handoff_tickets`

These records are intentionally short-lived. Keeping them forever adds clutter with no product value.

## Current codebase fit

Relevant files:

- `src/bungie.ts`
- `migrations/0001_init.sql`

Current flow:

- `POST /auth/bungie/start` inserts into `auth_login_transactions`
- `GET /auth/bungie/callback` consumes the login transaction and creates `auth_handoff_tickets`
- `POST /auth/bungie/handoff/consume` consumes the one-time ticket

Current TTLs in code:

- login transaction TTL: `10 minutes`
- handoff ticket TTL: `60 seconds`

Current gap:

- rows expire logically, but not physically

## Recommended retention policy

Keep cleanup rules straightforward:

- handoff tickets: delete when `consumed_at` is older than `1 day`
- handoff tickets: delete when `expires_at` is older than `1 day`
- login transactions: delete when `consumed_at` is older than `1 day`
- login transactions: delete when `expires_at` is older than `1 day`

That gives enough time for debugging a fresh auth issue without retaining dead rows long-term.

## Recommended implementation shape

This work fits best into the same operational script as refresh-token cleanup:

- `src/scripts/cleanup-auth.ts`

That script should have three sections:

1. refresh-token cleanup
2. handoff-ticket cleanup
3. login-transaction cleanup

## Important deletion order

Delete handoff tickets before login transactions.

Reason:

- `auth_handoff_tickets.login_id` references `auth_login_transactions(id)`
- deleting the login transaction cascades the handoff ticket
- explicit ticket cleanup first keeps metrics clearer and avoids ambiguity in delete counts

Recommended order:

1. delete old handoff tickets
2. delete old login transactions

## Migration support

`auth_login_transactions` already has an `expires_at` index.

Recommended next migration additions:

```sql
create index if not exists auth_login_transactions_consumed_idx
  on auth_login_transactions (consumed_at)
  where consumed_at is not null;

create index if not exists auth_handoff_tickets_expires_idx
  on auth_handoff_tickets (expires_at);

create index if not exists auth_handoff_tickets_consumed_idx
  on auth_handoff_tickets (consumed_at)
  where consumed_at is not null;
```

## SQL shape

Delete old handoff tickets:

```sql
delete from auth_handoff_tickets
where ticket_id in (
  select ticket_id
  from auth_handoff_tickets
  where expires_at < now() - interval '1 day'
     or consumed_at < now() - interval '1 day'
  order by created_at asc
  limit $1
);
```

Delete old login transactions:

```sql
delete from auth_login_transactions
where id in (
  select id
  from auth_login_transactions
  where expires_at < now() - interval '1 day'
     or consumed_at < now() - interval '1 day'
  order by created_at asc
  limit $1
);
```

## Pseudocode

```ts
export async function cleanupAuthArtifacts(db, batchSize = 1000) {
  const handoffDeleted = await deleteExpiredOrConsumedHandoffs(db, batchSize);
  const loginDeleted = await deleteExpiredOrConsumedLoginTransactions(db, batchSize);

  return {
    handoffDeleted,
    loginDeleted,
    totalDeleted: handoffDeleted + loginDeleted
  };
}
```

Recommended top-level loop:

```ts
while (true) {
  const result = await cleanupAuthArtifacts(db, 1000);
  if (result.totalDeleted === 0) break;
}
```

## Metrics and logging

At minimum, log one summary line:

```text
cleanup-auth: refresh=24 handoffs=62 logins=61
```

If the project later adds structured logging, emit these counts as fields instead of plain text.

## Test plan

Add cleanup tests for:

- expired login transaction is deleted
- consumed login transaction older than retention is deleted
- fresh unconsumed login transaction is kept
- expired handoff ticket is deleted
- consumed handoff ticket older than retention is deleted
- fresh unconsumed handoff ticket is kept

Also test one realistic chain:

1. create login transaction
2. create handoff ticket
3. age both rows
4. run cleanup
5. assert both are gone

## Practical note

This cleanup work is operational hygiene, not user-visible functionality. Keep it boring:

- one script
- chunked deletes
- deterministic retention windows
- no request-path side effects
