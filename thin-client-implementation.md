# Thin Client Implementation

## Goal

Build a client that stays deliberately thin:

- the backend owns Bungie OAuth
- the backend owns Bungie token storage
- the backend owns party rules and verification state
- the client owns only UI, local session storage, and API calls

This matches the merged implementation note and the current backend shape.

## What the client should store

Store only:

- app `accessToken`
- app `refreshToken`
- a cached `/me` payload

Do not store:

- Bungie access tokens
- Bungie refresh tokens
- Bungie business rules

## Required backend contracts

The client should assume these endpoints exist:

- `POST /auth/bungie/start`
- `POST /auth/bungie/handoff/consume`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `POST /me/bungie/resync`
- party endpoints already implemented

## Recommended client modules

### Session store

Responsibilities:

- persist access and refresh tokens in secure device storage
- expose `getSession()`, `setSession()`, `clearSession()`

### Auth coordinator

Responsibilities:

- start Bungie login
- complete native handoff
- refresh app session
- logout app session

### API client

Responsibilities:

- attach bearer access token
- retry once on `401` by calling `POST /auth/refresh`
- clear local session if refresh fails

### Me store

Responsibilities:

- fetch `/me`
- fetch `/me/bungie/resync`
- expose `marathonVerified` and identity info to UI

### Party client

Responsibilities:

- fetch list/detail
- create/join/leave/cancel
- host moderation actions

The party client should not reimplement capacity or verification rules locally.

## Screen-level flow

### App bootstrap

1. load session from secure storage
2. if no session, show signed-out screen
3. call `/me` with access token
4. if `401`, call `/auth/refresh`
5. retry `/me` once
6. if refresh fails, clear session and show signed-out screen

### Sign in

1. call `POST /auth/bungie/start`
2. open returned `authorizeUrl` in system browser
3. wait for native universal link/app link callback
4. parse `ticket` and `loginId`
5. call `POST /auth/bungie/handoff/consume`
6. store returned access/refresh tokens
7. call `/me`
8. route into the signed-in app

### Logout

1. read refresh token from secure storage
2. call `POST /auth/logout`
3. clear secure storage
4. clear in-memory stores
5. route to signed-out screen

### Manual Bungie resync

1. call `POST /me/bungie/resync`
2. replace cached `/me` data with the response
3. refresh screens that depend on Marathon verification

## Pseudocode

### Session bootstrap

```ts
async function bootstrapSession() {
  const session = await sessionStore.getSession();
  if (!session) return signedOut();

  let me = await api.getMe(session.accessToken);
  if (me.status === 401) {
    const refreshed = await auth.refresh(session.refreshToken);
    if (!refreshed.ok) {
      await sessionStore.clearSession();
      return signedOut();
    }

    await sessionStore.setSession(refreshed.session);
    me = await api.getMe(refreshed.session.accessToken);
  }

  if (me.status !== 200) {
    await sessionStore.clearSession();
    return signedOut();
  }

  return signedIn(me.body);
}
```

### API retry-once wrapper

```ts
async function authorizedFetch(input, init) {
  const session = await sessionStore.getSession();
  const response = await fetchWithAccessToken(input, init, session?.accessToken);
  if (response.status !== 401 || !session?.refreshToken) return response;

  const refreshResult = await auth.refresh(session.refreshToken);
  if (!refreshResult.ok) {
    await sessionStore.clearSession();
    return response;
  }

  await sessionStore.setSession(refreshResult.session);
  return fetchWithAccessToken(input, init, refreshResult.session.accessToken);
}
```

### Native handoff completion

```ts
async function completeNativeLogin(url) {
  const { ticket, loginId } = parseAuthHandoffUrl(url);
  const session = await auth.consumeHandoff({ ticket, loginId });
  await sessionStore.setSession(session);
  return api.getMe(session.accessToken);
}
```

## Suggested client file layout

This is intentionally generic so it can fit native Swift/Kotlin, React Native, or Expo.

```text
client/
  auth/
    authCoordinator.ts
    sessionStore.ts
    handoff.ts
  api/
    apiClient.ts
    endpoints.ts
  features/
    me/
      meStore.ts
    parties/
      partyApi.ts
      partyFeedStore.ts
  app/
    bootstrap.ts
    navigation.ts
```

## Client rules to keep it thin

- never call Bungie endpoints directly from the client
- never compute verification state locally
- never infer party capacity locally when the backend already returns it
- never keep long-lived business rules duplicated in client code

## Backend changes the client depends on

Before client work starts, finish these backend items:

1. `POST /auth/refresh`
2. `POST /auth/logout`
3. `POST /me/bungie/resync`

Without those, the client auth lifecycle will be incomplete.

## Patch confidence

No code patch is included here because there is no client codebase in this repo yet.

The correct next move is:

1. finish the backend session endpoints
2. define the client repo or client folder
3. apply this client structure against the real client technology choice
