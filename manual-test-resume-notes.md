# Manual Test Resume Notes

## Snapshot

Last updated: April 5, 2026

The backend was manually validated for:

- Bungie OAuth start
- Bungie callback through ngrok
- handoff ticket consume
- `/me`
- one-account party flow:
  - create
  - list
  - detail
  - cancel

Do not rely on previously issued access or refresh tokens in this note. Generate a fresh session when resuming.

## Current local setup

Working local runtime settings are in [`.env`](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/.env).

Important values:

- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/marathon_lfg`
- `BUNGIE_REDIRECT_URI=https://9a9c-73-169-46-127.ngrok-free.app/auth/bungie/callback`
- `APP_UNIVERSAL_LINK_BASE=http://localhost:3000`

Important caution:

- the ngrok URL is a free URL and may rotate
- if it rotates, update both:
  - Bungie application redirect URL in the Bungie portal
  - `BUNGIE_REDIRECT_URI` in [`.env`](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/.env)

## What worked

### Bungie auth

The native/manual OAuth flow worked end to end once the config was corrected:

1. `POST /auth/bungie/start` returned `loginId` and `authorizeUrl`
2. Bungie redirected to `BUNGIE_REDIRECT_URI`
3. Backend redirected to `http://localhost:3000/auth/handoff?...`
4. The handoff URL in the browser returned `404`, but that is expected in this repo
5. The handoff `ticket` plus `loginId` were exchanged via `POST /auth/bungie/handoff/consume`
6. `GET /me` returned a valid Bungie-linked, Marathon-verified user

Observed `/me` result at that time:

- Bungie membership id: `11417346`
- Bungie display name: `deadceleberty`
- Marathon membership id present
- `marathon.verified = true`

### One-account party flow

The following path succeeded using the authenticated account:

1. `POST /parties`
2. `GET /parties`
3. `GET /parties/:partyId`
4. `POST /parties/:partyId/cancel`

Observed created party once during testing:

- `partyId`: `8ad4dfa4-f644-4948-a749-edc59d18070c`
- initial status: `open`
- cancel result: `cancelled`

That specific party is only historical context. Create a fresh one next time.

## Issues encountered and how they were resolved

### 1. Stale backend process on port 3000

Problem:

- an older Node process was still listening on `3000`
- it was serving an outdated build where `GET /parties` still returned `501 not_implemented`

Fix:

- identify the process with `lsof -nP -iTCP:3000 -sTCP:LISTEN`
- stop the stale process
- rebuild with `npm run build`
- restart the current backend with `node dist/server.js`

### 2. Docker/Postgres was not running

Problem:

- `/auth/bungie/start` failed with DB connection errors

Fix:

- start Docker Desktop
- run `docker compose up -d postgres`
- confirm health with `docker ps --filter name=marathon-lfg-postgres`

### 3. ngrok URL changed

Problem:

- Bungie redirect URL was set to an old free ngrok URL
- Bungie redirected to a dead tunnel

Fix:

- inspect the active tunnel at `http://127.0.0.1:4040/api/tunnels`
- update the Bungie app portal redirect URL
- update `BUNGIE_REDIRECT_URI` in [`.env`](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/.env)

### 4. Opened ngrok root `/` instead of `/health`

Problem:

- visiting the bare public tunnel root returned `404`
- this looked like tunnel failure at first

Cause:

- this backend does not implement `GET /`

Fix:

- verify tunnel health with:
  - `https://<ngrok-host>/health`
- expected result:
  - `{"ok":true}`

### 5. Bungie client secret was copied incorrectly

Problem:

- Bungie callback reached the backend
- token exchange then failed with a `500`
- backend log showed JSON parse failure from upstream response

Cause:

- the client secret copied from a screenshot contained transcription errors

Fix:

- compare `.env` against the Bungie portal directly
- correct the secret exactly
- restart the backend

### 6. `/auth/handoff` returned `404`

Problem:

- after Bungie callback, the browser landed on `/auth/handoff?...` and showed a not-found response

Status:

- expected for the current manual setup
- not a backend auth failure

Reason:

- the backend uses `/auth/handoff` only as the URL that carries `ticket` and `loginId`
- the repo does not implement a frontend page for that path

Correct action:

- copy `ticket` and `loginId` from the browser URL
- call `POST /auth/bungie/handoff/consume`

## Fast resume checklist

1. Start Docker Desktop if needed.
2. From repo root run:

   ```bash
   docker compose up -d postgres
   npm run build
   node dist/server.js
   ```

3. Verify local API:

   ```bash
   curl -i http://127.0.0.1:3000/health
   ```

4. Check active ngrok tunnel:

   ```bash
   curl -s http://127.0.0.1:4040/api/tunnels
   ```

5. If ngrok changed, update:

   - Bungie portal redirect URL
   - `BUNGIE_REDIRECT_URI` in [`.env`](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/.env)

6. Verify tunnel health in a browser:

   ```text
   https://<active-ngrok-host>/health
   ```

7. Generate a fresh login:

   ```bash
   curl -s -X POST http://127.0.0.1:3000/auth/bungie/start \
     -H 'Content-Type: application/json' \
     -d '{"platform":"ios","appState":"manual-test","redirectMode":"native"}'
   ```

8. Open the returned `authorizeUrl`.
9. Copy `ticket` and `loginId` from the `/auth/handoff?...` URL.
10. Exchange them:

   ```bash
   curl -s -X POST http://127.0.0.1:3000/auth/bungie/handoff/consume \
     -H 'Content-Type: application/json' \
     -d '{"ticket":"<ticket>","loginId":"<loginId>"}'
   ```

11. Verify session:

   ```bash
   curl -s http://127.0.0.1:3000/me \
     -H "Authorization: Bearer <accessToken>"
   ```

## Next manual test to run

Two-user flow with a friend:

1. Host authenticates
2. Member authenticates
3. Host creates party
4. Member joins
5. Find `memberId` in Postgres
6. Host accepts
7. Member leaves or host kicks

DB lookup for `memberId`:

```bash
docker compose exec postgres psql -U postgres -d marathon_lfg
```

```sql
select id, party_id, user_id, status
from party_members
where party_id = 'YOUR_PARTY_ID'
order by created_at desc, id desc;
```

## Cleanup note

The current repo does not implement a browser page for `/auth/handoff`. If repeated manual testing becomes common, adding a tiny debug page that just displays `ticket` and `loginId` would remove the recurring 404 confusion.
