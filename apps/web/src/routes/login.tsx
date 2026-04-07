import { useLocation, Navigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useAuth } from '../app/auth';

function safeReturnTo(candidate: string | null): string {
  if (!candidate || !candidate.startsWith('/app') || candidate.startsWith('//')) {
    return '/app/parties';
  }

  return candidate;
}

export function LoginPage() {
  const location = useLocation();
  const { status, beginLogin, errorMessage } = useAuth();

  if (status === 'authenticated') {
    return <Navigate to="/parties" replace />;
  }

  const search = new URLSearchParams(location.search);
  const returnTo = safeReturnTo(search.get('returnTo'));

  async function handleLogin() {
    try {
      await beginLogin(returnTo);
    } catch (error) {
      if (error instanceof ApiError) {
        window.alert(error.message);
        return;
      }

      window.alert('Unable to start Bungie login.');
    }
  }

  return (
    <section className="panel">
      <div className="panel-body stack">
        <article className="card">
          <p className="route-tag">POST /auth/bungie/start</p>
          <h2 className="card-title">Sign in with Bungie</h2>
          <p className="meta">
            The browser client uses the same backend Bungie callback as the native flow, but completes into secure cookies instead of a handoff ticket.
          </p>
          {errorMessage ? <p className="notice notice-error">{errorMessage}</p> : null}
          <div className="button-row">
            <button className="button" type="button" onClick={() => void handleLogin()}>
              Continue with Bungie
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
