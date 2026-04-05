# CODEX Notes

## Purpose

This file is a project-local handoff note for future Codex sessions.

Important:

- actual permission enforcement and approved command prefixes are managed by the Codex app
- this file is only a reminder of what the user has been comfortable allowing in this workspace

## Repo

Primary repo root:

- [MarathonLookingForGroup](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup)

Parent workspace:

- `/Users/brennan/Documents/MaratonLookingForGroup`

## User-approved working style in this repo

The user has been comfortable with Codex doing the following when needed:

- start Docker Postgres locally
- inspect Docker container status
- build and run the backend locally
- make local HTTP requests to the backend on `3000` and `3001`
- make local HTTP requests to the ngrok inspector on `127.0.0.1:4040`
- make public HTTP requests to the active ngrok `/health` URL for diagnostics
- stop a stale local Node process on port `3000` when it is serving an outdated build
- update local non-committed runtime config in [`.env`](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/.env)

## Common commands used successfully

Run from repo root unless a future task requires otherwise.

### Local infra

```bash
docker compose up -d postgres
docker ps --filter name=marathon-lfg-postgres
docker compose exec postgres psql -U postgres -d marathon_lfg
```

### Build and test

```bash
npm install
npm run build
npm run test:integration
```

### Run backend

```bash
node dist/server.js
```

Notes:

- `npm run dev` can fail in the sandbox because `tsx watch` tries to open an IPC pipe
- use `node dist/server.js` after `npm run build` when that happens

### Local HTTP checks

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://localhost:3000/health
curl -s http://127.0.0.1:3000/parties
curl -s http://127.0.0.1:3000/me -H "Authorization: Bearer <accessToken>"
```

### Auth flow helpers

```bash
curl -s -X POST http://127.0.0.1:3000/auth/bungie/start \
  -H 'Content-Type: application/json' \
  -d '{"platform":"ios","appState":"manual-test","redirectMode":"native"}'

curl -s -X POST http://127.0.0.1:3000/auth/bungie/handoff/consume \
  -H 'Content-Type: application/json' \
  -d '{"ticket":"<ticket>","loginId":"<loginId>"}'

curl -s -X POST http://127.0.0.1:3000/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

### ngrok diagnostics

```bash
curl -s http://127.0.0.1:4040/api/tunnels
curl -i https://<active-ngrok-host>/health
```

## Known local environment facts

As of April 5, 2026:

- local API expected on `http://127.0.0.1:3000`
- local Postgres expected on `localhost:5432`
- ngrok free URL may rotate frequently
- if ngrok rotates, both Bungie portal and `BUNGIE_REDIRECT_URI` must be updated

## Important product and debugging notes

### `/auth/handoff` 404 is expected in manual testing

The repo does not implement a frontend page for `/auth/handoff`.

That path is still useful because it carries:

- `ticket`
- `loginId`
- `appState`

During manual testing:

- capture those values from the browser URL
- then call `POST /auth/bungie/handoff/consume`

### Tunnel health check

Do not test the tunnel by opening the bare root URL and expecting JSON.

Use:

```text
https://<active-ngrok-host>/health
```

The backend currently has no `GET /` route, so the root URL returns `404`.

### Common failure modes already seen

- stale process on `3000` serving an outdated build
- Docker not running, causing DB connection failures
- ngrok URL changed but Bungie portal and `.env` were still using the old callback
- Bungie secret copied incorrectly from a screenshot

## Related handoff note

Manual testing progress and recovery steps are documented in:

- [manual-test-resume-notes.md](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/manual-test-resume-notes.md)
