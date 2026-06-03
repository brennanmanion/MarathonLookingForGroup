import { Link, useLocation } from 'react-router-dom';

function describeErrorCode(code: string | null): string {
  switch (code) {
    case 'access_denied':
      return 'Bungie login was cancelled before the backend could finish sign-in.';
    case 'bungie_state_invalid':
      return 'The Bungie OAuth state was missing or expired. Start sign-in again.';
    default:
      return 'The backend could not complete Bungie sign-in.';
  }
}

export function CallbackErrorPage() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const code = search.get('code');

  return (
    <section className="panel">
      <div className="panel-body">
        <article className="card">
          <p className="route-tag">/app/auth/callback/error</p>
          <h2 className="card-title">Sign-in failed</h2>
          <p className="meta">{describeErrorCode(code)}</p>
          {code ? <p className="detail-label">Error code: {code}</p> : null}
          <div className="button-row">
            <Link className="button" to="/login">
              Try again
            </Link>
            <Link className="button button-secondary" to="/parties">
              Back to parties
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
