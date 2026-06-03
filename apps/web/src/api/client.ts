import type { ApiErrorResponse, RefreshResponse } from './types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthExpiredError extends Error {
  public constructor(message = 'Your session has expired. Sign in again.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;

  for (const segment of document.cookie.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }

  return null;
}

async function readJsonBody<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function buildApiError(response: Response): Promise<ApiError> {
  const payload = await readJsonBody<ApiErrorResponse>(response);
  return new ApiError(
    response.status,
    payload?.error ?? 'request_failed',
    payload?.message ?? `Request failed with status ${response.status}`
  );
}

async function executeRequest(
  path: string,
  init: RequestInit,
  allowRefreshRetry: boolean
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? {});

  if (!SAFE_METHODS.has(method)) {
    const csrfToken = readCookie('mlfg_csrf');
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: 'include'
  });

  if (!allowRefreshRetry || path === '/auth/refresh' || response.status !== 401) {
    return response;
  }

  const errorPayload = await readJsonBody<ApiErrorResponse>(response);
  if (errorPayload?.error !== 'auth_expired') {
    return response;
  }

  try {
    await apiRequest<RefreshResponse>('/auth/refresh', {
      method: 'POST'
    }, {
      allowRefreshRetry: false
    });
  } catch {
    throw new AuthExpiredError();
  }

  return executeRequest(path, init, false);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: {
    allowRefreshRetry?: boolean;
  } = {}
): Promise<T> {
  const response = await executeRequest(path, init, options.allowRefreshRetry ?? true);
  if (!response.ok) {
    throw await buildApiError(response);
  }

  const payload = await readJsonBody<T>(response);
  return (payload ?? {}) as T;
}
