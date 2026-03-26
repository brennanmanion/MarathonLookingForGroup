# MarathonLookingForGroup

Initial backend scaffold for the Marathon LFG MVP.

## Stack

- TypeScript
- Fastify
- PostgreSQL

## Current status

- Project config and runtime scaffold are in place.
- Native Bungie auth start, callback, and handoff consume routes are implemented.
- Bearer-token auth is wired for `/me`, `POST /parties`, and `POST /parties/:partyId/join`.
- The initial SQL migration is in `migrations/0001_init.sql`.
- `/me`, `POST /parties`, and `POST /parties/:partyId/join` are implemented.
- Host moderation for pending-to-accepted lifecycle is implemented with accept, decline, and kick routes.
- Bungie resync, leave, cancel, list, and detail flows are still stubbed with `501 not_implemented`.

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

If another Codex thread opens this repo later, it should use the backend workspace here:

```bash
cd MarathonLookingForGroup
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
node dist/server.js
```

Use `npm run build` first if `dist/` is stale.

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
- Redirects to the configured Universal Link/App Link handoff URL with a one-time ticket.

`POST /auth/bungie/handoff/consume`

- Consumes a one-time handoff ticket.
- Returns a first-party access token and refresh token.

`GET /me`

- Requires `Authorization: Bearer <accessToken>`.
- Returns the current app user plus Bungie and Marathon verification state.

`POST /parties`

- Requires bearer auth and `marathon_verified = true`.
- Creates a party and optional tags.

`POST /parties/:partyId/join`

- Requires bearer auth.
- Enforces the merged spec's reapply rules for `accepted`, `pending`, and `kicked`.

`POST /parties/:partyId/members/:memberId/accept`

- Requires bearer auth.
- Requires the caller to be the party host.
- Transitions a pending membership to `accepted` and updates capacity.

`POST /parties/:partyId/members/:memberId/decline`

- Requires bearer auth.
- Requires the caller to be the party host.
- Transitions a pending membership to `declined`.

`POST /parties/:partyId/members/:memberId/kick`

- Requires bearer auth.
- Requires the caller to be the party host.
- Transitions a pending or accepted membership to `kicked` and reopens the party if capacity frees up.
