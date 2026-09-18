import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context';
import Layout from './components/Layout';
import Login from './pages/Login';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Dashboard from './pages/Dashboard';
import Complaints from './pages/Complaints';
import Campaigns from './pages/Campaigns';
import Coupons from './pages/Coupons';
import CouponDetail from './pages/CouponDetail';
import Products from './pages/Products';
import MarketSuppliers from './pages/MarketSuppliers';
import ProductsBySupplier from './pages/ProductsBySupplier';
import ProductEdit from './pages/ProductEdit';
import Categories from './pages/Categories';
import Settings from './pages/Settings';
import Markets from './pages/Markets';
import MarketSettings from './pages/MarketSettings';
import StaffAndCouriers from './pages/StaffAndCouriers';
import SorumluDetail from './pages/SorumluDetail';
import SupplierContract from './pages/SupplierContract';
import Logs from './pages/Logs';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Bu uygulama SADECE tam yetkili yönetici ("admin"/"yonetici") içindir - güvenlik
 * kararı: yönetici paketi hiçbir zaman başka bir kişiye (ör. Pazar Sorumlusu) verilmez,
 * o rol artık ayrı "saha" uygulamasında (/sorumlu). Başka bir rolle buraya giriş
 * denenirse (backend zaten engeller ama arayüzde de netleştir) hemen çıkış yaptır. */
function RequireYonetici({ children }: { children: React.ReactElement }) {
  const { user, logout } = useAuth();
  if (user && user.role !== 'admin' && user.role !== 'yonetici') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Bu uygulama sadece yönetici içindir</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Pazar Sorumlusu ve tedarikçi/kurye hesapları artık "saha" uygulamasından giriş yapıyor.
        </div>
        <button className="btn" onClick={logout}>Çıkış Yap</button>
      </div>
    );
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <RequireYonetici>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/orders/:txId" element={<OrderDetail />} />
                  <Route path="/members" element={<Members />} />
                  <Route path="/members/:userId" element={<MemberDetail />} />
                  <Route path="/complaints" element={<Complaints />} />
                  <Route path="/campaigns" element={<Campaigns />} />
                  <Route path="/coupons" element={<Coupons />} />
                  <Route path="/coupons/:couponId" element={<CouponDetail />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/products/market/:marketId" element={<MarketSuppliers />} />
                  <Route path="/products/:supplierGroup" element={<ProductsBySupplier />} />
                  <Route path="/products/:supplierGroup/:productId" element={<ProductEdit />} />
                  <Route path="/categories" element={<Categories />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/markets" element={<Markets />} />
                  <Route path="/markets/:marketId/settings" element={<MarketSettings />} />
                  <Route path="/staff" element={<StaffAndCouriers />} />
                  <Route path="/staff/sorumlu/:userId" element={<SorumluDetail />} />
                  <Route path="/supplier-contract" element={<SupplierContract />} />
                  <Route path="/logs" element={<Logs />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RequireYonetici>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
