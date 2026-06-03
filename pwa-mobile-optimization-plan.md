# PWA Mobile Optimization Plan

## Goal

Turn the current same-origin React/Vite browser client into a mobile-first PWA that feels intentional on phone screens, installs cleanly, and stays usable when network quality is inconsistent.

The current baseline is already solid:

- same-origin cookie auth
- manifest + standalone display
- React Router app under `/app`
- in-app realtime updates via SSE
- core party flows working end to end

The remaining work is mostly mobile UX, installability, and resilience.

## Current Gaps

- desktop-first masthead and card spacing consume too much vertical space on phones
- primary navigation is header-only instead of mobile-bottom-nav first
- no install prompt flow or standalone-mode-specific polish
- no service worker, offline shell, or cached read experience
- icons/manifest are minimal and not yet app-store-quality
- no explicit mobile-safe-area handling for notches and home indicators
- no mobile-specific confirmation patterns beyond toasts

## Phase 1: Mobile Shell And Navigation

Objective: make the app comfortable to use one-handed on a phone before adding deeper PWA features.

Implementation:

- keep `/parties` as the effective home route
- replace the current desktop-leaning header behavior on small screens with:
  - a tighter top bar
  - a sticky bottom navigation
  - primary tabs: `Home`, `Create`, `Profile`
- keep `Log out` and secondary utility actions out of the bottom nav
- reduce panel padding and card spacing below `720px`
- make all primary action buttons full-width on narrow screens
- ensure tap targets are at least `44px`
- add `padding-bottom` and `padding-top` using `env(safe-area-inset-*)`

Files likely affected:

- `apps/web/src/components/shell-layout.tsx`
- `apps/web/src/styles/app.css`
- route components with action bars such as `party-detail.tsx` and `party-create.tsx`

## Phase 2: Installability And Standalone Behavior

Objective: make the app feel like an installable product instead of a bookmarked web page.

Implementation:

- expand `manifest.webmanifest` with:
  - `id`
  - `display_override`
  - `icons` for real PNG sizes
  - at least one `maskable` icon
  - shortcuts for:
    - Home
    - Create Party
    - Profile
- add `apple-touch-icon` assets and mobile-web-app meta tags
- add a lightweight install banner component:
  - use `beforeinstallprompt` where supported
  - hide after install or dismiss
  - show iOS-specific manual “Add to Home Screen” instructions when needed
- detect standalone mode and remove browser-specific copy when installed

Files likely affected:

- `apps/web/index.html`
- `apps/web/manifest.webmanifest`
- new assets under `apps/web/public` or equivalent served path
- new React component such as `apps/web/src/app/install-prompt.tsx`

## Phase 3: Offline Shell And Network Resilience

Objective: preserve the feeling of an app when connectivity drops.

Implementation:

- add a service worker for static shell assets first
- cache:
  - HTML shell
  - built JS/CSS assets
  - manifest
  - icon assets
- use network-first or stale-while-revalidate for public read routes:
  - `GET /parties`
  - `GET /parties/:partyId`
  - `GET /auth/session`
  - `GET /me`
- add an offline fallback state:
  - “You are offline”
  - show last known party feed if cached
  - disable write actions until connectivity returns
- avoid caching mutation responses aggressively

Notes:

- keep auth and mutation semantics server-authoritative
- do not fake a successful join/create while offline

Files likely affected:

- Vite config / build output handling
- new service worker file
- frontend API layer and query defaults

## Phase 4: Mobile Interaction Polish

Objective: make the main workflows feel fast and obvious on a phone.

Implementation:

- add sticky action bars on critical screens:
  - party detail join/leave/cancel
  - create party submit
- add skeleton loaders instead of plain text loading states
- tighten long text blocks and use collapsible detail sections on mobile
- add clearer inline confirmations after state changes in addition to toasts:
  - request sent
  - approved
  - declined
  - removed
  - party cancelled
- keep full parties visible but visually deprioritized
- make the approved-player handoff card prominent and thumb-friendly

Files likely affected:

- `apps/web/src/routes/parties-feed.tsx`
- `apps/web/src/routes/party-detail.tsx`
- `apps/web/src/routes/party-create.tsx`
- `apps/web/src/styles/app.css`

## Phase 5: Notifications Beyond The Active Page

Objective: move from in-app live state to real PWA notifications where justified.

Current state:

- realtime is already implemented with SSE for active sessions

Next step:

- keep SSE for foreground updates
- add Web Push only if product testing shows real value

Requirements for Web Push:

- service worker already in place
- notification permission UX
- VAPID keys and backend subscription storage
- clear opt-in language
- unsubscribe controls in profile/settings

Notification candidates:

- join request received
- join approved
- join declined
- removed from party
- party cancelled

Non-goal for now:

- do not add WebSockets just to feel more “realtime”
- SSE already covers the current live in-app need

## Backend Touches Needed Later

Most work is frontend, but a few backend additions will help:

- optional unread event cursor if notification history becomes necessary
- push subscription endpoints if Web Push is added
- rate limiting and event dedupe for notification fanout

## Recommended Order

1. Mobile shell and bottom navigation
2. Install prompt plus manifest/icon upgrade
3. Service worker for static shell
4. Offline/cached feed behavior
5. Sticky mobile action bars and skeleton states
6. Optional Web Push

## Acceptance Criteria For “Very PWA’y”

- app installs cleanly from mobile browser
- standalone mode looks intentional
- home/feed, create, and profile are reachable one-handed
- loading and empty states feel app-like, not document-like
- temporary network drops do not collapse the shell
- active users get live updates through SSE
- optional push notifications can be layered on later without redesign
