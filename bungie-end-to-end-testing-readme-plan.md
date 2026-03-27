# Bungie End-To-End Testing README Plan

## Goal

Make the README good enough for a developer to run a real Bungie-backed auth test without guessing the missing steps.

The current README describes the endpoints, but it does not yet provide a reliable end-to-end recipe for:

- configuring Bungie OAuth
- stepping through the native redirect flow
- manually consuming the handoff ticket
- validating refresh, resync, and logout afterward

## Current codebase fit

Relevant files:

- `README.md`
- `src/routes/auth.ts`
- `src/routes/me.ts`
- `src/bungie.ts`

Current backend behavior:

- `POST /auth/bungie/start` returns an authorize URL
- Bungie redirects back to `GET /auth/bungie/callback`
- callback redirects to `APP_UNIVERSAL_LINK_BASE/auth/handoff?...`
- `POST /auth/bungie/handoff/consume` exchanges the one-time ticket for first-party tokens

That is enough for manual testing today. The README just needs to explain it clearly.

## Recommended README sections

Add a dedicated section:

`## Bungie End-To-End Testing`

Subsections:

1. Prerequisites
2. Environment variables
3. Start Postgres and the API
4. Run the native OAuth flow manually
5. Exchange the handoff ticket
6. Verify `/me`, refresh, resync, and logout
7. Troubleshooting

## Recommended content

### 1. Prerequisites

Spell out these assumptions:

- you have a Bungie application registered
- the Bungie app has the exact callback URI configured
- the local server can receive the Bungie callback
- `APP_UNIVERSAL_LINK_BASE` is set to something you can inspect

Important note to include:

For backend-only manual testing, the app link does not need to open a real mobile app. You only need to capture the final redirect URL so you can copy `ticket` and `loginId` into `POST /auth/bungie/handoff/consume`.

### 2. Environment variables

Add one explicit block:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/marathon_lfg
BUNGIE_CLIENT_ID=...
BUNGIE_CLIENT_SECRET=...
BUNGIE_API_KEY=...
BUNGIE_REDIRECT_URI=http://127.0.0.1:3000/auth/bungie/callback
APP_UNIVERSAL_LINK_BASE=https://app.example.test
APP_SESSION_SECRET=replace-me
```

If the team keeps using `localhost` instead of `127.0.0.1`, keep the URI consistent everywhere. OAuth callback mismatches are usually exact-string problems.

### 3. Start the stack

Recommended commands:

```bash
docker compose up -d postgres
npm install
npm run build
node dist/server.js
```

Optional dev mode:

```bash
npm run dev
```

### 4. Start Bungie login

Document a real command:

```bash
curl -sS -X POST http://127.0.0.1:3000/auth/bungie/start \
  -H 'content-type: application/json' \
  -d '{"platform":"ios","appState":"manual-readme-test","redirectMode":"native"}'
```

Explain the result:

- copy the `authorizeUrl`
- open it in a browser
- sign in to Bungie
- approve access

### 5. Capture the callback redirect

This is the part the current README needs most.

The developer should know that after Bungie redirects to the backend callback, the backend will immediately redirect again to:

```text
APP_UNIVERSAL_LINK_BASE/auth/handoff?ticket=...&loginId=...&appState=...
```

Ways to capture it:

- browser devtools network panel
- server-side logs if redirect logging is added later
- a controlled test domain that shows the final URL

The README should explicitly say:

Copy `ticket` and `loginId` from that final redirect URL.

### 6. Consume the handoff

Add a direct example:

```bash
curl -sS -X POST http://127.0.0.1:3000/auth/bungie/handoff/consume \
  -H 'content-type: application/json' \
  -d '{"ticket":"<ticket>","loginId":"<loginId>"}'
```

Explain what to save:

- `accessToken`
- `refreshToken`

### 7. Verify the session

Add concrete curl steps:

```bash
curl -sS http://127.0.0.1:3000/me \
  -H "authorization: Bearer <accessToken>"
```

```bash
curl -sS -X POST http://127.0.0.1:3000/auth/refresh \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

```bash
curl -sS -X POST http://127.0.0.1:3000/me/bungie/resync \
  -H "authorization: Bearer <accessToken>"
```

```bash
curl -sS -X POST http://127.0.0.1:3000/auth/logout \
  -H 'content-type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

## Troubleshooting section to add

Recommended bullets:

- `config_missing`: missing Bungie or session env vars
- `bungie_state_invalid`: the callback state is expired, already consumed, or from a different DB instance
- `handoff_ticket_expired`: the handoff ticket lifetime is only 60 seconds
- `bungie_auth_failed`: Bungie token exchange or membership lookup failed
- `db_unavailable`: `DATABASE_URL` is unset or the database is not reachable

## Patch-ready README block

If you want to patch the README directly later, this is the section I would insert with only minor wording edits:

```md
## Bungie End-To-End Testing

1. Start Postgres and the API:

   ```bash
   docker compose up -d postgres
   npm install
   npm run build
   node dist/server.js
   ```

2. Set these environment variables in `.env`:

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/marathon_lfg
   BUNGIE_CLIENT_ID=...
   BUNGIE_CLIENT_SECRET=...
   BUNGIE_API_KEY=...
   BUNGIE_REDIRECT_URI=http://127.0.0.1:3000/auth/bungie/callback
   APP_UNIVERSAL_LINK_BASE=https://app.example.test
   APP_SESSION_SECRET=replace-me
   ```

3. Start the login flow:

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/auth/bungie/start \
     -H 'content-type: application/json' \
     -d '{"platform":"ios","appState":"manual-readme-test","redirectMode":"native"}'
   ```

4. Copy the returned `authorizeUrl`, open it in a browser, and complete Bungie login.

5. After Bungie redirects back to the backend, the backend will redirect again to:

   ```text
   APP_UNIVERSAL_LINK_BASE/auth/handoff?ticket=...&loginId=...&appState=...
   ```

   Copy `ticket` and `loginId` from that final redirect URL.

6. Exchange the handoff ticket:

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/auth/bungie/handoff/consume \
     -H 'content-type: application/json' \
     -d '{"ticket":"<ticket>","loginId":"<loginId>"}'
   ```

7. Verify the returned tokens:

   ```bash
   curl -sS http://127.0.0.1:3000/me \
     -H "authorization: Bearer <accessToken>"
   ```

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/auth/refresh \
     -H 'content-type: application/json' \
     -d '{"refreshToken":"<refreshToken>"}'
   ```

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/me/bungie/resync \
     -H "authorization: Bearer <accessToken>"
   ```

   ```bash
   curl -sS -X POST http://127.0.0.1:3000/auth/logout \
     -H 'content-type: application/json' \
     -d '{"refreshToken":"<refreshToken>"}'
   ```
```

## Practical follow-up

If the team keeps testing native auth manually, consider adding a tiny debug page later that simply echoes query params from `/auth/handoff`. That is optional, but it would remove most of the guesswork from local demo flows.
