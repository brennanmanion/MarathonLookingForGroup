import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDbAdapter } from '../src/db.js';
import type { PartyEventBus, PartyRealtimeEvent } from '../src/party-events.js';
import { issueAccessToken } from '../src/session.js';
import {
  applyMigration,
  buildDatabaseUrl,
  buildTestDatabaseName,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  seedVerifiedUser
} from './helpers/integration.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_USER_ID = '22222222-2222-4222-8222-222222222222';

function buildTestConfig(loadedConfig: AppConfig, databaseUrl: string): AppConfig {
  return {
    ...loadedConfig,
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl,
    webAppBaseUrl: 'https://app.example.test/app/',
    appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
  };
}

class RecordingPartyEventBus implements PartyEventBus {
  public readonly published: Array<{
    recipients: string[];
    event: Omit<PartyRealtimeEvent, 'eventId' | 'occurredAt'>;
  }> = [];

  public subscribe(): () => void {
    return () => {};
  }

  public publishToUsers(
    userIds: string[],
    input: Omit<PartyRealtimeEvent, 'eventId' | 'occurredAt'>
  ): void {
    this.published.push({
      recipients: [...userIds],
      event: input
    });
  }

  public close(): void {
    this.published.length = 0;
  }
}

test('integration: join request publishes a host-facing party event', async () => {
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
      bungieMembershipId: '920000000000001',
      marathonMembershipId: '930000000000001',
      displayName: 'HostEvent',
      displayNameCode: 1111
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_USER_ID,
      bungieMembershipId: '920000000000002',
      marathonMembershipId: '930000000000002',
      displayName: 'MemberEvent',
      displayNameCode: 2222
    });

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    const eventBus = new RecordingPartyEventBus();
    app = await createApp(config, db, {
      partyEvents: eventBus
    });
    await app.ready();

    const hostBearer = issueAccessToken(config, HOST_USER_ID).token;
    const memberBearer = issueAccessToken(config, MEMBER_USER_ID).token;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: {
        authorization: `Bearer ${hostBearer}`
      },
      payload: {
        title: 'Realtime join request party',
        activityKey: 'marathon',
        maxSize: 3
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { partyId } = createResponse.json() as { partyId: string };

    const joinResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/join`,
      headers: {
        authorization: `Bearer ${memberBearer}`
      },
      payload: {}
    });

    assert.equal(joinResponse.statusCode, 200);
    assert.deepEqual(eventBus.published, [
      {
        recipients: [HOST_USER_ID],
        event: {
          type: 'party.join_requested',
          partyId,
          actorUserId: MEMBER_USER_ID
        }
      }
    ]);
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: host approval publishes a member-facing party event', async () => {
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
      bungieMembershipId: '940000000000001',
      marathonMembershipId: '950000000000001',
      displayName: 'HostApprove',
      displayNameCode: 1111
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_USER_ID,
      bungieMembershipId: '940000000000002',
      marathonMembershipId: '950000000000002',
      displayName: 'MemberApprove',
      displayNameCode: 2222
    });

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    const eventBus = new RecordingPartyEventBus();
    app = await createApp(config, db, {
      partyEvents: eventBus
    });
    await app.ready();

    const hostBearer = issueAccessToken(config, HOST_USER_ID).token;
    const memberBearer = issueAccessToken(config, MEMBER_USER_ID).token;

    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: {
        authorization: `Bearer ${hostBearer}`
      },
      payload: {
        title: 'Realtime approval party',
        activityKey: 'marathon',
        maxSize: 3
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { partyId } = createResponse.json() as { partyId: string };

    const joinResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/join`,
      headers: {
        authorization: `Bearer ${memberBearer}`
      },
      payload: {}
    });

    assert.equal(joinResponse.statusCode, 200);
    eventBus.published.length = 0;

    const hostDetail = await app.inject({
      method: 'GET',
      url: `/parties/${partyId}`,
      headers: {
        authorization: `Bearer ${hostBearer}`
      }
    });

    assert.equal(hostDetail.statusCode, 200);
    const detailBody = hostDetail.json() as {
      members: Array<{ memberId: string }>;
    };
    const memberId = detailBody.members[0]?.memberId;
    assert.ok(memberId);

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/members/${memberId}/accept`,
      headers: {
        authorization: `Bearer ${hostBearer}`
      }
    });

    assert.equal(acceptResponse.statusCode, 200);
    assert.deepEqual(eventBus.published, [
      {
        recipients: [MEMBER_USER_ID],
        event: {
          type: 'party.join_accepted',
          partyId,
          actorUserId: HOST_USER_ID
        }
      }
    ]);
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
