# Marathon LFG Backend Blocker Research Brief

## Purpose
Use this brief to drive a deep-research pass on the blockers found while reviewing the backend implementation note at:

- `/Users/brennan/Documents/MaratonLookingForGroup/marathon-lfg-backend-implementation.md`

The goal is not just to comment on the issues. The goal is to produce source-backed recommendations that can be turned into concrete schema, API, and auth-flow changes.

## Current context
- Repo branch for this work: `codex/review-backend-implementation`
- The repo itself is minimal right now; this is mostly a spec review, not a code review against an implemented backend.
- The implementation note assumes Bungie is used for identity plus Marathon ownership verification, not for public Marathon stats/loadout enforcement.

## Blockers to research

### 1. `bungie_verified` is referenced but never modeled
Problem:
- The spec says to set `bungie_verified = true`, but neither `app_users` nor `bungie_accounts` defines that column.
- That makes it unclear whether Bungie verification is:
  - an explicit persisted state,
  - an implicit property of having a linked Bungie account row,
  - or something else.

Research questions:
- What is the cleanest domain model for these states?
- Should `bungie_verified` exist as an explicit column at all?
- If it should exist, which table should own it?
- If it should not exist, what should the spec say instead?
- How should `marathon_verified` relate to Bungie login, Bungie link presence, and membership resync?
- What are the exact state transitions on:
  - first login,
  - failed token exchange,
  - successful Bungie auth but missing `marathonMembershipId`,
  - successful Bungie auth with `marathonMembershipId`,
  - later resync where `marathonMembershipId` disappears,
  - revoked/expired Bungie refresh token?

Expected output:
- A recommended state model.
- A recommended schema change.
- A short truth table or state-transition table.

### 2. Native OAuth flow cannot securely finish in the app as written
Problem:
- The current flow starts in the system browser and returns to the backend callback.
- The document then says the backend should issue the app session.
- For a native mobile client, that leaves the app without a defined secure handoff for receiving its own authenticated session.

Research questions:
- What is the correct end-to-end mobile auth flow here if Bungie OAuth is handled by a confidential backend client?
- Does Bungie support or require any patterns that materially affect the solution?
- Is PKCE relevant or supported in a way that changes the design?
- What is the best way to hand backend auth back to the native app after the backend callback?
- Compare realistic options:
  - backend session cookie only,
  - one-time app code handed off via universal link / app link / custom scheme and exchanged for app tokens,
  - browser-to-app deep-link with short-lived signed artifact,
  - any other source-backed option that fits Bungie's OAuth model.
- What are the security properties and tradeoffs of each option?
- What redirect, state, nonce, CSRF, and replay protections are required?
- What should the final sequence look like for iOS/Android or React Native/Expo?

Expected output:
- One recommended mobile auth topology.
- A step-by-step sequence from login start to app session established.
- Required backend endpoints and temporary artifacts.
- A short threat-model section covering token leakage, replay, and browser/app boundary issues.

### 3. Membership schema blocks rejoin after terminal states
Problem:
- `party_members` uses `(party_id, user_id)` as the primary key.
- The same row also models terminal states such as `declined`, `left`, and `kicked`.
- The join flow later says to insert a membership row on join.
- That combination blocks a clean rejoin/reapply flow unless callers mutate old rows instead of inserting.

Research questions:
- What is the best data model for party membership lifecycle?
- Should the table be:
  - one mutable row per `(party_id, user_id)`,
  - append-only membership attempts with a surrogate key,
  - one active row plus separate history/audit table,
  - or another pattern?
- How should the model distinguish:
  - pending request,
  - accepted membership,
  - host,
  - declined request,
  - user voluntarily left,
  - host kicked user,
  - cancelled party?
- Should a kicked user be allowed to reapply?
- Should a declined user be allowed to reapply automatically, or only after some reset?
- What constraints and indexes are needed to support capacity checks and idempotent join behavior?
- How should the API behave on repeated join requests under each terminal state?

Expected output:
- A recommended membership schema.
- Recommended uniqueness constraints and indexes.
- Rejoin/reapply rules by status.
- Example transactional logic for join, accept, leave, and kick.

### 4. Host state is duplicated without an invariant
Problem:
- The host is represented in two places:
  - `parties.host_user_id`
  - a `party_members` row with status `host`
- The current note does not define any invariant ensuring those two representations stay aligned.

Research questions:
- What should be the single source of truth for host ownership?
- Is a dedicated `host` row in `party_members` worth the complexity?
- Should host be derived only from `parties.host_user_id` and excluded from `party_members` status logic?
- If both representations are kept, what database-level invariant is required?
- How should host count toward capacity?
- How should host transfer work, if it is allowed later?

Expected output:
- One recommended host-ownership model.
- Any required schema constraints or triggers.
- A clear rule for how host participation affects capacity and membership queries.

## Required research standards
- Prefer primary sources first.
- For Bungie-specific claims, use official Bungie documentation or official Bungie-maintained API references.
- For OAuth/mobile-app claims, prefer standards and official platform guidance over blog posts when possible.
- Clearly separate:
  - source-backed facts,
  - informed recommendations,
  - assumptions where the source material is silent.
- Include direct links to sources.
- Use concrete examples when a recommendation depends on subtle lifecycle behavior.

## Suggested source priorities

### Bungie
- Bungie OAuth documentation
- Bungie API reference for membership/user endpoints
- Bungie application registration behavior and scope behavior

### OAuth and native app security
- OAuth 2.0 for Native Apps guidance
- Platform guidance for universal links / app links / deep links
- General OAuth security best practices relevant to browser-to-app handoff

## Desired deliverable from the research agent
Produce a markdown memo with these sections:

1. Executive summary
2. Findings by blocker
3. Recommended spec changes
4. Proposed schema changes
5. Proposed auth-flow changes
6. Open questions and unresolved risks
7. Sources

For each blocker, the memo should answer:
- What is wrong with the current note?
- What is definitely true based on sources?
- What is the recommended fix?
- What exact wording or schema should replace the current section?

## Constraints to preserve
- Treat Bungie as identity plus Marathon ownership verification.
- Do not redesign the MVP around Marathon loadout, gear, rank, or completion APIs.
- Keep Bungie tokens server-side if the chosen flow allows that.
- Prefer a backend-owned session model over exposing Bungie access or refresh tokens to the mobile client.

## Nice-to-have output
If the evidence is strong enough, include a proposed patch plan for updating:

- `/Users/brennan/Documents/MaratonLookingForGroup/marathon-lfg-backend-implementation.md`

That patch plan should be specific enough that another agent can convert it into an edit pass with minimal interpretation.
