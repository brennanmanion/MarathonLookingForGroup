import { apiRequest } from './client';
import type {
  AuthSessionStateResponse,
  BungieStartResponse,
  LogoutResponse,
  RefreshResponse
} from './types';

export async function getAuthSession() {
  return apiRequest<AuthSessionStateResponse>('/auth/session');
}

export async function startWebLogin(returnTo = '/app/parties') {
  return apiRequest<BungieStartResponse>('/auth/bungie/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      redirectMode: 'web',
      returnTo
    })
  });
}

export async function refreshSession() {
  return apiRequest<RefreshResponse>('/auth/refresh', {
    method: 'POST'
  }, {
    allowRefreshRetry: false
  });
}

export async function logout() {
  return apiRequest<LogoutResponse>('/auth/logout', {
    method: 'POST'
  }, {
    allowRefreshRetry: false
  });
}
