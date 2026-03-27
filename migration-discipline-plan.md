# Migration Discipline Plan

## Goal

Move from a one-time bootstrap migration to a real forward-only migration workflow.

The current setup is fine for the first slice, but it will become fragile once the schema changes beyond `0001_init.sql`.

## Current state

Relevant files:

- `migrations/0001_init.sql`
- `compose.yaml`
- `test/helpers/integration.ts`
- `README.md`

Current behavior:

- Docker Postgres applies `0001_init.sql` only when the volume is created for the first time
- integration tests explicitly apply `0001_init.sql`
- there is no migration tracking table
- there is no migration runner

That means the project is still depending on bootstrap behavior, not a real schema evolution process.

## Problems to solve

Once more migrations exist, the current setup will drift:

- a reused Docker volume will not auto-apply `0002`, `0003`, and later files
- tests that only read `0001_init.sql` will no longer reflect production schema
- editing old migrations after they are already applied will become dangerous

## Recommended policy

Adopt a simple forward-only policy:

- never edit an already-merged migration
- every schema change gets a new numbered SQL file
- app code and migration ship in the same change set
- tests always apply all migrations in order

Do not introduce reversible down migrations yet unless the team actually has a deployment requirement for rollback-by-migration. Forward fixes are simpler and safer for this project stage.

## Recommended file convention

Continue using numeric prefixes:

- `0001_init.sql`
- `0002_auth_cleanup_indexes.sql`
- `0003_parties_listing_indexes.sql`

Keep names descriptive and stable.

## Recommended migration runner

Add a dedicated table:

```sql
create table if not exists schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
```

Add a script:

- `src/scripts/migrate.ts`

Responsibilities:

1. read all `migrations/*.sql`
2. sort lexicographically
3. hash each file
4. compare against `schema_migrations`
5. apply any missing migration inside a transaction
6. insert the applied version and checksum

If a version exists with a different checksum, fail loudly. That is a sign someone edited an already-applied migration.

## Pseudocode

```ts
async function migrate(databaseUrl: string) {
  const db = createDbAdapter(databaseUrl);
  if (!db) throw new Error('DATABASE_URL is required');

  await ensureSchemaMigrationsTable(db);

  const files = await loadMigrationFiles();

  for (const file of files) {
    const checksum = sha256(file.contents);
    const applied = await loadAppliedMigration(db, file.version);

    if (!applied) {
      await db.withTransaction(async (client) => {
        await client.query(file.contents);
        await client.query(
          'insert into schema_migrations (version, checksum) values ($1, $2)',
          [file.version, checksum]
        );
      });
      continue;
    }

    if (applied.checksum !== checksum) {
      throw new Error(`Migration checksum mismatch for ${file.version}`);
    }
  }
}
```

## Recommended package scripts

Add:

```json
{
  "scripts": {
    "db:migrate": "node dist/scripts/migrate.js",
    "db:migrate:check": "node dist/scripts/migrate.js --check"
  }
}
```

Optional later:

```json
{
  "scripts": {
    "db:migrate:test": "NODE_ENV=test node dist/scripts/migrate.js"
  }
}
```

## Test helper changes

`test/helpers/integration.ts` currently reads only `migrations/0001_init.sql`.

That should be replaced with:

- `applyAllMigrations(databaseUrl)`

Recommended behavior:

1. load every SQL file from `migrations/`
2. sort by filename
3. execute each file in order

That keeps integration tests aligned with real schema evolution even before the production migration runner is fully wired.

## README changes

Once the runner exists, the README should stop implying that Docker bootstrap is sufficient forever.

Recommended flow:

```bash
docker compose up -d postgres
npm install
npm run build
npm run db:migrate
node dist/server.js
```

The README should also say:

- Docker bootstrap only initializes a fresh volume
- `npm run db:migrate` is the real source of truth for later schema changes

## CI discipline

Once CI is added or expanded, require:

1. create empty test database
2. run all migrations
3. run typecheck
4. run integration tests

That catches:

- broken SQL ordering
- missing indexes or types
- code that assumes a column exists before the migration adds it

## Pull request discipline

For every schema-affecting change:

- include the SQL migration
- include code changes using the new schema
- include test changes proving the new schema path works
- do not rewrite old migration files

## Patch direction

This is one of the clearer future patches in the repo.

Expected files:

- `src/scripts/migrate.ts`
- `package.json`
- `test/helpers/integration.ts`
- `README.md`
- `migrations/0002_*.sql` and later

## Practical recommendation

Do this before the next nontrivial schema change, not after.

The current project is still small enough that a lightweight SQL runner will be easy to introduce. Waiting until there are many migrations and multiple environments will make the cleanup harder than it needs to be.
