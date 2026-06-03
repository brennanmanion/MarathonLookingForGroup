import type { PartyTag } from '../api/types';

export const PLAYLIST_OPTIONS = [
  { label: 'Trios', value: 'trios', maxSize: 3, shellSlots: 2 },
  { label: 'Duos', value: 'duos', maxSize: 2, shellSlots: 1 }
] as const;

export const SHELL_OPTIONS = [
  { label: 'Any shell', value: '' },
  { label: 'Destroyer', value: 'destroyer' },
  { label: 'Vandal', value: 'vandal' },
  { label: 'Recon', value: 'recon' },
  { label: 'Assassin', value: 'assassin' },
  { label: 'Triage', value: 'triage' },
  { label: 'Thief', value: 'thief' },
  { label: 'Sentinel', value: 'sentinel' }
] as const;

export const MAP_OPTIONS = [
  { label: 'Perimeter', value: 'perimeter' },
  { label: 'Dire Marsh Day', value: 'dire_marsh_day' },
  { label: 'Dire Marsh Night', value: 'dire_marsh_night' },
  { label: 'Dire Marsh PVP Lite', value: 'dire_marsh_pvp_lite' },
  { label: 'Outpost', value: 'outpost' },
  { label: 'Cryo Archive', value: 'cryo_archive' }
] as const;

const PLAYLIST_LABELS = Object.fromEntries(PLAYLIST_OPTIONS.map((option) => [option.value, option.label]));
const PLAYLIST_DETAILS = Object.fromEntries(PLAYLIST_OPTIONS.map((option) => [option.value, option]));
const SHELL_LABELS = Object.fromEntries(SHELL_OPTIONS.map((option) => [option.value, option.label]));
const MAP_LABELS = Object.fromEntries(MAP_OPTIONS.map((option) => [option.value, option.label]));

export function getPlaylistDetails(value: string) {
  return PLAYLIST_DETAILS[value] ?? PLAYLIST_OPTIONS[0];
}

export function formatPlaylist(value: string | null): string {
  return value ? PLAYLIST_LABELS[value] ?? value : 'Marathon';
}

export function formatMap(value: string): string {
  return MAP_LABELS[value] ?? value;
}

export function formatTag(tag: PartyTag): string {
  if (tag.tagKey === 'shell' && tag.tagValue) {
    return `Shell: ${SHELL_LABELS[tag.tagValue] ?? tag.tagValue}`;
  }

  if (tag.tagKey === 'map' && tag.tagValue) {
    return `Map: ${MAP_LABELS[tag.tagValue] ?? tag.tagValue}`;
  }

  return tag.tagValue ? `${tag.tagKey}:${tag.tagValue}` : tag.tagKey;
}
