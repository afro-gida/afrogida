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
import Categories from './pages/Categories';
import Settings from './pages/Settings';
import Markets from './pages/Markets';
import MarketSettings from './pages/MarketSettings';
import StaffAndCouriers from './pages/StaffAndCouriers';
import SorumluDetail from './pages/SorumluDetail';
import YoneticiLayout from './components/YoneticiLayout';
import YoneticiHome from './pages/YoneticiHome';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** DİKKAT: "yonetici" bu projede GERÇEK admin rolüdür (tam yetkili tek hesap türü) —
 * karıştırmayın. Yeni, kısıtlı rolün adı "pazar_sorumlusu" — sadece kendi pazarındaki
 * tedarikçileri yönetebilir, bu yüzden tamamen ayrı, dar kapsamlı bir arayüz görür. */
const PAZAR_SORUMLUSU_ROLE = 'pazar_sorumlusu';

function RoleRouter({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (user?.role === PAZAR_SORUMLUSU_ROLE) {
    return (
      <Routes>
        <Route element={<YoneticiLayout />}>
          <Route path="/" element={<YoneticiHome />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
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
            <RoleRouter>
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
                  <Route path="/categories" element={<Categories />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/markets" element={<Markets />} />
                  <Route path="/markets/:marketId/settings" element={<MarketSettings />} />
                  <Route path="/staff" element={<StaffAndCouriers />} />
                  <Route path="/staff/sorumlu/:userId" element={<SorumluDetail />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RoleRouter>
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
