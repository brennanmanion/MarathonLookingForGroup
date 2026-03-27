export type RedirectMode = 'native' | 'web';

export interface BungieStartBody {
  platform?: string;
  appState?: string;
  redirectMode?: RedirectMode;
}

export interface BungieStartResponse {
  loginId: string;
  authorizeUrl: string;
}

export interface HandoffConsumeBody {
  ticket: string;
  loginId: string;
}

export interface RefreshTokenBody {
  refreshToken: string;
}

export interface AppSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface CreatePartyTagInput {
  tagKey: string;
  tagValue?: string;
}

export interface CreatePartyBody {
  title: string;
  activityKey: string;
  playlistKey?: string;
  platformKey?: string;
  regionKey?: string;
  languageKey?: string;
  voiceRequired?: boolean;
  ranked?: boolean;
  scheduledFor?: string;
  maxSize: number;
  approvalMode?: string;
  visibility?: string;
  requiresMarathonVerified?: boolean;
  requirementText?: string;
  description?: string;
  externalJoinUrl?: string;
  tags?: CreatePartyTagInput[];
}

export interface UpdatePartyBody {
  title?: string;
  playlistKey?: string | null;
  platformKey?: string;
  regionKey?: string | null;
  languageKey?: string | null;
  voiceRequired?: boolean;
  ranked?: boolean | null;
  scheduledFor?: string | null;
  maxSize?: number;
  approvalMode?: string;
  visibility?: string;
  requiresMarathonVerified?: boolean;
  requirementText?: string | null;
  description?: string | null;
  externalJoinUrl?: string | null;
  tags?: CreatePartyTagInput[];
}
