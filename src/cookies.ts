import { randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { AppSessionResponse } from './types.js';

type SameSite = 'Lax' | 'Strict' | 'None';

interface CookieOptions {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: SameSite;
  secure?: boolean;
}

export const WEB_ACCESS_COOKIE_NAME = 'mlfg_at';
export const WEB_REFRESH_COOKIE_NAME = 'mlfg_rt';
export const WEB_CSRF_COOKIE_NAME = 'mlfg_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

function normalizeCookieHeader(header: string | string[] | undefined): string {
  if (!header) {
    return '';
  }

  return Array.isArray(header) ? header.join('; ') : header;
}

function normalizeHeaderValue(header: string | string[] | undefined): string | null {
  if (!header) {
    return null;
  }

  if (Array.isArray(header)) {
    return header[0] ?? null;
  }

  return header;
}

function appendSetCookie(reply: FastifyReply, cookie: string): void {
  if (typeof reply.raw.appendHeader === 'function') {
    reply.raw.appendHeader('Set-Cookie', cookie);
    return;
  }

  const current = reply.getHeader('Set-Cookie');

  if (!current) {
    reply.header('Set-Cookie', cookie);
    return;
  }

  if (Array.isArray(current)) {
    reply.header('Set-Cookie', [...current.map(String), cookie]);
    return;
  }

  reply.header('Set-Cookie', [String(current), cookie]);
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? '/'}`);

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function isSecureCookieConfig(config: AppConfig): boolean {
  return config.nodeEnv === 'production';
}

function buildCookieOptions(
  config: AppConfig,
  input: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
  }
): CookieOptions {
  return {
    httpOnly: input.httpOnly,
    maxAge: input.maxAge,
    path: input.path,
    sameSite: 'Lax',
    secure: isSecureCookieConfig(config),
    ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {})
  };
}

function expireCookie(reply: FastifyReply, config: AppConfig, name: string, path: string): void {
  appendSetCookie(
    reply,
    serializeCookie(name, '', {
      expires: new Date(0),
      httpOnly: name !== WEB_CSRF_COOKIE_NAME,
      maxAge: 0,
      path,
      sameSite: 'Lax',
      secure: isSecureCookieConfig(config),
      ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {})
    })
  );
}

export function issueCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function parseCookies(request: Pick<FastifyRequest, 'headers'>): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = normalizeCookieHeader(request.headers.cookie);

  if (!header) {
    return cookies;
  }

  for (const part of header.split(';')) {
    const segment = part.trim();
    if (!segment) {
      continue;
    }

    const separatorIndex = segment.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();
    const rawValue = segment.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }

    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

export function getAccessTokenFromCookies(request: Pick<FastifyRequest, 'headers'>): string | null {
  return parseCookies(request)[WEB_ACCESS_COOKIE_NAME] ?? null;
}

export function getRefreshTokenFromCookies(request: Pick<FastifyRequest, 'headers'>): string | null {
  return parseCookies(request)[WEB_REFRESH_COOKIE_NAME] ?? null;
}

export function getCsrfTokenFromCookies(request: Pick<FastifyRequest, 'headers'>): string | null {
  return parseCookies(request)[WEB_CSRF_COOKIE_NAME] ?? null;
}

export function hasWebSessionCookies(request: Pick<FastifyRequest, 'headers'>): boolean {
  const cookies = parseCookies(request);

  return Boolean(
    cookies[WEB_ACCESS_COOKIE_NAME] ||
    cookies[WEB_REFRESH_COOKIE_NAME] ||
    cookies[WEB_CSRF_COOKIE_NAME]
  );
}

export function requireCsrfToken(request: Pick<FastifyRequest, 'headers'>): string {
  const cookieToken = getCsrfTokenFromCookies(request);
  const headerToken = normalizeHeaderValue(request.headers[CSRF_HEADER_NAME]);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new AppError(403, 'csrf_invalid', 'A valid CSRF token is required');
  }

  return headerToken;
}

export function setWebSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  session: AppSessionResponse
): string {
  const csrfToken = issueCsrfToken();

  appendSetCookie(
    reply,
    serializeCookie(
      WEB_ACCESS_COOKIE_NAME,
      session.accessToken,
      buildCookieOptions(config, {
        httpOnly: true,
        maxAge: session.expiresIn,
        path: '/'
      })
    )
  );

  appendSetCookie(
    reply,
    serializeCookie(
      WEB_REFRESH_COOKIE_NAME,
      session.refreshToken,
      buildCookieOptions(config, {
        httpOnly: true,
        maxAge: session.refreshExpiresIn,
        path: '/auth'
      })
    )
  );

  appendSetCookie(
    reply,
    serializeCookie(
      WEB_CSRF_COOKIE_NAME,
      csrfToken,
      buildCookieOptions(config, {
        httpOnly: false,
        maxAge: session.refreshExpiresIn,
        path: '/'
      })
    )
  );

  return csrfToken;
}

export function clearWebSessionCookies(reply: FastifyReply, config: AppConfig): void {
  expireCookie(reply, config, WEB_ACCESS_COOKIE_NAME, '/');
  expireCookie(reply, config, WEB_REFRESH_COOKIE_NAME, '/auth');
  expireCookie(reply, config, WEB_CSRF_COOKIE_NAME, '/');
}
