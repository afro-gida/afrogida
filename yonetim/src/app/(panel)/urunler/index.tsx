import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, Chips, ErrorBox, Field, ListRow, Loading, Page, T, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { salePrice, withoutPriceFields, type Product } from '@/lib/types';

const norm = (s: string) => s.toLocaleLowerCase('tr-TR');

export default function Products() {
  const router = useRouter();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [supplier, setSupplier] = useState('__all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<Product[]>('/admin/products'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const suppliers = useMemo(() => [...new Set((rows ?? []).map((p) => p.supplier_group || '—'))], [rows]);
  const shown = (rows ?? []).filter(
    (p) => (supplier === '__all' || (p.supplier_group || '—') === supplier) && (!q.trim() || norm(p.name).includes(norm(q.trim()))),
  );

  async function toggleStock(p: Product) {
    setBusyId(p.id);
    try {
      // Sunucu PUT'ta tüm alanları yazar -> ürünün tamamı gönderilir; fiyat
      // alanları hariç (gönderilmezse sunucu mevcut fiyatı korur).
      const updated = await api.put<Product>(`/admin/products/${p.id}`, { ...withoutPriceFields(p), in_stock: !p.in_stock });
      setRows((rs) => rs?.map((r) => (r.id === p.id ? updated : r)) ?? null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page title="Ürünler" subtitle={rows ? `${rows.length} ürün` : undefined} right={<Button small icon="add" label="Yeni ürün" onPress={() => router.push('/urunler/yeni')} />}>
      {error && <ErrorBox text={error} onRetry={load} />}
      <Field label="Ara" placeholder="Ürün adı" value={q} onChangeText={setQ} />
      <Chips options={[{ value: '__all', label: 'Tüm tedarikçiler' }, ...suppliers.map((s) => ({ value: s, label: s }))]} value={supplier} onChange={setSupplier} />
      {!rows && !error ? (
        <Loading />
      ) : (
        <Card>
          {shown.length === 0 && <T muted>Ürün yok.</T>}
          {shown.map((p) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={`${p.supplier_group || '—'} · ${p.category}${p.subcategory ? ` › ${p.subcategory}` : ''} · ${money(salePrice(p))} / ${p.unit}${p.supplier_price ? ` (alış ${money(p.supplier_price)})` : ''}`}
              onPress={() => router.push(`/urunler/${p.id}`)}
              right={
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  {!p.active && <Badge label="Pasif" />}
                  {p.hidden && <Badge label="Gizli" />}
                  <Button
                    small
                    kind={p.in_stock ? 'secondary' : 'danger'}
                    label={p.in_stock ? 'Stokta' : 'Tükendi'}
                    loading={busyId === p.id}
                    onPress={() => toggleStock(p)}
                  />
                </View>
              }
            />
          ))}
        </Card>
      )}
    </Page>
  );
}
