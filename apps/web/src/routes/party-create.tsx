import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createParty } from '../api/parties';
import { useAuth } from '../app/auth';
import { getPlaylistDetails, MAP_OPTIONS, PLAYLIST_OPTIONS, SHELL_OPTIONS } from '../app/party-options';
import { useToast } from '../app/toasts';

export function PartyCreatePage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { showToast } = useToast();
  const [selectedPlaylistKey, setSelectedPlaylistKey] = useState<string>(PLAYLIST_OPTIONS[0].value);
  const selectedPlaylist = getPlaylistDetails(selectedPlaylistKey);

  const mutation = useMutation({
    mutationFn: createParty,
    onSuccess: async (result) => {
      showToast({
        kind: 'success',
        message: 'Party created.'
      });
      await navigate(`/parties/${result.partyId}`);
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to create party.'
      });
    }
  });

  const errorMessage = mutation.error instanceof ApiError
    ? mutation.error.message
    : mutation.error
      ? 'Unable to create party.'
      : null;

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <p className="route-tag">POST /parties</p>
          <h2 className="card-title">Create a party</h2>
          <p className="meta">
            This first React cut only exposes fields the backend already supports. Party editing still remains deferred.
          </p>
          {!me?.capabilities.canCreateParty ? (
            <p className="notice notice-error">This account cannot create parties until Marathon verification succeeds.</p>
          ) : null}
          {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();

            const form = new FormData(event.currentTarget);
            const description = String(form.get('description') ?? '').trim();
            const requirementText = String(form.get('requirementText') ?? '').trim();
            const playlistKey = String(form.get('playlistKey') ?? PLAYLIST_OPTIONS[0].value).trim();
            const playlist = getPlaylistDetails(playlistKey);
            const activityKey = String(form.get('activityKey') ?? MAP_OPTIONS[0].value).trim();
            const shellOne = String(form.get('shellOne') ?? '').trim();
            const shellTwo = playlist.shellSlots > 1 ? String(form.get('shellTwo') ?? '').trim() : '';
            const voiceRequired = form.get('voiceRequired') === 'on';
            const selectedShells = Array.from(new Set([shellOne, shellTwo].filter(Boolean)));
            const tags = selectedShells.map((shell) => ({ tagKey: 'shell', tagValue: shell }));

            void mutation.mutateAsync({
              title: String(form.get('title') ?? '').trim(),
              activityKey,
              playlistKey,
              maxSize: playlist.maxSize,
              voiceRequired,
              ...(description ? { description } : {}),
              ...(requirementText ? { requirementText } : {}),
              ...(tags.length ? { tags } : {})
            });
          }}>
            <label className="field">
              <span>Title</span>
              <input name="title" type="text" maxLength={120} placeholder="Shield run in 10" required />
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
              <select name="activityKey" defaultValue={MAP_OPTIONS[0].value} required>
                {MAP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Preferred shell 1</span>
              <select name="shellOne" defaultValue="">
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
                <select name="shellTwo" defaultValue="">
                  {SHELL_OPTIONS.map((option) => (
                    <option key={option.value || 'any'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field checkbox-field">
              <input name="voiceRequired" type="checkbox" />
              <span>Mic required</span>
            </label>
            <label className="field field-full">
              <span>Description</span>
              <textarea name="description" rows={3} placeholder="Short callout for the run." />
            </label>
            <label className="field field-full">
              <span>Requirement text</span>
              <input name="requirementText" type="text" maxLength={160} placeholder="Bring shields and mic." />
            </label>
            <div className="button-row">
              <button className="button" type="submit" disabled={mutation.isPending || !me?.capabilities.canCreateParty}>
                {mutation.isPending ? 'Creating...' : 'Create party'}
              </button>
            </div>
          </form>
        </article>
      </div>
    </section>
  );
}
