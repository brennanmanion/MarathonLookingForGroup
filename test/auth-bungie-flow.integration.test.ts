import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createApp } from '../src/app.js';
import type { AppServices } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createDbAdapter } from '../src/db.js';
import type { AppSessionResponse, BungieStartResponse } from '../src/types.js';
import {
  applyMigration,
  buildDatabaseUrl,
  buildTestDatabaseName,
  createIsolatedDatabase,
  dropIsolatedDatabase
} from './helpers/integration.js';

interface AuthTestContext {
  loadedConfig: AppConfig;
  config: AppConfig;
  databaseName: string;
  db: NonNullable<ReturnType<typeof createDbAdapter>>;
  app: Awaited<ReturnType<typeof createApp>>;
  close(): Promise<void>;
}

interface LoginTransactionRow {
  id: string;
  oauth_state: string;
  redirect_mode: string;
  app_state: string | null;
  platform: string | null;
  consumed_at: Date | null;
  expires_at: Date;
}

interface HandoffTicketRow {
  ticket_id: string;
  login_id: string;
  user_id: string;
  consumed_at: Date | null;
  expires_at: Date;
}

interface BungieAccountRow {
  user_id: string;
  bungie_membership_id: string;
  bungie_display_name: string | null;
  bungie_global_display_name: string | null;
  bungie_global_display_name_code: number | null;
  bungie_verified: boolean;
  marathon_membership_id: string | null;
  marathon_verified: boolean;
}

interface BungieOauthTokenRow {
  access_token: string;
  refresh_token: string | null;
  is_stale: boolean;
}

interface AppRefreshTokenRow {
  user_id: string;
  created_by_login_id: string | null;
  user_agent: string | null;
}

interface MockFetchCall {
  url: string;
  method: string;
}

function buildIntegrationConfig(loadedConfig: AppConfig, databaseUrl: string): AppConfig {
  return {
    ...loadedConfig,
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl,
    bungieClientId: loadedConfig.bungieClientId ?? 'test-client-id',
    bungieClientSecret: loadedConfig.bungieClientSecret ?? 'test-client-secret',
    bungieApiKey: loadedConfig.bungieApiKey ?? 'test-api-key',
    bungieRedirectUri: loadedConfig.bungieRedirectUri ?? 'https://api.example.test/auth/bungie/callback',
    appUniversalLinkBase: loadedConfig.appUniversalLinkBase ?? 'https://app.example.test',
    appSessionSecret: loadedConfig.appSessionSecret ?? 'integration-test-session-secret'
  };
}

function toRequestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function buildSuccessfulBungieFetch(config: AppConfig): { fetchImpl: typeof fetch; calls: MockFetchCall[] } {
  const calls: MockFetchCall[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = toRequestUrl(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });

    if (url === 'https://www.bungie.net/Platform/App/OAuth/token/' && method === 'POST') {
      assert.ok(init?.body instanceof URLSearchParams, 'OAuth token exchange should send URLSearchParams');
      assert.equal(init.body.get('grant_type'), 'authorization_code');
      assert.equal(init.body.get('code'), 'test-auth-code');
      assert.equal(init.body.get('redirect_uri'), config.bungieRedirectUri);

      return new Response(
        JSON.stringify({
          access_token: 'bungie-access-token',
          expires_in: 3600,
          refresh_token: 'bungie-refresh-token',
          refresh_expires_in: 7200,
          membership_id: '800000000000123'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    }

    if (url === 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/' && method === 'GET') {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer bungie-access-token');
      assert.equal(headers.get('x-api-key'), config.bungieApiKey);

      return new Response(
        JSON.stringify({
          ErrorCode: 1,
          ErrorStatus: 'Success',
          Message: 'Ok',
          Response: {
            bungieNetUser: {
              membershipId: '800000000000123',
              displayName: 'AuthFlowDisplay',
              uniqueName: 'AuthFlowGlobal',
              displayNameCode: 2026
            },
            marathonMembershipId: '810000000000123'
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      );
    }

    throw new Error(`Unexpected fetch call to ${method} ${url}`);
  };

  return { fetchImpl, calls };
}

async function createAuthTestContext(services: AppServices = {}): Promise<AuthTestContext> {
  const loadedConfig = loadConfig();
  assert.ok(loadedConfig.databaseUrl, 'DATABASE_URL must be configured to run integration tests');

  const databaseName = buildTestDatabaseName();
  const isolatedDatabaseUrl = buildDatabaseUrl(loadedConfig.databaseUrl, databaseName);
  const config = buildIntegrationConfig(loadedConfig, isolatedDatabaseUrl);

  await createIsolatedDatabase(loadedConfig.databaseUrl, databaseName);

  let db: ReturnType<typeof createDbAdapter> | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  try {
    await applyMigration(isolatedDatabaseUrl);
    db = createDbAdapter(config.databaseUrl);
    assert.ok(db, 'Database adapter should be created for integration tests');

    app = await createApp(config, db, services);
    await app.ready();
    const readyApp = app;
    const readyDb = db;

    return {
      loadedConfig,
      config,
      databaseName,
      db: readyDb,
      app: readyApp,
      close: async () => {
        await readyApp.close();
        await dropIsolatedDatabase(loadedConfig.databaseUrl!, databaseName);
      }
    };
  } catch (error) {
    if (app) {
      await app.close();
    } else if (db) {
      await db.close();
    }

    await dropIsolatedDatabase(loadedConfig.databaseUrl, databaseName);
    throw error;
  }
}

async function startNativeLogin(context: AuthTestContext): Promise<{ loginId: string; oauthState: string; authorizeUrl: URL }> {
  const startResponse = await context.app.inject({
    method: 'POST',
    url: '/auth/bungie/start',
    payload: {
      platform: 'ios',
      appState: 'resume-demo',
      redirectMode: 'native'
    }
  });

  assert.equal(startResponse.statusCode, 200);
  const body = startResponse.json() as BungieStartResponse;
  assert.ok(body.loginId);
  assert.ok(body.authorizeUrl);

  const authorizeUrl = new URL(body.authorizeUrl);
  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, 'https://www.bungie.net/en/OAuth/Authorize');
  assert.equal(authorizeUrl.searchParams.get('client_id'), context.config.bungieClientId);
  assert.equal(authorizeUrl.searchParams.get('response_type'), 'code');
  assert.equal(authorizeUrl.searchParams.get('redirect_uri'), context.config.bungieRedirectUri);

  const oauthState = authorizeUrl.searchParams.get('state');
  if (!oauthState) {
    throw new Error('authorizeUrl is missing the OAuth state parameter');
  }

  return {
    loginId: body.loginId,
    oauthState,
    authorizeUrl
  };
}

async function runCallback(context: AuthTestContext, state: string): Promise<{ redirectUrl: URL; ticket: string }> {
  const callbackResponse = await context.app.inject({
    method: 'GET',
    url: `/auth/bungie/callback?code=test-auth-code&state=${encodeURIComponent(state)}`
  });

  assert.equal(callbackResponse.statusCode, 302);
  const location = callbackResponse.headers.location;
  if (typeof location !== 'string') {
    throw new Error('callback response is missing the redirect location');
  }

  const redirectUrl = new URL(location);
  assert.equal(redirectUrl.origin + redirectUrl.pathname, 'https://app.example.test/auth/handoff');

  const ticket = redirectUrl.searchParams.get('ticket');
  if (!ticket) {
    throw new Error('callback redirect is missing the handoff ticket');
  }

  return {
    redirectUrl,
    ticket
  };
}

test('integration: Bungie start, callback, and handoff consume create a usable app session', async () => {
  const { fetchImpl, calls } = buildSuccessfulBungieFetch(buildIntegrationConfig(loadConfig(), 'postgres://unused'));
  const context = await createAuthTestContext({ bungieFetch: fetchImpl });

  try {
    const { loginId, oauthState } = await startNativeLogin(context);

    const initialLoginResult = await context.db.query<LoginTransactionRow>(
      `
        select
          id::text,
          oauth_state,
          redirect_mode,
          app_state,
          platform,
          consumed_at,
          expires_at
        from auth_login_transactions
        where id = $1::uuid
      `,
      [loginId]
    );

    assert.equal(initialLoginResult.rows.length, 1);
    const initialLoginRow = initialLoginResult.rows[0]!;
    assert.equal(initialLoginRow.oauth_state, oauthState);
    assert.equal(initialLoginRow.redirect_mode, 'native');
    assert.equal(initialLoginRow.app_state, 'resume-demo');
    assert.equal(initialLoginRow.platform, 'ios');
    assert.equal(initialLoginRow.consumed_at, null);
    assert.ok(initialLoginRow.expires_at.getTime() > Date.now());

    const { redirectUrl, ticket } = await runCallback(context, oauthState);
    assert.equal(redirectUrl.searchParams.get('loginId'), loginId);
    assert.equal(redirectUrl.searchParams.get('appState'), 'resume-demo');

    assert.deepEqual(calls, [
      { url: 'https://www.bungie.net/Platform/App/OAuth/token/', method: 'POST' },
      { url: 'https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/', method: 'GET' }
    ]);

    const consumedLoginResult = await context.db.query<LoginTransactionRow>(
      `
        select
          id::text,
          oauth_state,
          redirect_mode,
          app_state,
          platform,
          consumed_at,
          expires_at
        from auth_login_transactions
        where id = $1::uuid
      `,
      [loginId]
    );

    const consumedLoginRow = consumedLoginResult.rows[0]!;
    assert.ok(consumedLoginRow.consumed_at, 'Callback should consume the login transaction');

    const accountResult = await context.db.query<BungieAccountRow>(
      `
        select
          user_id::text,
          bungie_membership_id::text,
          bungie_display_name,
          bungie_global_display_name,
          bungie_global_display_name_code,
          bungie_verified,
          marathon_membership_id::text,
          marathon_verified
        from bungie_accounts
      `
    );

    assert.equal(accountResult.rows.length, 1);
    const accountRow = accountResult.rows[0]!;
    assert.equal(accountRow.bungie_membership_id, '800000000000123');
    assert.equal(accountRow.bungie_display_name, 'AuthFlowDisplay');
    assert.equal(accountRow.bungie_global_display_name, 'AuthFlowGlobal');
    assert.equal(accountRow.bungie_global_display_name_code, 2026);
    assert.equal(accountRow.bungie_verified, true);
    assert.equal(accountRow.marathon_membership_id, '810000000000123');
    assert.equal(accountRow.marathon_verified, true);

    const oauthTokenResult = await context.db.query<BungieOauthTokenRow>(
      `
        select
          access_token,
          refresh_token,
          is_stale
        from bungie_oauth_tokens
        where user_id = $1::uuid
      `,
      [accountRow.user_id]
    );

    assert.deepEqual(oauthTokenResult.rows[0], {
      access_token: 'bungie-access-token',
      refresh_token: 'bungie-refresh-token',
      is_stale: false
    });

    const handoffResult = await context.db.query<HandoffTicketRow>(
      `
        select
          ticket_id::text,
          login_id::text,
          user_id::text,
          consumed_at,
          expires_at
        from auth_handoff_tickets
        where ticket_id = $1::uuid
      `,
      [ticket]
    );

    assert.equal(handoffResult.rows.length, 1);
    const handoffRow = handoffResult.rows[0]!;
    assert.equal(handoffRow.login_id, loginId);
    assert.equal(handoffRow.user_id, accountRow.user_id);
    assert.equal(handoffRow.consumed_at, null);
    assert.ok(handoffRow.expires_at.getTime() > Date.now());

    const consumeResponse = await context.app.inject({
      method: 'POST',
      url: '/auth/bungie/handoff/consume',
      headers: {
        'user-agent': 'integration-auth-flow'
      },
      payload: {
        ticket,
        loginId
      }
    });

    assert.equal(consumeResponse.statusCode, 200);
    const consumeBody = consumeResponse.json() as AppSessionResponse;
    assert.ok(consumeBody.accessToken.startsWith('v1.'));
    assert.ok(consumeBody.refreshToken.startsWith('rt_'));
    assert.equal(consumeBody.expiresIn, 900);
    assert.equal(consumeBody.refreshExpiresIn, 7776000);

    const handoffConsumedResult = await context.db.query<HandoffTicketRow>(
      `
        select
          ticket_id::text,
          login_id::text,
          user_id::text,
          consumed_at,
          expires_at
        from auth_handoff_tickets
        where ticket_id = $1::uuid
      `,
      [ticket]
    );

    assert.ok(handoffConsumedResult.rows[0]?.consumed_at, 'Handoff consume should mark the ticket as used');

    const refreshTokenResult = await context.db.query<AppRefreshTokenRow>(
      `
        select
          user_id::text,
          created_by_login_id::text,
          user_agent
        from app_refresh_tokens
        where user_id = $1::uuid
      `,
      [accountRow.user_id]
    );

    assert.equal(refreshTokenResult.rows.length, 1);
    assert.equal(refreshTokenResult.rows[0]?.user_id, accountRow.user_id);
    assert.equal(refreshTokenResult.rows[0]?.created_by_login_id, loginId);
    assert.equal(refreshTokenResult.rows[0]?.user_agent, 'integration-auth-flow');

    const meResponse = await context.app.inject({
      method: 'GET',
      url: '/me',
      headers: {
        authorization: `Bearer ${consumeBody.accessToken}`
      }
    });

    assert.equal(meResponse.statusCode, 200);
    const meBody = meResponse.json() as {
      userId: string;
      bungie: {
        membershipId: string | null;
        displayName: string | null;
        globalDisplayName: string | null;
        globalDisplayNameCode: number | null;
        verified: boolean;
      };
      marathon: {
        membershipId: string | null;
        verified: boolean;
      };
      lastMembershipSyncAt: string | null;
    };
    assert.deepEqual(meBody, {
      userId: accountRow.user_id,
      bungie: {
        membershipId: '800000000000123',
        displayName: 'AuthFlowDisplay',
        globalDisplayName: 'AuthFlowGlobal',
        globalDisplayNameCode: 2026,
        verified: true
      },
      marathon: {
        membershipId: '810000000000123',
        verified: true
      },
      lastMembershipSyncAt: meBody.lastMembershipSyncAt
    });
    assert.ok(meBody.lastMembershipSyncAt);

    const replayResponse = await context.app.inject({
      method: 'POST',
      url: '/auth/bungie/handoff/consume',
      payload: {
        ticket,
        loginId
      }
    });

    assert.equal(replayResponse.statusCode, 409);
    assert.deepEqual(replayResponse.json(), {
      error: 'handoff_ticket_used',
      message: 'Handoff ticket has already been used'
    });
  } finally {
    await context.close();
  }
});

test('integration: handoff consume rejects expired tickets', async () => {
  const context = await createAuthTestContext({ bungieFetch: buildSuccessfulBungieFetch(buildIntegrationConfig(loadConfig(), 'postgres://unused')).fetchImpl });

  try {
    const { loginId, oauthState } = await startNativeLogin(context);
    const { ticket } = await runCallback(context, oauthState);

    await context.db.query(
      `
        update auth_handoff_tickets
        set expires_at = now() - interval '1 second'
        where ticket_id = $1::uuid
      `,
      [ticket]
    );

    const consumeResponse = await context.app.inject({
      method: 'POST',
      url: '/auth/bungie/handoff/consume',
      payload: {
        ticket,
        loginId
      }
    });

    assert.equal(consumeResponse.statusCode, 410);
    assert.deepEqual(consumeResponse.json(), {
      error: 'handoff_ticket_expired',
      message: 'Handoff ticket has expired'
    });

    const handoffResult = await context.db.query<HandoffTicketRow>(
      `
        select
          ticket_id::text,
          login_id::text,
          user_id::text,
          consumed_at,
          expires_at
        from auth_handoff_tickets
        where ticket_id = $1::uuid
      `,
      [ticket]
    );

    assert.equal(handoffResult.rows[0]?.consumed_at, null);
  } finally {
    await context.close();
  }
});

test('integration: callback rejects an invalid OAuth state before any Bungie network call', async () => {
  const calls: MockFetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: toRequestUrl(input),
      method: init?.method ?? 'GET'
    });
    throw new Error('Unexpected network call for invalid state');
  };

  const context = await createAuthTestContext({ bungieFetch: fetchImpl });

  try {
    const callbackResponse = await context.app.inject({
      method: 'GET',
      url: `/auth/bungie/callback?code=test-auth-code&state=${encodeURIComponent(randomUUID())}`
    });

    assert.equal(callbackResponse.statusCode, 400);
    assert.deepEqual(callbackResponse.json(), {
      error: 'bungie_state_invalid',
      message: 'OAuth state is invalid or expired'
    });
    assert.deepEqual(calls, []);
  } finally {
    await context.close();
  }
});
