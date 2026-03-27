import type { PoolClient } from 'pg';

import type { DbAdapter, Queryable } from './db.js';
import { AppError } from './errors.js';
import type { CreatePartyBody } from './types.js';
import type { CurrentUser } from './users.js';

type PartyStatus = 'open' | 'full' | 'in_progress' | 'closed' | 'cancelled';
type PartyMemberStatus = 'accepted' | 'pending' | 'declined' | 'left' | 'kicked';
type PartyMemberEventType = 'join_requested' | 'join_accepted' | 'join_declined' | 'left' | 'kicked';

interface PartyInsertRow {
  id: string;
  status: string;
  max_size: number;
}

interface PartyRow {
  id: string;
  status: PartyStatus;
  max_size: number;
  approval_mode: string;
  requires_marathon_verified: boolean;
  host_user_id: string;
}

interface PriorMembershipRow {
  id: string;
  status: PartyMemberStatus;
}

interface PartyMemberInsertRow {
  id: string;
  status: 'accepted' | 'pending';
}

interface PartyMemberRow {
  id: string;
  user_id: string;
  status: PartyMemberStatus;
}

interface CapacityRow {
  accepted_count: string;
}

interface PartyViewRow {
  id: string;
  status: PartyStatus;
  title: string;
  activity_key: string;
  playlist_key: string | null;
  platform_key: string;
  region_key: string | null;
  language_key: string | null;
  voice_required: boolean;
  ranked: boolean | null;
  scheduled_for: string | null;
  max_size: number;
  approval_mode: string;
  visibility: string;
  requires_marathon_verified: boolean;
  requirement_text: string | null;
  description: string | null;
  external_join_url: string | null;
  filled_slots: number;
  open_slots: number;
  created_at: string;
  updated_at: string;
  host_user_id: string;
  host_bungie_display_name: string | null;
  host_bungie_global_display_name: string | null;
  host_bungie_global_display_name_code: number | null;
}

interface PartyTagRow {
  party_id: string;
  tag_key: string;
  tag_value: string | null;
}

interface MembershipSummaryRow {
  party_id: string;
  member_id: string;
  status: PartyMemberStatus;
  note_to_host: string | null;
  joined_at: string | null;
  responded_at: string | null;
  created_at: string;
}

interface PartyTag {
  tagKey: string;
  tagValue: string | null;
}

interface PartyMembershipSummary {
  memberId: string;
  status: PartyMemberStatus;
  noteToHost: string | null;
  joinedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface PartyView {
  partyId: string;
  status: PartyStatus;
  title: string;
  activityKey: string;
  playlistKey: string | null;
  platformKey: string;
  regionKey: string | null;
  languageKey: string | null;
  voiceRequired: boolean;
  ranked: boolean | null;
  scheduledFor: string | null;
  maxSize: number;
  approvalMode: string;
  visibility: string;
  requiresMarathonVerified: boolean;
  requirementText: string | null;
  description: string | null;
  externalJoinUrl: string | null;
  filledSlots: number;
  openSlots: number;
  createdAt: string;
  updatedAt: string;
  host: {
    userId: string;
    bungieDisplayName: string | null;
    globalDisplayName: string | null;
    globalDisplayNameCode: number | null;
  };
  tags: PartyTag[];
  myMembership: PartyMembershipSummary | null;
}

interface PartyMutationResult {
  partyId: string;
  memberId: string;
  memberStatus: PartyMemberStatus;
  filledSlots: number;
  openSlots: number;
  partyStatus: string;
}

function requirePartyDb(db: DbAdapter | null): DbAdapter {
  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  return db;
}

function ensureMarathonVerified(user: CurrentUser): void {
  if (!user.marathonVerified) {
    throw new AppError(
      403,
      'marathon_membership_missing',
      'Your Bungie account is linked but Marathon membership could not be verified. Re-sync your account and try again.'
    );
  }
}

function normalizeTags(body: CreatePartyBody) {
  return (body.tags ?? []).map((tag) => ({
    tagKey: tag.tagKey,
    tagValue: tag.tagValue ?? null
  }));
}

function calculateCapacity(maxSize: number, acceptedCount: number): { filledSlots: number; openSlots: number } {
  const filledSlots = 1 + acceptedCount;
  return {
    filledSlots,
    openSlots: Math.max(maxSize - filledSlots, 0)
  };
}

function mapMembership(row: MembershipSummaryRow | undefined): PartyMembershipSummary | null {
  if (!row) {
    return null;
  }

  return {
    memberId: row.member_id,
    status: row.status,
    noteToHost: row.note_to_host,
    joinedAt: row.joined_at,
    respondedAt: row.responded_at,
    createdAt: row.created_at
  };
}

function mapPartyView(
  row: PartyViewRow,
  tags: PartyTag[],
  membership: MembershipSummaryRow | undefined
): PartyView {
  return {
    partyId: row.id,
    status: row.status,
    title: row.title,
    activityKey: row.activity_key,
    playlistKey: row.playlist_key,
    platformKey: row.platform_key,
    regionKey: row.region_key,
    languageKey: row.language_key,
    voiceRequired: row.voice_required,
    ranked: row.ranked,
    scheduledFor: row.scheduled_for,
    maxSize: row.max_size,
    approvalMode: row.approval_mode,
    visibility: row.visibility,
    requiresMarathonVerified: row.requires_marathon_verified,
    requirementText: row.requirement_text,
    description: row.description,
    externalJoinUrl: row.external_join_url,
    filledSlots: row.filled_slots,
    openSlots: row.open_slots,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    host: {
      userId: row.host_user_id,
      bungieDisplayName: row.host_bungie_display_name,
      globalDisplayName: row.host_bungie_global_display_name,
      globalDisplayNameCode: row.host_bungie_global_display_name_code
    },
    tags,
    myMembership: mapMembership(membership)
  };
}

async function loadPartyTags(
  client: Queryable,
  partyIds: string[]
): Promise<Map<string, PartyTag[]>> {
  const tagsByParty = new Map<string, PartyTag[]>();
  if (partyIds.length === 0) {
    return tagsByParty;
  }

  const result = await client.query<PartyTagRow>(
    `
      select
        party_id::text,
        tag_key,
        tag_value
      from party_tags
      where party_id = any($1::uuid[])
      order by party_id, tag_key, tag_value nulls first
    `,
    [partyIds]
  );

  for (const row of result.rows) {
    const tags = tagsByParty.get(row.party_id) ?? [];
    tags.push({
      tagKey: row.tag_key,
      tagValue: row.tag_value
    });
    tagsByParty.set(row.party_id, tags);
  }

  return tagsByParty;
}

async function loadLatestMembershipSummaries(
  client: Queryable,
  viewerUserId: string,
  partyIds: string[]
): Promise<Map<string, MembershipSummaryRow>> {
  const membershipsByParty = new Map<string, MembershipSummaryRow>();
  if (partyIds.length === 0) {
    return membershipsByParty;
  }

  const result = await client.query<MembershipSummaryRow>(
    `
      select distinct on (party_id)
        party_id::text,
        id::text as member_id,
        status,
        note_to_host,
        joined_at::text,
        responded_at::text,
        created_at::text
      from party_members
      where user_id = $1
        and party_id = any($2::uuid[])
      order by party_id, created_at desc, id desc
    `,
    [viewerUserId, partyIds]
  );

  for (const row of result.rows) {
    membershipsByParty.set(row.party_id, row);
  }

  return membershipsByParty;
}

async function buildPartyViews(
  client: Queryable,
  rows: PartyViewRow[],
  viewerUserId?: string
): Promise<PartyView[]> {
  const partyIds = rows.map((row) => row.id);
  const tagsByParty = await loadPartyTags(client, partyIds);
  const membershipsByParty = viewerUserId
    ? await loadLatestMembershipSummaries(client, viewerUserId, partyIds)
    : new Map<string, MembershipSummaryRow>();

  return rows.map((row) => mapPartyView(row, tagsByParty.get(row.id) ?? [], membershipsByParty.get(row.id)));
}

export async function createParty(
  db: DbAdapter | null,
  user: CurrentUser,
  body: CreatePartyBody
): Promise<{ partyId: string; status: string; filledSlots: number; openSlots: number }> {
  const database = requirePartyDb(db);
  ensureMarathonVerified(user);

  return database.withTransaction(async (client) => {
    const partyResult = await client.query<PartyInsertRow>(
      `
        insert into parties (
          host_user_id,
          title,
          activity_key,
          playlist_key,
          platform_key,
          region_key,
          language_key,
          voice_required,
          ranked,
          scheduled_for,
          max_size,
          approval_mode,
          visibility,
          requires_marathon_verified,
          requirement_text,
          description,
          external_join_url
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )
        returning id::text, status::text, max_size
      `,
      [
        user.userId,
        body.title,
        body.activityKey,
        body.playlistKey ?? null,
        body.platformKey ?? 'any',
        body.regionKey ?? null,
        body.languageKey ?? null,
        body.voiceRequired ?? false,
        body.ranked ?? null,
        body.scheduledFor ?? null,
        body.maxSize,
        body.approvalMode ?? 'manual',
        body.visibility ?? 'public',
        body.requiresMarathonVerified ?? true,
        body.requirementText ?? null,
        body.description ?? null,
        body.externalJoinUrl ?? null
      ]
    );

    const party = partyResult.rows[0];
    if (!party) {
      throw new AppError(500, 'party_create_failed', 'Unable to create party');
    }

    const tags = normalizeTags(body);
    for (const tag of tags) {
      await client.query(
        `
          insert into party_tags (party_id, tag_key, tag_value)
          values ($1, $2, $3)
          on conflict do nothing
        `,
        [party.id, tag.tagKey, tag.tagValue]
      );
    }

    return {
      partyId: party.id,
      status: party.status,
      filledSlots: 1,
      openSlots: Math.max(party.max_size - 1, 0)
    };
  });
}

async function loadLockedParty(client: PoolClient, partyId: string): Promise<PartyRow> {
  const result = await client.query<PartyRow>(
    `
      select
        id::text,
        status::text,
        max_size,
        approval_mode,
        requires_marathon_verified,
        host_user_id::text
      from parties
      where id = $1
      for update
    `,
    [partyId]
  );

  const party = result.rows[0];
  if (!party) {
    throw new AppError(404, 'party_not_found', 'Party not found');
  }

  return party;
}

async function countAcceptedMembers(client: PoolClient, partyId: string): Promise<number> {
  const capacityResult = await client.query<CapacityRow>(
    `
      select count(*)::text as accepted_count
      from party_members
      where party_id = $1
        and status = 'accepted'
    `,
    [partyId]
  );

  return Number(capacityResult.rows[0]?.accepted_count ?? '0');
}

async function syncPartyOpenFullStatus(
  client: PoolClient,
  party: Pick<PartyRow, 'id' | 'status' | 'max_size'>,
  acceptedCount: number
): Promise<'open' | 'full' | string> {
  const { openSlots } = calculateCapacity(party.max_size, acceptedCount);

  if (party.status === 'open' && openSlots === 0) {
    await client.query(
      `
        update parties
        set status = 'full', updated_at = now()
        where id = $1
      `,
      [party.id]
    );
    return 'full';
  }

  if (party.status === 'full' && openSlots > 0) {
    await client.query(
      `
        update parties
        set status = 'open', updated_at = now()
        where id = $1
      `,
      [party.id]
    );
    return 'open';
  }

  return party.status;
}

function ensureHost(user: CurrentUser, party: PartyRow): void {
  if (party.host_user_id !== user.userId) {
    throw new AppError(403, 'not_party_host', 'Only the party host can perform this action');
  }
}

async function loadLockedMember(
  client: PoolClient,
  partyId: string,
  memberId: string
): Promise<PartyMemberRow> {
  const result = await client.query<PartyMemberRow>(
    `
      select
        id,
        user_id::text,
        status
      from party_members
      where id = $1
        and party_id = $2
      for update
    `,
    [memberId, partyId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'party_member_not_found', 'Party membership was not found');
  }

  return row;
}

async function loadLockedLatestMembershipByUser(
  client: PoolClient,
  partyId: string,
  userId: string
): Promise<PartyMemberRow | null> {
  const result = await client.query<PartyMemberRow>(
    `
      select
        id,
        user_id::text,
        status
      from party_members
      where party_id = $1
        and user_id = $2
      order by created_at desc, id desc
      limit 1
      for update
    `,
    [partyId, userId]
  );

  return result.rows[0] ?? null;
}

async function insertMemberEvent(
  client: PoolClient,
  memberId: string,
  eventType: PartyMemberEventType,
  fromStatus: PartyMemberStatus | null,
  toStatus: PartyMemberStatus
): Promise<void> {
  await client.query(
    `
      insert into party_member_events (
        party_member_id,
        event_type,
        from_status,
        to_status
      )
      values ($1, $2::party_member_event_type, $3::party_member_status, $4::party_member_status)
    `,
    [memberId, eventType, fromStatus, toStatus]
  );
}

export async function listParties(
  db: DbAdapter | null,
  viewer: CurrentUser | null
): Promise<{ items: PartyView[] }> {
  const database = requirePartyDb(db);
  const params: unknown[] = [];
  let visibilitySql = "p.visibility = 'public' and p.status <> 'cancelled'";

  if (viewer) {
    params.push(viewer.userId);
    visibilitySql = `
      (
        (p.visibility = 'public' and p.status <> 'cancelled')
        or p.host_user_id = $1
        or exists (
          select 1
          from party_members pmv
          where pmv.party_id = p.id
            and pmv.user_id = $1
            and pmv.status in ('accepted', 'pending')
        )
      )
    `;
  }

  const result = await database.query<PartyViewRow>(
    `
      select
        p.id::text,
        p.status::text,
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
        pc.filled_slots::int as filled_slots,
        pc.open_slots::int as open_slots,
        p.created_at::text,
        p.updated_at::text,
        p.host_user_id::text,
        ba.bungie_display_name as host_bungie_display_name,
        ba.bungie_global_display_name as host_bungie_global_display_name,
        ba.bungie_global_display_name_code as host_bungie_global_display_name_code
      from parties p
      join party_capacity pc on pc.party_id = p.id
      left join bungie_accounts ba on ba.user_id = p.host_user_id
      where ${visibilitySql}
      order by p.created_at desc, p.id desc
    `,
    params
  );

  return {
    items: await buildPartyViews(database, result.rows, viewer?.userId)
  };
}

export async function getParty(
  db: DbAdapter | null,
  viewer: CurrentUser | null,
  partyId: string
): Promise<PartyView> {
  const database = requirePartyDb(db);
  const params: unknown[] = [partyId];
  let accessSql = "(p.visibility = 'public' and p.status <> 'cancelled')";

  if (viewer) {
    params.push(viewer.userId);
    accessSql = `
      (
        (p.visibility = 'public' and p.status <> 'cancelled')
        or p.host_user_id = $2
        or exists (
          select 1
          from party_members pmv
          where pmv.party_id = p.id
            and pmv.user_id = $2
            and pmv.status in ('accepted', 'pending')
        )
      )
    `;
  }

  const result = await database.query<PartyViewRow>(
    `
      select
        p.id::text,
        p.status::text,
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
        pc.filled_slots::int as filled_slots,
        pc.open_slots::int as open_slots,
        p.created_at::text,
        p.updated_at::text,
        p.host_user_id::text,
        ba.bungie_display_name as host_bungie_display_name,
        ba.bungie_global_display_name as host_bungie_global_display_name,
        ba.bungie_global_display_name_code as host_bungie_global_display_name_code
      from parties p
      join party_capacity pc on pc.party_id = p.id
      left join bungie_accounts ba on ba.user_id = p.host_user_id
      where p.id = $1
        and ${accessSql}
      limit 1
    `,
    params
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'party_not_found', 'Party not found');
  }

  const [party] = await buildPartyViews(database, [row], viewer?.userId);
  if (!party) {
    throw new AppError(500, 'party_load_failed', 'Unable to load party');
  }

  return party;
}

export async function joinParty(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string,
  noteToHost?: string
): Promise<{ partyId: string; myStatus: string; filledSlots: number; openSlots: number }> {
  const database = requirePartyDb(db);

  return database.withTransaction(async (client) => {
    const party = await loadLockedParty(client, partyId);
    if (party.status !== 'open') {
      throw new AppError(409, 'party_closed', 'Party is not open for new members');
    }

    if (party.requires_marathon_verified) {
      ensureMarathonVerified(user);
    }

    const priorResult = await client.query<PriorMembershipRow>(
      `
        select id, status
        from party_members
        where party_id = $1
          and user_id = $2
        order by created_at desc, id desc
        limit 1
      `,
      [partyId, user.userId]
    );

    const prior = priorResult.rows[0];
    if (prior?.status === 'accepted' || prior?.status === 'pending') {
      throw new AppError(409, 'already_member', 'You already have an active membership for this party');
    }

    if (prior?.status === 'kicked') {
      throw new AppError(403, 'membership_blocked', 'You are blocked from joining this party');
    }

    const acceptedCount = await countAcceptedMembers(client, partyId);
    const filledBeforeInsert = 1 + acceptedCount;
    if (filledBeforeInsert >= party.max_size) {
      throw new AppError(409, 'party_full', 'Party is already full');
    }

    const newStatus = party.approval_mode === 'auto_accept' ? 'accepted' : 'pending';
    const insertResult = await client.query<PartyMemberInsertRow>(
      `
        insert into party_members (
          party_id,
          user_id,
          status,
          joined_at,
          note_to_host
        )
        values ($1, $2, $3::party_member_status, now(), $4)
        returning id, status
      `,
      [partyId, user.userId, newStatus, noteToHost ?? null]
    );

    const membership = insertResult.rows[0];
    if (!membership) {
      throw new AppError(500, 'join_failed', 'Unable to create party membership');
    }

    await insertMemberEvent(
      client,
      membership.id,
      newStatus === 'accepted' ? 'join_accepted' : 'join_requested',
      prior?.status ?? null,
      membership.status
    );

    const filledAfterInsert = newStatus === 'accepted' ? filledBeforeInsert + 1 : filledBeforeInsert;
    const acceptedAfterInsert = newStatus === 'accepted' ? acceptedCount + 1 : acceptedCount;
    await syncPartyOpenFullStatus(client, party, acceptedAfterInsert);

    return {
      partyId,
      myStatus: membership.status,
      filledSlots: filledAfterInsert,
      openSlots: Math.max(party.max_size - filledAfterInsert, 0)
    };
  });
}

export async function leaveParty(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string
): Promise<PartyMutationResult> {
  const database = requirePartyDb(db);

  return database.withTransaction(async (client) => {
    const party = await loadLockedParty(client, partyId);
    if (party.host_user_id === user.userId) {
      throw new AppError(409, 'host_must_cancel', 'Party hosts must cancel the party instead of leaving it');
    }

    if (party.status === 'cancelled') {
      throw new AppError(409, 'party_closed', 'Party has already been cancelled');
    }

    const member = await loadLockedLatestMembershipByUser(client, partyId, user.userId);
    if (!member || (member.status !== 'accepted' && member.status !== 'pending')) {
      throw new AppError(409, 'invalid_member_state', 'You do not have an active party membership to leave');
    }

    const acceptedCountBefore = await countAcceptedMembers(client, partyId);
    await client.query(
      `
        update party_members
        set status = 'left',
            responded_at = now()
        where id = $1
      `,
      [member.id]
    );

    await insertMemberEvent(client, member.id, 'left', member.status, 'left');

    const acceptedCountAfter = member.status === 'accepted' ? acceptedCountBefore - 1 : acceptedCountBefore;
    const partyStatus = await syncPartyOpenFullStatus(client, party, acceptedCountAfter);
    const capacity = calculateCapacity(party.max_size, acceptedCountAfter);

    return {
      partyId,
      memberId: member.id,
      memberStatus: 'left',
      filledSlots: capacity.filledSlots,
      openSlots: capacity.openSlots,
      partyStatus
    };
  });
}

export async function cancelParty(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string
): Promise<{ partyId: string; status: PartyStatus }> {
  const database = requirePartyDb(db);

  return database.withTransaction(async (client) => {
    const party = await loadLockedParty(client, partyId);
    ensureHost(user, party);

    if (party.status !== 'cancelled') {
      await client.query(
        `
          update parties
          set status = 'cancelled',
              updated_at = now()
          where id = $1
        `,
        [partyId]
      );
    }

    return {
      partyId,
      status: 'cancelled'
    };
  });
}

async function transitionMemberStatus(
  db: DbAdapter | null,
  user: CurrentUser,
  input: {
    partyId: string;
    memberId: string;
    expectedStatuses: PartyMemberRow['status'][];
    nextStatus: 'accepted' | 'declined' | 'kicked';
    eventType: 'join_accepted' | 'join_declined' | 'kicked';
    capacityAffectsAcceptance: boolean;
  }
): Promise<PartyMutationResult> {
  const database = requirePartyDb(db);

  return database.withTransaction(async (client) => {
    const party = await loadLockedParty(client, input.partyId);
    ensureHost(user, party);

    if (party.status === 'cancelled' || party.status === 'closed') {
      throw new AppError(409, 'party_closed', 'Party is not open for moderation');
    }

    const member = await loadLockedMember(client, input.partyId, input.memberId);
    if (!input.expectedStatuses.includes(member.status)) {
      throw new AppError(409, 'invalid_member_state', 'Party membership is not in a mutable state for this action');
    }

    const acceptedCountBefore = await countAcceptedMembers(client, input.partyId);
    if (input.capacityAffectsAcceptance && member.status !== 'accepted') {
      const { openSlots } = calculateCapacity(party.max_size, acceptedCountBefore);
      if (openSlots <= 0) {
        throw new AppError(409, 'party_full', 'Party is already full');
      }
    }

    await client.query(
      `
        update party_members
        set status = $1::party_member_status,
            responded_at = now()
        where id = $2
      `,
      [input.nextStatus, member.id]
    );

    await insertMemberEvent(client, member.id, input.eventType, member.status, input.nextStatus);

    let acceptedCountAfter = acceptedCountBefore;
    if (member.status !== 'accepted' && input.nextStatus === 'accepted') {
      acceptedCountAfter += 1;
    } else if (member.status === 'accepted' && input.nextStatus !== 'accepted') {
      acceptedCountAfter -= 1;
    }

    const partyStatus = await syncPartyOpenFullStatus(client, party, acceptedCountAfter);
    const capacity = calculateCapacity(party.max_size, acceptedCountAfter);

    return {
      partyId: input.partyId,
      memberId: member.id,
      memberStatus: input.nextStatus,
      filledSlots: capacity.filledSlots,
      openSlots: capacity.openSlots,
      partyStatus
    };
  });
}

export async function acceptPartyMember(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string,
  memberId: string
) {
  return transitionMemberStatus(db, user, {
    partyId,
    memberId,
    expectedStatuses: ['pending'],
    nextStatus: 'accepted',
    eventType: 'join_accepted',
    capacityAffectsAcceptance: true
  });
}

export async function declinePartyMember(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string,
  memberId: string
) {
  return transitionMemberStatus(db, user, {
    partyId,
    memberId,
    expectedStatuses: ['pending'],
    nextStatus: 'declined',
    eventType: 'join_declined',
    capacityAffectsAcceptance: false
  });
}

export async function kickPartyMember(
  db: DbAdapter | null,
  user: CurrentUser,
  partyId: string,
  memberId: string
) {
  return transitionMemberStatus(db, user, {
    partyId,
    memberId,
    expectedStatuses: ['pending', 'accepted'],
    nextStatus: 'kicked',
    eventType: 'kicked',
    capacityAffectsAcceptance: false
  });
}
