import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Member } from '../lib/types';
import { formatDateTime, maskPhone } from '../lib/format';

export default function Members() {
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    const timeout = setTimeout(() => {
      api
        .get<Member[]>(`/admin/members${q}`)
        .then((data) => {
          if (!cancelled) setMembers(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : 'Üyeler yüklenemedi');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Üyeler {!loading && `(${members.length})`}</h1>

      <input
        placeholder="İsim veya telefon ara…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          background: '#0a130e',
          border: '1px solid var(--surface-border)',
          borderRadius: 10,
          padding: '12px 14px',
          color: 'var(--text)',
          outline: 'none',
        }}
      />

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}
      {!loading && !error && members.length === 0 && (
        <div style={{ color: 'var(--text-muted)' }}>Üye bulunamadı.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {members.map((m) => (
          <Link
            key={m.user_id}
            to={`/members/${m.user_id}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{m.name || 'İsimsiz Üye'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{maskPhone(m.phone)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Kayıt: {formatDateTime(m.created_at)}
              </div>
            </div>
            <span className="badge badge-green">Detay</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
