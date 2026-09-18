import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, BACKEND_ORIGIN, uploadFile } from '../lib/api';
import type { CustomizationGroup, Product } from '../lib/product-types';

function imageSrc(url?: string | null) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
}

const UNIT_OPTIONS = ['Kg', 'Adet', 'File', 'Demet'];

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
  image_url: string;
  campaign_discount_percent: number | '';
  campaign_min_qty: number | '';
  customization_options: CustomizationGroup[];
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
    image_url: '',
    campaign_discount_percent: '',
    campaign_min_qty: '',
    customization_options: [],
  };
}

/** Müşteri tarafı (mobile/src/app/pazar/[id]/index.tsx) ürünleri `product.category`
 * ALT kategori (ör. "Domates") olarak filtreler; ana kategoriyi ("Sebze") bu ağaçtan
 * bulur. Bu yüzden burada Ana Kategori sadece "hangi alt kategori listesini göstereyim"
 * için bir yardımcı - kaydederken alanlar ters çevrilip gönderiliyor, bkz. save(). */
function findMainCategory(catalog: CatalogConfig | null, leaf: string): string {
  if (!catalog) return '';
  for (const main of catalog.categories) {
    if ((catalog.subcategories[main] ?? []).includes(leaf)) return main;
  }
  return catalog.categories[0] ?? '';
}

export default function ProductEdit() {
  const { supplierGroup, productId } = useParams<{ supplierGroup: string; productId: string }>();
  const group = decodeURIComponent(supplierGroup ?? '');
  const isNew = productId === 'yeni';
  const navigate = useNavigate();
  const backHref = `/products/${encodeURIComponent(group)}`;

  const [catalog, setCatalog] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProductForm>(emptyForm(''));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFormError('');
    Promise.all([
      api.get<CatalogConfig>('/admin/catalog-config'),
      isNew ? Promise.resolve<Product[] | null>(null) : api.get<Product[]>('/admin/products'),
    ])
      .then(([c, list]) => {
        setCatalog(c);
        if (isNew) {
          setForm(emptyForm(c.categories?.[0] ?? ''));
          return;
        }
        const p = (list ?? []).find((x) => x.id === productId);
        if (!p) {
          setFormError('Ürün bulunamadı');
          return;
        }
        const mainCategory = findMainCategory(c, p.category) || p.subcategory || c.categories?.[0] || '';
        setForm({
          name: p.name,
          category: mainCategory,
          subcategory: p.category,
          unit: p.unit,
          supplier_price: p.supplier_price ?? '',
          price: p.price ?? '',
          in_stock: p.in_stock,
          active: p.active,
          image_url: p.image_url ?? '',
          campaign_discount_percent: p.campaign_discount_percent ?? '',
          campaign_min_qty: p.campaign_min_qty ?? '',
          customization_options: (p.customization_options ?? []).map((g) => ({
            title: g.title,
            choices: g.choices.map((c2) => ({ ...c2 })),
          })),
        });
      })
      .catch((err) => setFormError(err instanceof ApiError ? err.message : 'Ürün yüklenemedi'))
      .finally(() => setLoading(false));
  }, [productId, isNew]);

  async function handleUpload(file: File) {
    setUploading(true);
    setFormError('');
    try {
      const res = await uploadFile(file);
      setForm((f) => ({ ...f, image_url: res.url }));
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Yükleme başarısız');
    } finally {
      setUploading(false);
    }
  }

  function addOptionGroup() {
    setForm((f) => ({ ...f, customization_options: [...f.customization_options, { title: '', choices: [{ label: '', price_delta: 0 }] }] }));
  }

  function removeOptionGroup(index: number) {
    setForm((f) => ({ ...f, customization_options: f.customization_options.filter((_, i) => i !== index) }));
  }

  function updateOptionGroupTitle(index: number, title: string) {
    setForm((f) => ({
      ...f,
      customization_options: f.customization_options.map((g, i) => (i === index ? { ...g, title } : g)),
    }));
  }

  function addChoice(groupIndex: number) {
    setForm((f) => ({
      ...f,
      customization_options: f.customization_options.map((g, i) =>
        i === groupIndex ? { ...g, choices: [...g.choices, { label: '', price_delta: 0 }] } : g,
      ),
    }));
  }

  function removeChoice(groupIndex: number, choiceIndex: number) {
    setForm((f) => ({
      ...f,
      customization_options: f.customization_options.map((g, i) =>
        i === groupIndex ? { ...g, choices: g.choices.filter((_, ci) => ci !== choiceIndex) } : g,
      ),
    }));
  }

  function updateChoice(groupIndex: number, choiceIndex: number, patch: Partial<{ label: string; price_delta: number }>) {
    setForm((f) => ({
      ...f,
      customization_options: f.customization_options.map((g, i) =>
        i === groupIndex
          ? { ...g, choices: g.choices.map((c, ci) => (ci === choiceIndex ? { ...c, ...patch } : c)) }
          : g,
      ),
    }));
  }

  async function save() {
    if (!form.name.trim() || !form.category || !form.subcategory) {
      setFormError('Ürün adı, ana kategori ve alt kategori zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    const cleanOptions = form.customization_options
      .map((g) => ({
        title: g.title.trim(),
        choices: g.choices
          .filter((c) => c.label.trim())
          .map((c) => ({ label: c.label.trim(), price_delta: Number(c.price_delta) || 0 })),
      }))
      .filter((g) => g.title && g.choices.length > 0);
    const payload = {
      name: form.name.trim(),
      // Müşteri tarafı ürünleri ALT kategoriye (ör. "Domates") göre filtreler,
      // ana kategoriyi ("Sebze") ağaçtan bulur - bu yüzden burada tersine çevrilip
      // gönderiliyor. bkz. mobile/src/app/pazar/[id]/index.tsx + findMainCategory().
      category: form.subcategory,
      subcategory: form.category,
      supplier_group: group,
      unit: form.unit,
      supplier_price: form.supplier_price === '' ? 0 : Number(form.supplier_price),
      price: form.price === '' ? 0 : Number(form.price),
      sale_price: form.price === '' ? 0 : Number(form.price),
      in_stock: form.in_stock,
      active: form.active,
      image_url: form.image_url || null,
      campaign_discount_percent: form.campaign_discount_percent === '' ? 0 : Number(form.campaign_discount_percent),
      campaign_min_qty: form.campaign_min_qty === '' ? 0 : Number(form.campaign_min_qty),
      customization_options: cleanOptions,
    };
    try {
      if (!isNew) {
        await api.put(`/admin/products/${productId}`, payload);
      } else {
        await api.post('/admin/products', payload);
      }
      navigate(backHref);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  const rawSubcatOptions = catalog?.subcategories?.[form.category] ?? [];
  const subcatOptions = rawSubcatOptions.includes(form.subcategory) || !form.subcategory
    ? rawSubcatOptions
    : [form.subcategory, ...rawSubcatOptions];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(backHref)} className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </button>
        <h1 style={{ fontSize: 20, margin: 0 }}>{isNew ? 'Yeni Ürün' : 'Ürünü Düzenle'}</h1>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}

      {!loading && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <label>Ürün Adı</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label>Kategori</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, subcategory: 'Diğer' }))}
              >
                {(catalog?.categories ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '1 1 140px' }}>
              <label>Alt Kategori</label>
              <select
                value={form.subcategory}
                onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
              >
                {subcatOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 120px' }}>
              <label>Alış Fiyatı (₺)</label>
              <input
                type="number"
                value={form.supplier_price}
                onChange={(e) => setForm((f) => ({ ...f, supplier_price: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: '1 1 120px' }}>
              <label>Satış Fiyatı (₺)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: '1 1 120px' }}>
              <label>Birim</label>
              <select
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              >
                {(UNIT_OPTIONS.includes(form.unit) ? UNIT_OPTIONS : [form.unit, ...UNIT_OPTIONS]).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Ürün Fotoğrafı (Opsiyonel)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              disabled={uploading}
            />
            {uploading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yükleniyor…</span>}
            {form.image_url && (
              <img src={imageSrc(form.image_url)} alt="" style={{ maxWidth: 120, borderRadius: 10, marginTop: 6 }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label>Kampanya İndirimi (%)</label>
              <input
                type="number"
                placeholder="Örn: 10"
                value={form.campaign_discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, campaign_discount_percent: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
            <div className="field" style={{ flex: '1 1 160px' }}>
              <label>Min. Adet (kampanya için)</label>
              <input
                type="number"
                placeholder="Örn: 3"
                value={form.campaign_min_qty}
                onChange={(e) => setForm((f) => ({ ...f, campaign_min_qty: e.target.value === '' ? '' : Number(e.target.value) }))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Seçenek Listesi (Opsiyonel)</label>
              <button type="button" className="btn btn-outline" onClick={addOptionGroup}>+ Grup Ekle</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Örn: grup "Porsiyon", seçenekler "Küçük" (+0₺), "Büyük" (+5₺).
            </div>
            {form.customization_options.map((group, gi) => (
              <div key={gi} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: '1 1 160px' }}>
                    <input
                      placeholder="Grup adı (örn: Porsiyon)"
                      value={group.title}
                      onChange={(e) => updateOptionGroupTitle(gi, e.target.value)}
                    />
                  </div>
                  <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeOptionGroup(gi)}>
                    Grubu Sil
                  </button>
                </div>
                {group.choices.map((choice, ci) => (
                  <div key={ci} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div className="field" style={{ flex: '2 1 160px' }}>
                      <input
                        placeholder="Seçenek adı (örn: Büyük)"
                        value={choice.label}
                        onChange={(e) => updateChoice(gi, ci, { label: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ flex: '1 1 100px' }}>
                      <input
                        type="number"
                        placeholder="Fiyat farkı (₺)"
                        value={choice.price_delta}
                        onChange={(e) => updateChoice(gi, ci, { price_delta: e.target.value === '' ? 0 : Number(e.target.value) })}
                      />
                    </div>
                    <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeChoice(gi, ci)}>
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => addChoice(gi)}>
                  + Seçenek Ekle
                </button>
              </div>
            ))}
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
    </div>
  );
}
