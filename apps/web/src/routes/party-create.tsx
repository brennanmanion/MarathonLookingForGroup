import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { createParty } from '../api/parties';
import { useAuth } from '../app/auth';
import { useToast } from '../app/toasts';

const SHELL_OPTIONS = [
  { label: 'Any shell', value: '' },
  { label: 'Destroyer', value: 'destroyer' },
  { label: 'Vandal', value: 'vandal' },
  { label: 'Recon', value: 'recon' },
  { label: 'Assassin', value: 'assassin' },
  { label: 'Triage', value: 'triage' },
  { label: 'Thief', value: 'thief' },
  { label: 'Sentinel', value: 'sentinel' }
] as const;

export function PartyCreatePage() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { showToast } = useToast();

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
            const shell = String(form.get('shell') ?? '').trim();
            const voiceRequired = form.get('voiceRequired') === 'on';

            void mutation.mutateAsync({
              title: String(form.get('title') ?? '').trim(),
              activityKey: String(form.get('activityKey') ?? 'marathon'),
              maxSize: Number(form.get('maxSize') ?? 3),
              voiceRequired,
              ...(description ? { description } : {}),
              ...(requirementText ? { requirementText } : {}),
              ...(shell ? { tags: [{ tagKey: 'shell', tagValue: shell }] } : {})
            });
          }}>
            <label className="field">
              <span>Title</span>
              <input name="title" type="text" maxLength={120} placeholder="Shield run in 10" required />
            </label>
            <label className="field">
              <span>Activity key</span>
              <input name="activityKey" type="text" defaultValue="marathon" required />
            </label>
            <label className="field">
              <span>Max size</span>
              <input name="maxSize" type="number" min={2} max={6} defaultValue={3} required />
            </label>
            <label className="field">
              <span>Preferred shell</span>
              <select name="shell" defaultValue="">
                {SHELL_OPTIONS.map((option) => (
                  <option key={option.value || 'any'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
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
