# PWA Manual Test Checklist

## Current public origin

As of 2026-04-07, the current ngrok tunnel reported by the local inspector is:

- `https://9a9c-73-169-46-127.ngrok-free.app`

Current local `.env` values are aligned to that origin:

- `BUNGIE_REDIRECT_URI=https://9a9c-73-169-46-127.ngrok-free.app/auth/bungie/callback`
- `WEB_APP_BASE_URL=https://9a9c-73-169-46-127.ngrok-free.app/app/`
- `APP_UNIVERSAL_LINK_BASE=https://9a9c-73-169-46-127.ngrok-free.app`

If ngrok rotates to a new URL later, update both:

1. the Bungie app portal redirect URL
2. local `.env`

Do not reuse old Bungie authorize links after the tunnel changes.

## Recommended way to run the PWA POC

For the actual browser POC, do not use the Vite dev server as the public app origin.

Use the same-origin backend-served path:

- backend serves API routes
- backend also serves the built web app from `/app`
- ngrok points at local port `3000`

That is the deployment shape the current PWA work is designed around.

## One-time setup commands

From the repo root:

```bash
docker compose up -d postgres
npm install
npm --prefix apps/web install
```

## Commands to start the backend and frontend later

### Recommended POC startup flow

From the repo root:

```bash
npm --prefix apps/web run build
npm run build
node dist/server.js
```

Use this mode for:

- Bungie login testing
- cookie/session testing
- real browser PWA flow under `/app`
- anything going through ngrok

In this mode, the frontend is already built and served by the backend. You do not run a separate frontend server.

### Optional frontend-only iteration mode

If you want to work on React UI locally without doing a full backend-served build each time:

```bash
npm --prefix apps/web run dev
```

That is useful for frontend iteration, but it is not the recommended mode for the real same-origin auth POC.

### Optional backend live-reload mode

For backend-only iteration:

```bash
npm run dev
```

Again, that is useful for development, but for the actual PWA browser path you should still verify with the built backend-served app.

## Pre-flight checks before manual browser testing

1. Confirm Postgres is up:

```bash
docker compose ps
```

Expected:

- `marathon-lfg-postgres` should be `Up` and `healthy`

2. Confirm backend health locally:

```bash
curl -i http://127.0.0.1:3000/health
```

Expected:

```json
{"ok":true}
```

3. Confirm backend serves the web app locally:

```bash
curl -i http://127.0.0.1:3000/app
```

Expected:

- `200 OK`
- HTML response

4. Confirm ngrok reaches the backend:

```bash
curl -i https://9a9c-73-169-46-127.ngrok-free.app/health
```

Expected:

```json
{"ok":true}
```

If that fails, stop and fix ngrok before testing Bungie auth.

## Manual PWA test flow

Open this in the browser:

- `https://9a9c-73-169-46-127.ngrok-free.app/app/`

### Flow 1: bootstrap and login

1. Visit `/app/`
2. Confirm you land on the parties route or login route
3. Click `Continue with Bungie`
4. Complete Bungie login
5. Confirm Bungie redirects to:
   - `https://9a9c-73-169-46-127.ngrok-free.app/auth/bungie/callback`
6. Confirm the backend then redirects into:
   - `/app/auth/callback/success`
7. Confirm the app lands on:
   - `/app/parties`

Success criteria:

- no `404` handoff page
- no raw JSON error page
- browser ends up authenticated inside the React app

### Flow 2: session bootstrap

From the browser app:

1. Load `/app/parties`
2. Confirm the page shows the signed-in viewer state
3. Go to `/app/me`
4. Confirm Bungie and Marathon identity data render

Success criteria:

- app bootstraps from `/auth/session` then `/me`
- profile route renders without needing manual token copying

### Flow 3: create party

1. Open `/app/parties/new`
2. Create a party with:
   - title
   - activity key
   - max size
   - optional description
   - optional requirement text
3. Submit the form
4. Confirm redirect to `/app/parties/:partyId`

Success criteria:

- party detail loads
- created party shows host identity and capacity

### Flow 4: party feed and detail

1. Go back to `/app/parties`
2. Confirm the new party appears in the list
3. Open the party detail page
4. Confirm tags, capacity, requirements, and status render

### Flow 5: profile and Bungie resync

1. Open `/app/me`
2. Click `Resync Bungie`
3. Confirm the page stays authenticated
4. Confirm no CSRF or session error appears

### Flow 6: logout

1. Click `Log out`
2. Confirm you return to anonymous state
3. Reload `/app/me`
4. Confirm protected route behavior sends you back through login flow instead of rendering authenticated data

## Two-user manual test after coordination

When your friend is available, run this next:

1. host account signs in and creates a party
2. friend account signs in and opens the party
3. friend joins the party
4. host opens the detail page and sees the pending member in the moderation roster
5. host accepts, declines, or kicks
6. verify the member-side detail view updates
7. test member leave
8. test host cancel

## Failure cases to watch for

### ngrok rotation

Symptom:

- Bungie callback fails or reaches the wrong tunnel

Fix:

- update Bungie app redirect URL
- update `.env`
- restart backend

### stale authorize URL

Symptom:

- Bungie state invalid or expired

Fix:

- restart sign-in from `/app/login`
- do not reuse an old Bungie auth URL

### callback reaches backend but fails

Symptom:

- redirect into `/app/auth/callback/error`
- backend returns a Bungie auth error

Likely causes:

- wrong Bungie credentials
- wrong redirect URL in Bungie portal
- stale tunnel URL

### protected browser actions fail

Symptom:

- create/join/leave/resync/logout fail in the browser

Likely causes:

- expired session
- missing cookies
- broken CSRF cookie/header flow

First recovery step:

- reload `/app`
- if still broken, sign in again

## Fast restart checklist

From the repo root:

```bash
docker compose up -d postgres
npm --prefix apps/web run build
npm run build
node dist/server.js
```

Then open:

- local: `http://127.0.0.1:3000/app/`
- public: `https://9a9c-73-169-46-127.ngrok-free.app/app/`
