import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { getParty, updateParty } from '../api/parties';
import { useAuth } from '../app/auth';
import {
  getPlaylistDetails,
  MAP_OPTIONS,
  PLAYLIST_OPTIONS,
  SHELL_OPTIONS,
  shellTagsFromValues,
  shellValuesFromTags
} from '../app/party-options';
import { useToast } from '../app/toasts';

export function PartyEditPage() {
  const { partyId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const { showToast } = useToast();
  const [selectedPlaylistKey, setSelectedPlaylistKey] = useState<string>(PLAYLIST_OPTIONS[0].value);

  const partyQuery = useQuery({
    queryKey: ['party', partyId],
    queryFn: () => getParty(partyId),
    enabled: partyId.length > 0
  });

  const party = partyQuery.data;
  const selectedPlaylist = getPlaylistDetails(selectedPlaylistKey);
  const shellValues = party ? shellValuesFromTags(party.tags) : [];
  const isHost = Boolean(me && party && me.userId === party.host.userId);

  useEffect(() => {
    if (party?.playlistKey) {
      setSelectedPlaylistKey(party.playlistKey);
    }
  }, [party?.playlistKey]);

  const mutation = useMutation({
    mutationFn: (formData: FormData) => {
      const playlistKey = String(formData.get('playlistKey') ?? PLAYLIST_OPTIONS[0].value).trim();
      const playlist = getPlaylistDetails(playlistKey);
      const description = String(formData.get('description') ?? '').trim();
      const requirementText = String(formData.get('requirementText') ?? '').trim();
      const shellOne = String(formData.get('shellOne') ?? '').trim();
      const shellTwo = playlist.shellSlots > 1 ? String(formData.get('shellTwo') ?? '').trim() : '';

      return updateParty(partyId, {
        title: String(formData.get('title') ?? '').trim(),
        activityKey: String(formData.get('activityKey') ?? MAP_OPTIONS[0].value).trim(),
        playlistKey,
        maxSize: playlist.maxSize,
        voiceRequired: formData.get('voiceRequired') === 'on',
        description: description || null,
        requirementText: requirementText || null,
        tags: shellTagsFromValues([shellOne, shellTwo])
      });
    },
    onSuccess: async (updatedParty) => {
      queryClient.setQueryData(['party', updatedParty.partyId], updatedParty);
      await queryClient.invalidateQueries({ queryKey: ['parties'] });
      showToast({
        kind: 'success',
        message: 'Party updated.'
      });
      await navigate(`/parties/${updatedParty.partyId}`);
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to update party.'
      });
    }
  });

  const errorMessage = mutation.error instanceof ApiError
    ? mutation.error.message
    : mutation.error
      ? 'Unable to update party.'
      : null;

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <p className="route-tag">PATCH /parties/:partyId</p>
          <h2 className="card-title">Edit party</h2>
          {partyQuery.isLoading ? <p className="status-line">Loading party...</p> : null}
          {partyQuery.isError ? <p className="notice notice-error">Unable to load this party.</p> : null}
          {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
          {party && !isHost ? (
            <p className="notice notice-error">Only the host can edit this party.</p>
          ) : null}

          {party && isHost ? (
            <form className="form-grid" onSubmit={(event) => {
              event.preventDefault();
              void mutation.mutateAsync(new FormData(event.currentTarget));
            }}>
              <label className="field">
                <span>Title</span>
                <input name="title" type="text" maxLength={120} defaultValue={party.title} required />
              </label>
              <label className="field">
                <span>Mode</span>
                <select
                  name="playlistKey"
                  value={selectedPlaylistKey}
                  required
                  onChange={(event) => setSelectedPlaylistKey(event.currentTarget.value)}
                >
                  {PLAYLIST_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Map</span>
                <select name="activityKey" defaultValue={party.activityKey} required>
                  {MAP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Preferred shell 1</span>
                <select name="shellOne" defaultValue={shellValues[0] ?? ''}>
                  {SHELL_OPTIONS.map((option) => (
                    <option key={option.value || 'any'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPlaylist.shellSlots > 1 ? (
                <label className="field">
                  <span>Preferred shell 2</span>
                  <select name="shellTwo" defaultValue={shellValues[1] ?? ''}>
                    {SHELL_OPTIONS.map((option) => (
                      <option key={option.value || 'any'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field checkbox-field">
                <input name="voiceRequired" type="checkbox" defaultChecked={party.voiceRequired} />
                <span>Mic required</span>
              </label>
              <label className="field field-full">
                <span>Description</span>
                <textarea name="description" rows={3} defaultValue={party.description ?? ''} />
              </label>
              <label className="field field-full">
                <span>Requirement text</span>
                <input name="requirementText" type="text" maxLength={160} defaultValue={party.requirementText ?? ''} />
              </label>
              <div className="button-row">
                <button className="button" type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Saving...' : 'Save changes'}
                </button>
                <Link className="button button-secondary" to={`/parties/${party.partyId}`}>
                  Cancel
                </Link>
              </div>
            </form>
          ) : null}
        </article>
      </div>
    </section>
  );
}
