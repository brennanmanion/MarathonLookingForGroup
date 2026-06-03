import assert from 'node:assert/strict';
import type { OutgoingHttpHeaders } from 'node:http';
import test from 'node:test';

import { createAppSession } from '../src/app-sessions.js';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import {
  WEB_ACCESS_COOKIE_NAME,
  WEB_CSRF_COOKIE_NAME,
  WEB_REFRESH_COOKIE_NAME
} from '../src/cookies.js';
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

function buildTestConfig(loadedConfig: AppConfig, databaseUrl: string): AppConfig {
  return {
    ...loadedConfig,
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl,
    webAppBaseUrl: loadedConfig.webAppBaseUrl ?? 'https://app.example.test',
    sessionCookieDomain: loadedConfig.sessionCookieDomain,
    appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
  };
}

function getSetCookieHeaders(headers: OutgoingHttpHeaders): string[] {
  const header = headers['set-cookie'];

  if (!header) {
    return [];
  }

  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }

  return typeof header === 'string' ? [header] : [];
}

function extractCookieValue(setCookieHeaders: string[], cookieName: string): string {
  for (const header of setCookieHeaders) {
    const [cookiePair] = header.split(';');
    if (!cookiePair) {
      continue;
    }

    const separatorIndex = cookiePair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const name = cookiePair.slice(0, separatorIndex);
    if (name !== cookieName) {
      continue;
    }

    return decodeURIComponent(cookiePair.slice(separatorIndex + 1));
  }

  throw new Error(`Cookie ${cookieName} is missing from the response`);
}

function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);

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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);

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

test('integration: auth session reports unauthenticated without bearer or web cookies', async () => {
  const loadedConfig = loadConfig();
  assert.ok(loadedConfig.databaseUrl, 'DATABASE_URL must be configured to run integration tests');

  const databaseName = buildTestDatabaseName();
  const isolatedDatabaseUrl = buildDatabaseUrl(loadedConfig.databaseUrl, databaseName);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  await createIsolatedDatabase(loadedConfig.databaseUrl, databaseName);

  try {
    await applyMigration(isolatedDatabaseUrl);
    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);

    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/session'
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      authenticated: false
    });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: cookie refresh rotates the web session and auth session reflects the new access cookie', async () => {
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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const initialSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-web-refresh'
        }
      })
    );

    const initialCookies = {
      [WEB_ACCESS_COOKIE_NAME]: initialSession.accessToken,
      [WEB_REFRESH_COOKIE_NAME]: initialSession.refreshToken,
      [WEB_CSRF_COOKIE_NAME]: 'csrf-token-initial'
    };

    const sessionBeforeRefresh = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: buildCookieHeader(initialCookies)
      }
    });

    assert.equal(sessionBeforeRefresh.statusCode, 200);
    assert.deepEqual(sessionBeforeRefresh.json(), {
      authenticated: true,
      user: {
        userId: HOST_USER_ID
      }
    });

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildCookieHeader(initialCookies),
        'x-csrf-token': 'csrf-token-initial',
        'user-agent': 'integration-web-refresh'
      }
    });

    assert.equal(refreshResponse.statusCode, 200);
    assert.deepEqual(refreshResponse.json(), {
      ok: true,
      expiresIn: 900,
      refreshExpiresIn: 7776000
    });

    const setCookieHeaders = getSetCookieHeaders(refreshResponse.headers);
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_ACCESS_COOKIE_NAME}=`)));
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_REFRESH_COOKIE_NAME}=`)));
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_CSRF_COOKIE_NAME}=`)));

    const rotatedAccessToken = extractCookieValue(setCookieHeaders, WEB_ACCESS_COOKIE_NAME);
    const rotatedRefreshToken = extractCookieValue(setCookieHeaders, WEB_REFRESH_COOKIE_NAME);
    const rotatedCsrfToken = extractCookieValue(setCookieHeaders, WEB_CSRF_COOKIE_NAME);
    assert.notEqual(rotatedRefreshToken, initialSession.refreshToken);

    const oldToken = parseRefreshToken(initialSession.refreshToken);
    const newToken = parseRefreshToken(rotatedRefreshToken);
    const refreshRowsResult = await db.query<{
      token_id: string;
      revoked_at: string | null;
    }>(
      `
        select
          token_id::text,
          revoked_at::text
        from app_refresh_tokens
        where token_id = any($1::uuid[])
        order by token_id
      `,
      [[oldToken.tokenId, newToken.tokenId]]
    );

    const oldRow = refreshRowsResult.rows.find((row) => row.token_id === oldToken.tokenId);
    const newRow = refreshRowsResult.rows.find((row) => row.token_id === newToken.tokenId);
    assert.ok(oldRow?.revoked_at);
    assert.equal(newRow?.revoked_at, null);

    const sessionAfterRefresh = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: {
        cookie: buildCookieHeader({
          [WEB_ACCESS_COOKIE_NAME]: rotatedAccessToken,
          [WEB_REFRESH_COOKIE_NAME]: rotatedRefreshToken,
          [WEB_CSRF_COOKIE_NAME]: rotatedCsrfToken
        })
      }
    });

    assert.equal(sessionAfterRefresh.statusCode, 200);
    assert.deepEqual(sessionAfterRefresh.json(), {
      authenticated: true,
      user: {
        userId: HOST_USER_ID
      }
    });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: cookie refresh rejects missing csrf token', async () => {
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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const initialSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-web-refresh'
        }
      })
    );

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildCookieHeader({
          [WEB_ACCESS_COOKIE_NAME]: initialSession.accessToken,
          [WEB_REFRESH_COOKIE_NAME]: initialSession.refreshToken,
          [WEB_CSRF_COOKIE_NAME]: 'csrf-token-initial'
        })
      }
    });

    assert.equal(refreshResponse.statusCode, 403);
    assert.deepEqual(refreshResponse.json(), {
      error: 'csrf_invalid',
      message: 'A valid CSRF token is required'
    });
  } finally {
    if (app) {
      await app.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
  }
});

test('integration: cookie logout revokes the web refresh token, clears cookies, and ends the session', async () => {
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

    const config = buildTestConfig(loadedConfig, isolatedDatabaseUrl);
    const db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db);
    await app.ready();

    const initialSession = await db.withTransaction((client) =>
      createAppSession(client, config, {
        userId: HOST_USER_ID,
        metadata: {
          ip: '127.0.0.1',
          userAgent: 'integration-web-logout'
        }
      })
    );

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie: buildCookieHeader({
          [WEB_ACCESS_COOKIE_NAME]: initialSession.accessToken,
          [WEB_REFRESH_COOKIE_NAME]: initialSession.refreshToken,
          [WEB_CSRF_COOKIE_NAME]: 'csrf-token-logout'
        }),
        'x-csrf-token': 'csrf-token-logout'
      }
    });

    assert.equal(logoutResponse.statusCode, 200);
    assert.deepEqual(logoutResponse.json(), { ok: true });

    const setCookieHeaders = getSetCookieHeaders(logoutResponse.headers);
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_ACCESS_COOKIE_NAME}=`) && value.includes('Max-Age=0')));
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_REFRESH_COOKIE_NAME}=`) && value.includes('Max-Age=0')));
    assert.ok(setCookieHeaders.some((value) => value.startsWith(`${WEB_CSRF_COOKIE_NAME}=`) && value.includes('Max-Age=0')));

    const oldToken = parseRefreshToken(initialSession.refreshToken);
    const refreshRowResult = await db.query<{ revoked_at: string | null }>(
      `
        select revoked_at::text as revoked_at
        from app_refresh_tokens
        where token_id = $1::uuid
      `,
      [oldToken.tokenId]
    );

    assert.ok(refreshRowResult.rows[0]?.revoked_at);

    const sessionAfterLogout = await app.inject({
      method: 'GET',
      url: '/auth/session'
    });

    assert.equal(sessionAfterLogout.statusCode, 200);
    assert.deepEqual(sessionAfterLogout.json(), {
      authenticated: false
    });

    const refreshAfterLogout = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: buildCookieHeader({
          [WEB_ACCESS_COOKIE_NAME]: initialSession.accessToken,
          [WEB_REFRESH_COOKIE_NAME]: initialSession.refreshToken,
          [WEB_CSRF_COOKIE_NAME]: 'csrf-token-logout'
        }),
        'x-csrf-token': 'csrf-token-logout'
      }
    });

    assert.equal(refreshAfterLogout.statusCode, 401);
    assert.deepEqual(refreshAfterLogout.json(), {
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
