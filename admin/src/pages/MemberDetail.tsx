import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Member, MemberLogsResponse, Order } from '../lib/types';
import type { MemberCoupon } from '../lib/coupon-types';
import { formatDateTime, formatMoney, maskPhone, orderStatusBadgeClass, orderStatusLabel } from '../lib/format';

type Tab = 'addresses' | 'orders' | 'coupons';

export default function MemberDetail() {
  const { userId } = useParams<{ userId: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [logs, setLogs] = useState<MemberLogsResponse | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [coupons, setCoupons] = useState<MemberCoupon[] | null>(null);
  const [tab, setTab] = useState<Tab>('addresses');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clearingRestriction, setClearingRestriction] = useState(false);
  const [restrictionNote, setRestrictionNote] = useState('');
  const [restrictionBusy, setRestrictionBusy] = useState(false);
  const [restrictionError, setRestrictionError] = useState('');

  function loadAll() {
    if (!userId) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.get<Member>(`/admin/members/${userId}`),
      api.get<MemberLogsResponse>(`/admin/members/${userId}/logs`),
    ])
      .then(([m, l]) => {
        setMember(m);
        setLogs(l);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Üye yüklenemedi'))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, [userId]);

  useEffect(() => {
    if (tab !== 'orders' || !userId || orders !== null) return;
    api
      .get<Order[]>('/admin/orders?filter_type=all_time')
      .then((all) => setOrders(all.filter((o) => o.user_id === userId)))
      .catch(() => setOrders([]));
  }, [tab, userId, orders]);

  useEffect(() => {
    if (tab !== 'coupons' || !userId || coupons !== null) return;
    api
      .get<MemberCoupon[]>(`/admin/members/${userId}/coupons`)
      .then(setCoupons)
      .catch(() => setCoupons([]));
  }, [tab, userId, coupons]);

  async function submitClearRestriction() {
    if (!userId || !restrictionNote.trim()) return;
    setRestrictionBusy(true);
    setRestrictionError('');
    try {
      await api.post(`/admin/members/${userId}/no-show/clear`, { admin_note: restrictionNote.trim() });
      setClearingRestriction(false);
      setRestrictionNote('');
      loadAll();
    } catch (err) {
      setRestrictionError(err instanceof ApiError ? err.message : 'Kısıtlama kaldırılamadı');
    } finally {
      setRestrictionBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/members" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Üye Detayı</h1>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {member && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{member.name || 'İsimsiz Üye'}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>{maskPhone(member.phone)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Kayıt: {formatDateTime(member.created_at)} · {member.auth_type ?? 'phone'}
            </div>
          </div>

          {member.is_restricted && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 6 }}>Kısıtlama Aktif</div>
              <div style={{ fontSize: 14, marginBottom: 12 }}>{member.restriction_reason || '—'}</div>
              {!clearingRestriction ? (
                <button className="btn" style={{ background: 'var(--danger)' }} onClick={() => setClearingRestriction(true)}>
                  Kısıtlamayı Kaldır
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="field">
                    <label htmlFor="restriction-note">Neden kaldırıyorsunuz? (zorunlu)</label>
                    <input
                      id="restriction-note"
                      value={restrictionNote}
                      onChange={(e) => setRestrictionNote(e.target.value)}
                      placeholder="Örn: müşteri ile görüşüldü, mücbir sebep vardı"
                    />
                  </div>
                  {restrictionError && <div className="error-text">{restrictionError}</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      disabled={!restrictionNote.trim() || restrictionBusy}
                      onClick={submitClearRestriction}
                    >
                      {restrictionBusy ? 'Kaydediliyor…' : 'Onayla ve Kaldır'}
                    </button>
                    <button className="btn btn-outline" onClick={() => setClearingRestriction(false)}>
                      Vazgeç
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className={tab === 'addresses' ? 'btn' : 'btn btn-outline'} onClick={() => setTab('addresses')}>
              Adresler
            </button>
            <button className={tab === 'orders' ? 'btn' : 'btn btn-outline'} onClick={() => setTab('orders')}>
              Sipariş Geçmişi
            </button>
            <button className={tab === 'coupons' ? 'btn' : 'btn btn-outline'} onClick={() => setTab('coupons')}>
              Kuponlar
            </button>
          </div>

          {tab === 'addresses' && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>Kayıtlı Adresler</div>
                <span style={{ color: 'var(--text-muted)' }}>{member.addresses?.length ?? 0}</span>
              </div>
              {(member.addresses?.length ?? 0) === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Kayıtlı adres yok</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {member.addresses!.map((a) => (
                    <div key={a.id} style={{ fontSize: 14, paddingBottom: 8, borderBottom: '1px solid var(--surface-border)' }}>
                      <div style={{ fontWeight: 600 }}>
                        {a.title} {a.is_default && <span className="badge badge-green">Varsayılan</span>}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        {[a.neighborhood, a.street, a.building_no && `No:${a.building_no}`, a.city].filter(Boolean).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'orders' && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Sipariş Geçmişi</div>
              {orders === null && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Yükleniyor…</div>}
              {orders && orders.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Henüz sipariş yok.</div>
              )}
              {orders && orders.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {orders.map((o) => (
                    <Link
                      key={o.tx_id}
                      to={`/orders/${o.tx_id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 14,
                        paddingBottom: 8,
                        borderBottom: '1px solid var(--surface-border)',
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                    >
                      <div>
                        <div>{formatDateTime(o.created_at)}</div>
                        <span className={`badge ${orderStatusBadgeClass(o.order_status)}`}>{orderStatusLabel(o.order_status)}</span>
                      </div>
                      <div style={{ fontWeight: 600 }}>{formatMoney(o.total_amount ?? o.amount)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'coupons' && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Kuponlar</div>
              {coupons === null && <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Yükleniyor…</div>}
              {coupons && coupons.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Bu üyeye tanımlı kupon yok.</div>
              )}
              {coupons && coupons.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {coupons.map((c) => (
                    <div key={c.coupon_id} style={{ fontSize: 14, paddingBottom: 8, borderBottom: '1px solid var(--surface-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 600, color: 'var(--primary)' }}>{c.code}</div>
                        {c.auto_issued && <span className="badge badge-muted">Otomatik</span>}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>{c.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {formatMoney(c.discount_amount)} indirim · Limit: {c.limit} · Kullanım: {c.used_count} · Kalan:{' '}
                        {c.remaining}
                        {c.last_used_at ? ` · Son: ${formatDateTime(c.last_used_at)}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>İşlem Geçmişi {logs && `(${logs.total})`}</div>
            {(logs?.logs.length ?? 0) === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Henüz işlem yok.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {logs!.logs.map((l, i) => (
                  <div key={i} style={{ fontSize: 14, paddingBottom: 8, borderBottom: '1px solid var(--surface-border)' }}>
                    <div style={{ fontWeight: 600 }}>{l.label}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {l.timestamp_tr || formatDateTime(l.timestamp)}
                      {l.admin_name ? ` · ${l.admin_name}` : ''}
                    </div>
                    {l.note && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{l.note}</div>}
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
