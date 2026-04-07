import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../api/client';
import { resyncBungie } from '../api/me';
import { useAuth } from '../app/auth';

export function ProfilePage() {
  const queryClient = useQueryClient();
  const { me, refreshBootstrap, logoutUser } = useAuth();

  const resyncMutation = useMutation({
    mutationFn: resyncBungie,
    onSuccess: async (payload) => {
      queryClient.setQueryData(['me'], payload);
      await refreshBootstrap();
    }
  });

  const errorMessage = resyncMutation.error instanceof ApiError
    ? resyncMutation.error.message
    : resyncMutation.error
      ? 'Unable to resync Bungie account.'
      : null;

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <p className="route-tag">GET /me</p>
          <h2 className="card-title">Your profile</h2>
          {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
          {me ? (
            <div className="detail-grid">
              <div className="detail-list">
                <div className="detail-row">
                  <span className="detail-label">Primary display name</span>
                  <span>{me.profile.primaryDisplayName}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Bungie membership</span>
                  <span>{me.bungie.membershipId ?? 'Missing'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Marathon membership</span>
                  <span>{me.marathon.membershipId ?? 'Missing'}</span>
                </div>
              </div>
              <div className="detail-list">
                <div className="detail-row">
                  <span className="detail-label">Bungie verified</span>
                  <span>{me.bungie.verified ? 'Yes' : 'No'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Marathon verified</span>
                  <span>{me.marathon.verified ? 'Yes' : 'No'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Last sync</span>
                  <span>{me.lastMembershipSyncAt ?? 'Not synced yet'}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="status-line">Loading profile...</p>
          )}
          <div className="button-row">
            {me?.capabilities.canUsePwaBungieResync ? (
              <button className="button button-secondary" type="button" onClick={() => void resyncMutation.mutateAsync()}>
                {resyncMutation.isPending ? 'Resyncing...' : 'Resync Bungie'}
              </button>
            ) : null}
            <button className="button button-danger" type="button" onClick={() => void logoutUser()}>
              Log out
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
