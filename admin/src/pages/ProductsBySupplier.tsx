import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/product-types';
import { formatMoney } from '../lib/format';

interface CatalogConfig {
  categories: string[];
  subcategories: Record<string, string[]>;
}

interface ProductForm {
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  supplier_price: number | '';
  price: number | '';
  in_stock: boolean;
  active: boolean;
}

function emptyForm(defaultCategory: string): ProductForm {
  return {
    name: '',
    category: defaultCategory,
    subcategory: 'Diğer',
    unit: 'Kg',
    supplier_price: '',
    price: '',
    in_stock: true,
    active: true,
  };
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

  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm(''));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([api.get<Product[]>('/admin/products'), api.get<CatalogConfig>('/admin/catalog-config')])
      .then(([p, c]) => {
        setProducts(p.filter((x) => (x.supplier_group || 'Tanımsız') === group));
        setCatalog(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Ürünler yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [group]);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm(catalog?.categories?.[0] ?? ''));
    setFormError('');
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: p.category,
      subcategory: p.subcategory ?? 'Diğer',
      unit: p.unit,
      supplier_price: p.supplier_price ?? '',
      price: p.price ?? '',
      in_stock: p.in_stock,
      active: p.active,
    });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim() || !form.category) {
      setFormError('Ürün adı ve kategori zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      category: form.category,
      subcategory: form.subcategory,
      supplier_group: group,
      unit: form.unit,
      supplier_price: form.supplier_price === '' ? 0 : Number(form.supplier_price),
      price: form.price === '' ? 0 : Number(form.price),
      sale_price: form.price === '' ? 0 : Number(form.price),
      in_stock: form.in_stock,
      active: form.active,
    };
    try {
      if (editingId) {
        await api.put(`/admin/products/${editingId}`, payload);
      } else {
        await api.post('/admin/products', payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/admin/products/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  const subcatOptions = catalog?.subcategories?.[form.category] ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/products" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>{group}</h1>
      </div>

      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={openNew}>
        + Ürün Ekle
      </button>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {showForm && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>{editingId ? 'Ürünü Düzenle' : 'Yeni Ürün'}</div>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>✕</button>
          </div>
          <div className="field">
            <label>Ürün Adı</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Kategori</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, subcategory: 'Diğer' }))}
                style={{ background: '#0a130e', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
              >
                {(catalog?.categories ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Alt Kategori</label>
              <select
                value={form.subcategory}
                onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                style={{ background: '#0a130e', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)' }}
              >
                {subcatOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Alış Fiyatı (₺)</label>
              <input
                type="number"
                value={form.supplier_price}
                onChange={(e) => setForm((f) => ({ ...f, supplier_price: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Satış Fiyatı (₺)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Birim</label>
              <input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={form.in_stock} onChange={(e) => setForm((f) => ({ ...f, in_stock: e.target.checked }))} />
            Stokta
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Aktif
          </label>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {products.map((p) => (
          <div key={p.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {p.category} › {p.subcategory} · {p.unit}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Alış: {formatMoney(p.supplier_price)} · Satış: {formatMoney(p.sale_price ?? p.price)} ·{' '}
                <span style={{ color: 'var(--primary)' }}>Kâr: {formatMoney(profit(p))}</span>
              </div>
              {!p.in_stock && <span className="badge badge-red" style={{ marginTop: 4 }}>Stok Yok</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" onClick={() => openEdit(p)}>Düzenle</button>
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
