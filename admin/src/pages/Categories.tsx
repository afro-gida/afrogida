import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

interface CatalogConfig {
  categories: string[];
  subcategories: Record<string, string[]>;
  [key: string]: unknown;
}

export default function Categories() {
  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [newCategory, setNewCategory] = useState('');
  const [newSubcat, setNewSubcat] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    api
      .get<CatalogConfig>('/admin/catalog-config')
      .then((c) => {
        setCategories(c.categories ?? []);
        setSubcategories(c.subcategories ?? {});
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Kategoriler yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  async function persist(nextCategories: string[], nextSubcategories: Record<string, string[]>) {
    setSaving(true);
    setError('');
    try {
      await api.put('/admin/catalog-config', { categories: nextCategories, subcategories: nextSubcategories });
      setCategories(nextCategories);
      setSubcategories(nextSubcategories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name || categories.includes(name)) return;
    const nextCategories = [...categories, name];
    const nextSub = { ...subcategories, [name]: ['Diğer'] };
    setNewCategory('');
    persist(nextCategories, nextSub);
  }

  function removeCategory(name: string) {
    const usesWarning =
      'Bu kategoriyi silersen, bu kategoride kayıtlı ürünler listede görünmeye devam eder ama ' +
      'düzenlerken kategori seçimini değiştirmen gerekebilir. Silmek istediğine emin misin?';
    if (!window.confirm(usesWarning)) return;
    const nextCategories = categories.filter((c) => c !== name);
    const nextSub = { ...subcategories };
    delete nextSub[name];
    persist(nextCategories, nextSub);
  }

  function addSubcategory(category: string) {
    const name = (newSubcat[category] ?? '').trim();
    if (!name) return;
    const current = subcategories[category] ?? [];
    if (current.includes(name)) return;
    const nextSub = { ...subcategories, [category]: [...current, name] };
    setNewSubcat((s) => ({ ...s, [category]: '' }));
    persist(categories, nextSub);
  }

  function removeSubcategory(category: string, name: string) {
    if (!window.confirm(`"${name}" alt kategorisini silmek istediğine emin misin?`)) return;
    const nextSub = { ...subcategories, [category]: (subcategories[category] ?? []).filter((s) => s !== name) };
    persist(categories, nextSub);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/products" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Kategoriler</h1>
        {saving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Kaydediliyor…</span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Ürün eklerken seçilen kategori ve alt kategori listeleri burada yönetilir.
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {!loading && (
        <>
          <div className="card" style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <input
                placeholder="Yeni kategori adı"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              />
            </div>
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={addCategory} disabled={!newCategory.trim()}>
              + Kategori Ekle
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {categories.map((cat) => (
              <div key={cat} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700 }}>{cat}</div>
                  <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => removeCategory(cat)}>
                    Kategoriyi Sil
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(subcategories[cat] ?? []).map((sub) => (
                    <span
                      key={sub}
                      className="badge badge-muted"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}
                    >
                      {sub}
                      <button
                        onClick={() => removeSubcategory(cat, sub)}
                        title="Alt kategoriyi sil"
                        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <input
                      placeholder="Yeni alt kategori"
                      value={newSubcat[cat] ?? ''}
                      onChange={(e) => setNewSubcat((s) => ({ ...s, [cat]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && addSubcategory(cat)}
                    />
                  </div>
                  <button
                    className="btn btn-outline"
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => addSubcategory(cat)}
                    disabled={!(newSubcat[cat] ?? '').trim()}
                  >
                    Ekle
                  </button>
                </div>
              </div>
            ))}
            {categories.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Henüz kategori yok.</div>}
          </div>
        </>
      )}
    </div>
  );
}
