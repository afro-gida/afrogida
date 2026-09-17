import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/product-types';
import type { Market } from '../lib/market-types';

interface CatalogConfig {
  suppliers: string[];
  supplier_markets: Record<string, string[]>;
  [key: string]: unknown;
}

export default function Products() {
  const [markets, setMarkets] = useState<Market[]>([]);
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
        setMarkets(mk);
        setProducts(p);
        setCatalog(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Pazarlar yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  function productCountForMarket(marketName: string) {
    const groups = (catalog?.suppliers ?? []).filter((g) => (catalog?.supplier_markets?.[g] ?? []).includes(marketName));
    return products.filter((p) => groups.includes(p.supplier_group ?? '')).length;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Ürünler</h1>
        <Link to="/categories" className="btn btn-outline" style={{ padding: '8px 14px', textDecoration: 'none' }}>
          Kategoriler
        </Link>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Bir pazara gir, sonra o pazarın tedarikçisini seç.</div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {markets.map((m) => (
          <Link
            key={m.id}
            to={`/products/market/${m.id}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.day}</div>
            </div>
            <span className="badge badge-green">{productCountForMarket(m.name)} ürün</span>
          </Link>
        ))}
        {!loading && markets.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Henüz pazar yok.</div>}
      </div>
    </div>
  );
}
