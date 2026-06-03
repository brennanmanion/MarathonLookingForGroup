import { apiRequest } from './client';
import type { MeResponse } from './types';

export async function getMe() {
  return apiRequest<MeResponse>('/me');
}

export async function resyncBungie() {
  return apiRequest<MeResponse>('/me/bungie/resync', {
    method: 'POST'
  });
}
