import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ErrorBox, Notice, Page, T, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { useSession } from '@/lib/session';

type Stats = { markets: number; products: number; outOfStock: number; todayOrders: number; todayTotal: number; members: number; pendingReturns: number; pendingComplaints: number; productRequests: number };

export default function Overview() {
  const router = useRouter();
  const { user } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [markets, products, orders, members, returns, complaints, productRequests] =await Promise.all([
        api.get<any[]>('/admin/markets'),
        api.get<any[]>('/admin/products'),
        api.get<any[]>('/admin/orders?filter_type=today'),
        api.get<{ count: number }>('/admin/members/count'),
        // Destek sayıları özeti bozmasın: hata verirse boş say.
        api.get<any[]>('/admin/return-requests').catch(() => []),
        api.get<any[]>('/admin/complaints').catch(() => []),
        api.get<any[]>('/admin/product-requests').catch(() => []),
      ]);
      const pending = (s?: string) => s !== 'resolved';
      setStats({
        markets: markets.length,
        products: products.length,
        outOfStock: products.filter((p) => !p.in_stock).length,
        todayOrders: orders.length,
        todayTotal: orders.reduce((s, o) => s + (Number(o.total ?? o.amount) || 0), 0),
        members: members.count,
        pendingReturns: returns.filter((r) => pending(r.return_request?.status)).length,
        pendingComplaints: complaints.filter((c) => pending(c.status)).length,
        productRequests: productRequests.length,
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tile = (label: string, value: string, href: string, sub?: string) => (
    <Card style={styles.tile}>
      <T muted size={12.5}>{label}</T>
      <T bold size={24}>{value}</T>
      {!!sub && <T muted size={12.5}>{sub}</T>}
      <Button small kind="ghost" label="Aç" onPress={() => router.navigate(href as any)} />
    </Card>
  );

  return (
    <Page title="Özet" subtitle={`Hoş geldiniz${user?.name ? `, ${user.name}` : ''}`} right={<Button small kind="secondary" icon="refresh" label="Yenile" onPress={load} />}>
      {error && <ErrorBox text={error} onRetry={load} />}
      {(user?.backup_codes_left ?? 8) <= 2 && (
        <Notice tone="warn" text={`Yedek kodunuz azaldı (${user?.backup_codes_left ?? 0}). Yenilemek için sunucuda sıfırlama gerekir.`} />
      )}
      {stats && (
        <View style={styles.grid}>
          {tile('Bugünkü siparişler', String(stats.todayOrders), '/siparisler', money(stats.todayTotal))}
          {tile('Pazarlar', String(stats.markets), '/pazarlar')}
          {tile('Ürünler', String(stats.products), '/urunler', `${stats.outOfStock} tükendi`)}
          {tile('Üyeler', String(stats.members), '/uyeler')}
          {tile('Ürün talepleri', String(stats.productRequests), '/urun-talepleri', 'onay bekliyor')}
          {tile('Destek (bekleyen)', String(stats.pendingReturns + stats.pendingComplaints), '/destek', `${stats.pendingReturns} iade · ${stats.pendingComplaints} öneri/şikayet`)}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // Her satırda iki kutu (dar ekranda da): %48 + 12 px boşluk.
  tile: { flexGrow: 1, flexBasis: '46%', maxWidth: '50%', minWidth: 130, gap: 2 },
});
