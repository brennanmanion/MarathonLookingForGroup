import { apiRequest } from './client';
import type {
  CancelPartyResponse,
  CreatePartyBody,
  CreatePartyResponse,
  JoinPartyBody,
  JoinPartyResponse,
  PartyListResponse,
  PartyMutationResponse,
  PartyView
} from './types';

export async function listParties() {
  return apiRequest<PartyListResponse>('/parties');
}

export async function getParty(partyId: string) {
  return apiRequest<PartyView>(`/parties/${encodeURIComponent(partyId)}`);
}

export async function createParty(body: CreatePartyBody) {
  return apiRequest<CreatePartyResponse>('/parties', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export async function joinParty(partyId: string, body: JoinPartyBody) {
  return apiRequest<JoinPartyResponse>(`/parties/${encodeURIComponent(partyId)}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export async function leaveParty(partyId: string) {
  return apiRequest<PartyMutationResponse>(`/parties/${encodeURIComponent(partyId)}/leave`, {
    method: 'POST'
  });
}

export async function cancelParty(partyId: string) {
  return apiRequest<CancelPartyResponse>(`/parties/${encodeURIComponent(partyId)}/cancel`, {
    method: 'POST'
  });
}

export async function moderateMember(
  partyId: string,
  memberId: string,
  action: 'accept' | 'decline' | 'kick'
) {
  return apiRequest<PartyMutationResponse>(
    `/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(memberId)}/${action}`,
    {
      method: 'POST'
    }
  );
}
