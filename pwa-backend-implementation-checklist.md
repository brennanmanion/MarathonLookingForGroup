# PWA Backend Implementation Checklist

This checklist converts the pivot plan into execution slices against the current backend.

## Phase 1: Web Session Foundations

- [x] Add a concrete PWA pivot plan document
- [x] Add an implementation checklist
- [x] Add web runtime config:
  - `WEB_APP_BASE_URL`
  - optional `SESSION_COOKIE_DOMAIN`
- [x] Add backend cookie helpers:
  - parse incoming cookies
  - set access/refresh cookies
  - clear access/refresh cookies
  - mint readable CSRF cookie
- [x] Extend auth start to support `redirectMode: "web"`
- [x] Allow safe relative `returnTo` values for web login
- [x] Extend auth callback to branch by stored `redirect_mode`
- [x] On web callback success:
  - create first-party web session
  - set auth cookies
  - redirect to frontend success route
- [x] Keep native handoff flow working unchanged
- [x] Allow cookie auth on safe read routes such as `GET /me`
- [x] Reject cookie-authenticated mutation routes until CSRF enforcement lands
- [x] Add integration coverage for web callback cookie issuance

## Phase 2: Browser Session Bootstrap

- [x] Add `GET /auth/session`
- [x] Return authenticated/unauthenticated state for the PWA shell
- [x] Make `/me` the source of full hydrated account data after bootstrap
- [x] Add frontend callback success/error routes in the new web app

## Phase 3: Web Refresh and Logout

- [x] Extend `POST /auth/refresh` to support refresh-cookie flow
- [x] Rotate refresh cookies server-side
- [x] Extend `POST /auth/logout` to support cookie-authenticated web logout
- [x] Clear all auth cookies on logout
- [x] Add integration coverage for cookie refresh/logout

## Phase 4: CSRF Protection

- [x] Enforce CSRF for cookie-authenticated non-GET auth routes
- [x] Choose double-submit cookie header contract
- [x] Extend CSRF enforcement to cookie-authenticated party and resync routes
- [x] Add CSRF integration tests for mutation routes
- [x] Document how the frontend must send `X-CSRF-Token`

## Phase 5: Frontend Integration

- [x] Create `apps/web`
- [x] Build login screen and auth bootstrap flow
- [x] Build callback success/error screens
- [ ] Build PWA manifest and service worker after browser auth is stable
- [x] Wire party list/detail/create/join flows to the web session model
- [x] Wire leave/cancel and Bungie resync actions to the web session model
- [x] Wire host member moderation actions to the web session model

## Phase 6: Docs and Contracts

- [x] Update README for web auth mode
- [x] Update `.env.example`
- [x] Update OpenAPI/Swagger to represent web mode and cookie auth
- [x] Document production deployment assumptions:
  - same-origin preferred
  - HTTPS required
  - cookie domain strategy
