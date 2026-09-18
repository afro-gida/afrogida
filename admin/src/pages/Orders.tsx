import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Order } from '../lib/types';
import {
  formatDateTime,
  formatMoney,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusBadgeClass,
  paymentStatusLabel,
} from '../lib/format';

const FILTERS: { value: string; label: string }[] = [
  { value: 'today', label: 'Bugün' },
  { value: 'last_7_days', label: 'Son 7 Gün' },
  { value: 'last_1_month', label: 'Son 1 Ay' },
  { value: 'all_time', label: 'Tümü' },
];

const FAILED_STATUSES = new Set(['teslim_alinmadi', 'musteri_gelmedi_iptal']);

function summarize(orders: Order[]) {
  let completedCount = 0;
  let completedTotal = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let refundedCount = 0;
  let refundedTotal = 0;

  for (const o of orders) {
    const amount = Number(o.total_amount ?? o.amount ?? 0);
    if (o.order_status === 'teslim_edildi') {
      completedCount += 1;
      completedTotal += amount;
    } else if (FAILED_STATUSES.has(o.order_status ?? '')) {
      failedCount += 1;
    } else if (o.order_status === 'iptal_edildi') {
      cancelledCount += 1;
    }
    if (o.refund_status === 'iade_edildi' || o.refund_status === 'kismi_iade_edildi') {
      refundedCount += 1;
      refundedTotal += Number(o.refund_amount ?? 0);
    }
  }
  return { completedCount, completedTotal, failedCount, cancelledCount, refundedCount, refundedTotal };
}

export default function Orders() {
  const [filter, setFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get<Order[]>(`/admin/orders?filter_type=${filter}`)
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Siparişler yüklenemedi');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return orders;
    return orders.filter((o) =>
      [o.customer_name, o.phone, o.customer_phone, o.tx_id]
        .filter(Boolean)
        .some((v) => String(v).toLocaleLowerCase('tr').includes(q)),
    );
  }, [orders, search]);

  const summary = useMemo(() => summarize(filteredOrders), [filteredOrders]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Siparişler</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={filter === f.value ? 'btn' : 'btn btn-outline'}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        placeholder="Müşteri, telefon veya sipariş no ile ara…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          background: '#0f0f0f',
          border: '1px solid var(--surface-border)',
          borderRadius: 10,
          padding: '12px 14px',
          color: 'var(--text)',
          outline: 'none',
        }}
      />

      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yapılan Satış</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.completedCount}</div>
            <div style={{ fontSize: 13, color: 'var(--primary)' }}>{formatMoney(summary.completedTotal)}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Başarısız Satış</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.failedCount}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>İptal</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.cancelledCount}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>İade</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.refundedCount}</div>
            <div style={{ fontSize: 13, color: 'var(--danger)' }}>{formatMoney(summary.refundedTotal)}</div>
          </div>
        </div>
      )}
      {!loading && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Kâr rakamı henüz eklenmedi — ürünlere alış fiyatı tanımlandığında (Tedarikçiler ekranında konuştuğumuz özellik)
          buraya da eklenecek.
        </div>
      )}

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}
      {!loading && !error && filteredOrders.length === 0 && (
        <div style={{ color: 'var(--text-muted)' }}>Bu aralıkta sipariş bulunamadı.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filteredOrders.map((o) => (
          <Link key={o.tx_id} to={`/orders/${o.tx_id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{o.customer_name ?? o.phone ?? o.customer_phone ?? o.tx_id}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{o.market_name ?? o.stall_id ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{formatDateTime(o.created_at)}</div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <div style={{ fontWeight: 700 }}>{formatMoney(o.total_amount ?? o.amount)}</div>
                <span className={`badge ${orderStatusBadgeClass(o.order_status)}`}>{orderStatusLabel(o.order_status)}</span>
                <span className={`badge ${paymentStatusBadgeClass(o.payment_status)}`} style={{ fontSize: 11 }}>
                  {paymentStatusLabel(o.payment_status)}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
