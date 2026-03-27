# Logout Endpoint Implementation

## Goal

Implement `POST /auth/logout` so the current app refresh token can be revoked explicitly.

## Current codebase fit

Relevant files:

- `src/routes/auth.ts`
- `src/session.ts`
- recommended shared helper file: `src/app-sessions.ts`
- `migrations/0001_init.sql`

Current useful pieces already exist:

- `app_refresh_tokens.revoked_at`
- refresh token issuance in `consumeHandoffTicket`

Current missing pieces:

- no refresh-token parser
- no revocation helper
- no logout request contract

## Recommended route contract

### Request

`POST /auth/logout`

```json
{
  "refreshToken": "rt_<tokenId>_<secret>"
}
```

MVP recommendation:

- do not require bearer auth
- use the refresh token as the revocation handle

That matches the real session primitive the app needs to destroy.

### Response

Return a simple idempotent success body:

```json
{
  "ok": true
}
```

### Error behavior

Recommended MVP behavior:

- malformed token format -> `401 auth_invalid`
- unknown, expired, or already-revoked token -> still return `200 { "ok": true }`

Why:

- logout should be idempotent
- the client should never be stuck in a half-logged-out state because the server says the session was already gone

## Recommended implementation shape

### 1. Reuse refresh parsing and hash helpers

Logout should reuse the same helpers added for the refresh endpoint:

- `parseRefreshToken`
- `hashRefreshTokenSecret`

### 2. Add shared token revocation helper

Recommended shared helper:

```ts
revokeRefreshToken(db, refreshToken): Promise<void>
```

Transaction steps:

1. parse token
2. lookup row by `token_id`
3. compare `token_hash`
4. if match and `revoked_at IS NULL`, set `revoked_at = now()`
5. return success even if row is already revoked or expired

### 3. Do not revoke by user alone in MVP

For the first pass, keep logout scoped to one refresh token.

Do not add `logout all devices` yet unless the thin client actually needs it.

## Pseudocode

```ts
export async function logoutAppSession(db, refreshToken) {
  const { tokenId, rawSecret } = parseRefreshToken(refreshToken);
  const tokenHash = hashRefreshTokenSecret(rawSecret);

  await db.withTransaction(async (client) => {
    const row = await client.query(
      `select token_id::text, token_hash, revoked_at
       from app_refresh_tokens
       where token_id = $1
       for update`,
      [tokenId]
    );

    const token = row.rows[0];
    if (!token) return;
    if (token.token_hash !== tokenHash) return;
    if (token.revoked_at) return;

    await client.query(
      `update app_refresh_tokens
       set revoked_at = now()
       where token_id = $1`,
      [tokenId]
    );
  });
}
```

## Patch sketch

```diff
diff --git a/src/types.ts b/src/types.ts
+export interface LogoutBody {
+  refreshToken: string;
+}

diff --git a/src/routes/auth.ts b/src/routes/auth.ts
+  app.post<{ Body: LogoutBody }>('/auth/logout', {
+    schema: { body: logoutBodySchema }
+  }, async (request, reply) => {
+    await logoutAppSession(deps.db, request.body.refreshToken);
+    return reply.code(200).send({ ok: true });
+  });
```

## Test plan

### Integration

Add one test:

1. create session
2. call logout with valid refresh token
3. assert `revoked_at` is set
4. call refresh with the same token
5. assert refresh fails with `401`

### Idempotency

Call logout twice with the same token and assert both return `200`.

## Optional future extension

Later, if the client needs it:

```json
{
  "refreshToken": "rt_...",
  "allSessions": true
}
```

That would revoke all `app_refresh_tokens` rows for the current user, but it is not required for the first pass.
