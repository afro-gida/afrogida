import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export default function YoneticiLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ minHeight: '100%', width: '100%', maxWidth: '100vw', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--surface-border)',
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Pazar Sorumlusu</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{user?.name ?? '—'}</div>
        </div>
        <button
          className="btn"
          style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', padding: 10, borderRadius: '50%' }}
          onClick={handleLogout}
          title="Çıkış yap"
          aria-label="Çıkış yap"
        >
          ⎋
        </button>
      </header>
      <main style={{ flex: 1, padding: 20, minWidth: 0, overflowX: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  );
}
