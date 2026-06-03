# PWA Production Deployment

This note documents the intended production shape for the current PWA/backend implementation.

## Recommended topology

Use one public HTTPS origin for both the browser shell and the API.

Recommended:

- `https://lfg.example.com/app/`
- `https://lfg.example.com/auth/*`
- `https://lfg.example.com/me`
- `https://lfg.example.com/parties`
- `https://lfg.example.com/docs`

Why:

- the current shell is served by the backend at `/app`
- cookie auth is simplest and safest when the PWA and API are same-origin
- same-origin avoids adding CORS and split-origin cookie complexity before it is necessary

## Required production env shape

Example:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgres://...
BUNGIE_CLIENT_ID=...
BUNGIE_CLIENT_SECRET=...
BUNGIE_API_KEY=...
BUNGIE_REDIRECT_URI=https://lfg.example.com/auth/bungie/callback
WEB_APP_BASE_URL=https://lfg.example.com/app/
SESSION_COOKIE_DOMAIN=
APP_SESSION_SECRET=replace-with-a-long-random-secret
```

Notes:

- leave `SESSION_COOKIE_DOMAIN` blank for the recommended same-origin setup
- `APP_UNIVERSAL_LINK_BASE` is only needed if you still want the native handoff flow available in the same deployment
- in production, [src/server.ts](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/src/server.ts) now validates that `WEB_APP_BASE_URL`, `BUNGIE_REDIRECT_URI`, and `APP_UNIVERSAL_LINK_BASE` are `https://` URLs

## HTTPS requirements

Production assumes HTTPS everywhere that matters to the browser session:

- `WEB_APP_BASE_URL` must be `https://`
- `BUNGIE_REDIRECT_URI` must be `https://`
- if native handoff stays enabled, `APP_UNIVERSAL_LINK_BASE` must be `https://`

Why:

- cookie helpers set `Secure` in production
- browsers will not send secure cookies over plain HTTP
- Bungie callback configuration should be stable and public, not a dev tunnel

## Cookie domain strategy

Recommended:

- same-origin
- leave `SESSION_COOKIE_DOMAIN` unset

Why:

- host-only cookies are the narrowest cookie scope
- no parent-domain sharing is needed when the shell is served from the backend origin
- it reduces accidental cookie bleed across unrelated subdomains

Only set `SESSION_COOKIE_DOMAIN` when you intentionally want shared cookies across subdomains.

Example:

- `.example.com`

Do not set:

- full URLs like `https://example.com`
- values with paths like `example.com/app`
- whitespace-containing values

The server now rejects malformed production `SESSION_COOKIE_DOMAIN` values.

## Same-origin reverse proxy shape

The simplest production deployment is:

1. run the Node app behind a reverse proxy
2. terminate TLS at the proxy
3. expose one public host, for example `lfg.example.com`
4. forward all app and API routes to the backend

The important public routes are:

- `/app`
- `/app/*`
- `/auth/*`
- `/me`
- `/parties`
- `/parties/*`
- `/docs`
- `/openapi.yaml`

The backend already serves the shell and API on the same process, so there is no required frontend-to-backend routing split yet.

## Bungie callback alignment

The current production-aligned web flow expects:

- Bungie app redirect URL:
  - `https://lfg.example.com/auth/bungie/callback`
- backend env:
  - `BUNGIE_REDIRECT_URI=https://lfg.example.com/auth/bungie/callback`
- shell env:
  - `WEB_APP_BASE_URL=https://lfg.example.com/app/`

Those values should be treated as a matched set.

## Current non-goals

This branch is not yet hardened for a split-origin web deployment such as:

- `https://app.example.com`
- `https://api.example.com`

That can be made to work later, but it would need deliberate work around:

- credentialed cross-origin fetch rules
- CORS policy
- shared cookie scope
- stricter CSRF review

Do not choose split-origin just because it sounds cleaner. The current codebase is intentionally optimized for same-origin first.

## Docs route note

`/docs` currently loads Swagger UI from a CDN.

That is acceptable for internal/dev use, but for a locked-down production environment you may want to:

- vendor Swagger UI locally
- protect `/docs`
- or disable docs in production entirely

This is not on the critical auth path, but it is worth deciding explicitly before public launch.
