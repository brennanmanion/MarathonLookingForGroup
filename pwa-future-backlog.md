# PWA Future Backlog

This note captures backend-adjacent work that is not required for the current browser POC, but is likely to matter soon after frontend implementation begins in earnest.

## 1. Party Feed Pagination, Filtering, and Sorting

### Current gap

`GET /parties` is still a simple unbounded list:

- no pagination
- no explicit filter contract
- no sorting contract beyond the current default query order
- no list-specific indexes

That is acceptable for a POC, but not for a production feed or a richer frontend.

### Recommended route contract

Keep one route:

- `GET /parties`

Add future query params:

- `limit`
- `cursor`
- `sort`
- `activityKey`
- `platformKey`
- `regionKey`
- `languageKey`
- `approvalMode`
- `requiresMarathonVerified`
- `voiceRequired`
- `ranked`
- `tagKey`
- `tagValue`

Recommended first sort options:

- `newest`
- `scheduled`

Recommended defaults:

- `limit=20`
- `sort=newest`

Recommended response shape:

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": "opaque-string-or-null"
  }
}
```

Do not add total-count in the first pass.

### Cursor design

Use opaque base64url JSON instead of page numbers.

Example cursor payloads:

For `sort=newest`:

```json
{
  "sort": "newest",
  "createdAt": "2026-03-27T19:10:00.000Z",
  "id": "uuid"
}
```

For `sort=scheduled`:

```json
{
  "sort": "scheduled",
  "scheduledFor": "2026-03-28T03:00:00.000Z",
  "id": "uuid"
}
```

### Important rule

Do not weaken the existing visibility rules while adding feed features.

The route should still return:

- public non-cancelled parties to anonymous viewers
- host-visible private/cancelled parties to the host
- active-member-visible private/cancelled parties to accepted or pending members

### Migration/index planning

Once the contract is stable, add list-oriented indexes in a follow-up migration.

Suggested direction:

```sql
create index if not exists parties_public_newest_idx
  on parties (created_at desc, id desc)
  where visibility = 'public' and status in ('open', 'full');

create index if not exists parties_public_scheduled_idx
  on parties (scheduled_for asc, id asc)
  where visibility = 'public' and status in ('open', 'full');

create index if not exists party_tags_lookup_idx
  on party_tags (tag_key, tag_value, party_id);
```

### Frontend implications

When this lands, the frontend should move from “load all visible parties” to:

- initial page fetch
- cursor-based next-page loading
- stable filter state in URL/search params
- sort selection in the feed UI

## 2. Token and Session Cleanup

### Current gap

The backend correctly rotates and revokes sessions, but cleanup is still logical only, not physical.

Tables that need cleanup strategy:

- `app_refresh_tokens`
- `auth_login_transactions`
- `auth_handoff_tickets`

Without cleanup:

- refresh-token history grows forever
- expired login transactions accumulate
- consumed/expired handoff tickets accumulate

### Recommended retention policy

Refresh tokens:

- keep active unexpired tokens
- delete expired tokens once they are more than `7 days` past expiry
- delete revoked tokens once they have been revoked for more than `30 days`

Auth artifacts:

- delete expired login transactions once they are more than `1 day` old
- delete consumed login transactions once `consumed_at` is more than `1 day` old
- delete expired handoff tickets once they are more than `1 day` old
- delete consumed handoff tickets once `consumed_at` is more than `1 day` old

### Recommended implementation shape

Create one operational cleanup script, not request-path cleanup.

Suggested file:

- `src/scripts/cleanup-auth.ts`

Suggested npm script:

```json
{
  "scripts": {
    "cleanup:auth": "node dist/scripts/cleanup-auth.js"
  }
}
```

Run it:

- daily at first
- hourly later if session churn becomes meaningful

### Important deletion order

Delete in this order:

1. old handoff tickets
2. old login transactions
3. expired refresh tokens
4. long-revoked refresh tokens

That keeps counts understandable and respects the `auth_handoff_tickets.login_id` reference path.

### Migration/index planning

Suggested follow-up migration direction:

```sql
create index if not exists app_refresh_tokens_expires_idx
  on app_refresh_tokens (expires_at);

create index if not exists app_refresh_tokens_revoked_idx
  on app_refresh_tokens (revoked_at)
  where revoked_at is not null;

create index if not exists auth_login_transactions_consumed_idx
  on auth_login_transactions (consumed_at)
  where consumed_at is not null;

create index if not exists auth_handoff_tickets_expires_idx
  on auth_handoff_tickets (expires_at);

create index if not exists auth_handoff_tickets_consumed_idx
  on auth_handoff_tickets (consumed_at)
  where consumed_at is not null;
```

### Operational note

Keep this boring:

- chunked deletes
- explicit retention windows
- one summary log line per run
- no hidden background cleanup during request handling

## 3. Split-Origin Deployment

### Current recommendation

The current PWA path is intentionally optimized for same-origin:

- shell at `/app`
- API on the same host
- host-only cookies when `SESSION_COOKIE_DOMAIN` is blank

That is still the recommended production path.

### Why split-origin may still happen

You may later want:

- `https://app.example.com`
- `https://api.example.com`

Reasons might include:

- separate frontend hosting
- CDN or edge constraints
- org-level platform decisions
- independent frontend deployment workflow

### What becomes more complex

Split-origin is not just a DNS change. It needs deliberate backend and deployment work around:

- credentialed cross-origin fetch
- CORS policy
- shared cookie scope
- cookie `Domain` strategy
- CSRF review with cross-origin requests in mind
- origin allowlists
- logout/refresh behavior across app and API origins

### Minimum planning assumptions if split-origin becomes necessary

1. The API should remain HTTPS-only.
2. Browser fetches must be credentialed.
3. `SESSION_COOKIE_DOMAIN` must be intentionally set for the shared parent domain.
4. CORS must be allowlist-based, not wildcard.
5. The frontend origin and API origin must be treated as a matched deployment pair.

Example future env shape:

```env
WEB_APP_BASE_URL=https://app.example.com/app/
BUNGIE_REDIRECT_URI=https://api.example.com/auth/bungie/callback
SESSION_COOKIE_DOMAIN=.example.com
```

### Backend work that would likely be needed

- explicit CORS support in Fastify
- origin allowlist config
- deploy-time validation that `WEB_APP_BASE_URL` and the allowed frontend origins match
- careful testing of cookie delivery rules across subdomains
- documentation updates for frontend fetch defaults and CSRF expectations

### Recommendation

Do not switch to split-origin casually.

Treat it as a planned deployment track with its own checklist and verification pass, not a small config tweak.

## Suggested order after the current POC

1. Frontend implementation against the current same-origin backend.
2. Party feed pagination/filtering/sorting once the feed UI needs it.
3. Cleanup script and retention indexes.
4. Split-origin deployment only if infrastructure or product constraints force it.

## Related notes

More detailed earlier notes still exist here:

- [parties-query-polish-implementation.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/parties-query-polish-implementation.md)
- [app-refresh-token-cleanup-strategy.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/app-refresh-token-cleanup-strategy.md)
- [auth-artifact-cleanup-strategy.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/auth-artifact-cleanup-strategy.md)
- [pwa-production-deployment.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/pwa-production-deployment.md)
