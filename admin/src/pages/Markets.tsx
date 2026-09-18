import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, BACKEND_ORIGIN, uploadFile } from '../lib/api';
import type { Market } from '../lib/market-types';

interface FormState {
  name: string;
  day: string;
  google_maps_url: string;
  neighborhoods: string; // textarea metni (satır satır / virgülle)
  image_url: string;
}

function emptyForm(): FormState {
  return { name: '', day: '', google_maps_url: '', neighborhoods: '', image_url: '' };
}

function imageSrc(url?: string | null) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
}

function parseNeighborhoods(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// PUT tüm alanı değiştirdiği için, formda göstermediğimiz operasyonel alanları
// (aktif/sipariş/eve servis anahtarları vb.) düzenlerken olduğu gibi korumamız gerekir.
const PASSTHROUGH_DEFAULTS = {
  location: '',
  note: '',
  location_url: '',
  active: true,
  orders_enabled: false,
  delivery_enabled: false,
  online_payment_enabled: false,
  active_eve_servis: false,
  active_gel_al: true,
};

export default function Markets() {
  const [items, setItems] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Market[]>('/admin/markets')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Pazarlar yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setEditingMarket(null);
    setForm(emptyForm());
    setFormError('');
    setShowForm(true);
  }

  function openEdit(m: Market) {
    setEditingMarket(m);
    setForm({
      name: m.name,
      day: m.day,
      google_maps_url: m.google_maps_url ?? '',
      neighborhoods: (m.delivery_neighborhoods ?? []).join('\n'),
      image_url: m.image_url ?? '',
    });
    setFormError('');
    setShowForm(true);
  }

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

  async function save() {
    if (!form.name.trim() || !form.day.trim()) {
      setFormError('Pazar adı ve gün zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    const passthrough = editingMarket
      ? {
          location: editingMarket.location ?? '',
          note: editingMarket.note ?? '',
          location_url: editingMarket.location_url ?? '',
          active: editingMarket.active,
          orders_enabled: editingMarket.orders_enabled,
          delivery_enabled: editingMarket.delivery_enabled,
          online_payment_enabled: editingMarket.online_payment_enabled,
          active_eve_servis: editingMarket.active_eve_servis,
          active_gel_al: editingMarket.active_gel_al,
        }
      : PASSTHROUGH_DEFAULTS;
    const payload = {
      name: form.name.trim(),
      day: form.day.trim(),
      google_maps_url: form.google_maps_url.trim() || null,
      image_url: form.image_url.trim() || null,
      delivery_neighborhoods: parseNeighborhoods(form.neighborhoods),
      ...passthrough,
    };
    try {
      if (editingMarket) {
        await api.put(`/admin/markets/${editingMarket.id}`, payload);
      } else {
        await api.post('/admin/markets', payload);
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
      await api.del(`/admin/markets/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  async function toggleField(m: Market, field: 'active' | 'active_eve_servis' | 'active_gel_al' | 'online_payment_enabled') {
    setToggleBusyId(m.id + field);
    setError('');
    const payload = {
      name: m.name,
      day: m.day,
      google_maps_url: m.google_maps_url ?? null,
      image_url: m.image_url ?? null,
      delivery_neighborhoods: m.delivery_neighborhoods ?? [],
      location: m.location ?? '',
      note: m.note ?? '',
      location_url: m.location_url ?? '',
      active: m.active,
      orders_enabled: m.orders_enabled,
      delivery_enabled: m.delivery_enabled,
      online_payment_enabled: m.online_payment_enabled,
      active_eve_servis: m.active_eve_servis,
      active_gel_al: m.active_gel_al,
      [field]: !m[field],
    };
    try {
      await api.put(`/admin/markets/${m.id}`, payload);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Değiştirilemedi');
    } finally {
      setToggleBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Pazarlar</h1>
        <button className="btn" onClick={openNew}>
          + Yeni Pazar
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {showForm && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>{editingMarket ? 'Pazar Düzenle' : 'Yeni Pazar'}</div>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>✕</button>
          </div>
          <div className="field">
            <label>Pazar Adı</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label>Gün</label>
            <input value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))} placeholder="Çarşamba" />
          </div>
          <div className="field">
            <label>Google Haritalar Linki (Opsiyonel)</label>
            <input
              value={form.google_maps_url}
              onChange={(e) => setForm((f) => ({ ...f, google_maps_url: e.target.value }))}
              placeholder="https://maps.app.goo.gl/…"
            />
          </div>
          <div className="field">
            <label>Teslimat Bölgeleri</label>
            <textarea
              value={form.neighborhoods}
              onChange={(e) => setForm((f) => ({ ...f, neighborhoods: e.target.value }))}
              rows={4}
              style={{ background: '#0f0f0f', border: '1px solid var(--surface-border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)', resize: 'vertical' }}
              placeholder="Her satıra bir mahalle, ya da virgülle ayırarak yaz"
            />
          </div>
          <div className="field">
            <label>Pazar Fotoğrafı (Opsiyonel)</label>
            <input value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" />
            <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
            {uploading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yükleniyor…</span>}
            {form.image_url && <img src={imageSrc(form.image_url)} alt="" style={{ maxWidth: 120, borderRadius: 10, marginTop: 6 }} />}
          </div>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((m) => (
          <div key={m.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {m.image_url && <img src={imageSrc(m.image_url)} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{m.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{m.day}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className={m.active ? 'btn' : 'btn btn-outline'}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={toggleBusyId === m.id + 'active'}
                  onClick={() => toggleField(m, 'active')}
                >
                  {m.active ? 'Göster: Açık' : 'Göster: Kapalı (Gizli)'}
                </button>
                <button
                  className={m.active_eve_servis ? 'btn' : 'btn btn-outline'}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={toggleBusyId === m.id + 'active_eve_servis'}
                  onClick={() => toggleField(m, 'active_eve_servis')}
                >
                  Eve Servis: {m.active_eve_servis ? 'Açık' : 'Kapalı'}
                </button>
                <button
                  className={m.active_gel_al ? 'btn' : 'btn btn-outline'}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={toggleBusyId === m.id + 'active_gel_al'}
                  onClick={() => toggleField(m, 'active_gel_al')}
                >
                  Gel Al: {m.active_gel_al ? 'Açık' : 'Kapalı'}
                </button>
                <button
                  className={m.online_payment_enabled ? 'btn' : 'btn btn-outline'}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  disabled={toggleBusyId === m.id + 'online_payment_enabled'}
                  onClick={() => toggleField(m, 'online_payment_enabled')}
                >
                  Online Ödeme: {m.online_payment_enabled ? 'Açık' : 'Kapalı'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <Link
                to={`/markets/${m.id}/settings`}
                className="btn btn-outline"
                style={{ padding: 8, borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                title="Pazar Ayarları"
                aria-label="Pazar Ayarları"
              >
                ⚙
              </Link>
              <button
                className="btn btn-outline"
                style={{ padding: 8, borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => openEdit(m)}
                title="Düzenle"
                aria-label="Düzenle"
              >
                ✎
              </button>
              <button
                className="btn btn-outline"
                style={{ padding: 8, borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}
                onClick={() => remove(m.id)}
                title="Sil"
                aria-label="Sil"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
