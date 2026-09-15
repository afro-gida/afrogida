import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { Product } from '../lib/product-types';
import type { Market } from '../lib/market-types';

interface PazarSorumlusuSupplier {
  supplier_group: string;
  markets: string[]; // hangi (kendi) pazarlarında aktif
}

function profit(p: Product) {
  const sell = p.sale_price ?? p.price ?? 0;
  const buy = p.supplier_price ?? 0;
  if (p.profit_margin_amount) return p.profit_margin_amount;
  return sell - buy;
}

export default function YoneticiHome() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [suppliers, setSuppliers] = useState<PazarSorumlusuSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [supplierGroup, setSupplierGroup] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([
      api.get<Market[]>('/pazar-sorumlusu/markets'),
      api.get<PazarSorumlusuSupplier[]>('/pazar-sorumlusu/suppliers'),
    ])
      .then(([m, s]) => {
        setMarkets(m);
        setSuppliers(s);
        if (m.length === 1) setSelectedMarketId(m[0].id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function marketName(id: string) {
    return markets.find((m) => m.id === id)?.name ?? id;
  }

  async function assign() {
    if (!supplierGroup.trim() || !selectedMarketId) {
      setFormError('Tedarikçi adı ve pazar seçin');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/pazar-sorumlusu/suppliers/assign', {
        supplier_group: supplierGroup.trim(),
        market_id: selectedMarketId,
      });
      setSupplierGroup('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Atanamadı');
    } finally {
      setSaving(false);
    }
  }

  async function unassign(supplierGroupName: string, marketId: string) {
    try {
      await api.post('/pazar-sorumlusu/suppliers/unassign', { supplier_group: supplierGroupName, market_id: marketId });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    }
  }

  async function toggleProducts(group: string) {
    if (expandedGroup === group) {
      setExpandedGroup(null);
      setProducts(null);
      return;
    }
    setExpandedGroup(group);
    setProducts(null);
    try {
      const p = await api.get<Product[]>(`/pazar-sorumlusu/suppliers/${encodeURIComponent(group)}/products`);
      setProducts(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Pazarım</h1>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {markets.map((m) => (
          <span key={m.id} className="badge badge-green">{m.name}</span>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Tedarikçiyi Pazara Bağla</div>
        <div className="field">
          <label>Tedarikçi Adı</label>
          <input value={supplierGroup} onChange={(e) => setSupplierGroup(e.target.value)} placeholder="Örn: Afro Sebze" />
        </div>
        {markets.length > 1 && (
          <div className="field">
            <label>Pazar</label>
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              style={{ background: '#0a130e', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
            >
              <option value="">Seçiniz…</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
        {formError && <div className="error-text">{formError}</div>}
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={saving} onClick={assign}>
          {saving ? 'Kaydediliyor…' : 'Bağla'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {suppliers.map((s) => (
          <div key={s.supplier_group} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{s.supplier_group}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {s.markets.map((mid) => (
                    <span key={mid} className="badge badge-muted">{marketName(mid)}</span>
                  ))}
                </div>
              </div>
              <button className="btn btn-outline" onClick={() => toggleProducts(s.supplier_group)}>
                {expandedGroup === s.supplier_group ? 'Gizle' : 'Ürünleri Gör'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {s.markets.map((mid) => (
                <button
                  key={mid}
                  className="btn btn-outline"
                  style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger)' }}
                  onClick={() => unassign(s.supplier_group, mid)}
                >
                  {marketName(mid)}'dan kaldır
                </button>
              ))}
            </div>
            {expandedGroup === s.supplier_group && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--surface-border)', paddingTop: 8 }}>
                {products === null && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Yükleniyor…</div>}
                {products && products.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Ürün yok.</div>
                )}
                {products?.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <div>{p.name}</div>
                    <div>
                      Alış: {formatMoney(p.supplier_price)} · Satış: {formatMoney(p.sale_price ?? p.price)} ·{' '}
                      <span style={{ color: 'var(--primary)' }}>Kâr: {formatMoney(profit(p))}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && suppliers.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>Pazarında bağlı tedarikçi yok.</div>
        )}
      </div>
    </div>
  );
}
