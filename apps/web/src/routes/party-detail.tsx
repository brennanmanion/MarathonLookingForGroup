import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { cancelParty, getParty, joinParty, leaveParty, moderateMember } from '../api/parties';
import type { PartyMemberView, PartyView } from '../api/types';
import { useAuth } from '../app/auth';
import { useToast } from '../app/toasts';

function formatIdentityName(input: {
  globalDisplayName: string | null;
  globalDisplayNameCode: number | null;
  bungieDisplayName: string | null;
}): string {
  if (input.globalDisplayName) {
    if (input.globalDisplayNameCode !== null && !input.globalDisplayName.includes('#')) {
      return `${input.globalDisplayName}#${String(input.globalDisplayNameCode).padStart(4, '0')}`;
    }

    return input.globalDisplayName;
  }

  return input.bungieDisplayName ?? 'Unknown guardian';
}

function formatPartyPerson(party: PartyView): string {
  return formatIdentityName(party.host);
}

function formatMemberName(member: PartyMemberView): string {
  return formatIdentityName(member);
}

function statusBadgeClass(status: PartyView['status']): string {
  switch (status) {
    case 'open':
      return 'badge badge-positive';
    case 'full':
      return 'badge badge-warning';
    default:
      return 'badge badge-muted';
  }
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
  const { showToast } = useToast();
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
    onSuccess: async (result) => {
      await invalidateParty(queryClient, partyId);
      showToast({
        kind: 'success',
        message: result.myStatus === 'accepted' ? 'Joined party.' : 'Join request sent.'
      });
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to join party.'
      });
    }
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveParty(partyId),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
      showToast({
        kind: 'success',
        message: 'You left the party.'
      });
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to leave party.'
      });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelParty(partyId),
    onSuccess: async () => {
      await invalidateParty(queryClient, partyId);
      showToast({
        kind: 'success',
        message: 'Party cancelled.'
      });
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to cancel party.'
      });
    }
  });

  const moderationMutation = useMutation({
    mutationFn: ({ memberId, action }: { memberId: string; action: 'accept' | 'decline' | 'kick' }) =>
      moderateMember(partyId, memberId, action),
    onSuccess: async (result, variables) => {
      await invalidateParty(queryClient, partyId);
      const messageByAction: Record<typeof variables.action, string> = {
        accept: 'Player approved.',
        decline: 'Player declined.',
        kick: 'Player removed.'
      };
      showToast({
        kind: 'success',
        message: messageByAction[variables.action] ?? `Member updated to ${result.memberStatus}.`
      });
    },
    onError: (error) => {
      showToast({
        kind: 'error',
        message: error instanceof ApiError ? error.message : 'Unable to update member status.'
      });
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

  async function copyText(value: string, successMessage: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      showToast({
        kind: 'success',
        message: successMessage
      });
    } catch {
      showToast({
        kind: 'error',
        message: 'Unable to copy that Bungie name.'
      });
    }
  }

  const isHost = Boolean(me && party && me.userId === party.host.userId);
  const membershipStatus = party?.myMembership?.status ?? null;
  const approvedMembers = party?.members.filter((member) => member.status === 'accepted') ?? [];
  const pendingMembers = party?.members.filter((member) => member.status === 'pending') ?? [];
  const hostInviteName = party ? formatPartyPerson(party) : null;

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
            <span className={party ? statusBadgeClass(party.status) : 'badge badge-muted'}>
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
                party.status === 'open' ? (
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
                ) : (
                  <article className="notice">
                    <p className="meta">
                      {party.status === 'full'
                        ? 'This party is full right now. Watch for a slot to open or join a different group.'
                        : 'This party is not currently open for new members.'}
                    </p>
                  </article>
                )
              ) : null}

              {status === 'authenticated' && !isHost && (membershipStatus === 'pending' || membershipStatus === 'accepted') ? (
                <div className="stack">
                  <div className="button-row">
                    <span className={membershipStatus === 'accepted' ? 'badge badge-positive' : 'badge badge-warning'}>
                      Your status: {membershipStatus}
                    </span>
                    <button className="button button-danger" type="button" onClick={() => void leaveMutation.mutateAsync()}>
                      Leave party
                    </button>
                  </div>
                  {membershipStatus === 'pending' ? (
                    <article className="notice">
                      <p className="meta">
                        Your request is pending. Full Bungie names stay masked until the host approves you.
                      </p>
                    </article>
                  ) : null}
                  {membershipStatus === 'accepted' && hostInviteName ? (
                    <article className="guide-card">
                      <p className="route-tag">Next step</p>
                      <h3 className="card-title">You are approved</h3>
                      <p className="meta">
                        The app cannot complete the in-game Marathon crew invite for you. Use the host Bungie name below and finish the crew step manually in game.
                      </p>
                      <div className="copy-row">
                        <code className="copy-code">{hostInviteName}</code>
                        <button className="button button-secondary" type="button" onClick={() => void copyText(hostInviteName, 'Host Bungie name copied.')}>
                          Copy host Bungie name
                        </button>
                      </div>
                      <ol className="guide-list">
                        <li>Open Marathon and find the host using the Bungie name above.</li>
                        <li>Send the friend, crew, or join step manually in game.</li>
                        <li>Return here if the party changes or the host cancels.</li>
                      </ol>
                    </article>
                  ) : null}
                </div>
              ) : null}
            </article>

            {isHost ? (
              <div className="stack">
                <article className="card">
                  <p className="route-tag">Host moderation</p>
                  <h2 className="card-title">Pending requests</h2>
                  <div className="member-list">
                    {pendingMembers.length ? pendingMembers.map((member) => (
                      <article className="member-item" key={member.memberId}>
                        <div className="member-header">
                          <div>
                            <h3 className="member-name">{formatMemberName(member)}</h3>
                            <p className="meta">User {member.userId}</p>
                            {member.noteToHost ? <p className="meta">Note: {member.noteToHost}</p> : null}
                          </div>
                          <span className="badge badge-warning">{member.status}</span>
                        </div>
                        <div className="member-actions">
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
                          <button className="button button-danger" type="button" onClick={() => void moderationMutation.mutateAsync({
                            memberId: member.memberId,
                            action: 'kick'
                          })}>
                            Kick
                          </button>
                        </div>
                      </article>
                    )) : <p className="meta">No pending requests right now.</p>}
                  </div>
                </article>

                <article className="card">
                  <p className="route-tag">Approved players</p>
                  <h2 className="card-title">Manual invite step</h2>
                  <p className="meta">
                    The app cannot send the final in-game Marathon crew invite through the public API. Once a player is approved, use their Bungie name below and finish the invite manually in game.
                  </p>
                  <ol className="guide-list">
                    <li>Approve the player here.</li>
                    <li>Copy their Bungie name.</li>
                    <li>Find and invite them manually in Marathon.</li>
                  </ol>
                  <div className="member-list">
                    {approvedMembers.length ? approvedMembers.map((member) => {
                      const displayName = formatMemberName(member);

                      return (
                        <article className="member-item" key={member.memberId}>
                          <div className="member-header">
                            <div>
                              <h3 className="member-name">{displayName}</h3>
                              <p className="meta">User {member.userId}</p>
                            </div>
                            <span className="badge badge-positive">{member.status}</span>
                          </div>
                          <div className="copy-row">
                            <code className="copy-code">{displayName}</code>
                            <button className="button button-secondary" type="button" onClick={() => void copyText(displayName, 'Approved player Bungie name copied.')}>
                              Copy Bungie name
                            </button>
                            <button className="button button-danger" type="button" onClick={() => void moderationMutation.mutateAsync({
                              memberId: member.memberId,
                              action: 'kick'
                            })}>
                              Remove
                            </button>
                          </div>
                        </article>
                      );
                    }) : <p className="meta">No approved players yet.</p>}
                  </div>
                </article>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
