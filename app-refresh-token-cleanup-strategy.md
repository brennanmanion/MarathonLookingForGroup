# App Refresh Token Cleanup Strategy

## Goal

Add an explicit retention and cleanup policy for `app_refresh_tokens`.

The backend already rotates refresh tokens and revokes the old token on refresh. What is missing is lifecycle cleanup for old rows.

Without cleanup, the table will grow forever with:

- expired tokens
- revoked tokens
- replayed-session history that is no longer operationally useful

## Current codebase fit

Relevant files:

- `src/app-sessions.ts`
- `src/session.ts`
- `migrations/0001_init.sql`

Current table shape:

- `token_id`
- `user_id`
- `token_hash`
- `created_by_login_id`
- `expires_at`
- `revoked_at`
- `ip`
- `user_agent`
- `created_at`

Current useful behavior:

- refresh rotates the session token
- logout revokes the current token
- invalid or revoked tokens are already rejected

Current gap:

- there is no delete/archive policy
- there is no scheduled cleanup job
- there is no index aimed at cleanup scans

## Recommended retention policy

Keep it simple for MVP:

- active unexpired tokens: keep
- expired tokens: delete once they are more than `7 days` past expiry
- revoked tokens: delete once they have been revoked for more than `30 days`

Why this split:

- short retention for expired tokens is enough for debugging obvious auth issues
- longer retention for revoked tokens helps investigate suspicious replay patterns

Do not keep refresh-token history forever unless there is an actual audit requirement.

## Recommended implementation shape

### 1. Add cleanup indexes in a new migration

Recommended migration additions:

```sql
create index if not exists app_refresh_tokens_expires_idx
  on app_refresh_tokens (expires_at);

create index if not exists app_refresh_tokens_revoked_idx
  on app_refresh_tokens (revoked_at)
  where revoked_at is not null;
```

### 2. Add a small cleanup script

Recommended file:

- `src/scripts/cleanup-auth.ts`

That script can eventually clean all auth artifacts, but the first pass should at least clean refresh tokens.

Recommended command:

```bash
npm run cleanup:auth
```

### 3. Delete in chunks

Do not issue one giant `delete` against the whole table.

Use chunked deletes such as `500` or `1000` rows per pass. That keeps row locking and vacuum pressure reasonable.

## SQL shape

Delete expired rows first:

```sql
delete from app_refresh_tokens
where token_id in (
  select token_id
  from app_refresh_tokens
  where expires_at < now() - interval '7 days'
  order by expires_at asc
  limit $1
);
```

Delete long-revoked rows second:

```sql
delete from app_refresh_tokens
where token_id in (
  select token_id
  from app_refresh_tokens
  where revoked_at is not null
    and revoked_at < now() - interval '30 days'
  order by revoked_at asc
  limit $1
);
```

If a row matches both predicates, either query can remove it. That is fine.

## Pseudocode

```ts
export async function cleanupRefreshTokens(db, batchSize = 1000) {
  const expiredDeleted = await deleteExpiredRefreshTokens(db, batchSize);
  const revokedDeleted = await deleteRevokedRefreshTokens(db, batchSize);

  return {
    expiredDeleted,
    revokedDeleted,
    totalDeleted: expiredDeleted + revokedDeleted
  };
}

async function runCleanupLoop(db) {
  let totalDeleted = 0;

  while (true) {
    const result = await cleanupRefreshTokens(db, 1000);
    totalDeleted += result.totalDeleted;

    if (result.totalDeleted === 0) {
      break;
    }
  }

  return totalDeleted;
}
```

## Operational schedule

Recommended first pass:

- run daily from cron or the deployment scheduler

If the app gets heavier session churn later, move it to hourly.

Do not run cleanup on every request path. That is the wrong coupling.

## Optional future schema hardening

Not needed for the first pass, but worth tracking:

- `last_used_at`
- `replaced_by_token_id`
- `revocation_reason`
- `device_label`

Those are useful only if session management gets more advanced. Do not add them preemptively unless product work needs them.

## Test plan

Add script-level coverage for:

- expired rows older than retention are deleted
- expired rows inside retention are kept
- revoked rows older than retention are deleted
- active rows are kept

If the project adds a migration runner, use an isolated test database and seed explicit timestamps.

## Patch direction

The implementation should likely touch:

- `migrations/0002_auth_cleanup_indexes.sql`
- `src/scripts/cleanup-auth.ts`
- `package.json`
- `README.md`

Minimal `package.json` addition:

```json
{
  "scripts": {
    "cleanup:auth": "node dist/scripts/cleanup-auth.js"
  }
}
```
