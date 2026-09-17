import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/product-types';

interface CatalogConfig {
  categories: string[];
  subcategories: Record<string, string[]>;
  suppliers: string[];
  [key: string]: unknown;
}

function moveItem<T>(arr: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

/** Basit +/- düğmeleriyle sırala, adı yerinde düzenle, sil - "Kaydet"e basana kadar
 * hiçbir şey sunucuya gitmez (eski sistemdeki Kategori Ayarları paneliyle aynı akış). */
function EditableList({
  items,
  onChange,
  onRemove,
  placeholder,
  countFor,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  onRemove: (name: string) => void;
  placeholder: string;
  countFor?: (name: string) => number;
}) {
  const [draft, setDraft] = useState('');

  function rename(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function add() {
    const name = draft.trim();
    if (!name || items.includes(name)) return;
    onChange([...items, name]);
    setDraft('');
  }

  function remove(index: number) {
    const name = items[index];
    const count = countFor?.(name) ?? 0;
    const warning =
      count > 0
        ? `"${name}" şu anda ${count} üründe kullanılıyor. Silersen o ürünler eski adla kalır, listede görünmeye devam eder ama düzenlerken yeni bir seçim yapman gerekir. Silmek istediğine emin misin?`
        : `"${name}" öğesini silmek istediğine emin misin?`;
    if (!window.confirm(warning)) return;
    onRemove(name);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={item}
            onChange={(e) => rename(i, e.target.value)}
            style={{
              flex: 1,
              background: '#fff',
              color: '#0d1a12',
              border: 'none',
              borderRadius: 999,
              padding: '12px 16px',
              fontSize: 15,
            }}
          />
          <button
            type="button"
            className="btn btn-outline"
            style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }}
            onClick={() => onChange(moveItem(items, i, -1))}
            disabled={i === 0}
            title="Yukarı taşı"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }}
            onClick={() => onChange(moveItem(items, i, 1))}
            disabled={i === items.length - 1}
            title="Aşağı taşı"
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ borderRadius: '50%', width: 36, height: 36, padding: 0, color: 'var(--danger)' }}
            onClick={() => remove(i)}
            title="Sil"
          >
            🗑
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{
            flex: 1,
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--surface-border)',
            borderRadius: 999,
            padding: '10px 16px',
          }}
        />
        <button type="button" className="btn btn-outline" onClick={add} disabled={!draft.trim()}>
          + Ekle
        </button>
      </div>
    </div>
  );
}

export default function Categories() {
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<Record<string, string[]>>({});
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get<CatalogConfig>('/admin/catalog-config'), api.get<Product[]>('/admin/products')])
      .then(([c, p]) => {
        setCategories(c.categories ?? []);
        setSubcategories(c.subcategories ?? {});
        setSuppliers(c.suppliers ?? []);
        setProducts(p);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  // Ürünlerde asıl filtrelenen alan `category` ALT kategoridir (ör. "Domates"),
  // ana kategori `subcategory` alanında tutulur - bkz. ProductsBySupplier.tsx save().
  function categoryProductCount(name: string) {
    return products.filter((p) => p.subcategory === name).length;
  }
  function subcategoryProductCount(category: string, name: string) {
    return products.filter((p) => p.subcategory === category && p.category === name).length;
  }
  function supplierProductCount(name: string) {
    return products.filter((p) => p.supplier_group === name).length;
  }

  function updateCategoryName(index: number, name: string) {
    const oldName = categories[index];
    const nextCategories = [...categories];
    nextCategories[index] = name;
    const nextSub = { ...subcategories };
    if (oldName !== name) {
      nextSub[name] = nextSub[oldName] ?? ['Diğer'];
      delete nextSub[oldName];
    }
    setCategories(nextCategories);
    setSubcategories(nextSub);
  }

  function reorderCategories(next: string[]) {
    // subcategories objesi isimle eşleşiyor, sıra değişse de bozulmaz.
    setCategories(next);
  }

  function addCategory(next: string[]) {
    const added = next.find((c) => !categories.includes(c));
    setCategories(next);
    if (added) setSubcategories((s) => ({ ...s, [added]: ['Diğer'] }));
  }

  function removeCategory(name: string) {
    setCategories((c) => c.filter((x) => x !== name));
    setSubcategories((s) => {
      const next = { ...s };
      delete next[name];
      return next;
    });
  }

  function addSupplier(next: string[]) {
    setSuppliers(next);
  }

  function removeSupplier(name: string) {
    setSuppliers((s) => s.filter((x) => x !== name));
  }

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/admin/catalog-config', { categories, subcategories, suppliers });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/products" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Kategori Ayarları</h1>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Değişiklikler yalnızca "Kaydet"e basınca uygulanır. Ok düğmeleriyle sırayı değiştirebilirsin.
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}
      {saved && !saving && <div style={{ color: 'var(--primary)', fontSize: 14 }}>Kaydedildi ✓</div>}

      {!loading && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {categories.map((cat, i) => (
              <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Ana Kategori
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={cat}
                    onChange={(e) => updateCategoryName(i, e.target.value)}
                    style={{ flex: 1, background: '#fff', color: '#0d1a12', border: 'none', borderRadius: 999, padding: '12px 16px', fontSize: 15, fontWeight: 700 }}
                  />
                  <button type="button" className="btn btn-outline" style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }} onClick={() => reorderCategories(moveItem(categories, i, -1))} disabled={i === 0} title="Yukarı taşı">↑</button>
                  <button type="button" className="btn btn-outline" style={{ borderRadius: '50%', width: 36, height: 36, padding: 0 }} onClick={() => reorderCategories(moveItem(categories, i, 1))} disabled={i === categories.length - 1} title="Aşağı taşı">↓</button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ borderRadius: '50%', width: 36, height: 36, padding: 0, color: 'var(--danger)' }}
                    onClick={() => {
                      const count = categoryProductCount(cat);
                      const warning = count > 0
                        ? `"${cat}" şu anda ${count} üründe kullanılıyor. Silersen o ürünler eski adla kalır. Silmek istediğine emin misin?`
                        : `"${cat}" kategorisini silmek istediğine emin misin?`;
                      if (window.confirm(warning)) removeCategory(cat);
                    }}
                    title="Kategoriyi Sil"
                  >
                    🗑
                  </button>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginTop: 6 }}>
                  Alt Kategoriler
                </div>
                <EditableList
                  items={subcategories[cat] ?? []}
                  onChange={(next) => setSubcategories((s) => ({ ...s, [cat]: next }))}
                  onRemove={(name) => setSubcategories((s) => ({ ...s, [cat]: (s[cat] ?? []).filter((x) => x !== name) }))}
                  placeholder="Alt kategori ekle"
                  countFor={(name) => subcategoryProductCount(cat, name)}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 8 }}>
              <NewCategoryInput onAdd={(name) => addCategory([...categories, name])} disabledNames={categories} />
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
              Tedarikçiler
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Ürün eklerken "tedarikçi grubu" olarak buradaki liste kullanılır, sıraları da müşteri tarafına yansır.
            </div>
            <EditableList
              items={suppliers}
              onChange={addSupplier}
              onRemove={(name) => {
                const count = supplierProductCount(name);
                if (count > 0) {
                  window.alert(`"${name}" şu anda ${count} üründe tedarikçi olarak kullanılıyor, bu yüzden silmedim. Önce o ürünleri başka bir tedarikçiye taşı.`);
                  return;
                }
                removeSupplier(name);
              }}
              placeholder="Tedarikçi ekle"
            />
          </div>

          <button className="btn" disabled={saving} onClick={save} style={{ alignSelf: 'flex-start', padding: '12px 24px' }}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      )}
    </div>
  );
}

function NewCategoryInput({ onAdd, disabledNames }: { onAdd: (name: string) => void; disabledNames: string[] }) {
  const [value, setValue] = useState('');
  function submit() {
    const name = value.trim();
    if (!name || disabledNames.includes(name)) return;
    onAdd(name);
    setValue('');
  }
  return (
    <>
      <input
        placeholder="Yeni ana kategori adı"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        style={{ flex: 1, background: 'transparent', color: 'var(--text)', border: '1px solid var(--surface-border)', borderRadius: 999, padding: '10px 16px' }}
      />
      <button type="button" className="btn" onClick={submit} disabled={!value.trim()}>
        + Ana Kategori Ekle
      </button>
    </>
  );
}
