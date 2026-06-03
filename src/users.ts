import type { FastifyRequest } from 'fastify';

import type { AppConfig } from './config.js';
import { getAccessTokenFromCookies, requireCsrfToken } from './cookies.js';
import type { DbAdapter, Queryable } from './db.js';
import { AppError, isAppError } from './errors.js';
import { verifyAccessToken } from './session.js';

export interface CurrentUser {
  userId: string;
  isActive: boolean;
  bungieMembershipId: string | null;
  bungieDisplayName: string | null;
  bungieGlobalDisplayName: string | null;
  bungieGlobalDisplayNameCode: number | null;
  bungieVerified: boolean;
  marathonMembershipId: string | null;
  marathonVerified: boolean;
  lastMembershipSyncAt: string | null;
}

interface CurrentUserRow {
  user_id: string;
  is_active: boolean;
  bungie_membership_id: string | null;
  bungie_display_name: string | null;
  bungie_global_display_name: string | null;
  bungie_global_display_name_code: number | null;
  bungie_verified: boolean | null;
  marathon_membership_id: string | null;
  marathon_verified: boolean | null;
  last_membership_sync_at: string | null;
}

const SAFE_COOKIE_AUTH_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SESSION_AUTH_ERROR_CODES = new Set(['auth_required', 'auth_invalid', 'auth_expired']);
type AuthSource = 'bearer' | 'cookie';

interface AccessTokenSelection {
  token: string;
  source: AuthSource;
}

interface CurrentUserOptions {
  allowCookieMutation?: boolean;
}

export async function findCurrentUser(queryable: Queryable, userId: string): Promise<CurrentUser> {
  const result = await queryable.query<CurrentUserRow>(
    `
      select
        u.id::text as user_id,
        u.is_active,
        ba.bungie_membership_id::text as bungie_membership_id,
        ba.bungie_display_name,
        ba.bungie_global_display_name,
        ba.bungie_global_display_name_code,
        ba.bungie_verified,
        ba.marathon_membership_id::text as marathon_membership_id,
        ba.marathon_verified,
        ba.last_membership_sync_at::text
      from app_users u
      left join bungie_accounts ba on ba.user_id = u.id
      where u.id = $1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row || !row.is_active) {
    throw new AppError(401, 'auth_invalid', 'The current session is no longer valid');
  }

  return {
    userId: row.user_id,
    isActive: row.is_active,
    bungieMembershipId: row.bungie_membership_id,
    bungieDisplayName: row.bungie_display_name,
    bungieGlobalDisplayName: row.bungie_global_display_name,
    bungieGlobalDisplayNameCode: row.bungie_global_display_name_code,
    bungieVerified: row.bungie_verified ?? false,
    marathonMembershipId: row.marathon_membership_id,
    marathonVerified: row.marathon_verified ?? false,
    lastMembershipSyncAt: row.last_membership_sync_at
  };
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header) {
    throw new AppError(401, 'auth_required', 'Authorization header is required');
  }

  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) {
    throw new AppError(401, 'auth_required', 'Bearer token is required');
  }

  return value;
}

function resolveAccessToken(request: FastifyRequest): AccessTokenSelection {
  if (request.headers.authorization) {
    return {
      token: extractBearerToken(request),
      source: 'bearer'
    };
  }

  const cookieToken = getAccessTokenFromCookies(request);
  if (cookieToken) {
    return {
      token: cookieToken,
      source: 'cookie'
    };
  }

  throw new AppError(401, 'auth_required', 'Authentication is required');
}

function enforceCookieMutationPolicy(
  request: FastifyRequest,
  source: AuthSource,
  options: CurrentUserOptions
): void {
  const method = request.method.toUpperCase();
  if (source !== 'cookie' || SAFE_COOKIE_AUTH_METHODS.has(method)) {
    return;
  }

  if (!options.allowCookieMutation) {
    throw new AppError(
      403,
      'csrf_required',
      'Cookie-authenticated mutation is not enabled for this route'
    );
  }

  requireCsrfToken(request);
}

export async function requireCurrentUser(
  request: FastifyRequest,
  db: DbAdapter | null,
  config: AppConfig,
  options: CurrentUserOptions = {}
): Promise<CurrentUser> {
  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  const selection = resolveAccessToken(request);
  enforceCookieMutationPolicy(request, selection.source, options);
  const payload = verifyAccessToken(config, selection.token);
  return findCurrentUser(db, payload.sub);
}

export async function findOptionalCurrentUser(
  request: FastifyRequest,
  db: DbAdapter | null,
  config: AppConfig,
  options: CurrentUserOptions = {}
): Promise<CurrentUser | null> {
  if (!request.headers.authorization && !getAccessTokenFromCookies(request)) {
    return null;
  }

  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  const selection = resolveAccessToken(request);
  enforceCookieMutationPolicy(request, selection.source, options);
  const payload = verifyAccessToken(config, selection.token);
  return findCurrentUser(db, payload.sub);
}

export async function findSessionCurrentUser(
  request: FastifyRequest,
  db: DbAdapter | null,
  config: AppConfig
): Promise<CurrentUser | null> {
  try {
    return await findOptionalCurrentUser(request, db, config);
  } catch (error) {
    if (isAppError(error) && SESSION_AUTH_ERROR_CODES.has(error.code)) {
      return null;
    }

    throw error;
  }
}
