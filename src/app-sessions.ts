import type { PoolClient } from 'pg';

import type { AppConfig } from './config.js';
import type { DbAdapter } from './db.js';
import { AppError } from './errors.js';
import { hashRefreshTokenSecret, issueAccessToken, issueRefreshToken, parseRefreshToken } from './session.js';
import type { AppSessionResponse } from './types.js';

interface SessionMetadata {
  ip: string | undefined;
  userAgent: string | undefined;
}

interface StoredRefreshTokenRow {
  token_id: string;
  user_id: string;
  token_hash: string;
  created_by_login_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  is_active: boolean;
}

function requireSessionDb(db: DbAdapter | null): DbAdapter {
  if (!db) {
    throw new AppError(503, 'db_unavailable', 'DATABASE_URL is not configured');
  }

  return db;
}

export async function createAppSession(
  client: PoolClient,
  config: AppConfig,
  input: {
    userId: string;
    createdByLoginId?: string | null;
    metadata: SessionMetadata;
  }
): Promise<AppSessionResponse> {
  const accessToken = issueAccessToken(config, input.userId);
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
      input.userId,
      refreshToken.tokenHash,
      input.createdByLoginId ?? null,
      refreshToken.expiresAt,
      input.metadata.ip ?? null,
      input.metadata.userAgent ?? null
    ]
  );

  return {
    accessToken: accessToken.token,
    refreshToken: refreshToken.token,
    expiresIn: accessToken.expiresIn,
    refreshExpiresIn: refreshToken.expiresIn
  };
}

export async function refreshAppSession(
  db: DbAdapter | null,
  config: AppConfig,
  refreshTokenValue: string,
  metadata: SessionMetadata
): Promise<AppSessionResponse> {
  const database = requireSessionDb(db);
  const { tokenId, rawSecret } = parseRefreshToken(refreshTokenValue);
  const tokenHash = hashRefreshTokenSecret(rawSecret);

  return database.withTransaction(async (client) => {
    const tokenResult = await client.query<StoredRefreshTokenRow>(
      `
        select
          rt.token_id::text,
          rt.user_id::text,
          rt.token_hash,
          rt.created_by_login_id::text,
          rt.expires_at,
          rt.revoked_at,
          u.is_active
        from app_refresh_tokens rt
        join app_users u on u.id = rt.user_id
        where rt.token_id = $1
        for update
      `,
      [tokenId]
    );

    const tokenRow = tokenResult.rows[0];
    if (!tokenRow || tokenRow.token_hash !== tokenHash || tokenRow.revoked_at || !tokenRow.is_active) {
      throw new AppError(401, 'auth_invalid', 'Invalid refresh token');
    }

    if (tokenRow.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, 'auth_expired', 'Refresh token has expired');
    }

    await client.query(
      `
        update app_refresh_tokens
        set revoked_at = now()
        where token_id = $1
      `,
      [tokenRow.token_id]
    );

    return createAppSession(client, config, {
      userId: tokenRow.user_id,
      createdByLoginId: tokenRow.created_by_login_id,
      metadata
    });
  });
}
