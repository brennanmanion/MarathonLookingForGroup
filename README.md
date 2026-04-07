# MarathonLookingForGroup

Initial backend scaffold for the Marathon LFG MVP.

## Stack

- TypeScript
- Fastify
- PostgreSQL

## Current status

- Project config and runtime scaffold are in place.
- Native Bungie auth start, callback, and handoff consume routes are implemented.
- Web Bungie login start/callback now set first-party cookies and redirect to a frontend callback route.
- First-party app session refresh is implemented.
- First-party logout is implemented via refresh-token revocation.
- Bearer-token auth is wired for `/me` and protected party mutations.
- Cookie-authenticated web sessions now support `/me`, `/me/bungie/resync`, and party mutations with CSRF enforcement.
- `GET /auth/session` is implemented for PWA bootstrap.
- Cookie-based web refresh and logout are implemented with CSRF enforcement.
- The first browser shell is served from `/app`.
- Swagger UI is served from `/docs`, backed by `/openapi.yaml`.
- The initial SQL migration is in `migrations/0001_init.sql`.
- `/me`, `POST /parties`, `GET /parties`, `GET /parties/:partyId`, and `POST /parties/:partyId/join` are implemented.
- Host moderation plus leave and cancel flows are implemented.
- Bungie resync is implemented.
- `PATCH /parties/:partyId` has a typed deferred placeholder and currently returns `501 party_edit_deferred`.

## Local setup

1. Start PostgreSQL with Docker:

   ```bash
   docker compose up -d postgres
   ```

   This creates a local `marathon_lfg` database on `localhost:5432` with the default credentials from `.env.example`, and applies `migrations/0001_init.sql` automatically on first boot.

2. Copy `.env.example` to `.env` and fill in Bungie values as needed.
3. Install dependencies with `npm install`.
4. Run the API with `npm run dev`.

To stop the database:

```bash
docker compose down
```

## Using Docker Postgres From Another Thread

If another Codex thread opens this repo later, run commands from the repository root:

```bash
cd /Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup
```

Start the database:

```bash
docker compose up -d postgres
```

Connection details:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/marathon_lfg
```

What this setup does:

- `compose.yaml` starts a `postgres:16-alpine` container named `marathon-lfg-postgres`.
- The SQL file at `migrations/0001_init.sql` is mounted into `/docker-entrypoint-initdb.d/`.
- That migration runs automatically only on first boot of the named Docker volume.

Useful commands for another thread:

```bash
docker ps --filter name=marathon-lfg-postgres
docker logs marathon-lfg-postgres
docker compose exec postgres psql -U postgres -d marathon_lfg
docker compose down
docker compose down -v
```

Reset behavior:

- `docker compose down` stops the container and preserves the database volume.
- `docker compose down -v` deletes the named volume, wipes the local database, and causes the init migration to run again on next startup.

If the thread needs the API as well:

```bash
npm install
npm run build
node dist/server.js
```

## Implemented endpoint

`POST /auth/bungie/start`

Example body:

```json
{
  "platform": "ios",
  "appState": "opaque-client-state",
  "redirectMode": "native"
}
```

Web example body:

```json
{
  "redirectMode": "web",
  "returnTo": "/app"
}
```

Example response:

```json
{
  "loginId": "uuid",
  "authorizeUrl": "https://www.bungie.net/en/OAuth/Authorize?client_id=...&response_type=code&state=..."
}
```

`GET /auth/bungie/callback`

- Validates the stored OAuth state.
- Exchanges the Bungie authorization code.
- Fetches membership data and upserts the local user + Bungie token state.
- For native logins, redirects to the configured Universal Link/App Link handoff URL with a one-time ticket.
- For web logins, creates a first-party session, sets auth cookies, and redirects to `WEB_APP_BASE_URL/auth/callback/success`.
- When the stored login transaction is web-mode and Bungie returns an OAuth error, redirects to `WEB_APP_BASE_URL/auth/callback/error`.

`POST /auth/bungie/handoff/consume`

- Consumes a one-time handoff ticket.
- Returns a first-party access token and refresh token.

`POST /auth/refresh`

- Accepts an app refresh token.
- Rotates the refresh token and returns a new access token plus new refresh token.
- Also supports cookie-based web refresh with `mlfg_rt` plus `X-CSRF-Token`.
- Web refresh rotates `mlfg_at`, `mlfg_rt`, and `mlfg_csrf` cookies.

`POST /auth/logout`

- Accepts an app refresh token.
- Revokes the current app refresh token for that session.
- Also supports cookie-based web logout with `X-CSRF-Token`.
- Clears `mlfg_at`, `mlfg_rt`, and `mlfg_csrf` cookies.

`GET /auth/session`

- PWA bootstrap route.
- Returns `{ "authenticated": false }` when there is no valid bearer or web-cookie session.
- Returns `{ "authenticated": true, "user": { "userId": "..." } }` when the current session is valid.

`GET /me`

- Accepts either `Authorization: Bearer <accessToken>` or the web auth cookie on safe read requests.
- Returns the full authenticated PWA bootstrap payload:
  - display/profile summary
  - Bungie and Marathon verification state
  - current web-shell capability flags
  - known PWA route metadata

`POST /me/bungie/resync`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Uses the stored Bungie OAuth session to refresh membership state.
- Refreshes the stored Bungie access token if needed.
- Updates Bungie identity fields and Marathon verification state.

`POST /parties`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Requires `marathon_verified = true`.
- Creates a party and optional tags.

`POST /parties/:partyId/join`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Enforces the merged spec's reapply rules for `accepted`, `pending`, and `kicked`.

`GET /parties`

- Public route.
- Returns public parties plus non-public parties visible to the current host or active member when viewer auth is provided.
- Includes computed capacity, tags, host identity, and the caller's latest membership state when available.

`GET /parties/:partyId`

- Public route for public non-cancelled parties.
- Also returns non-public or cancelled parties to the host or an active member when viewer auth is provided.
- Includes computed capacity, tags, host identity, and the caller's latest membership state when available.
- Includes a host-only `members` roster for pending and accepted members, which the browser shell uses for moderation.

`POST /parties/:partyId/leave`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Lets an accepted or pending member leave the party and records a `left` membership event.
- Hosts must use cancel instead of leave.

`POST /parties/:partyId/cancel`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Requires the caller to be the party host.
- Marks the party as `cancelled`.

`PATCH /parties/:partyId`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Accepts the planned host-edit body shape for fields like title, max size, schedule, requirements, description, and tags.
- Currently returns `501 party_edit_deferred` while party editing remains deferred from the active MVP.

`POST /parties/:partyId/members/:memberId/accept`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Requires the caller to be the party host.
- Transitions a pending membership to `accepted` and updates capacity.

`POST /parties/:partyId/members/:memberId/decline`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Requires the caller to be the party host.
- Transitions a pending membership to `declined`.

`POST /parties/:partyId/members/:memberId/kick`

- Requires bearer auth or a cookie-authenticated browser session with `X-CSRF-Token`.
- Requires the caller to be the party host.
- Transitions a pending or accepted membership to `kicked` and reopens the party if capacity frees up.

## PWA Production Setup

Recommended production shape:

- one public HTTPS origin for both the shell and API
- same-origin browser shell at `/app`
- leave `SESSION_COOKIE_DOMAIN` unset

Example:

- `https://lfg.example.com/app/`
- `https://lfg.example.com/auth/bungie/callback`
- `https://lfg.example.com/me`
- `https://lfg.example.com/parties`

Production env expectations:

- `WEB_APP_BASE_URL` should be an `https://` app base such as `https://lfg.example.com/app/`
- `BUNGIE_REDIRECT_URI` should be the matching `https://` callback URL
- `SESSION_COOKIE_DOMAIN` should stay blank for the recommended same-origin deployment

The deployment note is in [pwa-production-deployment.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/pwa-production-deployment.md).

Runtime note:

- production startup now fails fast if `WEB_APP_BASE_URL`, `BUNGIE_REDIRECT_URI`, or `APP_UNIVERSAL_LINK_BASE` are non-HTTPS
- production startup also rejects malformed `SESSION_COOKIE_DOMAIN` values

## Browser Shell

- The first same-origin web client is now scaffolded as a React + TypeScript + Vite app in [apps/web](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web).
- The backend serves the built frontend from `/app` when [apps/web/dist](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/apps/web/dist) exists.
- If the frontend has not been built yet, the backend falls back to the earlier legacy shell so `/app` still resolves during backend-only work.
- Implemented shell routes:
  - `/app`
  - `/app/login`
  - `/app/auth/callback/success`
  - `/app/auth/callback/error`
- Additional app routes:
  - `/app/parties`
  - `/app/parties/new`
  - `/app/parties/:partyId`
  - `/app/me`
- Static shell assets:
  - `/app/assets/*`
  - `/app/manifest.webmanifest`
  - `/app/icon.svg`
- The shell currently covers:
  - login start
  - callback completion
  - `/auth/session` bootstrap
  - `/me` bootstrap display
  - Bungie resync
  - party feed and party detail views backed by `/parties` and `/parties/:partyId`
  - party create, join, leave, and cancel
  - host member moderation for accept, decline, and kick
  - logout
- Frontend package commands:
  - `npm run check:web`
  - `npm run build:web`
  - `npm --prefix apps/web run dev`
- API docs are browseable at `/docs`.
