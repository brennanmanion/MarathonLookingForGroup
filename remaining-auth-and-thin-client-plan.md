# Remaining Auth And Thin Client Plan

## Scope

This plan covers the next four items after the currently implemented backend:

6. refresh-token endpoint
7. Bungie resync
8. logout
9. thin client

## Current backend baseline

Implemented now:

- `POST /auth/bungie/start`
- `GET /auth/bungie/callback`
- `POST /auth/bungie/handoff/consume`
- `GET /me`
- party create/read/join/accept/decline/kick/leave/cancel

Stored now:

- first-party refresh tokens in `app_refresh_tokens`
- Bungie OAuth tokens in `bungie_oauth_tokens`
- Bungie + Marathon verification state in `bungie_accounts`

Missing now:

- no first-party refresh endpoint
- no logout revocation endpoint
- no Bungie resync implementation
- no thin client implementation plan tied to the real backend contract

## Recommended coding order

Keep the roadmap labels as 6, 7, 8, 9, but the practical coding order should be:

1. Refresh-token endpoint
2. Logout
3. Bungie resync
4. Thin client

Why:

- refresh and logout should share refresh-token parsing and revocation helpers
- thin client should not be built against a temporary auth contract
- Bungie resync is backend-only but easier to expose cleanly once session management is settled

## Deliverables

### 6. Refresh-token endpoint

Goal:

- let the native client rotate a refresh token and obtain a new access token without redoing Bungie login

Main files:

- `src/routes/auth.ts`
- `src/session.ts`
- recommended new file: `src/app-sessions.ts`
- `src/types.ts`

Schema impact:

- none required for MVP
- optional future migration can add `replaced_by_token_id` and `last_used_at`

Acceptance criteria:

- valid refresh token returns new access token + new refresh token
- old refresh token is revoked in the same transaction
- revoked or expired refresh token cannot be reused

### 7. Bungie resync

Goal:

- refresh Bungie membership state on demand and keep `marathon_verified` accurate

Main files:

- `src/routes/me.ts`
- `src/bungie.ts` or a new `src/bungie-sync.ts`
- `src/users.ts`

Schema impact:

- none required for MVP

Acceptance criteria:

- route uses stored Bungie tokens only
- route refreshes Bungie access token if needed
- route updates `bungie_accounts` and `bungie_oauth_tokens`
- if Marathon membership disappears, `marathon_verified` becomes `false`

### 8. Logout

Goal:

- revoke the current app refresh token so the client can end a session explicitly

Main files:

- `src/routes/auth.ts`
- `src/session.ts`
- recommended shared helper in `src/app-sessions.ts`
- `src/types.ts`

Schema impact:

- none required for MVP

Acceptance criteria:

- valid logout call revokes the supplied refresh token
- logout is safe to call more than once
- client can clear local state after a successful response

### 9. Thin client

Goal:

- implement a client that treats this backend as the source of truth and keeps Bungie complexity server-side

Required backend assumptions before client work:

- handoff consume is stable
- refresh is stable
- logout is stable
- `/me` and `/me/bungie/resync` are stable

Acceptance criteria:

- client stores only first-party access + refresh tokens
- client never receives Bungie access or refresh tokens
- client auto-refreshes once on `401`
- client signs out cleanly on refresh failure

## Suggested execution checklist

1. Add shared app-session helpers so handoff consume, refresh, and logout stop duplicating token logic.
2. Implement `POST /auth/refresh`.
3. Add integration coverage for handoff consume -> refresh -> logout.
4. Implement `POST /auth/logout`.
5. Implement `POST /me/bungie/resync`.
6. Add client contract notes for response payloads and failure handling.
7. Build the thin client around those stable contracts.

## Risks to watch

- refresh token rotation without a shared helper will duplicate security logic
- Bungie resync can silently drift if stale-token handling is not explicit
- logout that only clears local storage is not real logout
- a client that knows too much about Bungie flow will be expensive to change later

## Files in this planning set

- `refresh-token-endpoint-implementation.md`
- `bungie-resync-implementation.md`
- `logout-endpoint-implementation.md`
- `thin-client-implementation.md`
