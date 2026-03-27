import assert from 'node:assert/strict';
import test from 'node:test';

import { resyncBungieAccount } from '../src/bungie.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDbAdapter } from '../src/db.js';
import { AppError } from '../src/errors.js';
import { findCurrentUser } from '../src/users.js';
import {
  applyMigration,
  buildDatabaseUrl,
  buildTestDatabaseName,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  seedBungieOauthTokens,
  seedVerifiedUser
} from './helpers/integration.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';

test('integration: Bungie resync refreshes stored tokens and updates membership state', async () => {
  const loadedConfig = loadConfig();
  assert.ok(loadedConfig.databaseUrl, 'DATABASE_URL must be configured to run integration tests');

  const databaseName = buildTestDatabaseName();
  const isolatedDatabaseUrl = buildDatabaseUrl(loadedConfig.databaseUrl, databaseName);
  let db: ReturnType<typeof createDbAdapter> | undefined;

  await createIsolatedDatabase(loadedConfig.databaseUrl, databaseName);

  try {
    await applyMigration(isolatedDatabaseUrl);
    await seedVerifiedUser(isolatedDatabaseUrl, {
      userId: HOST_USER_ID,
      bungieMembershipId: '800000000000001',
      marathonMembershipId: '810000000000001',
      displayName: 'OldName',
      displayNameCode: 1111
    });
    await seedBungieOauthTokens(isolatedDatabaseUrl, {
      userId: HOST_USER_ID,
      accessToken: 'expired-access-token',
      refreshToken: 'stored-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isStale: true
    });

    const config: AppConfig = {
      ...loadedConfig,
      nodeEnv: 'test',
      databaseUrl: isolatedDatabaseUrl,
      bungieClientId: loadedConfig.bungieClientId ?? 'test-client-id',
      bungieClientSecret: loadedConfig.bungieClientSecret ?? 'test-client-secret',
      bungieApiKey: loadedConfig.bungieApiKey ?? 'test-api-key'
    };

    db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');
    const database = db;

    const currentUser = await findCurrentUser(database, HOST_USER_ID);
    const fetchCalls: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      fetchCalls.push({ url, method });

      if (url === 'https://www.bungie.net/Platform/App/OAuth/token/' && method === 'POST') {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-access-token',
            expires_in: 3600,
            refresh_token: 'fresh-refresh-token',
            refresh_expires_in: 7200,
            membership_id: '800000000000001'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/' && method === 'GET') {
        return new Response(
          JSON.stringify({
            ErrorCode: 1,
            ErrorStatus: 'Success',
            Message: 'Ok',
            Response: {
              bungieNetUser: {
                membershipId: '800000000000001',
                displayName: 'UpdatedName',
                uniqueName: 'UpdatedGlobal',
                displayNameCode: 4321
              },
              marathonMembershipId: null
            }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch call to ${method} ${url}`);
    };

    const refreshedUser = await resyncBungieAccount(database, config, currentUser, fetchImpl);

    assert.equal(fetchCalls.length, 2);
    assert.deepEqual(fetchCalls, [
      { url: 'https://www.bungie.net/Platform/App/OAuth/token/', method: 'POST' },
      { url: 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/', method: 'GET' }
    ]);
    assert.equal(refreshedUser.userId, HOST_USER_ID);
    assert.equal(refreshedUser.bungieDisplayName, 'UpdatedName');
    assert.equal(refreshedUser.bungieGlobalDisplayName, 'UpdatedGlobal');
    assert.equal(refreshedUser.bungieGlobalDisplayNameCode, 4321);
    assert.equal(refreshedUser.bungieVerified, true);
    assert.equal(refreshedUser.marathonMembershipId, null);
    assert.equal(refreshedUser.marathonVerified, false);
    assert.ok(refreshedUser.lastMembershipSyncAt);

    const accountResult = await database.query<{
      bungie_display_name: string | null;
      bungie_global_display_name: string | null;
      marathon_membership_id: string | null;
      marathon_verified: boolean;
    }>(
      `
        select
          bungie_display_name,
          bungie_global_display_name,
          marathon_membership_id::text,
          marathon_verified
        from bungie_accounts
        where user_id = $1::uuid
      `,
      [HOST_USER_ID]
    );

    assert.equal(accountResult.rows[0]?.bungie_display_name, 'UpdatedName');
    assert.equal(accountResult.rows[0]?.bungie_global_display_name, 'UpdatedGlobal');
    assert.equal(accountResult.rows[0]?.marathon_membership_id, null);
    assert.equal(accountResult.rows[0]?.marathon_verified, false);

    const tokenResult = await database.query<{
      access_token: string;
      refresh_token: string | null;
      is_stale: boolean;
    }>(
      `
        select
          access_token,
          refresh_token,
          is_stale
        from bungie_oauth_tokens
        where user_id = $1::uuid
      `,
      [HOST_USER_ID]
    );

    assert.equal(tokenResult.rows[0]?.access_token, 'fresh-access-token');
    assert.equal(tokenResult.rows[0]?.refresh_token, 'fresh-refresh-token');
    assert.equal(tokenResult.rows[0]?.is_stale, false);
  } finally {
    if (db) {
      await db.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: Bungie resync marks stored tokens stale when Bungie refresh fails', async () => {
  const loadedConfig = loadConfig();
  assert.ok(loadedConfig.databaseUrl, 'DATABASE_URL must be configured to run integration tests');

  const databaseName = buildTestDatabaseName();
  const isolatedDatabaseUrl = buildDatabaseUrl(loadedConfig.databaseUrl, databaseName);
  let db: ReturnType<typeof createDbAdapter> | undefined;

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
    await seedBungieOauthTokens(isolatedDatabaseUrl, {
      userId: HOST_USER_ID,
      accessToken: 'expired-access-token',
      refreshToken: 'stored-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    const config: AppConfig = {
      ...loadedConfig,
      nodeEnv: 'test',
      databaseUrl: isolatedDatabaseUrl,
      bungieClientId: loadedConfig.bungieClientId ?? 'test-client-id',
      bungieClientSecret: loadedConfig.bungieClientSecret ?? 'test-client-secret',
      bungieApiKey: loadedConfig.bungieApiKey ?? 'test-api-key'
    };

    db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');
    const database = db;

    const currentUser = await findCurrentUser(database, HOST_USER_ID);
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';

      if (url === 'https://www.bungie.net/Platform/App/OAuth/token/' && method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant'
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch call to ${method} ${url}`);
    };

    await assert.rejects(
      () => resyncBungieAccount(database, config, currentUser, fetchImpl),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 502 &&
        error.code === 'bungie_token_refresh_failed' &&
        error.message === 'Bungie token refresh failed'
    );

    const tokenResult = await database.query<{ is_stale: boolean }>(
      `
        select is_stale
        from bungie_oauth_tokens
        where user_id = $1::uuid
      `,
      [HOST_USER_ID]
    );

    assert.equal(tokenResult.rows[0]?.is_stale, true);
  } finally {
    if (db) {
      await db.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});
