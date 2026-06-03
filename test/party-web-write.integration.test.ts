import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppSession } from '../src/app-sessions.js';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { WEB_ACCESS_COOKIE_NAME, WEB_CSRF_COOKIE_NAME } from '../src/cookies.js';
import { createDbAdapter } from '../src/db.js';
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
const MEMBER_ACCEPT_USER_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_DECLINE_USER_ID = '44444444-4444-4444-8444-444444444444';
const MEMBER_KICK_USER_ID = '55555555-5555-4555-8555-555555555555';

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

function buildCookieHeader(accessToken: string, csrfToken: string): string {
  return [
    `${WEB_ACCESS_COOKIE_NAME}=${encodeURIComponent(accessToken)}`,
    `${WEB_CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`
  ].join('; ');
}

test('integration: cookie-authenticated party writes support create, join, leave, and cancel', async () => {
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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const hostSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-web-host'
        }
      })
    );
    const memberSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: MEMBER_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-web-member'
        }
      })
    );

    const hostHeaders = {
      cookie: buildCookieHeader(hostSession.accessToken, 'host-csrf'),
      'x-csrf-token': 'host-csrf'
    };
    const memberHeaders = {
      cookie: buildCookieHeader(memberSession.accessToken, 'member-csrf'),
      'x-csrf-token': 'member-csrf'
    };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: hostHeaders,
      payload: {
        title: 'Cookie write party',
        activityKey: 'marathon',
        maxSize: 3,
        description: 'Created by a browser session'
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createBody = createResponse.json() as {
      partyId: string;
      status: string;
      filledSlots: number;
      openSlots: number;
    };
    assert.ok(createBody.partyId);
    assert.equal(createBody.status, 'open');
    assert.equal(createBody.filledSlots, 1);
    assert.equal(createBody.openSlots, 2);

    const joinResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/join`,
      headers: memberHeaders,
      payload: {
        noteToHost: 'Joining from the web shell'
      }
    });

    assert.equal(joinResponse.statusCode, 200);
    assert.deepEqual(joinResponse.json(), {
      partyId: createBody.partyId,
      myStatus: 'pending',
      filledSlots: 1,
      openSlots: 2
    });

    const leaveResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/leave`,
      headers: memberHeaders
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
    assert.ok(leaveBody.memberId);
    assert.deepEqual(leaveBody, {
      partyId: createBody.partyId,
      memberId: leaveBody.memberId,
      memberStatus: 'left',
      filledSlots: 1,
      openSlots: 2,
      partyStatus: 'open'
    });

    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/parties/${createBody.partyId}/cancel`,
      headers: hostHeaders
    });

    assert.equal(cancelResponse.statusCode, 200);
    assert.deepEqual(cancelResponse.json(), {
      partyId: createBody.partyId,
      status: 'cancelled'
    });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: host moderation uses member lists plus accept, decline, and kick from cookie-authenticated sessions', async () => {
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
      bungieMembershipId: '810000000000001',
      marathonMembershipId: '820000000000001',
      displayName: 'HostUser',
      displayNameCode: 1111
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_ACCEPT_USER_ID,
      bungieMembershipId: '810000000000002',
      marathonMembershipId: '820000000000002',
      displayName: 'AcceptUser',
      displayNameCode: 2222
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_DECLINE_USER_ID,
      bungieMembershipId: '810000000000003',
      marathonMembershipId: '820000000000003',
      displayName: 'DeclineUser',
      displayNameCode: 3333
    });
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: MEMBER_KICK_USER_ID,
      bungieMembershipId: '810000000000004',
      marathonMembershipId: '820000000000004',
      displayName: 'KickUser',
      displayNameCode: 4444
    });

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const hostSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-moderation-host'
        }
      })
    );
    const acceptSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: MEMBER_ACCEPT_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-moderation-accept'
        }
      })
    );
    const declineSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: MEMBER_DECLINE_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-moderation-decline'
        }
      })
    );
    const kickSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: MEMBER_KICK_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-moderation-kick'
        }
      })
    );

    const hostHeaders = {
      cookie: buildCookieHeader(hostSession.accessToken, 'host-csrf'),
      'x-csrf-token': 'host-csrf'
    };

    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: hostHeaders,
      payload: {
        title: 'Cookie moderation party',
        activityKey: 'marathon',
        maxSize: 5
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const { partyId } = createResponse.json() as { partyId: string };

    const joinWithSession = async (accessToken: string, csrfToken: string, noteToHost: string) =>
      app!.inject({
        method: 'POST',
        url: `/parties/${partyId}/join`,
        headers: {
          cookie: buildCookieHeader(accessToken, csrfToken),
          'x-csrf-token': csrfToken
        },
        payload: {
          noteToHost
        }
      });

    assert.equal((await joinWithSession(acceptSession.accessToken, 'accept-csrf', 'accept me')).statusCode, 200);
    assert.equal((await joinWithSession(declineSession.accessToken, 'decline-csrf', 'decline me')).statusCode, 200);
    assert.equal((await joinWithSession(kickSession.accessToken, 'kick-csrf', 'kick me')).statusCode, 200);

    const hostDetailBefore = await app.inject({
      method: 'GET',
      url: `/parties/${partyId}`,
      headers: {
        cookie: buildCookieHeader(hostSession.accessToken, 'host-csrf')
      }
    });

    assert.equal(hostDetailBefore.statusCode, 200);
    const hostPartyBefore = hostDetailBefore.json() as {
      members: Array<{
        memberId: string;
        userId: string;
        status: string;
        noteToHost: string | null;
      }>;
    };
    assert.equal(hostPartyBefore.members.length, 3);
    assert.deepEqual(
      hostPartyBefore.members.map((member) => ({
        userId: member.userId,
        status: member.status,
        noteToHost: member.noteToHost
      })),
      [
        { userId: MEMBER_ACCEPT_USER_ID, status: 'pending', noteToHost: 'accept me' },
        { userId: MEMBER_DECLINE_USER_ID, status: 'pending', noteToHost: 'decline me' },
        { userId: MEMBER_KICK_USER_ID, status: 'pending', noteToHost: 'kick me' }
      ]
    );

    const acceptMemberId = hostPartyBefore.members.find((member) => member.userId === MEMBER_ACCEPT_USER_ID)?.memberId;
    const declineMemberId = hostPartyBefore.members.find((member) => member.userId === MEMBER_DECLINE_USER_ID)?.memberId;
    const kickMemberId = hostPartyBefore.members.find((member) => member.userId === MEMBER_KICK_USER_ID)?.memberId;

    assert.ok(acceptMemberId);
    assert.ok(declineMemberId);
    assert.ok(kickMemberId);

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/members/${acceptMemberId}/accept`,
      headers: hostHeaders
    });
    assert.equal(acceptResponse.statusCode, 200);
    assert.equal((acceptResponse.json() as { memberStatus: string }).memberStatus, 'accepted');

    const declineResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/members/${declineMemberId}/decline`,
      headers: hostHeaders
    });
    assert.equal(declineResponse.statusCode, 200);
    assert.equal((declineResponse.json() as { memberStatus: string }).memberStatus, 'declined');

    const kickResponse = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/members/${kickMemberId}/kick`,
      headers: hostHeaders
    });
    assert.equal(kickResponse.statusCode, 200);
    assert.equal((kickResponse.json() as { memberStatus: string }).memberStatus, 'kicked');

    const hostDetailAfter = await app.inject({
      method: 'GET',
      url: `/parties/${partyId}`,
      headers: {
        cookie: buildCookieHeader(hostSession.accessToken, 'host-csrf')
      }
    });

    assert.equal(hostDetailAfter.statusCode, 200);
    const hostPartyAfter = hostDetailAfter.json() as {
      members: Array<{
        memberId: string;
        userId: string;
        status: string;
      }>;
    };
    assert.deepEqual(hostPartyAfter.members.map((member) => ({
      memberId: member.memberId,
      userId: member.userId,
      status: member.status
    })), [
      {
        memberId: acceptMemberId!,
        userId: MEMBER_ACCEPT_USER_ID,
        status: 'accepted'
      }
    ]);

    const acceptedMemberDetail = await app.inject({
      method: 'GET',
      url: `/parties/${partyId}`,
      headers: {
        cookie: buildCookieHeader(acceptSession.accessToken, 'accept-csrf')
      }
    });

    assert.equal(acceptedMemberDetail.statusCode, 200);
    assert.deepEqual((acceptedMemberDetail.json() as { members: Array<unknown> }).members, []);
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
