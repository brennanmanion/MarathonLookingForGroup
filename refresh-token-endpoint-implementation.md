# Refresh Token Endpoint Implementation

## Goal

Add `POST /auth/refresh` so the client can exchange a valid app refresh token for:

- a new access token
- a rotated refresh token

The old refresh token must be revoked in the same transaction.

## Current codebase fit

Relevant files:

- `src/routes/auth.ts`
- `src/session.ts`
- `src/bungie.ts`
- `src/types.ts`
- `migrations/0001_init.sql`

Current useful pieces already exist:

- refresh tokens are issued in `consumeHandoffTicket`
- refresh tokens are stored in `app_refresh_tokens`
- access tokens are already signed and verified in `src/session.ts`

Current missing pieces:

- no refresh-token parser
- no shared app-session service
- no route contract for token refresh

## Recommended route contract

### Request

`POST /auth/refresh`

```json
{
  "refreshToken": "rt_<tokenId>_<secret>"
}
```

### Response

Reuse the same shape as handoff consume:

```json
{
  "accessToken": "v1....",
  "refreshToken": "rt_<newTokenId>_<newSecret>",
  "expiresIn": 900,
  "refreshExpiresIn": 7776000
}
```

### Error behavior

- malformed token -> `401 auth_invalid`
- unknown token -> `401 auth_invalid`
- revoked token -> `401 auth_invalid`
- expired token -> `401 auth_expired`
- missing DB or session secret -> existing `503` config/DB errors

## Recommended implementation shape

### 1. Add shared refresh-token helpers in `src/session.ts`

Add:

- `parseRefreshToken(token: string): { tokenId: string; rawSecret: string }`
- `hashRefreshTokenSecret(rawSecret: string): string`

`issueRefreshToken()` should keep the current format:

```text
rt_<tokenId>_<rawSecret>
```

That lets the backend:

1. parse `tokenId`
2. hash `rawSecret`
3. compare against `app_refresh_tokens.token_hash`

### 2. Move app-session storage logic out of `src/bungie.ts`

Recommended new file:

- `src/app-sessions.ts`

Responsibilities:

- issue and persist access/refresh tokens
- rotate a refresh token
- revoke a refresh token

This avoids leaving first-party session logic mixed into Bungie OAuth flow.

### 3. Implement refresh rotation

Transaction steps:

1. parse refresh token
2. `SELECT ... FOR UPDATE` from `app_refresh_tokens`
3. reject if not found
4. reject if `revoked_at IS NOT NULL`
5. reject if `expires_at <= now()`
6. load current user to ensure `is_active = true`
7. set current row `revoked_at = now()`
8. issue new access token
9. issue new refresh token
10. insert new `app_refresh_tokens` row for the same user
11. return both tokens

Use the existing `created_by_login_id` from the old row when inserting the rotated row.

## Pseudocode

```ts
export async function refreshAppSession(db, config, body, metadata) {
  const { tokenId, rawSecret } = parseRefreshToken(body.refreshToken);
  const tokenHash = hashRefreshTokenSecret(rawSecret);

  return db.withTransaction(async (client) => {
    const row = await loadRefreshTokenForUpdate(client, tokenId);
    if (!row || row.token_hash !== tokenHash) throw authInvalid();
    if (row.revoked_at) throw authInvalid();
    if (row.expires_at <= now()) throw authExpired();

    await assertUserActive(client, row.user_id);

    await revokeRefreshTokenRow(client, row.token_id);

    const accessToken = issueAccessToken(config, row.user_id);
    const refreshToken = issueRefreshToken();

    await insertRefreshTokenRow(client, {
      tokenId: refreshToken.tokenId,
      userId: row.user_id,
      tokenHash: refreshToken.tokenHash,
      createdByLoginId: row.created_by_login_id,
      expiresAt: refreshToken.expiresAt,
      ip: metadata.ip,
      userAgent: metadata.userAgent
    });

    return {
      accessToken: accessToken.token,
      refreshToken: refreshToken.token,
      expiresIn: accessToken.expiresIn,
      refreshExpiresIn: refreshToken.expiresIn
    };
  });
}
```

## Patch sketch

This is the patch I would expect to apply with high confidence.

```diff
diff --git a/src/types.ts b/src/types.ts
+export interface RefreshTokenBody {
+  refreshToken: string;
+}

diff --git a/src/session.ts b/src/session.ts
+export function parseRefreshToken(token: string): { tokenId: string; rawSecret: string } {
+  const parts = token.split('_');
+  if (parts.length !== 3 || parts[0] !== 'rt' || !parts[1] || !parts[2]) {
+    throw new AppError(401, 'auth_invalid', 'Invalid refresh token');
+  }
+  return { tokenId: parts[1], rawSecret: parts[2] };
+}
+
+export function hashRefreshTokenSecret(rawSecret: string): string {
+  return createHash('sha256').update(rawSecret).digest('hex');
+}

diff --git a/src/routes/auth.ts b/src/routes/auth.ts
+  app.post<{ Body: RefreshTokenBody }>('/auth/refresh', {
+    schema: { body: refreshBodySchema }
+  }, async (request, reply) => {
+    const result = await refreshAppSession(deps.db, deps.config, request.body, {
+      ip: request.ip,
+      userAgent: request.headers['user-agent']
+    });
+    return reply.code(200).send(result);
+  });
```

## Test plan

### Integration

Add one integration test:

1. mint session via handoff or seed a refresh token row
2. call `POST /auth/refresh`
3. assert old refresh token is revoked
4. assert new refresh token row exists
5. assert second use of old token fails with `401`

### Edge cases

- revoked token
- expired token
- malformed token string
- inactive user

## Optional hardening after MVP

Optional migration:

```sql
alter table app_refresh_tokens
  add column replaced_by_token_id uuid references app_refresh_tokens(token_id),
  add column last_used_at timestamptz;
```

That enables replay detection and better audit trails, but it is not required for the first implementation.
