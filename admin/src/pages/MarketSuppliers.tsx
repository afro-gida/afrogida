import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/product-types';
import type { Market } from '../lib/market-types';

interface CatalogConfig {
  suppliers: string[];
  supplier_markets: Record<string, string[]>;
  [key: string]: unknown;
}

export default function MarketSuppliers() {
  const { marketId } = useParams<{ marketId: string }>();
  const [market, setMarket] = useState<Market | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<Market[]>('/admin/markets'),
      api.get<Product[]>('/admin/products'),
      api.get<CatalogConfig>('/admin/catalog-config'),
    ])
      .then(([mk, p, c]) => {
        setMarket(mk.find((m) => m.id === marketId) ?? null);
        setProducts(p);
        setCatalog(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, [marketId]);

  const marketName = market?.name ?? '';
  const suppliersHere = (catalog?.suppliers ?? []).filter((g) =>
    (catalog?.supplier_markets?.[g] ?? []).includes(marketName),
  );

  function productCount(group: string) {
    return products.filter((p) => p.supplier_group === group).length;
  }

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>;
  if (error) return <div className="error-text">{error}</div>;
  if (!market) return <div style={{ color: 'var(--text-muted)' }}>Pazar bulunamadı.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/products" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>{market.name}</h1>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Bu pazardaki tedarikçiyi seç, sonra ürünlerini yönet.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {suppliersHere.map((g) => (
          <Link
            key={g}
            to={`/products/${encodeURIComponent(g)}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ fontWeight: 700 }}>{g}</div>
            <span className="badge badge-green">{productCount(g)} ürün</span>
          </Link>
        ))}
        {suppliersHere.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            Bu pazarda henüz tedarikçi yok. Önce "Sorumlu/Kurye" sekmesinden bu pazara bir tedarikçi ata.
          </div>
        )}
      </div>
    </div>
  );
}
