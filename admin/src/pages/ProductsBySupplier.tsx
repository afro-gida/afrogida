import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, BACKEND_ORIGIN } from '../lib/api';
import type { Product } from '../lib/product-types';
import { formatMoney } from '../lib/format';

function imageSrc(url?: string | null) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
}

function profit(p: Product) {
  const sell = p.sale_price ?? p.price ?? 0;
  const buy = p.supplier_price ?? 0;
  if (p.profit_margin_amount) return p.profit_margin_amount;
  return sell - buy;
}

export default function ProductsBySupplier() {
  const { supplierGroup } = useParams<{ supplierGroup: string }>();
  const group = decodeURIComponent(supplierGroup ?? '');
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Product[]>('/admin/products')
      .then((p) => setProducts(p.filter((x) => (x.supplier_group || 'Tanımsız') === group)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [group]);

  async function remove(id: string) {
    try {
      await api.del(`/admin/products/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(-1)} className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </button>
        <h1 style={{ fontSize: 20, margin: 0 }}>{group}</h1>
      </div>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/products/${encodeURIComponent(group)}/yeni`)}>
        + Ürün Ekle
      </button>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {products.map((p) => (
          <div key={p.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {p.image_url && (
                <img src={imageSrc(p.image_url)} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div>
                <div style={{ fontWeight: 700 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {p.subcategory} › {p.category} · {p.unit}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Alış: {formatMoney(p.supplier_price)} · Satış: {formatMoney(p.sale_price ?? p.price)} ·{' '}
                  <span style={{ color: 'var(--primary)' }}>Kâr: {formatMoney(profit(p))}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  {!p.in_stock && <span className="badge badge-red">Stok Yok</span>}
                  {!!p.campaign_discount_percent && (
                    <span className="badge badge-orange">%{p.campaign_discount_percent} kampanya</span>
                  )}
                  {!!p.customization_options?.length && (
                    <span className="badge badge-muted">{p.customization_options.length} seçenek grubu</span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => navigate(`/products/${encodeURIComponent(group)}/${p.id}`)}>Düzenle</button>
              <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => remove(p.id)}>Sil</button>
            </div>
          </div>
        ))}
        {!loading && products.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>Bu tedarikçiye bağlı ürün yok.</div>
        )}
      </div>
    </div>
  );
}
