import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { AppConfig } from './config.js';
import type { DbAdapter } from './db.js';
import { AppError } from './errors.js';
import { issueAccessToken, issueRefreshToken } from './session.js';
import type { BungieStartBody, BungieStartResponse, HandoffConsumeBody, RedirectMode } from './types.js';

const LOGIN_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 60 * 1000;

interface LoginTransactionRow {
  id: string;
  oauth_state: string;
  redirect_mode: RedirectMode;
  app_state: string | null;
  expires_at: Date;
  consumed_at: Date | null;
}

interface BungieTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  membership_id?: string;
}

interface BungieEnvelope<T> {
  ErrorCode: number;
  ErrorStatus: string;
  Message: string;
  ThrottleSeconds?: number;
  Response?: T;
}

interface BungieNetUser {
  membershipId?: string;
  displayName?: string;
  uniqueName?: string;
  displayNameCode?: number;
}

interface BungieMembershipData {
  bungieNetUser?: BungieNetUser;
  marathonMembershipId?: string | null;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

interface CallbackResult {
  redirectUrl: string;
}

interface HandoffConsumeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface PersistedUser {
  userId: string;
  handoffTicket: string;
}

function requireBungieDb(db: DbAdapter | null): DbAdapter {
  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  return db;
}

function requireBungieConfig(config: AppConfig): void {
  if (!config.bungieClientId || !config.bungieClientSecret || !config.bungieApiKey) {
    throw new AppError(503, 'config_missing', 'Bungie OAuth configuration is incomplete');
  }
}

function normalizeRedirectMode(value: RedirectMode | undefined): RedirectMode {
  return value === 'web' ? 'web' : 'native';
}

function createAuthorizeUrl(config: AppConfig, oauthState: string): string {
  if (!config.bungieClientId) {
    throw new AppError(503, 'config_missing', 'BUNGIE_CLIENT_ID is not configured');
  }

  const url = new URL('https://www.bungie.net/en/OAuth/Authorize');
  url.searchParams.set('client_id', config.bungieClientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', oauthState);

  if (config.bungieRedirectUri) {
    url.searchParams.set('redirect_uri', config.bungieRedirectUri);
  }

  return url.toString();
}

async function claimLoginTransaction(db: DbAdapter, state: string): Promise<LoginTransactionRow> {
  return db.withTransaction(async (client) => {
    const result = await client.query<LoginTransactionRow>(
      `
        select
          id::text,
          oauth_state,
          redirect_mode,
          app_state,
          expires_at,
          consumed_at
        from auth_login_transactions
        where oauth_state = $1
        for update
      `,
      [state]
    );

    const row = result.rows[0];
    if (!row || row.consumed_at || row.expires_at.getTime() <= Date.now()) {
      throw new AppError(400, 'bungie_state_invalid', 'OAuth state is invalid or expired');
    }

    await client.query(
      `
        update auth_login_transactions
        set consumed_at = now()
        where id = $1
      `,
      [row.id]
    );

    return row;
  });
}

async function exchangeAuthorizationCode(config: AppConfig, code: string): Promise<BungieTokenResponse> {
  requireBungieConfig(config);

  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);

  if (config.bungieRedirectUri) {
    body.set('redirect_uri', config.bungieRedirectUri);
  }

  const basicAuth = Buffer.from(`${config.bungieClientId}:${config.bungieClientSecret}`).toString('base64');
  const response = await fetch('https://www.bungie.net/Platform/App/OAuth/token/', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = (await response.json()) as BungieTokenResponse;
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new AppError(502, 'bungie_auth_failed', 'Bungie token exchange failed');
  }

  return payload;
}

async function fetchMembershipData(config: AppConfig, accessToken: string): Promise<BungieMembershipData> {
  requireBungieConfig(config);

  const response = await fetch('https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/', {
    headers: {
      'X-API-Key': config.bungieApiKey!,
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = (await response.json()) as BungieEnvelope<BungieMembershipData>;
  if (!response.ok || payload.ErrorCode !== 1 || !payload.Response) {
    throw new AppError(502, 'bungie_auth_failed', 'Bungie membership lookup failed');
  }

  return payload.Response;
}

function resolveMembershipId(tokenResponse: BungieTokenResponse, membershipData: BungieMembershipData): string {
  const tokenMembershipId = tokenResponse.membership_id;
  const userMembershipId = membershipData.bungieNetUser?.membershipId;
  const value = tokenMembershipId ?? userMembershipId;

  if (!value) {
    throw new AppError(502, 'bungie_auth_failed', 'Bungie membership data is missing a membership id');
  }

  return value;
}

async function persistUserAndTokens(
  client: PoolClient,
  login: LoginTransactionRow,
  tokenResponse: BungieTokenResponse,
  membershipData: BungieMembershipData
): Promise<PersistedUser> {
  const now = new Date();
  const accessTokenExpiresAt = new Date(now.getTime() + tokenResponse.expires_in! * 1000);
  const refreshTokenExpiresAt = tokenResponse.refresh_expires_in
    ? new Date(now.getTime() + tokenResponse.refresh_expires_in * 1000)
    : null;
  const bungieMembershipId = resolveMembershipId(tokenResponse, membershipData);
  const marathonMembershipId = membershipData.marathonMembershipId ?? null;
  const marathonVerified = marathonMembershipId !== null;

  const existingResult = await client.query<{ user_id: string }>(
    `
      select user_id::text
      from bungie_accounts
      where bungie_membership_id = $1
      for update
    `,
    [bungieMembershipId]
  );

  let userId = existingResult.rows[0]?.user_id;
  if (!userId) {
    const userInsert = await client.query<{ id: string }>(
      `
        insert into app_users default values
        returning id::text
      `
    );
    userId = userInsert.rows[0]?.id;
  }

  if (!userId) {
    throw new AppError(500, 'login_start_failed', 'Unable to create local user');
  }

  const bungieGlobalDisplayName = membershipData.bungieNetUser?.uniqueName ?? null;
  const bungieGlobalDisplayNameCode = membershipData.bungieNetUser?.displayNameCode ?? null;

  await client.query(
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
      values ($1, $2, $3, $4, $5, true, now(), $6, $7, $8, now(), $9::jsonb)
      on conflict (user_id) do update
      set
        bungie_membership_id = excluded.bungie_membership_id,
        bungie_display_name = excluded.bungie_display_name,
        bungie_global_display_name = excluded.bungie_global_display_name,
        bungie_global_display_name_code = excluded.bungie_global_display_name_code,
        bungie_verified = true,
        bungie_verified_at = now(),
        marathon_membership_id = excluded.marathon_membership_id,
        marathon_verified = excluded.marathon_verified,
        marathon_verified_at = excluded.marathon_verified_at,
        last_membership_sync_at = now(),
        raw_membership_payload = excluded.raw_membership_payload,
        updated_at = now()
    `,
    [
      userId,
      bungieMembershipId,
      membershipData.bungieNetUser?.displayName ?? null,
      bungieGlobalDisplayName,
      bungieGlobalDisplayNameCode,
      marathonMembershipId,
      marathonVerified,
      marathonVerified ? now : null,
      JSON.stringify(membershipData)
    ]
  );

  await client.query(
    `
      insert into bungie_oauth_tokens (
        user_id,
        access_token,
        refresh_token,
        access_token_expires_at,
        refresh_token_expires_at,
        is_stale
      )
      values ($1, $2, $3, $4, $5, false)
      on conflict (user_id) do update
      set
        access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, bungie_oauth_tokens.refresh_token),
        access_token_expires_at = excluded.access_token_expires_at,
        refresh_token_expires_at = coalesce(excluded.refresh_token_expires_at, bungie_oauth_tokens.refresh_token_expires_at),
        is_stale = false,
        updated_at = now()
    `,
    [
      userId,
      tokenResponse.access_token,
      tokenResponse.refresh_token ?? null,
      accessTokenExpiresAt,
      refreshTokenExpiresAt
    ]
  );

  const handoffTicket = randomUUID();
  await client.query(
    `
      insert into auth_handoff_tickets (
        ticket_id,
        login_id,
        user_id,
        expires_at
      )
      values ($1, $2, $3, $4)
    `,
    [handoffTicket, login.id, userId, new Date(Date.now() + HANDOFF_TTL_MS)]
  );

  return {
    userId,
    handoffTicket
  };
}

function buildNativeRedirect(config: AppConfig, login: LoginTransactionRow, ticket: string): string {
  if (!config.appUniversalLinkBase) {
    throw new AppError(503, 'config_missing', 'APP_UNIVERSAL_LINK_BASE is not configured');
  }

  const url = new URL('/auth/handoff', config.appUniversalLinkBase);
  url.searchParams.set('ticket', ticket);
  url.searchParams.set('loginId', login.id);

  if (login.app_state) {
    url.searchParams.set('appState', login.app_state);
  }

  return url.toString();
}

export async function startBungieLogin(
  db: DbAdapter | null,
  config: AppConfig,
  body: BungieStartBody
): Promise<BungieStartResponse> {
  const database = requireBungieDb(db);
  const redirectMode = normalizeRedirectMode(body.redirectMode);
  if (redirectMode !== 'native') {
    throw new AppError(501, 'web_mode_not_implemented', 'Web Bungie login is not implemented yet');
  }

  const loginId = randomUUID();
  const oauthState = randomUUID();
  const expiresAt = new Date(Date.now() + LOGIN_TTL_MS);

  const insertSql = `
    insert into auth_login_transactions (
      id,
      oauth_state,
      redirect_mode,
      app_state,
      platform,
      expires_at
    )
    values ($1, $2, $3, $4, $5, $6)
    returning id, oauth_state
  `;

  const result = await database.query<{ id: string; oauth_state: string }>(insertSql, [
    loginId,
    oauthState,
    redirectMode,
    body.appState ?? null,
    body.platform ?? null,
    expiresAt
  ]);

  const row = result.rows[0];
  if (!row) {
    throw new AppError(500, 'login_start_failed', 'Unable to create login transaction');
  }

  return {
    loginId: row.id,
    authorizeUrl: createAuthorizeUrl(config, row.oauth_state)
  };
}

export async function handleBungieCallback(
  db: DbAdapter | null,
  config: AppConfig,
  query: CallbackQuery
): Promise<CallbackResult> {
  const database = requireBungieDb(db);
  requireBungieConfig(config);

  if (query.error) {
    throw new AppError(502, 'bungie_auth_failed', query.error_description ?? 'Bungie OAuth returned an error');
  }

  if (!query.code || !query.state) {
    throw new AppError(400, 'bungie_state_invalid', 'Missing Bungie OAuth code or state');
  }

  const login = await claimLoginTransaction(database, query.state);
  if (login.redirect_mode !== 'native') {
    throw new AppError(501, 'web_mode_not_implemented', 'Web Bungie login is not implemented yet');
  }

  const tokenResponse = await exchangeAuthorizationCode(config, query.code);
  const membershipData = await fetchMembershipData(config, tokenResponse.access_token!);
  const persisted = await database.withTransaction((client) =>
    persistUserAndTokens(client, login, tokenResponse, membershipData)
  );

  return {
    redirectUrl: buildNativeRedirect(config, login, persisted.handoffTicket)
  };
}

export async function consumeHandoffTicket(
  db: DbAdapter | null,
  config: AppConfig,
  body: HandoffConsumeBody,
  metadata: { ip: string | undefined; userAgent: string | undefined }
): Promise<HandoffConsumeResult> {
  const database = requireBungieDb(db);

  return database.withTransaction(async (client) => {
    const ticketResult = await client.query<{
      user_id: string;
      login_id: string;
      consumed_at: Date | null;
      expires_at: Date;
    }>(
      `
        select
          user_id::text,
          login_id::text,
          consumed_at,
          expires_at
        from auth_handoff_tickets
        where ticket_id = $1
          and login_id = $2
        for update
      `,
      [body.ticket, body.loginId]
    );

    const ticket = ticketResult.rows[0];
    if (!ticket) {
      throw new AppError(400, 'handoff_ticket_invalid', 'Handoff ticket is invalid');
    }

    if (ticket.consumed_at) {
      throw new AppError(409, 'handoff_ticket_used', 'Handoff ticket has already been used');
    }

    if (ticket.expires_at.getTime() <= Date.now()) {
      throw new AppError(410, 'handoff_ticket_expired', 'Handoff ticket has expired');
    }

    await client.query(
      `
        update auth_handoff_tickets
        set consumed_at = now()
        where ticket_id = $1
      `,
      [body.ticket]
    );

    const accessToken = issueAccessToken(config, ticket.user_id);
    const refreshToken = issueRefreshToken();

    await client.query(
      `
        insert into app_refresh_tokens (
          token_id,
          user_id,
          token_hash,
          created_by_login_id,
          expires_at,
          ip,
          user_agent
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        refreshToken.tokenId,
        ticket.user_id,
        refreshToken.tokenHash,
        ticket.login_id,
        refreshToken.expiresAt,
        metadata.ip ?? null,
        metadata.userAgent ?? null
      ]
    );

    return {
      accessToken: accessToken.token,
      refreshToken: refreshToken.token,
      expiresIn: accessToken.expiresIn,
      refreshExpiresIn: refreshToken.expiresIn
    };
  });
}
