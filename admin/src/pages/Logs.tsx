import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatMoney, maskPhone } from '../lib/format';

type LogRow = Record<string, unknown>;

interface TabDef {
  key: string;
  label: string;
  endpoint: string;
}

const TABS: TabDef[] = [
  { key: 'actions', label: 'Admin İşlemleri', endpoint: '/admin/logs/actions' },
  { key: 'security', label: 'Güvenlik', endpoint: '/admin/logs/security' },
  { key: 'orders', label: 'Siparişler', endpoint: '/admin/logs/orders' },
  { key: 'order-status', label: 'Durum Geçmişi', endpoint: '/admin/logs/order-status' },
  { key: 'payments', label: 'Ödemeler', endpoint: '/admin/logs/payments' },
  { key: 'refunds', label: 'İadeler', endpoint: '/admin/logs/refunds' },
  { key: 'coupons', label: 'Kuponlar', endpoint: '/admin/logs/coupons' },
  { key: 'members', label: 'Üyelik', endpoint: '/admin/logs/members' },
  { key: 'pickup', label: 'Gel-Al Teslimat', endpoint: '/admin/logs/pickup' },
  { key: 'agreements', label: 'Sözleşme Onayları', endpoint: '/admin/logs/agreements' },
];

function str(row: LogRow, key: string) {
  const v = row[key];
  return v == null ? '' : String(v);
}

function row(row: LogRow, key: string) {
  return row[key];
}

/** Her sekmenin field şekli farklı olduğu için tek tek küçük satır bileşenleri. */
function ActionsRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 700 }}>{str(r, 'action')}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatDateTime(str(r, 'timestamp'))}</div>
      <div style={{ fontSize: 13 }}>{str(r, 'admin_name')} {str(r, 'target_id') && `· hedef: ${str(r, 'target_id')}`}</div>
      {!!str(r, 'note') && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not: {str(r, 'note')}</div>}
      {!!str(r, 'ip') && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>IP: {str(r, 'ip')}</div>}
    </div>
  );
}

function SecurityRow({ r }: { r: LogRow }) {
  return (
    <div className="card">
      <div style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-word' }}>{str(r, 'log')}</div>
    </div>
  );
}

function OrdersRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>{str(r, 'user_name') || maskPhone(str(r, 'user_phone'))}</div>
        <div style={{ fontWeight: 700 }}>{formatMoney(Number(row(r, 'amount')) || 0)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'tx_id')}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span className="badge badge-blue">{str(r, 'delivery_type') === 'pickup' ? 'Gel-Al' : 'Eve Servis'}</span>
        <span className="badge badge-muted">{str(r, 'payment_method') === 'card' ? 'Kredi Kartı' : 'Tezgahta'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(str(r, 'created_at'))}</div>
    </div>
  );
}

function OrderStatusRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'tx_id')}</div>
      <div>
        {str(r, 'old_status') && <span style={{ color: 'var(--text-muted)' }}>{str(r, 'old_status')} → </span>}
        <b>{str(r, 'new_status')}</b>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {formatDateTime(str(r, 'changed_at'))} · {str(r, 'changed_by_type')}
      </div>
    </div>
  );
}

function PaymentsRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className={`badge ${str(r, 'status') === 'Başarılı' ? 'badge-green' : 'badge-red'}`}>{str(r, 'status')}</span>
        <div style={{ fontWeight: 700 }}>{formatMoney(Number(row(r, 'amount')) || 0)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'merchant_oid')}</div>
      {!!str(r, 'refund_status') && <div style={{ fontSize: 13 }}>{str(r, 'refund_status')}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(str(r, 'callback_date'))}</div>
    </div>
  );
}

function RefundsRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="badge badge-orange">{str(r, 'refund_type') === 'tam' ? 'Tam İade' : 'Kısmi İade'}</span>
        <div style={{ fontWeight: 700 }}>{formatMoney(Number(row(r, 'amount')) || 0)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'order_id')}</div>
      <div style={{ fontSize: 13 }}>{str(r, 'reason')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{str(r, 'admin_name')} · {formatDateTime(str(r, 'timestamp'))}</div>
    </div>
  );
}

function CouponsRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>{str(r, 'code')}</div>
        <div>{formatMoney(Number(row(r, 'discount')) || 0)}</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'user_id')} · {str(r, 'tx_id')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{str(r, 'action')} · {formatDateTime(str(r, 'used_at'))}</div>
    </div>
  );
}

function MembersRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>{str(r, 'phone')}</div>
        {row(r, 'is_restricted') === true && <span className="badge badge-red">Kısıtlı</span>}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'restriction_reason')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDateTime(str(r, 'deleted_at'))}</div>
    </div>
  );
}

function PickupRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>{str(r, 'order_id')}</div>
        <span className={`badge ${row(r, 'code_verified') ? 'badge-green' : 'badge-muted'}`}>
          {row(r, 'code_verified') ? 'Doğrulandı' : 'Bekliyor'}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{str(r, 'masked_phone')} · {str(r, 'branch_info')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        SMS: {row(r, 'sms_sent') ? 'Gönderildi' : 'Gönderilmedi'} · {formatDateTime(str(r, 'verified_at'))}
      </div>
    </div>
  );
}

function AgreementsRow({ r }: { r: LogRow }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700 }}>{str(r, 'document_name')}</div>
        <span className={`badge ${row(r, 'accepted') ? 'badge-green' : 'badge-red'}`}>
          {row(r, 'accepted') ? 'Onaylandı' : 'Reddedildi'}
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {str(r, 'user_id')} {str(r, 'order_id') && `· sipariş: ${str(r, 'order_id')}`}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        sürüm {str(r, 'document_version')} · {formatDateTime(str(r, 'timestamp'))}
      </div>
    </div>
  );
}

const ROW_COMPONENTS: Record<string, (props: { r: LogRow }) => React.ReactElement> = {
  actions: ActionsRow,
  security: SecurityRow,
  orders: OrdersRow,
  'order-status': OrderStatusRow,
  payments: PaymentsRow,
  refunds: RefundsRow,
  coupons: CouponsRow,
  members: MembersRow,
  pickup: PickupRow,
  agreements: AgreementsRow,
};

export default function Logs() {
  const [tab, setTab] = useState(TABS[0].key);
  const [rowsByTab, setRowsByTab] = useState<Record<string, LogRow[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (rowsByTab[tab]) return;
    setLoading(true);
    setError('');
    const def = TABS.find((t) => t.key === tab)!;
    api
      .get<LogRow[] | { logs: LogRow[] }>(def.endpoint)
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.logs ?? []);
        setRowsByTab((prev) => ({ ...prev, [tab]: list }));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Loglar yüklenemedi'))
      .finally(() => setLoading(false));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = rowsByTab[tab] ?? [];
  const RowComponent = ROW_COMPONENTS[tab];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Loglar</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn' : 'btn btn-outline'}
            style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>}
      {error && <div className="error-text">{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!loading && rows.length === 0 && !error && (
          <div style={{ color: 'var(--text-muted)' }}>Bu sekmede henüz kayıt yok.</div>
        )}
        {rows.map((r, i) => (
          <RowComponent key={i} r={r} />
        ))}
      </div>
    </div>
  );
}
