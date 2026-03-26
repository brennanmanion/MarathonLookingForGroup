# Marathon LFG Backend Status Summary

## Snapshot

- Date: 2026-03-26
- Working branch: `codex/review-backend-implementation`
- Repo path: `/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup`
- Planning baseline: `marathon-lfg-backend-implementation-merged.md`

This repo started effectively empty and now has an initial backend scaffold, schema migration, local Docker Postgres support, and the first implemented auth and party flows.

## What is implemented

### Project scaffold

- TypeScript + Fastify backend scaffold
- PostgreSQL adapter using `pg`
- Build/dev scripts in `package.json`
- Environment loading via `.env`
- Basic app error handling and route registration

### Database

- Initial schema in `migrations/0001_init.sql`
- Local Docker Postgres config in `compose.yaml`
- Migration has been applied to the local Docker database
- Verified tables currently present:
  - `app_users`
  - `bungie_accounts`
  - `bungie_oauth_tokens`
  - `auth_login_transactions`
  - `auth_handoff_tickets`
  - `app_refresh_tokens`
  - `parties`
  - `party_members`
  - `party_member_events`
  - `party_tags`

### Auth flow

Implemented routes:

- `POST /auth/bungie/start`
- `GET /auth/bungie/callback`
- `POST /auth/bungie/handoff/consume`
- `GET /me`

Implemented behavior:

- Native Bungie login start creates a login transaction and returns a Bungie authorize URL
- Bungie callback:
  - validates stored OAuth state
  - exchanges the auth code with Bungie
  - fetches current membership data
  - upserts local user + Bungie account state
  - stores Bungie tokens server-side
  - creates a one-time native handoff ticket
  - redirects to the configured Universal Link / App Link handoff URL
- Handoff consume:
  - validates single-use ticket
  - mints first-party access token
  - mints first-party refresh token
  - stores hashed refresh token in the database
- `/me` returns current user, Bungie identity, and Marathon verification state

### Party flow

Implemented routes:

- `POST /parties`
- `POST /parties/:partyId/join`
- `POST /parties/:partyId/members/:memberId/accept`
- `POST /parties/:partyId/members/:memberId/decline`
- `POST /parties/:partyId/members/:memberId/kick`

Implemented behavior:

- Party creation requires authenticated user and `marathon_verified = true`
- Join flow:
  - locks the party row
  - respects current capacity
  - enforces reapply rules
  - blocks `kicked`
  - writes `party_member_events`
- Host moderation:
  - host ownership enforced from `parties.host_user_id`
  - accept moves pending -> accepted
  - decline moves pending -> declined
  - kick moves pending/accepted -> kicked
  - capacity and party `open`/`full` state are synchronized during these transitions

## What has been verified

### Build verification

- `npm install` completed successfully
- `npm run check` passes
- `npm run build` passes

### App wiring verification

- Fastify in-process smoke test for `/health` returned `200`
- In-process smoke test for `/auth/bungie/start` returned expected `503 db_unavailable` when no DB was configured

### Database-backed flow verification

A live smoke test was run against the local Docker Postgres instance for:

1. create party
2. join as pending member
3. accept pending member
4. kick accepted member

Observed result:

- create -> `filledSlots=1`, `openSlots=1`, `status=open`
- join -> `myStatus=pending`
- accept -> `memberStatus=accepted`, `filledSlots=2`, `openSlots=0`, `partyStatus=full`
- kick -> `memberStatus=kicked`, `filledSlots=1`, `openSlots=1`, `partyStatus=open`

That path is currently working end-to-end against the local Postgres database.

## Current implementation shape

Key files:

- `src/server.ts`
- `src/app.ts`
- `src/config.ts`
- `src/db.ts`
- `src/errors.ts`
- `src/session.ts`
- `src/users.ts`
- `src/bungie.ts`
- `src/parties.ts`
- `src/routes/auth.ts`
- `src/routes/me.ts`
- `src/routes/parties.ts`
- `migrations/0001_init.sql`
- `compose.yaml`

## Important implementation choice currently in code

The implementation currently follows the merged implementation note, not the earlier derived-only recommendation:

- `bungie_verified` is persisted on `bungie_accounts`
- `marathon_verified` is also persisted on `bungie_accounts`

That means the codebase is presently aligned with the merged spec’s explicit verification fields rather than the earlier proposal to derive Bungie verification only from linkage state.

## What is still not implemented

### Auth / user

- Web-mode Bungie login flow
- Logout
- Bungie token refresh flow
- `/me/bungie/resync`
- Real refresh-token rotation endpoint for app sessions
- Real Bungie OAuth end-to-end test against live Bungie credentials

### Party API

- `GET /parties`
- `GET /parties/:partyId`
- `PATCH /parties/:partyId`
- `POST /parties/:partyId/leave`
- `POST /parties/:partyId/cancel`

### Operational work

- Automated tests
- Migration/versioning strategy beyond the single init file
- Docker/API startup polish
- Better README cleanup
- Production-grade auth hardening beyond the current scaffold

## Known caveats / cleanup items

- README still has reviewed issues around “another thread” working-directory assumptions and `dist/` startup assumptions
- There is no formal test suite yet; verification so far is compile/build plus smoke tests
- Some routes still intentionally return `501 not_implemented`
- The access token format is a custom HMAC-signed bearer token for scaffolding, not a full OAuth/JWT ecosystem
- The database migration file is doing both greenfield schema creation and repeated local apply usage; future migrations should be split cleanly

## Local environment status

- Docker Postgres container `marathon-lfg-postgres` is running and healthy
- The local database name is `marathon_lfg`
- Current connection string used for local verification:

```text
postgres://postgres:postgres@127.0.0.1:5432/marathon_lfg
```

## Suggested next planning areas

1. Decide whether to keep the current explicit `bungie_verified` schema or refactor toward a derived linkage model.
2. Finish the remaining party lifecycle endpoints: leave, cancel, detail/list, and host moderation edge cases.
3. Add token refresh and Bungie resync paths.
4. Add automated integration tests around auth and party capacity transitions.
5. Clean up README and establish a proper migration workflow.
