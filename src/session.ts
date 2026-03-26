import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { AppConfig } from './config.js';
import { AppError } from './errors.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

interface AccessTokenPayload {
  sub: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

export interface IssuedRefreshToken {
  tokenId: string;
  token: string;
  tokenHash: string;
  expiresAt: Date;
  expiresIn: number;
}

function requireSessionSecret(config: AppConfig): string {
  if (!config.appSessionSecret) {
    throw new AppError(503, 'config_missing', 'APP_SESSION_SECRET is not configured');
  }

  return config.appSessionSecret;
}

function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodePayload(payload: AccessTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function issueAccessToken(config: AppConfig, userId: string): IssuedAccessToken {
  const secret = requireSessionSecret(config);
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: userId,
    type: 'access',
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS
  };
  const encodedPayload = encodePayload(payload);
  const signature = signPayload(secret, encodedPayload);

  return {
    token: `v1.${encodedPayload}.${signature}`,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS
  };
}

export function verifyAccessToken(config: AppConfig, token: string): AccessTokenPayload {
  const secret = requireSessionSecret(config);
  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new AppError(401, 'auth_invalid', 'Invalid access token');
  }

  const [, encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) {
    throw new AppError(401, 'auth_invalid', 'Invalid access token');
  }

  const expectedSignature = signPayload(secret, encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError(401, 'auth_invalid', 'Invalid access token');
  }

  let payload: AccessTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AccessTokenPayload;
  } catch {
    throw new AppError(401, 'auth_invalid', 'Invalid access token');
  }

  if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    throw new AppError(401, 'auth_invalid', 'Invalid access token');
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError(401, 'auth_expired', 'Access token has expired');
  }

  return payload;
}

export function issueRefreshToken(): IssuedRefreshToken {
  const raw = randomBytes(32).toString('base64url');
  const tokenId = randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  return {
    tokenId,
    token: `rt_${tokenId}_${raw}`,
    tokenHash: createHash('sha256').update(raw).digest('hex'),
    expiresAt,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS
  };
}

