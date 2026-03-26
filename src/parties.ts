import type { PoolClient } from 'pg';

import type { DbAdapter } from './db.js';
import { AppError } from './errors.js';
import type { CreatePartyBody } from './types.js';
import type { CurrentUser } from './users.js';

interface PartyInsertRow {
  id: string;
  status: string;
  max_size: number;
}

interface PartyRow {
  id: string;
  status: string;
  max_size: number;
  approval_mode: string;
  requires_marathon_verified: boolean;
  host_user_id?: string;
}

interface PriorMembershipRow {
  id: number;
  status: 'accepted' | 'pending' | 'declined' | 'left' | 'kicked';
}

interface PartyMemberInsertRow {
  id: number;
  status: 'accepted' | 'pending';
}

interface PartyMemberRow {
  id: number;
  user_id: string;
  status: 'accepted' | 'pending' | 'declined' | 'left' | 'kicked';
}

interface CapacityRow {
  accepted_count: string;
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

function calculateCapacity(maxSize: number, acceptedCount: number): { filledSlots: number; openSlots: number } {
  const filledSlots = 1 + acceptedCount;
  return {
    filledSlots,
    openSlots: Math.max(maxSize - filledSlots, 0)
  };
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
      [
        membership.id,
        newStatus === 'accepted' ? 'join_accepted' : 'join_requested',
        prior?.status ?? null,
        membership.status
      ]
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
): Promise<{ partyId: string; memberId: number; memberStatus: string; filledSlots: number; openSlots: number; partyStatus: string }> {
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
      [member.id, input.eventType, member.status, input.nextStatus]
    );

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
