import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { queryClient } from './query-client';
import { AuthProvider, useAuth } from './auth';
import { ShellLayout } from '../components/shell-layout';
import { CallbackErrorPage } from '../routes/callback-error';
import { CallbackSuccessPage } from '../routes/callback-success';
import { LoginPage } from '../routes/login';
import { PartiesFeedPage } from '../routes/parties-feed';
import { PartyCreatePage } from '../routes/party-create';
import { PartyDetailPage } from '../routes/party-detail';
import { ProfilePage } from '../routes/profile';

function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'booting') {
    return (
      <section className="panel">
        <div className="panel-body">
          <article className="card">
            <p className="status-line">Bootstrapping session...</p>
          </article>
        </div>
      </section>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function RootRedirect() {
  return <Navigate to="/parties" replace />;
}

function AppRoutes() {
  const { status, errorMessage } = useAuth();

  return (
    <>
      {status === 'error' && errorMessage ? (
        <section className="panel">
          <div className="panel-body">
            <article className="card">
              <h2 className="card-title">Frontend bootstrap error</h2>
              <p className="notice notice-error">{errorMessage}</p>
            </article>
          </div>
        </section>
      ) : null}
      <Routes>
        <Route element={<ShellLayout />}>
          <Route index element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback/success" element={<CallbackSuccessPage />} />
          <Route path="/auth/callback/error" element={<CallbackErrorPage />} />
          <Route path="/parties" element={<PartiesFeedPage />} />
          <Route path="/parties/:partyId" element={<PartyDetailPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/parties/new" element={<PartyCreatePage />} />
            <Route path="/me" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/parties" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/app">
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
