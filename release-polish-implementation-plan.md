# Release Polish Implementation Plan

## Scope

This note covers the next release-facing polish items discussed after the PWA MVP reached a working state:

1. keep full parties visible in the feed
2. add user feedback for join/approval actions now, and realtime updates next
3. hide full Bungie names until approval
4. clarify the post-approval manual invite flow when the Bungie API cannot complete the in-game crew step

## 1. Full parties in the feed

### Current state

This is already true on the backend.

`GET /parties` currently returns public parties whose status is not `cancelled`, which already includes:

- `open`
- `full`
- other non-cancelled host/member-visible states

### Immediate action

No backend filter change is needed for this item.

### Recommended polish

The frontend should make the state clearer:

- keep `open` and `full` both visible
- sort `open` before `full` in the feed presentation layer
- render `full` with a stronger disabled-looking badge
- disable any future feed-level join action when `status === "full"`

### Future follow-up

Once pagination/filtering lands, preserve `full` parties in the default feed unless the user explicitly filters them out.

## 2. Realtime feedback for join and moderation

### Immediate release slice

Add visible client-side confirmations now:

- `Request sent`
- `Party created`
- `You left the party`
- `Party cancelled`
- `Player approved`
- `Player declined`
- `Player removed`
- `Bungie account resynced`
- `Logged out`

This is the lowest-risk improvement because it requires no transport changes.

### Recommended implementation

Add a lightweight toast system in the React app:

- one app-level toast provider
- top-right stack
- auto-dismiss after a short timeout
- success and error variants

### Realtime transport recommendation

For the next step, prefer Server-Sent Events before WebSockets.

Reason:

- the current product mostly needs server -> client updates
- same-origin cookie auth fits SSE well
- SSE is simpler to operate than a bidirectional socket layer

### Recommended event types

- `party.join_requested`
- `party.join_accepted`
- `party.join_declined`
- `party.kicked`
- `party.cancelled`

### Backend direction

Use existing mutation points and `party_member_events` as the source of truth.

Likely route:

- `GET /events/stream`

Likely filter model:

- authenticated host receives events for hosted parties
- authenticated member receives events for their own memberships

### Frontend direction

- subscribe after bootstrap
- invalidate `['parties']`, `['party', partyId]`, and `['me']` on relevant events
- also raise a toast when an event targets the current user

## 3. Hide full Bungie names until approval

### Goal

Do not expose the trailing `#1234` part of a Bungie name to unapproved viewers.

That reduces the chance that users bypass the intended approval flow by trying to contact or invite people before they are approved.

### Recommended policy

For party host identity in feed and detail:

- anonymous viewer: hide code
- signed-in non-member viewer: hide code
- pending member: hide code
- accepted member: reveal code
- host: reveal code

For party member roster:

- only the host sees the roster today, so host can continue seeing the full Bungie name

### Important implementation rule

Do this on the backend serializer, not only in the React client.

If the API still sends the code, the frontend is not enforcing the privacy boundary.

### Concrete serializer change

When host identity is not yet approved for the viewer:

- keep `globalDisplayName`
- force `globalDisplayNameCode = null`
- if the string already contains `#1234`, strip the suffix before returning it

### Future extension

If member-to-member visibility is added later, use the same reveal rule there:

- reveal full Bungie name only when the viewer is the host, the same user, or an accepted member in the same party

## 4. Approved-player manual invite flow

### Current API reality

Do not assume the public Bungie API can complete the actual in-game crew invite step for Marathon.

Publicly documented Bungie APIs show:

- group/clan invites
- social friend requests
- some read-only fireteam endpoints

They do not give a stable, documented public “invite this approved Marathon player directly into the live crew” flow that this app should depend on.

### Product implication

Treat post-approval coordination as a manual handoff step in the first release.

### Recommended UX after approval

For the approved member:

- show `Approved`
- show host Bungie name with full code
- add `Copy host Bungie name`
- show a short next-step message:
  - `You are approved. Add or invite the host in Marathon manually now.`

For the host:

- show approved players in a dedicated roster section
- reveal the approved player Bungie name with code
- add copy buttons
- show a short checklist:
  - `Approved`
  - `Invite sent in game`
  - `Joined crew`

### Optional later step

If Bungie social friend-request APIs prove usable and appropriate for Marathon account linking, treat that as a separate enhancement, not a release blocker.

Do not promise in-game invite automation before the public API contract is proven.

## Recommended implementation order

1. Toast confirmations for all important actions.
2. Backend-enforced Bungie name masking in `GET /parties` and `GET /parties/:partyId`.
3. Post-approval manual-invite guidance UI with copy buttons.
4. SSE-based live event stream for join/approval/cancel updates.
5. Optional deeper feed polish for sorting `open` before `full`.

## Current slice to implement now

Implement now:

- app-level success toasts
- backend-enforced Bungie name masking

Defer:

- realtime transport
- manual-invite guidance panel
- feed ordering polish
