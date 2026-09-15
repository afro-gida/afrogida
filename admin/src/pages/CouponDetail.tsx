import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { CouponDetails } from '../lib/coupon-types';
import { formatDateTime, formatMoney, maskPhone } from '../lib/format';

export default function CouponDetail() {
  const { couponId } = useParams<{ couponId: string }>();
  const [data, setData] = useState<CouponDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  function load() {
    if (!couponId) return;
    setLoading(true);
    setError('');
    api
      .get<CouponDetails>(`/admin/coupons/${couponId}/details`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Kupon yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [couponId]);

  async function unassign(userId: string) {
    if (!couponId) return;
    setBusyUserId(userId);
    try {
      await api.post('/admin/coupons/unassign-member', { coupon_id: couponId, user_id: userId });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kaldırılamadı');
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/coupons" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Kupon Detayı</h1>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {data && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--primary)' }}>{data.coupon.code}</div>
            <div style={{ fontSize: 14 }}>{data.coupon.title}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-muted">{formatMoney(data.coupon.discount_amount)} indirim</span>
              <span className="badge badge-muted">Min: {formatMoney(data.coupon.min_amount)}</span>
              <span className="badge badge-muted">SKT: {data.coupon.valid_until || '—'}</span>
              <span className={`badge ${data.coupon.active ? 'badge-green' : 'badge-red'}`}>
                {data.coupon.active ? 'Aktif' : 'Pasif'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {data.assigned_count} kişi · {data.total_uses} kullanım
            </div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Tanımlı Kişiler ({data.assigned_users.length})</div>
            {data.assigned_users.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Kimseye tanımlanmamış.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.assigned_users.map((u) => (
                  <div
                    key={u.user_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingBottom: 8,
                      borderBottom: '1px solid var(--surface-border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{u.user_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{maskPhone(u.phone)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Limit: {u.limit} · Kullanım: {u.used_count} · Kalan: {u.remaining}
                        {u.last_used_at ? ` · Son: ${formatDateTime(u.last_used_at)}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-outline"
                      style={{ color: 'var(--danger)' }}
                      disabled={busyUserId === u.user_id}
                      onClick={() => unassign(u.user_id)}
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Kullanım Geçmişi</div>
            {data.usage_logs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Henüz kullanım yok.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.usage_logs.map((l, i) => (
                  <div key={i} style={{ fontSize: 13, paddingBottom: 6, borderBottom: '1px solid var(--surface-border)' }}>
                    {formatDateTime(l.used_at)} — {formatMoney(l.discount_amount)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
