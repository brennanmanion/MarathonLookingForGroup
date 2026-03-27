import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDbAdapter } from '../src/db.js';
import { issueAccessToken } from '../src/session.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_USER_ID = '22222222-2222-4222-8222-222222222222';

function buildTestDatabaseName(): string {
  return `marathon_lfg_test_${randomUUID().replaceAll('-', '')}`;
}

function buildDatabaseUrl(baseDatabaseUrl: string, databaseName: string): string {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createIsolatedDatabase(baseDatabaseUrl: string, databaseName: string): Promise<void> {
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });

  try {
    await adminPool.query(`create database ${databaseName}`);
  } finally {
    await adminPool.end();
  }
}

async function dropIsolatedDatabase(baseDatabaseUrl: string, databaseName: string): Promise<void> {
  const adminPool = new Pool({ connectionString: baseDatabaseUrl });

  try {
    await adminPool.query(
      `
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = $1
          and pid <> pg_backend_pid()
      `,
      [databaseName]
    );
    await adminPool.query(`drop database if exists ${databaseName}`);
  } finally {
    await adminPool.end();
  }
}

async function applyMigration(databaseUrl: string): Promise<void> {
  const migrationSql = await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(migrationSql);
  } finally {
    await pool.end();
  }
}

async function seedVerifiedUser(
  databaseUrl: string,
  input: {
    userId: string;
    bungieMembershipId: string;
    marathonMembershipId: string;
    displayName: string;
    displayNameCode: number;
  }
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(
      `
        insert into app_users (id, is_active)
        values ($1::uuid, true)
      `,
      [input.userId]
    );

    await pool.query(
      `
        insert into bungie_accounts (
          user_id,
          bungie_membership_id,
          bungie_display_name,
          bungie_global_display_name,
          bungie_global_display_name_code,
          bungie_verified,
          bungie_verified_at,
          marathon_membership_id,
          marathon_verified,
          marathon_verified_at,
          last_membership_sync_at,
          raw_membership_payload
        )
        values (
          $1::uuid,
          $2::bigint,
          $3,
          $3,
          $4,
          true,
          now(),
          $5::bigint,
          true,
          now(),
          now(),
          jsonb_build_object('source', 'integration-test', 'userId', $1::text)
        )
      `,
      [
        input.userId,
        input.bungieMembershipId,
        input.displayName,
        input.displayNameCode,
        input.marathonMembershipId
      ]
    );
  } finally {
    await pool.end();
  }
}

test('integration: create, join, accept, leave, and cancel party lifecycle', async () => {
  const loadedConfig = loadConfig();
  assert.ok(loadedConfig.databaseUrl, 'DATABASE_URL must be configured to run integration tests');

  const databaseName = buildTestDatabaseName();
  const isolatedDatabaseUrl = buildDatabaseUrl(loadedConfig.databaseUrl, databaseName);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  await createIsolatedDatabase(loadedConfig.databaseUrl, databaseName);

  try {
    await applyMigration(isolatedDatabaseUrl);
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: HOST_USER_ID,
      bungieMembershipId: '800000000000001',
      marathonMembershipId: '810000000000001',
      displayName: 'HostUser',
      displayNameCode: 1111
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_USER_ID,
      bungieMembershipId: '800000000000002',
      marathonMembershipId: '810000000000002',
      displayName: 'MemberUser',
      displayNameCode: 2222
    });

    const config: AppConfig = {
      ...loadedConfig,
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: isolatedDatabaseUrl,
      appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
    };

    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const hostToken = issueAccessToken(config, HOST_USER_ID).token;
    const memberToken = issueAccessToken(config, MEMBER_USER_ID).token;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: {
        authorization: `Bearer ${hostToken}`
      },
      payload: {
        title: 'Integration lifecycle party',
        activityKey: 'cryo_archive',
        maxSize: 3,
        approvalMode: 'manual',
        visibility: 'public',
        tags: [
          {
            tagKey: 'source',
            tagValue: 'integration-test'
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createBody = createResponse.json() as {
      partyId: string;
      status: string;
      filledSlots: number;
      openSlots: number;
    };
    assert.equal(createBody.status, 'open');
    assert.equal(createBody.filledSlots, 1);
    assert.equal(createBody.openSlots, 2);

    const joinResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/join`,
      headers: {
        authorization: `Bearer ${memberToken}`
      },
      payload: {
        noteToHost: 'ready to go'
      }
    });

    assert.equal(joinResponse.statusCode, 200);
    const joinBody = joinResponse.json() as {
      partyId: string;
      myStatus: string;
      filledSlots: number;
      openSlots: number;
    };
    assert.equal(joinBody.partyId, createBody.partyId);
    assert.equal(joinBody.myStatus, 'pending');
    assert.equal(joinBody.filledSlots, 1);
    assert.equal(joinBody.openSlots, 2);

    const membershipResult = await db.query<{ id: string }>(
      `
        select id::text as id
        from party_members
        where party_id = $1::uuid
          and user_id = $2::uuid
        order by created_at desc, id desc
        limit 1
      `,
      [createBody.partyId, MEMBER_USER_ID]
    );

    const membershipId = membershipResult.rows[0]?.id;
    assert.ok(membershipId, 'Joined member row should exist before acceptance');

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/members/${membershipId}/accept`,
      headers: {
        authorization: `Bearer ${hostToken}`
      }
    });

    assert.equal(acceptResponse.statusCode, 200);
    const acceptBody = acceptResponse.json() as {
      partyId: string;
      memberId: string;
      memberStatus: string;
      filledSlots: number;
      openSlots: number;
      partyStatus: string;
    };
    assert.equal(acceptBody.partyId, createBody.partyId);
    assert.equal(acceptBody.memberId, membershipId);
    assert.equal(acceptBody.memberStatus, 'accepted');
    assert.equal(acceptBody.filledSlots, 2);
    assert.equal(acceptBody.openSlots, 1);
    assert.equal(acceptBody.partyStatus, 'open');

    const leaveResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/leave`,
      headers: {
        authorization: `Bearer ${memberToken}`
      }
    });

    assert.equal(leaveResponse.statusCode, 200);
    const leaveBody = leaveResponse.json() as {
      partyId: string;
      memberId: string;
      memberStatus: string;
      filledSlots: number;
      openSlots: number;
      partyStatus: string;
    };
    assert.equal(leaveBody.partyId, createBody.partyId);
    assert.equal(leaveBody.memberId, membershipId);
    assert.equal(leaveBody.memberStatus, 'left');
    assert.equal(leaveBody.filledSlots, 1);
    assert.equal(leaveBody.openSlots, 2);
    assert.equal(leaveBody.partyStatus, 'open');

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/cancel`,
      headers: {
        authorization: `Bearer ${hostToken}`
      }
    });

    assert.equal(cancelResponse.statusCode, 200);
    const cancelBody = cancelResponse.json() as {
      partyId: string;
      status: string;
    };
    assert.equal(cancelBody.partyId, createBody.partyId);
    assert.equal(cancelBody.status, 'cancelled');

    const latestPartyResult = await db.query<{ status: string }>(
      `
        select status::text as status
        from parties
        where id = $1::uuid
      `,
      [createBody.partyId]
    );
    assert.equal(latestPartyResult.rows[0]?.status, 'cancelled');

    const eventResult = await db.query<{ event_type: string; to_status: string }>(
      `
        select event_type::text as event_type, to_status::text as to_status
        from party_member_events
        where party_member_id = $1::bigint
        order by id asc
      `,
      [membershipId]
    );
    assert.deepEqual(
      eventResult.rows.map((row) => `${row.event_type}:${row.to_status}`),
      ['join_requested:pending', 'join_accepted:accepted', 'left:left']
    );
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
