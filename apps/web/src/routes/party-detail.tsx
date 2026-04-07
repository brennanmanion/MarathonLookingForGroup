import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { cancelParty, getParty, joinParty, leaveParty, moderateMember } from '../api/parties';
import type { PartyMemberView, PartyView } from '../api/types';
import { useAuth } from '../app/auth';

function formatPartyPerson(party: PartyView): string {
  const host = party.host;

  if (host.globalDisplayName) {
    if (host.globalDisplayNameCode !== null && !host.globalDisplayName.includes('#')) {
      return `${host.globalDisplayName}#${String(host.globalDisplayNameCode).padStart(4, '0')}`;
    }

    return host.globalDisplayName;
  }

  return host.bungieDisplayName ?? 'Unknown host';
}

function formatMemberName(member: PartyMemberView): string {
  if (member.globalDisplayName) {
    if (member.globalDisplayNameCode !== null && !member.globalDisplayName.includes('#')) {
      return `${member.globalDisplayName}#${String(member.globalDisplayNameCode).padStart(4, '0')}`;
    }

    return member.globalDisplayName;
  }

  return member.bungieDisplayName ?? member.userId;
}

function invalidateParty(queryClient: ReturnType<typeof useQueryClient>, partyId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['parties'] }),
    queryClient.invalidateQueries({ queryKey: ['party', partyId] }),
    queryClient.invalidateQueries({ queryKey: ['me'] })
  ]);
}

export function PartyDetailPage() {
  const { partyId = '' } = useParams();
  const { me, status } = useAuth();
  const queryClient = useQueryClient();
  const partyQuery = useQuery({
    queryKey: ['party', partyId],
    queryFn: () => getParty(partyId),
    enabled: partyId.length > 0
  });

  const joinMutation = useMutation({
    mutationFn: (noteToHost: string) => joinParty(
      partyId,
      noteToHost ? { noteToHost } : {}
    ),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
    }
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveParty(partyId),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelParty(partyId),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
    }
  });

  const moderationMutation = useMutation({
    mutationFn: ({ memberId, action }: { memberId: string; action: 'accept' | 'decline' | 'kick' }) =>
      moderateMember(partyId, memberId, action),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
    }
  });

  const party = partyQuery.data;
  const errorMessage = [joinMutation.error, leaveMutation.error, cancelMutation.error, moderationMutation.error]
    .filter(Boolean)
    .map((error) => error instanceof ApiError ? error.message : 'Request failed')[0] ?? null;

  async function handleJoinSubmit(formData: FormData) {
    const note = String(formData.get('noteToHost') ?? '').trim();
    await joinMutation.mutateAsync(note);
  }

  const isHost = Boolean(me && party && me.userId === party.host.userId);
  const membershipStatus = party?.myMembership?.status ?? null;

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <div className="feed-heading">
            <div>
              <p className="route-tag">GET /parties/:partyId</p>
              <h2 className="card-title">{party?.title ?? 'Party detail'}</h2>
              <p className="meta">
                {party ? `${party.activityKey} · Host ${formatPartyPerson(party)}` : 'Loading party details.'}
              </p>
            </div>
            <span className={party?.status === 'open' ? 'badge badge-positive' : 'badge badge-muted'}>
              {party?.status ?? 'loading'}
            </span>
          </div>
          {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
          {partyQuery.isLoading ? <p className="status-line">Loading party...</p> : null}
          {partyQuery.isError ? <p className="notice notice-error">Unable to load this party.</p> : null}
        </article>

        {party ? (
          <>
            <article className="card">
              <div className="detail-grid">
                <div className="detail-list">
                  <div className="detail-row">
                    <span className="detail-label">Capacity</span>
                    <span>{party.filledSlots}/{party.maxSize} slots</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Approval</span>
                    <span>{party.approvalMode}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Visibility</span>
                    <span>{party.visibility}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Scheduled</span>
                    <span>{party.scheduledFor ?? 'Not scheduled'}</span>
                  </div>
                </div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span className="detail-label">Requirements</span>
                    <span>{party.requirementText ?? 'No explicit requirement text yet.'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Description</span>
                    <span>{party.description ?? 'No description yet.'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Tags</span>
                    <div className="badge-row">
                      {party.tags.length ? party.tags.map((tag) => (
                        <span className="badge" key={`${tag.tagKey}:${tag.tagValue ?? ''}`}>
                          {tag.tagValue ? `${tag.tagKey}:${tag.tagValue}` : tag.tagKey}
                        </span>
                      )) : <span className="badge badge-muted">No tags</span>}
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className="card">
              <p className="route-tag">Party actions</p>
              <h2 className="card-title">Interact with this party</h2>
              {status !== 'authenticated' ? (
                <>
                  <p className="meta">Reads stay public. Sign in before joining, leaving, or hosting.</p>
                  <div className="button-row">
                    <Link className="button" to={`/login?returnTo=${encodeURIComponent(`/app/parties/${party.partyId}`)}`}>
                      Continue with Bungie
                    </Link>
                  </div>
                </>
              ) : null}

              {status === 'authenticated' && isHost ? (
                <div className="button-row">
                  {party.status !== 'cancelled' ? (
                    <button className="button button-danger" type="button" onClick={() => void cancelMutation.mutateAsync()}>
                      Cancel party
                    </button>
                  ) : null}
                </div>
              ) : null}

              {status === 'authenticated' && !isHost && membershipStatus !== 'pending' && membershipStatus !== 'accepted' ? (
                <form className="form-grid" onSubmit={(event) => {
                  event.preventDefault();
                  void handleJoinSubmit(new FormData(event.currentTarget));
                }}>
                  <label className="field field-full">
                    <span>Note to host</span>
                    <textarea name="noteToHost" rows={3} placeholder="Quick note for the host." />
                  </label>
                  <div className="button-row">
                    <button className="button" type="submit" disabled={joinMutation.isPending}>
                      {joinMutation.isPending ? 'Joining...' : 'Join party'}
                    </button>
                  </div>
                </form>
              ) : null}

              {status === 'authenticated' && !isHost && (membershipStatus === 'pending' || membershipStatus === 'accepted') ? (
                <div className="button-row">
                  <span className="badge badge-warning">Your status: {membershipStatus}</span>
                  <button className="button button-danger" type="button" onClick={() => void leaveMutation.mutateAsync()}>
                    Leave party
                  </button>
                </div>
              ) : null}
            </article>

            {isHost ? (
              <article className="card">
                <p className="route-tag">Host moderation</p>
                <h2 className="card-title">Member roster</h2>
                <div className="member-list">
                  {party.members.length ? party.members.map((member) => {
                    const isPending = member.status === 'pending';

                    return (
                      <article className="member-item" key={member.memberId}>
                        <div className="member-header">
                          <div>
                            <h3 className="member-name">{formatMemberName(member)}</h3>
                            <p className="meta">User {member.userId}</p>
                            {member.noteToHost ? <p className="meta">Note: {member.noteToHost}</p> : null}
                          </div>
                          <span className={isPending ? 'badge badge-warning' : 'badge badge-positive'}>
                            {member.status}
                          </span>
                        </div>
                        <div className="member-actions">
                          {isPending ? (
                            <>
                              <button className="button" type="button" onClick={() => void moderationMutation.mutateAsync({
                                memberId: member.memberId,
                                action: 'accept'
                              })}>
                                Accept
                              </button>
                              <button className="button button-secondary" type="button" onClick={() => void moderationMutation.mutateAsync({
                                memberId: member.memberId,
                                action: 'decline'
                              })}>
                                Decline
                              </button>
                            </>
                          ) : null}
                          <button className="button button-danger" type="button" onClick={() => void moderationMutation.mutateAsync({
                            memberId: member.memberId,
                            action: 'kick'
                          })}>
                            Kick
                          </button>
                        </div>
                      </article>
                    );
                  }) : <p className="meta">No pending or accepted members yet.</p>}
                </div>
              </article>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
