import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Badge, Button, Card, ErrorBox, Field, ListRow, Loading, Page, T, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { salePrice, withoutPriceFields, type Product } from '@/lib/types';

const norm = (s: string) => s.toLocaleLowerCase('tr-TR');
const NO_SUPPLIER = 'Tedarikçisiz';
const supplierOf = (p: Product) => p.supplier_group || NO_SUPPLIER;

/**
 * Ürünler: önce tedarikçiler listelenir (ürün / tükenen sayısıyla),
 * tedarikçiye basınca o tedarikçinin ürünleri açılır (?t=Tedarikçi).
 * Arama yazılınca tüm tedarikçilerde arar.
 */
export default function Products() {
  const router = useRouter();
  const { t: selected } = useLocalSearchParams<{ t?: string }>();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
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

  const suppliers = useMemo(() => {
    const map = new Map<string, { total: number; out: number }>();
    for (const p of rows ?? []) {
      const s = map.get(supplierOf(p)) ?? { total: 0, out: 0 };
      s.total += 1;
      if (!p.in_stock) s.out += 1;
      map.set(supplierOf(p), s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [rows]);

  const needle = norm(q.trim());
  const products = (rows ?? [])
    .filter((p) => (needle ? norm(p.name).includes(needle) : supplierOf(p) === selected))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

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

  const showProducts = !!needle || !!selected;
  const title = needle ? 'Arama sonuçları' : selected ? selected : 'Ürünler';
  const subtitle = !rows
    ? undefined
    : showProducts
      ? `${products.length} ürün`
      : `${suppliers.length} tedarikçi · ${rows.length} ürün`;

  return (
    <Page
      title={title}
      subtitle={subtitle}
      right={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!!selected && !needle && <Button small kind="secondary" icon="arrow-back" label="Tedarikçiler" onPress={() => router.setParams({ t: undefined })} />}
          <Button small icon="add" label="Yeni ürün" onPress={() => router.push(selected ? `/urunler/yeni?t=${encodeURIComponent(selected)}` : '/urunler/yeni')} />
        </View>
      }
    >
      {error && <ErrorBox text={error} onRetry={load} />}
      <Field label="Ürün ara (tüm tedarikçiler)" placeholder="Ürün adı" value={q} onChangeText={setQ} />
      {!rows && !error ? (
        <Loading />
      ) : !showProducts ? (
        <Card>
          {suppliers.length === 0 && <T muted>Henüz ürün yok.</T>}
          {suppliers.map(([name, s]) => (
            <ListRow
              key={name}
              title={name}
              subtitle={`${s.total} ürün${s.out ? ` · ${s.out} tükendi` : ''}`}
              onPress={() => router.setParams({ t: name })}
              right={s.out ? <Badge label={`${s.out} tükendi`} tone="danger" /> : undefined}
            />
          ))}
        </Card>
      ) : (
        <Card>
          {products.length === 0 && <T muted>Ürün yok.</T>}
          {products.map((p) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={`${needle ? `${supplierOf(p)} · ` : ''}${p.category}${p.subcategory ? ` › ${p.subcategory}` : ''} · ${money(salePrice(p))} / ${p.unit}${p.supplier_price ? ` (alış ${money(p.supplier_price)})` : ''}`}
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
