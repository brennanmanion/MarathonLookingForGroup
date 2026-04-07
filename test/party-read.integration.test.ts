import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppSession } from '../src/app-sessions.js';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { WEB_ACCESS_COOKIE_NAME } from '../src/cookies.js';
import { createDbAdapter } from '../src/db.js';
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

test('integration: cookie-authenticated safe reads support party list and detail for the web shell', async () => {
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

    const hostBearer = issueAccessToken(config, HOST_USER_ID).token;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/parties',
      headers: {
        authorization: `Bearer ${hostBearer}`
      },
      payload: {
        title: 'Web shell readable party',
        activityKey: 'marathon',
        maxSize: 3,
        description: 'Party description for the browser feed',
        requirementText: 'Bring mics',
        tags: [
          {
            tagKey: 'region',
            tagValue: 'na'
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createBody = createResponse.json() as { partyId: string };

    const hostSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-party-read'
        }
      })
    );

    const cookieHeader = `${WEB_ACCESS_COOKIE_NAME}=${encodeURIComponent(hostSession.accessToken)}`;

    const listResponse = await app.inject({
      method: 'GET',
      url: '/parties',
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json() as {
      items: Array<{
        partyId: string;
        title: string;
        description: string | null;
        host: {
          userId: string;
        };
        myMembership: unknown;
      }>;
    };
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0]?.partyId, createBody.partyId);
    assert.equal(listBody.items[0]?.title, 'Web shell readable party');
    assert.equal(listBody.items[0]?.description, 'Party description for the browser feed');
    assert.equal(listBody.items[0]?.host.userId, HOST_USER_ID);
    assert.equal(listBody.items[0]?.myMembership, null);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/parties/${createBody.partyId}`,
      headers: {
        cookie: cookieHeader
      }
    });

    assert.equal(detailResponse.statusCode, 200);
    const detailBody = detailResponse.json() as {
      partyId: string;
      title: string;
      requirementText: string | null;
      tags: Array<{ tagKey: string; tagValue: string | null }>;
      members: Array<unknown>;
      host: {
        userId: string;
      };
      myMembership: unknown;
    };
    assert.equal(detailBody.partyId, createBody.partyId);
    assert.equal(detailBody.title, 'Web shell readable party');
    assert.equal(detailBody.requirementText, 'Bring mics');
    assert.deepEqual(detailBody.tags, [
      {
        tagKey: 'region',
        tagValue: 'na'
      }
    ]);
    assert.equal(detailBody.host.userId, HOST_USER_ID);
    assert.equal(detailBody.myMembership, null);
    assert.deepEqual(detailBody.members, []);
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
