# React + Vite Frontend POC Plan

## Goal

Replace the current vanilla `/app` browser shell with a React + TypeScript + Vite app in `apps/web` while keeping the browser deployment same-origin with the backend.

That keeps these properties simple:

- cookie-authenticated browser sessions
- no CORS dependency for the main deployment path
- no split-origin CSRF complexity for the POC
- one deployable backend + web bundle

## Recommended stack

- React
- TypeScript
- Vite
- React Router
- TanStack Query
- plain `fetch` wrapper for API calls

Keep the POC lean:

- do not add a heavy component library yet
- do not auto-generate a full runtime client yet
- do not introduce Redux unless state complexity actually demands it

## Existing backend assumptions

The frontend should be built against the backend that already exists:

- `GET /auth/session`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `POST /me/bungie/resync`
- `GET /parties`
- `GET /parties/:partyId`
- `POST /parties`
- `POST /parties/:partyId/join`
- `POST /parties/:partyId/leave`
- `POST /parties/:partyId/cancel`
- `POST /parties/:partyId/members/:memberId/accept`
- `POST /parties/:partyId/members/:memberId/decline`
- `POST /parties/:partyId/members/:memberId/kick`

The current backend still serves `/app`. The React app should preserve that route base.

## App structure

Recommended frontend source layout:

```text
apps/web/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    main.tsx
    app/
      router.tsx
      query-client.ts
      bootstrap.ts
    api/
      client.ts
      auth.ts
      me.ts
      parties.ts
      types.ts
    features/
      auth/
      profile/
      parties/
    components/
    routes/
      login.tsx
      callback-success.tsx
      callback-error.tsx
      parties-feed.tsx
      party-detail.tsx
      party-create.tsx
      profile.tsx
    styles/
```

Keep the first pass route-driven. Do not over-abstract feature folders until the core screens are stable.

## Route structure under `/app`

Recommended browser routes:

- `/app/login`
- `/app/auth/callback/success`
- `/app/auth/callback/error`
- `/app/parties`
- `/app/parties/new`
- `/app/parties/:partyId`
- `/app/me`

Recommended redirect behavior:

- `/app` -> `/app/parties` when authenticated
- `/app` -> `/app/login` when unauthenticated

Host moderation should live inside party detail for the POC, not as a separate top-level route.

## Frontend POC screens

### 1. Login

Route:

- `/app/login`

Responsibilities:

- explain that login uses Bungie
- start browser auth by calling `POST /auth/bungie/start` with `redirectMode: "web"`
- pass a safe relative `returnTo`, usually `/app/parties`
- handle “already authenticated” by redirecting away

Minimal UI:

- app title
- one primary “Continue with Bungie” button
- small error message area for auth bootstrap failures

### 2. Auth callback success/error

Routes:

- `/app/auth/callback/success`
- `/app/auth/callback/error`

Responsibilities:

- success route:
  - call `GET /auth/session`
  - if authenticated, redirect to the requested route or `/app/parties`
  - if not authenticated, show a short recovery message and send the user back to login
- error route:
  - read error params from the URL
  - show a human-readable message
  - provide retry path back to `/app/login`

This should stay thin. The backend already owns the real OAuth work.

### 3. Party feed

Route:

- `/app/parties`

Responsibilities:

- fetch visible parties from `GET /parties`
- show host, title, tags, requirement text, scheduled time, and capacity
- show `Join`, `Leave`, or `Cancelled` state where appropriate
- link into party detail

POC scope:

- no pagination controls yet
- no filters yet
- no sorting UI yet

### 4. Party detail

Route:

- `/app/parties/:partyId`

Responsibilities:

- fetch `GET /parties/:partyId`
- show party metadata, host info, requirements, tags, capacity, and viewer membership
- show action buttons:
  - join
  - leave
  - cancel for host
- if viewer is host, render the moderation list from `members`

This is the main high-value screen. Keep it stronger than the feed.

### 5. Create party

Route:

- `/app/parties/new`

Responsibilities:

- submit `POST /parties`
- collect only fields already supported by the backend
- redirect to created party detail on success

POC fields should match backend reality, not wishlist fields.

Do not design around party editing yet because `PATCH /parties/:partyId` is still deferred.

### 6. My account / profile

Route:

- `/app/me`

Responsibilities:

- fetch from bootstrap state or `GET /me`
- show Bungie identity
- show Marathon verification state
- expose `Resync Bungie` via `POST /me/bungie/resync`
- expose logout via `POST /auth/logout`

This route should also display basic session troubleshooting messages if resync fails.

### 7. Host moderation panel

Route placement:

- embedded inside `/app/parties/:partyId`

Responsibilities:

- render pending/accepted roster for the host
- call:
  - `POST /parties/:partyId/members/:memberId/accept`
  - `POST /parties/:partyId/members/:memberId/decline`
  - `POST /parties/:partyId/members/:memberId/kick`
- refresh party detail after each mutation

For the POC, this should stay in the detail page rather than becoming a separate admin flow.

## Frontend concerns to plan first

### 1. Bootstrap flow

The app should not guess auth state from local storage.

Boot sequence:

1. call `GET /auth/session`
2. if `authenticated=false`, route to `/app/login`
3. if `authenticated=true`, call `GET /me`
4. hydrate app auth/user context from `/me`
5. render protected routes

Recommended ownership:

- one top-level bootstrap provider
- one route guard for authenticated routes

Keep bootstrap state explicit:

- `booting`
- `authenticated`
- `anonymous`
- `authError`

### 2. Cookie auth + CSRF header handling

Browser requests should always use:

- `credentials: "include"`

Mutation requests that rely on cookie auth must also send:

- `X-CSRF-Token`

Recommended implementation:

- read `mlfg_csrf` from `document.cookie`
- centralize request logic in one API wrapper
- auto-add the CSRF header for non-GET requests

Pseudo code:

```ts
async function apiFetch(path: string, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});

  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("mlfg_csrf");
    if (csrf) {
      headers.set("X-CSRF-Token", csrf);
    }
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  return response;
}
```

Do not scatter cookie and CSRF logic across components.

### 3. Expired-session handling

The browser flow needs one consistent answer for expired access tokens.

Recommended policy:

- on `401 auth_expired` during a protected request:
  - call `POST /auth/refresh`
  - if refresh succeeds, retry the original request once
  - if refresh fails, clear frontend auth state and route to `/app/login`

Important rule:

- only retry once per request
- do not create silent retry loops

Pseudo code:

```ts
async function apiFetchWithRefresh(path: string, init?: RequestInit) {
  let response = await apiFetch(path, init);

  if (response.status !== 401) {
    return response;
  }

  const body = await safeJson(response);
  if (body?.errorCode !== "auth_expired") {
    return response;
  }

  const refreshResponse = await apiFetch("/auth/refresh", { method: "POST" });
  if (!refreshResponse.ok) {
    throw new AuthExpiredError();
  }

  response = await apiFetch(path, init);
  return response;
}
```

### 4. Route structure under `/app`

Use React Router with a clear public/protected split.

Suggested route groups:

- public:
  - login
  - callback success
  - callback error
- protected:
  - parties feed
  - party detail
  - create party
  - profile

Recommended layout shape:

- `PublicLayout`
- `ProtectedLayout`

Protected layout should own:

- bootstrap guard
- top navigation
- logout entry point
- global session expiry handling

### 5. API layer typed against `openapi.yaml`

Use the checked-in OpenAPI file as the source of type truth, but keep the runtime client small.

Recommended first step:

- generate TypeScript types from `openapi.yaml`
- keep a thin handwritten fetch wrapper

Recommended tool direction:

- `openapi-typescript`

Why:

- strong request/response typing
- no heavy generated runtime client to fight during early iteration
- backend contract drift becomes easier to spot

Suggested output file:

- `apps/web/src/api/types.ts`

If generation becomes noisy during active backend changes, temporarily fall back to a small handwritten type layer and resume generation once route contracts settle.

## Build and serving plan

Target deployment shape:

- backend serves the built Vite app under `/app`
- backend still serves API routes from the same origin

Recommended production flow:

1. build backend
2. build Vite app
3. serve Vite `dist` output from the backend static route

Recommended local development direction:

- keep the browser origin at the backend when possible
- either:
  - have the backend serve built frontend assets during early development, or
  - proxy Vite through the backend under `/app`

Avoid treating `http://localhost:5173` as the long-term browser origin. That pushes you back toward split-origin behavior.

## Incremental replacement plan

Do not throw away the current shell in one step.

Recommended sequence:

1. scaffold React + TypeScript + Vite in `apps/web`
2. replace login and callback routes first
3. replace feed and detail routes
4. replace create and profile routes
5. remove the old vanilla `app.js` shell once route parity exists

## First implementation milestone

The first practical milestone should be:

1. React app boots under `/app`
2. login route works
3. callback success/error routes work
4. bootstrap flow works with `GET /auth/session` then `GET /me`
5. authenticated user can reach the party feed

That is the minimum slice that proves the frontend architecture is correct before the rest of the screens are migrated.
