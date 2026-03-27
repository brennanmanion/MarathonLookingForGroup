# Bungie Resync Implementation

## Goal

Implement `POST /me/bungie/resync` so the app can refresh Bungie and Marathon membership state without forcing a full re-login.

## Current codebase fit

Relevant files:

- `src/routes/me.ts`
- `src/bungie.ts`
- `src/users.ts`
- `migrations/0001_init.sql`

Current useful pieces already exist:

- `fetchMembershipData()` already calls `GetMembershipsForCurrentUser`
- `bungie_oauth_tokens` stores Bungie access + refresh tokens
- `bungie_accounts` stores `bungie_verified`, `marathon_membership_id`, `marathon_verified`, and `last_membership_sync_at`

Current missing pieces:

- no stored-token loader
- no Bungie refresh-token exchange path
- no resync route implementation
- no stale-token handling when refresh fails

## Recommended route contract

### Request

`POST /me/bungie/resync`

- requires `Authorization: Bearer <accessToken>`
- no request body needed for MVP

### Response

Return the same shape as `GET /me` to keep the client simple:

```json
{
  "userId": "uuid",
  "bungie": {
    "membershipId": "123",
    "displayName": "name",
    "globalDisplayName": "name",
    "globalDisplayNameCode": 1234,
    "verified": true
  },
  "marathon": {
    "membershipId": "456",
    "verified": true
  },
  "lastMembershipSyncAt": "2026-03-27T00:00:00.000Z"
}
```

### Error behavior

- no DB -> existing `503 db_unavailable`
- no Bungie OAuth row / stale row with no refresh path -> `502 bungie_token_refresh_failed`
- Bungie token refresh failure -> `502 bungie_token_refresh_failed`
- Bungie membership lookup failure -> `502 bungie_auth_failed`

## Recommended implementation shape

### 1. Split Bungie sync concerns from login flow

`src/bungie.ts` already does too much:

- login transaction claim
- Bungie auth-code exchange
- membership lookup
- user persistence
- handoff ticket consume

For resync, either:

- add focused helpers to `src/bungie.ts`, or
- create `src/bungie-sync.ts`

Recommended helpers:

- `loadStoredBungieTokens(client, userId)`
- `refreshBungieAccessToken(config, refreshToken)`
- `ensureFreshBungieAccessToken(client, config, userId)`
- `persistMembershipSync(client, userId, membershipData, tokenUpdate?)`
- `resyncBungieAccount(db, config, user)`

### 2. Refresh Bungie access token only when needed

Decision rule:

- if `access_token_expires_at > now() + 60 seconds`, reuse the current access token
- otherwise attempt Bungie refresh-token exchange

Use:

```http
POST https://www.bungie.net/Platform/App/OAuth/token/
grant_type=refresh_token&refresh_token=<REFRESH_TOKEN>
```

### 3. Persist correct membership outcomes

When membership data comes back:

- keep `bungie_verified = true`
- update Bungie display names
- update `raw_membership_payload`
- update `last_membership_sync_at`

If `marathonMembershipId` is present:

- set `marathon_membership_id`
- set `marathon_verified = true`
- set `marathon_verified_at = now()`

If `marathonMembershipId` is absent:

- set `marathon_membership_id = null`
- set `marathon_verified = false`
- set `marathon_verified_at = null`

That matches the merged implementation note and keeps create/join enforcement correct.

### 4. Mark Bungie tokens stale on refresh failure

If Bungie refresh fails:

1. update `bungie_oauth_tokens.is_stale = true`
2. keep existing row for debugging
3. return `bungie_token_refresh_failed`

Do not silently clear the Bungie account row.

## Pseudocode

```ts
export async function resyncBungieAccount(db, config, user) {
  return db.withTransaction(async (client) => {
    const tokenRow = await loadStoredBungieTokens(client, user.userId);
    const accessToken = await ensureFreshBungieAccessToken(client, config, tokenRow);
    const membershipData = await fetchMembershipData(config, accessToken);

    await persistMembershipSync(client, user.userId, membershipData);

    return findCurrentUser(client, user.userId);
  });
}
```

## Patch sketch

This is patch-ready enough for the first pass.

```diff
diff --git a/src/routes/me.ts b/src/routes/me.ts
@@
-  app.post('/me/bungie/resync', async () => {
-    throw new AppError(501, 'not_implemented', 'Bungie resync has not been implemented yet');
+  app.post('/me/bungie/resync', async (request, reply) => {
+    const user = await requireCurrentUser(request, deps.db, deps.config);
+    const refreshed = await resyncBungieAccount(deps.db, deps.config, user);
+    return reply.code(200).send({
+      userId: refreshed.userId,
+      bungie: {
+        membershipId: refreshed.bungieMembershipId,
+        displayName: refreshed.bungieDisplayName,
+        globalDisplayName: refreshed.bungieGlobalDisplayName,
+        globalDisplayNameCode: refreshed.bungieGlobalDisplayNameCode,
+        verified: refreshed.bungieVerified
+      },
+      marathon: {
+        membershipId: refreshed.marathonMembershipId,
+        verified: refreshed.marathonVerified
+      },
+      lastMembershipSyncAt: refreshed.lastMembershipSyncAt
+    });
   });
```

## Test plan

### Service-level test

Mock `globalThis.fetch` in `node:test` and cover:

1. access token still valid -> no Bungie refresh call, membership fetch succeeds
2. access token expired -> Bungie refresh call succeeds, membership fetch succeeds
3. Bungie refresh fails -> DB row becomes `is_stale = true`
4. Marathon membership disappears -> `marathon_verified = false`

### Integration test

Use a seeded `bungie_oauth_tokens` row in an isolated test DB and verify the route returns updated `/me` data.

## Recommended non-goals for this pass

- do not build background jobs yet
- do not proxy arbitrary Bungie endpoints yet
- do not expose Bungie tokens to the client
