import { useEffect, useState } from 'react';
import { api, ApiError, BACKEND_ORIGIN, uploadFile } from '../lib/api';

interface Campaign {
  id: string;
  title: string;
  description: string;
  image_url?: string | null;
  discount_text?: string | null;
  members_only: boolean;
  active: boolean;
  valid_until?: string | null;
}

type CampaignForm = Omit<Campaign, 'id'>;

const EMPTY_FORM: CampaignForm = {
  title: '',
  description: '',
  image_url: '',
  discount_text: '',
  members_only: true,
  active: true,
  valid_until: '',
};

function imageSrc(url?: string | null) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BACKEND_ORIGIN}${url}`;
}

export default function Campaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Campaign[]>('/admin/campaigns')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Kampanyalar yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(c: Campaign) {
    setEditingId(c.id);
    setForm({
      title: c.title,
      description: c.description,
      image_url: c.image_url ?? '',
      discount_text: c.discount_text ?? '',
      members_only: c.members_only,
      active: c.active,
      valid_until: c.valid_until ?? '',
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
    if (!form.title.trim() || !form.description.trim()) {
      setFormError('Başlık ve açıklama zorunlu');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await api.put(`/admin/campaigns/${editingId}`, form);
      } else {
        await api.post('/admin/campaigns', form);
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
      await api.del(`/admin/campaigns/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Kampanyalar</h1>
        <button className="btn" onClick={openNew}>
          + Yeni Kampanya
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {showForm && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700 }}>{editingId ? 'Düzenle' : 'Yeni Kampanya'}</div>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>
              ✕
            </button>
          </div>
          <div className="field">
            <label>Başlık</label>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="field">
            <label>Açıklama</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="field">
            <label>İndirim Metni (Örn: %20 İndirim)</label>
            <input
              value={form.discount_text ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, discount_text: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Son Geçerlilik (YYYY-AA-GG)</label>
            <input
              value={form.valid_until ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
              placeholder="2026-12-31"
            />
          </div>
          <div className="field">
            <label>Resim (Opsiyonel)</label>
            <input
              value={form.image_url ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
              placeholder="https://…"
            />
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.members_only}
              onChange={(e) => setForm((f) => ({ ...f, members_only: e.target.checked }))}
            />
            Sadece Üyelere
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Aktif
          </label>
          {formError && <div className="error-text">{formError}</div>}
          <button className="btn" disabled={saving} onClick={save}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((c) => (
          <div key={c.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {c.image_url && (
              <img src={imageSrc(c.image_url)} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover' }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{c.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{c.description}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {c.members_only && <span className="badge badge-green">Sadece Üyelere</span>}
                {!c.active && <span className="badge badge-red">Pasif</span>}
              </div>
            </div>
            <button className="btn btn-outline" onClick={() => openEdit(c)}>
              Düzenle
            </button>
            <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => remove(c.id)}>
              Sil
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
