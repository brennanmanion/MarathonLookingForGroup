# Frontend MVP Plan

## Goal

Start frontend planning now, without waiting for the coordinated two-user test.

The backend is stable enough for a first client pass because these flows already work:

- native Bungie auth start
- Bungie callback and handoff consume
- refresh token rotation
- logout
- `/me`
- Bungie resync
- party create
- party list/detail
- join
- accept/decline/kick
- leave
- cancel

## What the frontend should be

The current backend is built for a mobile/native client, not a web-first app.

That means the frontend plan should assume:

- system browser for Bungie login
- app deep-link or universal-link handoff back into the client
- first-party access and refresh tokens stored locally
- backend as the only source of truth for identity and party rules

## What not to build around yet

Avoid over-designing these areas until the backend changes land:

- party edit flow
- web login flow
- advanced list pagination/filter/sort UI
- soft requirement editing UI beyond display-only planning

Those can be planned, but they should not anchor the first MVP client.

## MVP client surfaces

### 1. Signed-out entry

Needs:

- app title / intro
- `Continue with Bungie` button
- brief explanation that Bungie login and Marathon verification are required for hosting

Primary action:

- call `POST /auth/bungie/start`
- open returned `authorizeUrl`

### 2. Handoff completion screen or invisible handoff handler

Needs:

- deep link parser for `/auth/handoff`
- loading state while consuming the ticket
- failure state if ticket is invalid or expired

Primary action:

- parse `ticket` and `loginId`
- call `POST /auth/bungie/handoff/consume`
- store tokens
- call `/me`

### 3. Home / party feed

Needs:

- `GET /parties`
- party card list
- CTA to create a party
- empty state when no public parties exist

Each card should show:

- title
- activity
- host display name
- capacity
- verification requirement
- tags

### 4. Party detail

Needs:

- `GET /parties/:partyId`
- host identity
- tags
- requirement text
- membership status if current user has one

Actions by state:

- not joined: `Join`
- pending: show `Pending`
- accepted: `Leave`
- host: `Cancel party`

### 5. Create party

Needs:

- title
- activity key
- max size
- approval mode
- visibility
- optional tags

Keep the first form small. Do not wait for the full future requirements system.

### 6. Host moderation

Needs:

- pending members list
- accept
- decline
- accepted members list
- kick

Important note:

The current detail response does not include a host-facing member roster. For a true moderation screen, you will either:

- query Postgres manually during testing, or
- add a backend detail expansion later

So for frontend planning, treat host moderation UI as real, but note that the backend may need a member-list enhancement for a production-grade screen.

### 7. Profile / account status

Needs:

- `/me`
- Bungie display identity
- Marathon verification state
- `Re-sync Bungie`
- `Logout`

This screen is also where you should explain why some actions are disabled when `marathon.verified = false`.

## Client state model

### Session state

Store only:

- `accessToken`
- `refreshToken`
- cached `/me`

Do not store:

- Bungie access token
- Bungie refresh token
- inferred business rules

### Session lifecycle

On app launch:

1. read local session
2. call `/me`
3. if `401`, call `/auth/refresh`
4. retry `/me` once
5. if refresh fails, clear session and route to signed-out

### Auth success criteria

Frontend auth is successful only when all of these have happened:

1. start login
2. browser auth
3. handoff consume
4. `/me` load

Do not treat “browser returned to app” as success by itself.

## MVP navigation

Recommended initial navigation:

1. Signed Out
2. Party Feed
3. Party Detail
4. Create Party
5. Profile

This is enough for the first pass.

Do not build a complex tab architecture until the actual screens are working with the backend.

## Error handling requirements

The frontend should explicitly handle these backend cases:

- `auth_required`
- `auth_invalid`
- `auth_expired`
- `handoff_ticket_invalid`
- `handoff_ticket_used`
- `handoff_ticket_expired`
- `marathon_membership_missing`
- `party_full`
- `party_closed`
- `not_party_host`
- `invalid_member_state`

Minimum UI approach:

- toast or inline error banner
- clear retry path
- forced sign-out on refresh failure

## Backend contracts the frontend depends on

These are the main routes to plan around now:

- `POST /auth/bungie/start`
- `POST /auth/bungie/handoff/consume`
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

## What to define before coding the frontend

### Product choices

Decide these first:

- native stack: SwiftUI, Kotlin, React Native, or Expo
- branding direction
- whether the first client is iOS-only or cross-platform
- whether host moderation ships in MVP client 1 or client 2

### Engineering choices

Decide these next:

- secure token storage mechanism
- deep-link/universal-link strategy
- API client wrapper shape
- navigation library
- state management approach

## Recommended implementation order

1. Session bootstrap and token storage
2. Bungie login + handoff flow
3. `/me` profile screen
4. Party feed
5. Party detail
6. Create party
7. Leave / cancel actions
8. Host moderation
9. Polish and empty states

## Recommended next artifacts

After this planning doc, the best next frontend docs would be:

1. screen map and wireframe note
2. auth/session state machine
3. API contract reference
4. component inventory

The API contract reference can be generated from an OpenAPI file. A starter one has been added in [openapi.yaml](/Users/brennan/Documents/MaratonLookingForGroup/MarathonLookingForGroup/openapi.yaml).
