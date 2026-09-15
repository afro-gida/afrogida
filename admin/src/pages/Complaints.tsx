import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface Complaint {
  id: string;
  name?: string;
  customer_name?: string;
  phone?: string;
  message?: string;
  content?: string;
  text?: string;
  status?: string;
  admin_response?: string;
  created_at?: string;
  [key: string]: unknown;
}

export default function Complaints() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError('');
    api
      .get<Complaint[]>('/admin/complaints')
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Şikayetler yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function markResolved(id: string) {
    setBusyId(id);
    try {
      await api.put(`/admin/complaints/${id}`, { status: 'resolved' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Güncellenemedi');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.del(`/admin/complaints/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Silinemedi');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Şikayet / Öneri {!loading && `(${items.length})`}</h1>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div style={{ color: 'var(--text-muted)' }}>Henüz şikayet/öneri yok.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((c) => (
          <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700 }}>{c.name ?? c.customer_name ?? c.phone ?? 'Bilinmeyen'}</div>
              <span className={`badge ${c.status === 'resolved' ? 'badge-green' : 'badge-orange'}`}>
                {c.status === 'resolved' ? 'Çözüldü' : 'Bekliyor'}
              </span>
            </div>
            <div style={{ fontSize: 14 }}>{c.message ?? c.content ?? c.text ?? '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(c.created_at)}</div>
            {c.admin_response && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Yanıt: {c.admin_response}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {c.status !== 'resolved' && (
                <button className="btn" disabled={busyId === c.id} onClick={() => markResolved(c.id)}>
                  Çözüldü olarak işaretle
                </button>
              )}
              <button
                className="btn btn-outline"
                style={{ color: 'var(--danger)' }}
                disabled={busyId === c.id}
                onClick={() => remove(c.id)}
              >
                Sil
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
