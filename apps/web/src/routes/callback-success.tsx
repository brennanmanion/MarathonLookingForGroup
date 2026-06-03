import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../app/auth';

function safeReturnTo(candidate: string | null): string {
  if (!candidate || !candidate.startsWith('/app') || candidate.startsWith('//')) {
    return '/app/parties';
  }

  return candidate;
}

export function CallbackSuccessPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, refreshBootstrap } = useAuth();

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }

    const search = new URLSearchParams(location.search);
    navigate(safeReturnTo(search.get('returnTo')), {
      replace: true
    });
  }, [location.search, navigate, status]);

  if (status === 'authenticated') {
    return <Navigate to="/parties" replace />;
  }

  return (
    <section className="panel">
      <div className="panel-body">
        <article className="card">
          <p className="route-tag">/app/auth/callback/success</p>
          <h2 className="card-title">Finishing sign-in</h2>
          <p className="meta">The backend has already set the browser session. The client is now bootstrapping `/auth/session` and `/me`.</p>
        </article>
      </div>
    </section>
  );
}
