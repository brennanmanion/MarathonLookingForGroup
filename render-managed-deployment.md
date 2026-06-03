# Render Managed Deployment

## Target Shape

Deploy the current PWA as one Render web service plus one Render-managed Postgres database.

The app remains same-origin:

- `/app` serves the React PWA
- `/auth/*`, `/me`, `/parties*`, and `/events/stream` are served by the same Node process
- cookies stay host-only by leaving `SESSION_COOKIE_DOMAIN` unset

## Files Added For Render

- `render.yaml` defines the web service and managed Postgres database.
- `src/migrate.ts` applies `migrations/0001_init.sql`.
- `npm run render:build` runs the production build sequence Render needs.
- `npm run migrate` runs the compiled migration script during Render pre-deploy.

## Render Blueprint

Use Render's Blueprint flow and point it at this repository. The checked-in `render.yaml` creates:

- `marathon-lfg` web service on the Starter plan
- `marathon-lfg-db` Postgres database on `basic-256mb`

Render will prompt for these secret values:

- `BUNGIE_CLIENT_ID`
- `BUNGIE_CLIENT_SECRET`
- `BUNGIE_API_KEY`

`APP_SESSION_SECRET` is generated automatically.

`DATABASE_URL` is wired from the managed Postgres database.

## URL Handling

The app derives these production URLs from Render's `RENDER_EXTERNAL_URL` if explicit env vars are not set:

- `WEB_APP_BASE_URL=https://<service>.onrender.com/app/`
- `BUNGIE_REDIRECT_URI=https://<service>.onrender.com/auth/bungie/callback`
- `APP_UNIVERSAL_LINK_BASE=https://<service>.onrender.com`

After Render creates the service, update the Bungie application redirect URL to:

```text
https://<service>.onrender.com/auth/bungie/callback
```

If you later add a custom domain, set explicit Render env vars for:

- `WEB_APP_BASE_URL=https://your-domain/app/`
- `BUNGIE_REDIRECT_URI=https://your-domain/auth/bungie/callback`
- `APP_UNIVERSAL_LINK_BASE=https://your-domain`

Then update the Bungie portal redirect URL to match.

## Build And Deploy Commands

Render build command:

```bash
npm run render:build
```

Render pre-deploy command:

```bash
npm run migrate
```

Render start command:

```bash
npm start
```

Health check:

```text
/health
```

## Local Verification

Before pushing deployment changes:

```bash
npm run check
npm run check:tests
npm --prefix apps/web run check
npm --prefix apps/web run build
npm run build
npm run render:build
```

The DB-backed integration suite also needs the local project Postgres container on `localhost:5432`. If another Docker container owns port `5432`, stop or move that container before running:

```bash
docker compose up -d postgres
npm run test:integration
```

## First Manual Production Test

1. Open `https://<service>.onrender.com/health`.
2. Open `https://<service>.onrender.com/app`.
3. Start Bungie login.
4. Confirm Bungie redirects to `/auth/bungie/callback`.
5. Confirm the app lands on `/app/auth/callback/success`.
6. Confirm `/app/parties` loads.
7. Create a party.
8. Confirm `GET /parties` includes it.

## Known Render-Specific Notes

- The SSE event bus is still in-memory. Keep the service at one instance for this POC.
- The managed database is separate from the web service lifecycle, which is the point of using Render-managed Postgres.
- `/docs` remains public unless you add auth or disable it before broader release.
