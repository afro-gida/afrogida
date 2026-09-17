import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Order } from '../lib/types';
import {
  deliveryTypeLabel,
  formatDateTime,
  formatMoney,
  orderStatusBadgeClass,
  orderStatusLabel,
  paymentStatusBadgeClass,
  paymentStatusLabel,
} from '../lib/format';

/** Seçenek fiyat farklarıyla birleşik birim fiyat (ör. taban ₺100 + "Büyük" +₺5 = ₺105/Kg). */
function combinedUnitPrice(item: { price?: number; unit_price_snapshot?: number; unit_price?: number; options_fee_unit?: number }) {
  const base = item.price ?? item.unit_price_snapshot ?? item.unit_price;
  if (base == null) return null;
  return base + (item.options_fee_unit ?? 0);
}

export default function OrderDetail() {
  const { txId } = useParams<{ txId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!txId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get<Order>(`/admin/orders/${txId}`)
      .then((data) => {
        if (!cancelled) setOrder(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Sipariş yüklenemedi');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [txId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/orders" className="btn btn-outline" style={{ padding: '8px 14px' }}>
          ← Geri
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>Sipariş Detayı</h1>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      {order && (
        <>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{order.tx_id}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {order.customer_name ?? order.phone ?? order.customer_phone ?? '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${orderStatusBadgeClass(order.order_status)}`}>
                {orderStatusLabel(order.order_status)}
              </span>
              <span className={`badge ${paymentStatusBadgeClass(order.payment_status)}`}>
                {paymentStatusLabel(order.payment_status)}
              </span>
              {order.delivery_type && <span className="badge badge-blue">{deliveryTypeLabel(order.delivery_type)}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14, marginTop: 6 }}>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Pazar</div>
                <div>{order.market_name ?? order.stall_id ?? '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Tutar</div>
                <div style={{ fontWeight: 700 }}>{formatMoney(order.total_amount ?? order.amount)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Sipariş Tarihi</div>
                <div>{formatDateTime(order.created_at)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)' }}>Teslim Tarihi</div>
                <div>{formatDateTime(order.delivered_at)}</div>
              </div>
            </div>
            {(order.refund_amount ?? 0) > 0 && (
              <div style={{ marginTop: 6 }}>
                <span className="badge badge-red">
                  İade: {formatMoney(order.refund_amount)} ({order.refund_status})
                </span>
              </div>
            )}
            {order.cancel_reason && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>İptal nedeni: {order.cancel_reason}</div>
            )}
            {order.admin_note && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not: {order.admin_note}</div>
            )}
          </div>

          {(order.address || order.courier_name) && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {order.address && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Teslimat Adresi</div>
                  <div style={{ fontSize: 14 }}>{order.address}</div>
                </div>
              )}
              {order.courier_name && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Kurye</div>
                  <div style={{ fontSize: 14 }}>{order.courier_name}</div>
                </div>
              )}
            </div>
          )}

          {(order.delivery_code || order.delivery_sms_sent != null) && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Teslim Kodu / SMS Durumu</div>
              <div style={{ fontSize: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {order.delivery_code && <span>Kod: {order.delivery_code}</span>}
                {order.delivery_sms_sent != null && (
                  <span className={`badge ${order.delivery_sms_sent ? 'badge-green' : 'badge-red'}`}>
                    {order.delivery_sms_sent ? 'SMS Gönderildi' : 'SMS Gönderilemedi'}
                  </span>
                )}
                {order.delivery_verified && <span className="badge badge-green">Doğrulandı</span>}
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Ürünler</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(order.items ?? []).length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Ürün bilgisi yok.</div>
              )}
              {(order.items ?? []).map((item, i) => {
                const unitPrice = combinedUnitPrice(item);
                return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    fontSize: 14,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--surface-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      {item.product_name ?? item.name ?? '—'}
                      {item.quantity != null && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}
                          × {item.quantity} {item.unit ?? ''}
                          {unitPrice != null && ` · ${formatMoney(unitPrice)}/${item.unit ?? 'birim'}`}
                        </span>
                      )}
                      {item.refunded && <span className="badge badge-red" style={{ marginLeft: 8 }}>İade</span>}
                    </div>
                    <div style={{ fontWeight: 600 }}>{formatMoney(item.line_total ?? item.total_price)}</div>
                  </div>
                  {(item.selected_options ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {item.selected_options!.map((opt, oi) => (
                        <span key={oi} className="badge badge-muted">
                          {opt.title ? `${opt.title}: ` : ''}{opt.label}
                          {!!opt.price_delta && ` (+${formatMoney(opt.price_delta)})`}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.customization_note && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not: {item.customization_note}</div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
