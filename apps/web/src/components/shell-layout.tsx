import { Link, NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../app/auth';

function navClassName(isActive: boolean) {
  return isActive ? 'nav-link nav-link-active' : 'nav-link';
}

export function ShellLayout() {
  const { me, status, logoutUser } = useAuth();

  return (
    <>
      <div className="background">
        <div className="glow glow-a"></div>
        <div className="glow glow-b"></div>
        <div className="grid"></div>
      </div>

      <main className="shell">
        <header className="masthead">
          <div>
            <p className="eyebrow">Marathon Looking For Group</p>
            <h1>
              <Link className="brand-link" to="/parties">
                Marathon LFG
              </Link>
            </h1>
          </div>

          <div className="masthead-side">
            <div className="pill-group">
              <span className="pill">React</span>
              <span className="pill">TypeScript</span>
              <span className="pill pill-muted">Vite</span>
            </div>
            <nav className="nav-row" aria-label="Primary">
              <NavLink className={({ isActive }) => navClassName(isActive)} to="/parties">
                Home
              </NavLink>
              <NavLink className={({ isActive }) => navClassName(isActive)} to="/parties/new">
                Create
              </NavLink>
              <NavLink className={({ isActive }) => navClassName(isActive)} to="/me">
                Profile
              </NavLink>
              {status === 'authenticated' ? (
                <button className="button button-secondary nav-button" type="button" onClick={() => void logoutUser()}>
                  Log out
                </button>
              ) : (
                <NavLink className={({ isActive }) => navClassName(isActive)} to="/login">
                  Sign in
                </NavLink>
              )}
            </nav>
            <div className="viewer-chip">
              {me ? me.profile.primaryDisplayName : 'Signed out'}
            </div>
          </div>
        </header>

        <Outlet />
      </main>
    </>
  );
}
