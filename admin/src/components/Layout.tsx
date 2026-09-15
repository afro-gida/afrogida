import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

const NAV_LINK_STYLE = ({ isActive }: { isActive: boolean }) => ({
  padding: '8px 14px',
  borderRadius: 999,
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 600,
  color: isActive ? '#06150c' : 'var(--text)',
  background: isActive ? 'var(--primary)' : 'transparent',
  whiteSpace: 'nowrap' as const,
  flexShrink: 0,
});

export default function Layout() {
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
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Yönetici Paneli</div>
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
      <nav
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 20px',
          borderBottom: '1px solid var(--surface-border)',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          minWidth: 0,
        }}
      >
        <NavLink to="/" end style={NAV_LINK_STYLE}>
          Ana Sayfa
        </NavLink>
        <NavLink to="/orders" style={NAV_LINK_STYLE}>
          Siparişler
        </NavLink>
        <NavLink to="/members" style={NAV_LINK_STYLE}>
          Üyeler
        </NavLink>
        <NavLink to="/staff" style={NAV_LINK_STYLE}>
          Sorumlu/Kurye
        </NavLink>
        <NavLink to="/complaints" style={NAV_LINK_STYLE}>
          Şikayet/Öneri
        </NavLink>
        <NavLink to="/campaigns" style={NAV_LINK_STYLE}>
          Kampanyalar
        </NavLink>
        <NavLink to="/coupons" style={NAV_LINK_STYLE}>
          Kuponlar
        </NavLink>
        <NavLink to="/products" style={NAV_LINK_STYLE}>
          Ürünler
        </NavLink>
        <NavLink to="/markets" style={NAV_LINK_STYLE}>
          Pazarlar
        </NavLink>
        <NavLink to="/settings" style={NAV_LINK_STYLE}>
          Ayarlar
        </NavLink>
      </nav>
      <main style={{ flex: 1, padding: 20, minWidth: 0, overflowX: 'hidden' }}>
        <Outlet />
      </main>
    </div>
  );
}
