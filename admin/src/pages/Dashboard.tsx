import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Order } from '../lib/types';

interface VisitRow {
  date: string;
  count: number;
  member_count?: number;
  guest_count?: number;
}

interface Tile {
  label: string;
  value: number | null;
  sub?: string;
  to?: string;
  icon: string;
}

export default function Dashboard() {
  const [tiles, setTiles] = useState<Record<string, { value: number; sub?: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    Promise.allSettled([
      api.get<Order[]>('/admin/orders?filter_type=today'),
      api.get<VisitRow[]>('/admin/visits/report'),
      api.get<{ count: number }>('/admin/members/count'),
      api.get<unknown[]>('/admin/complaints'),
      api.get<unknown[]>('/admin/products'),
      api.get<unknown[]>('/admin/campaigns'),
      api.get<unknown[]>('/admin/coupons'),
      api.get<unknown[]>('/admin/markets'),
    ]).then(([orders, visits, members, complaints, products, campaigns, coupons, markets]) => {
      const next: Record<string, { value: number; sub?: string }> = {};

      if (orders.status === 'fulfilled') next.orders = { value: orders.value.length };
      if (visits.status === 'fulfilled') {
        const row = visits.value.find((r) => r.date === today);
        next.visits = {
          value: row?.member_count ?? row?.count ?? 0,
          sub: row?.guest_count != null ? `+${row.guest_count} misafir` : undefined,
        };
      }
      if (members.status === 'fulfilled') next.members = { value: members.value.count };
      if (complaints.status === 'fulfilled') next.complaints = { value: complaints.value.length };
      if (products.status === 'fulfilled') next.products = { value: products.value.length };
      if (campaigns.status === 'fulfilled') next.campaigns = { value: campaigns.value.length };
      if (coupons.status === 'fulfilled') next.coupons = { value: coupons.value.length };
      if (markets.status === 'fulfilled') next.markets = { value: markets.value.length };

      setTiles(next);
      setLoading(false);
    });
  }, []);

  const items: Tile[] = [
    { label: 'Yeni Sipariş', value: tiles.orders?.value ?? null, to: '/orders', icon: '🛒' },
    { label: 'Bugünkü Ziyaret', value: tiles.visits?.value ?? null, sub: tiles.visits?.sub, icon: '👁' },
    { label: 'Müşteri', value: tiles.members?.value ?? null, to: '/members', icon: '👥' },
    { label: 'Şikayet/Öneri', value: tiles.complaints?.value ?? null, to: '/complaints', icon: '💬' },
    { label: 'Ürün', value: tiles.products?.value ?? null, to: '/products', icon: '🏷' },
    { label: 'Kampanya', value: tiles.campaigns?.value ?? null, to: '/campaigns', icon: '📣' },
    { label: 'Kupon', value: tiles.coupons?.value ?? null, to: '/coupons', icon: '🎟' },
    { label: 'Pazar', value: tiles.markets?.value ?? null, to: '/markets', icon: '🏪' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Ana Sayfa</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {items.map((item) => {
          const content = (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 20 }}>{item.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {loading ? '…' : item.value ?? '—'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.label}</div>
              {item.sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sub}</div>}
            </div>
          );
          return item.to ? (
            <Link key={item.label} to={item.to} style={{ textDecoration: 'none', color: 'inherit' }}>
              {content}
            </Link>
          ) : (
            <div key={item.label}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
