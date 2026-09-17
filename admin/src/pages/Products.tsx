import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/product-types';

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierGroups, setSupplierGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([api.get<Product[]>('/admin/products'), api.get<string[]>('/admin/supplier-groups')])
      .then(([p, s]) => {
        setProducts(p);
        setSupplierGroups(s);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  const counts: Record<string, number> = {};
  for (const p of products) {
    const g = p.supplier_group || 'Tanımsız';
    counts[g] = (counts[g] ?? 0) + 1;
  }
  // Kayıtlı tedarikçi listesinde olmayan ama ürünlerde geçen gruplar da (eski/silinmiş) gösterilsin.
  const allGroups = Array.from(new Set([...supplierGroups, ...Object.keys(counts)]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Ürünler {!loading && `(${products.length} çeşit)`}</h1>
        <Link to="/categories" className="btn btn-outline" style={{ padding: '8px 14px', textDecoration: 'none' }}>
          Kategoriler
        </Link>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Karttan içeri gir, sonra ürünleri yönet.</div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {allGroups.map((g) => (
          <Link key={g} to={`/products/${encodeURIComponent(g)}`} className="card" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 700 }}>{g}</div>
            <span className="badge badge-green">{counts[g] ?? 0} ürün</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
