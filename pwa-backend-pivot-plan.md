# PWA Backend Pivot Plan

This plan assumes we keep the existing Fastify/Postgres backend and add a web frontend in the same repo, rather than starting a new backend project.

The current backend already solves the expensive parts:

- Bungie OAuth callback and token exchange
- local user creation and Bungie account persistence
- first-party session issuance
- party lifecycle endpoints
- Postgres-backed integration tests

The main thing that must change is session completion and session transport for browsers.

## Target Architecture

### Repo shape

- Keep the backend in `src/`
- Add the PWA in `apps/web/`
- Keep one Postgres database and one API

Suggested structure:

```text
MarathonLookingForGroup/
  src/                  # existing Fastify API
  apps/web/             # new PWA client
  openapi.yaml
  migrations/
```

### Deployment shape

Preferred production setup:

- one public HTTPS origin for the PWA, for example `https://app.example.com`
- API served from the same origin if possible
- if same-origin is not practical, use a closely related API origin such as `https://api.example.com`

Recommendation:

- start with same-origin in production
- avoid making CORS and cross-site cookies part of the MVP unless there is a strong reason

### Auth model

Keep Bungie as the identity provider, but finish login into a browser session instead of a native handoff.

Target browser flow:

1. PWA calls `POST /auth/bungie/start` with `redirectMode: "web"`.
2. Backend creates `auth_login_transactions` row as it does today.
3. Browser goes to Bungie authorize URL.
4. Bungie redirects to backend `GET /auth/bungie/callback`.
5. Backend validates `state`, exchanges code, fetches Bungie membership, and upserts local user state.
6. Backend creates a first-party web session.
7. Backend sets secure HttpOnly cookies.
8. Backend redirects browser to a frontend route such as `/auth/callback/success`.
9. PWA calls `GET /auth/session` or `GET /me` to hydrate the current user.

This removes the current native requirement to extract `ticket` and `loginId` from a browser redirect and then call `/auth/bungie/handoff/consume`.

## Route Changes

### Keep

- `POST /auth/bungie/start`
- `GET /auth/bungie/callback`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- all current party routes

### Change

#### `POST /auth/bungie/start`

Current state:

- supports `redirectMode` in schema
- implementation rejects anything except `native`

Required change:

- accept `redirectMode: "web"`
- for web mode, store `returnTo` or `appState` that represents where the frontend should land after login

Suggested request shape:

```json
{
  "redirectMode": "web",
  "returnTo": "/parties"
}
```

Implementation note:

- keep `appState` for native if you want dual-mode support
- add `return_to` column to `auth_login_transactions` only if `app_state` is too ambiguous for web use

#### `GET /auth/bungie/callback`

Current state:

- only handles `redirect_mode = native`
- creates one-time handoff ticket
- redirects to `APP_UNIVERSAL_LINK_BASE/auth/handoff?...`

Required change for web:

- when `redirect_mode = web`, do not create handoff ticket
- create web session cookies
- redirect to frontend success or error route

Suggested behavior:

- success redirect: `/auth/callback/success`
- failure redirect: `/auth/callback/error?code=...`

#### `POST /auth/refresh`

Current state:

- accepts JSON `{ "refreshToken": "..." }`
- returns JSON access token and rotated refresh token

Required change:

- keep current JSON contract for native compatibility
- add web-mode cookie refresh path

Suggested web behavior:

- if request has no body but has refresh cookie, rotate using cookie value
- set replacement cookies in response
- return minimal JSON such as:

```json
{
  "ok": true,
  "expiresIn": 900
}
```

#### `POST /auth/logout`

Current state:

- accepts JSON refresh token
- revokes session token row

Required change:

- keep current JSON contract for native compatibility
- allow cookie-authenticated web logout with no request body
- revoke current refresh cookie session
- clear auth cookies

#### `GET /me`

Current state:

- bearer auth only

Required change:

- accept either:
  - `Authorization: Bearer ...`
  - cookie-based web session

#### Add `GET /auth/session`

Purpose:

- frontend bootstrapping endpoint
- tells the PWA whether the user is logged in without the frontend managing raw tokens

Suggested response:

```json
{
  "authenticated": true,
  "user": {
    "userId": "uuid"
  }
}
```

If no valid session:

```json
{
  "authenticated": false
}
```

#### Add `GET /auth/csrf` or mint CSRF during login

Needed only if browser mutations are authenticated by cookies.

Recommendation:

- use double-submit cookie CSRF
- set readable `csrf_token` cookie
- require `X-CSRF-Token` header on non-GET cookie-authenticated requests

## Cookie and Session Design

### Recommended design

Use cookies for web, keep bearer/JSON tokens for native.

Web cookies:

- `mlfg_at`
  - short-lived access token
  - HttpOnly
  - Secure
  - SameSite=Lax
  - Path=/
- `mlfg_rt`
  - refresh token
  - HttpOnly
  - Secure
  - SameSite=Lax
  - Path=/auth
- `mlfg_csrf`
  - CSRF token
  - Secure
  - SameSite=Lax
  - readable by JS
  - Path=/

Why this fits the current code:

- current access tokens are already self-signed and short-lived
- current refresh tokens are already opaque and stored hashed in `app_refresh_tokens`
- this lets us reuse most session issuance and rotation logic

### Authentication rules

For web requests:

- prefer access token from cookie
- if access token missing or expired, frontend calls `POST /auth/refresh`
- refresh endpoint rotates `mlfg_rt` and sets a new `mlfg_at`

For native requests:

- keep current bearer access token and JSON refresh token flow

### CSRF rules

If cookies authenticate browser mutations, CSRF protection is mandatory.

Rule:

- all non-GET routes using cookie auth require `X-CSRF-Token`
- server compares header to `mlfg_csrf` cookie

Do not skip this just because it is an MVP. Cookie auth without CSRF is a real bug, not polish.

### Cookie domain and environment rules

Add config for:

- `WEB_APP_BASE_URL`
- `SESSION_COOKIE_DOMAIN` optional
- `COOKIE_SECURE` derived from `NODE_ENV` or explicit

Development:

- `Secure=false` is acceptable only on local `http://localhost`

Production:

- `Secure=true`
- real HTTPS only

## Migration Order

### Phase 1: Add web session plumbing

1. Add config fields:
   - `WEB_APP_BASE_URL`
   - optional cookie domain settings
2. Add cookie support in Fastify.
3. Add helpers to:
   - set auth cookies
   - clear auth cookies
   - read access token from cookie
   - read refresh token from cookie
   - mint CSRF token

### Phase 2: Support web login start and callback

1. Update `startBungieLogin()` to accept `redirectMode: "web"`.
2. Persist web redirect target.
3. Update `handleBungieCallback()` to branch by stored `redirect_mode`.
4. On web success:
   - create app session
   - set cookies
   - redirect to frontend
5. On web failure:
   - redirect to frontend error page

### Phase 3: Add session bootstrap and cookie auth

1. Add `GET /auth/session`.
2. Update auth middleware so `/me` and protected routes can read cookie auth.
3. Keep bearer auth support intact.

### Phase 4: Update refresh and logout for browser mode

1. Extend `POST /auth/refresh` to accept cookie flow.
2. Extend `POST /auth/logout` to revoke cookie session and clear cookies.
3. Add CSRF checks for cookie-authenticated mutations.

### Phase 5: Frontend integration

1. Build `apps/web` login screen.
2. Add callback success/error screens.
3. Add app boot sequence:
   - call `GET /auth/session`
   - if unauthenticated, show login
   - if authenticated, fetch `/me`
4. Add service worker and manifest only after auth works normally in a browser tab.

### Phase 6: Documentation and tests

1. Update `openapi.yaml`.
2. Update Swagger examples.
3. Add integration tests for:
   - web login start
   - web callback sets cookies
   - web logout clears cookies
   - cookie-based `/me`
   - CSRF rejection on mutation routes

## What To Keep

- current Postgres schema as baseline
- `auth_login_transactions`
- `bungie_accounts`
- `bungie_oauth_tokens`
- `app_refresh_tokens`
- Bungie callback and membership sync logic
- refresh token hashing and rotation logic
- all party service logic
- existing integration tests as native coverage

## What To Remove Or De-Prioritize

### Remove as primary path

- `APP_UNIVERSAL_LINK_BASE` as the main completion mechanism
- the assumption that every successful OAuth flow ends in `/auth/handoff`

### Keep temporarily for compatibility

- `POST /auth/bungie/handoff/consume`
- native `redirectMode: "native"`
- JSON refresh/logout contracts

This lets you ship the PWA without breaking the native-oriented work you already paid for.

### De-prioritize for now

- true multi-origin production setup
- advanced offline behavior
- push notifications
- installing as a home-screen app before normal browser auth is stable

## File-Level Patch Map

Likely backend files to change first:

- `src/config.ts`
- `src/routes/auth.ts`
- `src/bungie.ts`
- `src/app-sessions.ts`
- `src/session.ts`
- auth middleware file for bearer parsing
- `README.md`
- `openapi.yaml`

Likely new backend files:

- `src/cookies.ts`
- `src/csrf.ts`
- `src/routes/auth-session.ts` or equivalent helper wiring

Likely new frontend files:

- `apps/web/src/routes/login`
- `apps/web/src/routes/auth/callback/success`
- `apps/web/src/routes/auth/callback/error`
- `apps/web/src/lib/session`

## Recommended First Execution Slice

Do not try to build the whole PWA stack at once.

First slice:

1. Add cookie helpers and config.
2. Implement `redirectMode: "web"` in Bungie start/callback.
3. Set auth cookies on callback success.
4. Add `GET /auth/session`.
5. Make `GET /me` work from cookies.

If that slice works, the backend is meaningfully pivoted. After that, the web frontend can be developed against a stable session model.
