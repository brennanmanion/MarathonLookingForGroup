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
