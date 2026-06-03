export interface ApiErrorResponse {
  error?: string;
  message?: string;
}

export interface AuthSessionStateResponse {
  authenticated: boolean;
  user?: {
    userId: string;
  };
}

export interface BungieStartResponse {
  loginId: string;
  authorizeUrl: string;
}

export interface PartyTag {
  tagKey: string;
  tagValue: string | null;
}

export interface PartyMembershipSummary {
  memberId: string;
  status: 'accepted' | 'pending' | 'declined' | 'left' | 'kicked';
  noteToHost: string | null;
  joinedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

export interface PartyMemberView {
  memberId: string;
  userId: string;
  status: 'accepted' | 'pending' | 'declined' | 'left' | 'kicked';
  noteToHost: string | null;
  joinedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  bungieDisplayName: string | null;
  globalDisplayName: string | null;
  globalDisplayNameCode: number | null;
}

export interface PartyView {
  partyId: string;
  status: 'open' | 'full' | 'in_progress' | 'closed' | 'cancelled';
  title: string;
  activityKey: string;
  playlistKey: string | null;
  platformKey: string;
  regionKey: string | null;
  languageKey: string | null;
  voiceRequired: boolean;
  ranked: boolean | null;
  scheduledFor: string | null;
  maxSize: number;
  approvalMode: string;
  visibility: string;
  requiresMarathonVerified: boolean;
  requirementText: string | null;
  description: string | null;
  externalJoinUrl: string | null;
  filledSlots: number;
  openSlots: number;
  createdAt: string;
  updatedAt: string;
  host: {
    userId: string;
    bungieDisplayName: string | null;
    globalDisplayName: string | null;
    globalDisplayNameCode: number | null;
  };
  tags: PartyTag[];
  myMembership: PartyMembershipSummary | null;
  members: PartyMemberView[];
}

export interface PartyListResponse {
  items: PartyView[];
}

export interface CreatePartyBody {
  title: string;
  activityKey: string;
  maxSize: number;
  description?: string;
  requirementText?: string;
}

export interface CreatePartyResponse {
  partyId: string;
  status: string;
  filledSlots: number;
  openSlots: number;
}

export interface JoinPartyBody {
  noteToHost?: string;
}

export interface JoinPartyResponse {
  partyId: string;
  myStatus: string;
  filledSlots: number;
  openSlots: number;
}

export interface PartyMutationResponse {
  partyId: string;
  memberId: string;
  memberStatus: string;
  filledSlots: number;
  openSlots: number;
  partyStatus: string;
}

export interface CancelPartyResponse {
  partyId: string;
  status: string;
}

export interface RefreshResponse {
  ok: true;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface LogoutResponse {
  ok: true;
}

export interface MeResponse {
  userId: string;
  profile: {
    primaryDisplayName: string;
    bungieDisplayName: string | null;
    bungieGlobalDisplayName: string | null;
    bungieGlobalDisplayNameCode: number | null;
  };
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
  capabilities: {
    canCreateParty: boolean;
    canUsePwaPartyWrites: boolean;
    canUsePwaBungieResync: boolean;
  };
  pwa: {
    appBasePath: string;
    loginPath: string;
    callbackSuccessPath: string;
    callbackErrorPath: string;
    sessionPath: string;
    mePath: string;
    resyncPath: string;
    partiesPath: string;
    cookieAuth: boolean;
    csrfRequired: boolean;
  };
  lastMembershipSyncAt: string | null;
}
