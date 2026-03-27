# Parties Query Polish Implementation

## Goal

Add pagination, filtering, and controlled sorting to `GET /parties` without destabilizing the current visibility rules.

The current route works for a demo, but it is still an unbounded list query:

- no pagination
- no query filters
- no explicit sort contract
- no listing indexes aimed at production usage

## Current codebase fit

Relevant files:

- `src/routes/parties.ts`
- `src/parties.ts`
- `src/types.ts`
- `migrations/0001_init.sql`

Current behavior:

- `GET /parties` returns all visible parties
- visibility is already viewer-aware
- tags and `myMembership` are loaded in follow-up queries
- capacity is already projected through the `party_capacity` view

That is a good base. The missing work is query shaping, not a new data model.

## Recommended route contract

Keep one route:

`GET /parties`

Add these query params:

- `limit`
- `cursor`
- `sort`
- `activityKey`
- `platformKey`
- `regionKey`
- `languageKey`
- `approvalMode`
- `requiresMarathonVerified`
- `voiceRequired`
- `ranked`
- `tagKey`
- `tagValue`

Recommended first-pass sort options:

- `newest`
- `scheduled`

Recommended defaults:

- `limit=20`
- `sort=newest`

Recommended response shape:

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": "opaque-string-or-null"
  }
}
```

Do not add total-count in the first pass. It is expensive, not necessary for the app flow, and easy to bolt on later if the UI actually needs it.

## Cursor design

Use opaque base64url JSON, not page numbers.

Reason:

- it avoids offset drift when parties are created during scrolling
- it keeps the sort order stable
- it works with current UUID ids and timestamp columns

Suggested cursor payloads:

For `sort=newest`:

```json
{
  "sort": "newest",
  "createdAt": "2026-03-27T19:10:00.000Z",
  "id": "uuid"
}
```

For `sort=scheduled`:

```json
{
  "sort": "scheduled",
  "scheduledFor": "2026-03-28T03:00:00.000Z",
  "id": "uuid"
}
```

## Visibility rules

Do not weaken the current visibility rules just because filters are added.

The listing query should still return:

- public non-cancelled parties to anonymous viewers
- additionally visible private/cancelled parties to the host
- additionally visible private/cancelled parties to accepted or pending members

The safest implementation is to keep the existing visibility predicate and layer filters on top of it.

## Recommended implementation shape

### 1. Add a query schema in `src/routes/parties.ts`

Add a Fastify schema for querystring validation.

Recommended fields:

```ts
{
  limit: { type: 'integer', minimum: 1, maximum: 50 },
  cursor: { type: 'string' },
  sort: { type: 'string', enum: ['newest', 'scheduled'] },
  activityKey: { type: 'string' },
  platformKey: { type: 'string' },
  regionKey: { type: 'string' },
  languageKey: { type: 'string' },
  approvalMode: { type: 'string' },
  requiresMarathonVerified: { type: 'boolean' },
  voiceRequired: { type: 'boolean' },
  ranked: { type: 'boolean' },
  tagKey: { type: 'string' },
  tagValue: { type: 'string' }
}
```

### 2. Add a dedicated list-query type in `src/types.ts`

Recommended:

```ts
export interface ListPartiesQuery {
  limit?: number;
  cursor?: string;
  sort?: 'newest' | 'scheduled';
  activityKey?: string;
  platformKey?: string;
  regionKey?: string;
  languageKey?: string;
  approvalMode?: string;
  requiresMarathonVerified?: boolean;
  voiceRequired?: boolean;
  ranked?: boolean;
  tagKey?: string;
  tagValue?: string;
}
```

### 3. Change `listParties` to accept the query input

Recommended signature:

```ts
export async function listParties(
  db: DbAdapter | null,
  user: CurrentUser | null,
  query: ListPartiesQuery
): Promise<{ items: PartyView[]; pageInfo: { nextCursor: string | null } }>
```

### 4. Keep sort implementations explicit

Do not build raw SQL from user-provided sort strings.

Use a small whitelist:

- `buildNewestSortQuery(...)`
- `buildScheduledSortQuery(...)`

That keeps the SQL easier to reason about and index.

## SQL shape

The listing query should still produce `PartyViewRow`, but with `limit + 1` rows so the caller can detect `nextCursor`.

Pseudo-SQL for `sort=newest`:

```sql
select
  p.id::text,
  p.status,
  p.title,
  p.activity_key,
  p.playlist_key,
  p.platform_key,
  p.region_key,
  p.language_key,
  p.voice_required,
  p.ranked,
  p.scheduled_for::text,
  p.max_size,
  p.approval_mode,
  p.visibility,
  p.requires_marathon_verified,
  p.requirement_text,
  p.description,
  p.external_join_url,
  pc.filled_slots,
  pc.open_slots,
  p.created_at::text,
  p.updated_at::text,
  p.host_user_id::text,
  host.bungie_display_name as host_bungie_display_name,
  host.bungie_global_display_name as host_bungie_global_display_name,
  host.bungie_global_display_name_code as host_bungie_global_display_name_code
from parties p
join party_capacity pc on pc.party_id = p.id
left join bungie_accounts host on host.user_id = p.host_user_id
where <existing visibility predicate>
  and ($1::text is null or p.activity_key = $1)
  and ($2::text is null or p.platform_key = $2)
  and ($3::text is null or p.region_key = $3)
  and ($4::text is null or p.language_key = $4)
  and ($5::text is null or p.approval_mode = $5)
  and ($6::boolean is null or p.requires_marathon_verified = $6)
  and ($7::boolean is null or p.voice_required = $7)
  and ($8::boolean is null or p.ranked = $8)
  and (
    $9::text is null
    or exists (
      select 1
      from party_tags pt
      where pt.party_id = p.id
        and pt.tag_key = $9
        and ($10::text is null or pt.tag_value = $10)
    )
  )
  and (
    $11::timestamptz is null
    or (p.created_at, p.id) < ($11::timestamptz, $12::uuid)
  )
order by p.created_at desc, p.id desc
limit $13
```

## Migration support

Add listing-oriented indexes once the route contract is stable.

Recommended next migration:

```sql
create index if not exists parties_public_newest_idx
  on parties (created_at desc, id desc)
  where visibility = 'public' and status in ('open', 'full');

create index if not exists parties_public_scheduled_idx
  on parties (scheduled_for asc, id asc)
  where visibility = 'public' and status in ('open', 'full');

create index if not exists party_tags_lookup_idx
  on party_tags (tag_key, tag_value, party_id);
```

If the product later adds host-only private discovery, add indexes for that deliberately instead of trying to make one index handle every visibility case.

## Pseudocode

```ts
export async function listParties(db, user, query) {
  const database = requirePartyDb(db);
  const normalized = normalizeListPartiesQuery(query);

  const rows = normalized.sort === 'scheduled'
    ? await listPartiesScheduled(database, user, normalized)
    : await listPartiesNewest(database, user, normalized);

  const hasMore = rows.length > normalized.limit;
  const pageRows = hasMore ? rows.slice(0, normalized.limit) : rows;
  const items = await buildPartyViews(database, pageRows, user?.userId);
  const nextCursor = hasMore ? encodeCursor(normalized.sort, pageRows.at(-1)) : null;

  return {
    items,
    pageInfo: {
      nextCursor
    }
  };
}
```

## Test plan

Add integration coverage for:

- anonymous list returns only public non-cancelled parties
- authenticated host sees their cancelled party
- `limit` truncates results and returns `nextCursor`
- `cursor` returns the next page without duplicates
- `sort=newest` is stable
- `sort=scheduled` is stable
- `activityKey` filter
- `tagKey` plus `tagValue` filter

## Suggested implementation order

1. Add query types and route validation.
2. Add cursor encode/decode helpers.
3. Split list SQL by sort mode.
4. Add indexes in a follow-up migration.
5. Add integration coverage against a multi-party fixture.
