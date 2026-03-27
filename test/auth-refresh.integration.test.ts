import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppSession } from '../src/app-sessions.js';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDbAdapter } from '../src/db.js';
import { parseRefreshToken } from '../src/session.js';
import {
  applyMigration,
  buildDatabaseUrl,
  buildTestDatabaseName,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  seedVerifiedUser
} from './helpers/integration.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';

test('integration: refresh endpoint rotates refresh token and returns a working access token', async () => {
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

    const initialSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-test'
        }
      })
    );

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        'user-agent': 'integration-test'
      },
      payload: {
        refreshToken: initialSession.refreshToken
      }
    });

    assert.equal(refreshResponse.statusCode, 200);
    const refreshBody = refreshResponse.json() as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      refreshExpiresIn: number;
    };
    assert.ok(refreshBody.accessToken.startsWith('v1.'));
    assert.notEqual(refreshBody.refreshToken, initialSession.refreshToken);
    assert.equal(refreshBody.expiresIn, 900);
    assert.equal(refreshBody.refreshExpiresIn, 7776000);

    const oldToken = parseRefreshToken(initialSession.refreshToken);
    const newToken = parseRefreshToken(refreshBody.refreshToken);

    const refreshRowsResult = await db.query<{
      token_id: string;
      revoked_at: string | null;
      user_id: string;
    }>(
      `
        select
          token_id::text,
          revoked_at::text,
          user_id::text
        from app_refresh_tokens
        where token_id = any($1::uuid[])
        order by token_id
      `,
      [[oldToken.tokenId, newToken.tokenId]]
    );

    assert.equal(refreshRowsResult.rows.length, 2);
    const oldRow = refreshRowsResult.rows.find((row) => row.token_id === oldToken.tokenId);
    const newRow = refreshRowsResult.rows.find((row) => row.token_id === newToken.tokenId);
    assert.ok(oldRow?.revoked_at, 'Old refresh token should be revoked after rotation');
    assert.equal(oldRow?.user_id, HOST_USER_ID);
    assert.equal(newRow?.revoked_at, null);
    assert.equal(newRow?.user_id, HOST_USER_ID);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: `Bearer ${refreshBody.accessToken}`
      }
    });

    assert.equal(meResponse.statusCode, 200);
    const meBody = meResponse.json() as { userId: string };
    assert.equal(meBody.userId, HOST_USER_ID);

    const replayResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: initialSession.refreshToken
      }
    });

    assert.equal(replayResponse.statusCode, 401);
    assert.deepEqual(replayResponse.json(), {
      error: 'auth_invalid',
      message: 'Invalid refresh token'
    });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: logout endpoint revokes the current refresh token', async () => {
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

    const initialSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-test'
        }
      })
    );

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {
        refreshToken: initialSession.refreshToken
      }
    });

    assert.equal(logoutResponse.statusCode, 200);
    assert.deepEqual(logoutResponse.json(), { ok: true });

    const oldToken = parseRefreshToken(initialSession.refreshToken);
    const refreshRowResult = await db.query<{ revoked_at: string | null }>(
      `
        select revoked_at::text as revoked_at
        from app_refresh_tokens
        where token_id = $1::uuid
      `,
      [oldToken.tokenId]
    );

    assert.ok(refreshRowResult.rows[0]?.revoked_at, 'Logout should revoke the current refresh token');

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: initialSession.refreshToken
      }
    });

    assert.equal(refreshResponse.statusCode, 401);
    assert.deepEqual(refreshResponse.json(), {
      error: 'auth_invalid',
      message: 'Invalid refresh token'
    });

    const secondLogoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: {
        refreshToken: initialSession.refreshToken
      }
    });

    assert.equal(secondLogoutResponse.statusCode, 200);
    assert.deepEqual(secondLogoutResponse.json(), { ok: true });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
