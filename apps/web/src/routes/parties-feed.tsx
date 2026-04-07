import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { listParties } from '../api/parties';
import type { PartyTag, PartyView } from '../api/types';
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

function formatTag(tag: PartyTag): string {
  return tag.tagValue ? `${tag.tagKey}:${tag.tagValue}` : tag.tagKey;
}

function formatCapacity(party: PartyView): string {
  return `${party.filledSlots}/${party.maxSize} slots`;
}

function describeVerification(party: PartyView): string {
  return party.requiresMarathonVerified ? 'Marathon verified required' : 'Open to unverified players';
}

export function PartiesFeedPage() {
  const { me, status } = useAuth();
  const partiesQuery = useQuery({
    queryKey: ['parties'],
    queryFn: listParties
  });

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <p className="route-tag">GET /parties</p>
          <h2 className="card-title">Party feed</h2>
          <p className="meta">
            This stays public. Party mutations happen on detail and create routes with the same cookie-authenticated backend session.
          </p>
          <div className="badge-row">
            {status === 'authenticated' && me ? (
              <>
                <span className={me.marathon.verified ? 'badge badge-positive' : 'badge badge-warning'}>
                  {me.marathon.verified ? 'Marathon verified' : 'Marathon verification missing'}
                </span>
                <span className={me.capabilities.canUsePwaPartyWrites ? 'badge badge-positive' : 'badge badge-warning'}>
                  {me.capabilities.canUsePwaPartyWrites ? 'Browser party writes enabled' : 'Browser party writes locked'}
                </span>
              </>
            ) : (
              <span className="badge badge-muted">Browsing anonymously</span>
            )}
          </div>
          <div className="button-row">
            {status === 'authenticated' ? (
              <Link className="button" to="/parties/new">
                Create party
              </Link>
            ) : (
              <Link className="button" to="/login">
                Continue with Bungie
              </Link>
            )}
          </div>
        </article>

        <article className="card">
          {partiesQuery.isLoading ? <p className="status-line">Loading parties...</p> : null}
          {partiesQuery.isError ? (
            <p className="notice notice-error">Unable to load parties right now.</p>
          ) : null}
          <div className="feed-list">
            {partiesQuery.data?.items.length ? partiesQuery.data.items.map((party) => (
              <article className="feed-item" key={party.partyId}>
                <div className="feed-heading">
                  <div>
                    <h3 className="feed-title">{party.title}</h3>
                    <p className="feed-subtitle">
                      {party.activityKey} · Host {formatPartyPerson(party)}
                    </p>
                  </div>
                  <span className={party.status === 'open' ? 'badge badge-positive' : 'badge badge-muted'}>
                    {party.status}
                  </span>
                </div>
                <div className="feed-meta">
                  <span className="badge">{formatCapacity(party)}</span>
                  <span className="badge">{describeVerification(party)}</span>
                  {party.myMembership ? (
                    <span className="badge badge-warning">Your status: {party.myMembership.status}</span>
                  ) : null}
                  {party.tags.map((tag) => (
                    <span className="badge" key={`${tag.tagKey}:${tag.tagValue ?? ''}`}>
                      {formatTag(tag)}
                    </span>
                  ))}
                </div>
                <div className="feed-actions">
                  <Link className="button button-secondary" to={`/parties/${party.partyId}`}>
                    Open party
                  </Link>
                </div>
              </article>
            )) : null}
            {partiesQuery.data && partiesQuery.data.items.length === 0 ? (
              <article className="feed-item">
                <h3 className="feed-title">No public parties yet</h3>
                <p className="feed-subtitle">Once the frontend grows, pagination, filtering, and sorting will layer onto this feed.</p>
              </article>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
