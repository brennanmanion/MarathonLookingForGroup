# PWA Pivot Resume Notes

## Current branch

- `codex/pwa-pivot`

## Where we left off

The backend PWA pivot is past the auth/bootstrap stage and now supports the first real browser-side writes.

Implemented and working:

- web Bungie login start/callback into cookie sessions
- `GET /auth/session`
- cookie-based `POST /auth/refresh`
- cookie-based `POST /auth/logout`
- `/me` as the authenticated PWA bootstrap payload
- `/me/bungie/resync` with cookie auth + CSRF
- `/app` browser shell
- browser-shell party feed and party detail
- browser-shell party create
- browser-shell party join
- browser-shell party leave
- browser-shell party cancel
- browser-shell host moderation:
  - accept
  - decline
  - kick
- Swagger UI at `/docs`
- checked-in OpenAPI spec at `/openapi.yaml`

Native handoff auth is still present. This branch has not removed the earlier native flow.

## Key backend files

- [src/users.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/users.ts)
- [src/cookies.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/cookies.ts)
- [src/routes/auth.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/routes/auth.ts)
- [src/routes/me.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/routes/me.ts)
- [src/routes/parties.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/routes/parties.ts)
- [src/routes/web.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/routes/web.ts)
- [src/app.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/app.ts)

## Key frontend shell files

- [apps/web/index.html](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web/index.html)
- [apps/web/assets/app.js](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web/assets/app.js)
- [apps/web/assets/app.css](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web/assets/app.css)
- [apps/web/manifest.webmanifest](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web/manifest.webmanifest)

## Test status

These all passed before stopping:

- `npm run check`
- `npm run check:tests`
- `npm run build`
- `npm run test:integration`

Integration suite status at stop:

- `17` passing
- `0` failing

Most relevant test files:

- [test/auth-bungie-flow.integration.test.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/test/auth-bungie-flow.integration.test.ts)
- [test/auth-refresh.integration.test.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/test/auth-refresh.integration.test.ts)
- [test/party-read.integration.test.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/test/party-read.integration.test.ts)
- [test/party-web-write.integration.test.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/test/party-web-write.integration.test.ts)
- [test/web-shell.integration.test.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/test/web-shell.integration.test.ts)

## Manual smoke that passed

Live smoke was run against a temporary built server on `http://127.0.0.1:3002` with `WEB_APP_BASE_URL=http://127.0.0.1:3002/app/`.

Confirmed with real curl requests:

- `GET /health`
- `GET /app/parties`
- cookie-authenticated `GET /auth/session`
- cookie-authenticated `POST /parties`
- cookie-authenticated `POST /parties/:partyId/join`
- cookie-authenticated `POST /parties/:partyId/leave`
- cookie-authenticated `POST /parties/:partyId/cancel`

Smoke-test party created during that run:

- `fa88bb25-925c-4396-a838-34e1b64e1497`

Note:

- a later follow-up read using the same seeded access token returned `auth_expired`, which is expected because access tokens are short-lived
- the server used for smoke was shut down afterward

## Important design state

- cookie-authenticated mutation is no longer blanket-blocked
- route-level CSRF enforcement is the browser mutation boundary
- `/me` advertises browser write capabilities
- host moderation is now available in the shell
- `/docs` is a simple in-repo Swagger UI page that loads `/openapi.yaml`
- `PATCH /parties/:partyId` is still deferred and returns `501 party_edit_deferred`

## Recommended next step

Primary next step:

- decide whether to implement party editing or move into production-hardening work for the PWA path

Best immediate engineering option:

- document production deployment assumptions:
  - same-origin preferred
  - HTTPS required
  - cookie domain strategy
  - real web app host instead of localhost

Secondary option:

- expand the shell into richer host/member flows such as accepted roster presentation, moderation history, or party editing once that endpoint exists

## Restart checklist

From [the repo root](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup):

1. Start Postgres:
   `docker compose up -d postgres`
2. Re-run verification:
   `npm run test:integration`
3. Build:
   `npm run build`
4. Start the server for local shell work:
   `WEB_APP_BASE_URL=http://127.0.0.1:3002/app/ PORT=3002 node dist/server.js`
5. Open:
   `http://127.0.0.1:3002/app/parties`

## Worktree note

There are still unstaged local changes on this branch, including:

- `apps/web/`
- `src/cookies.ts`
- `src/routes/web.ts`
- `test/party-read.integration.test.ts`
- `test/party-web-write.integration.test.ts`
- `test/web-shell.integration.test.ts`
- related updates in `src/` and `README.md`

Do not assume this branch is committed yet.
