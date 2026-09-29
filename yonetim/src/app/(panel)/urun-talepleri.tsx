import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, ErrorBox, ListRow, Loading, Page, T, confirmAsync, dateTime, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import type { Product } from '@/lib/types';
import { useTheme } from '@/lib/theme';

/** Talepte gösterilen alanlar (türeyen fiyat alanları "Satış fiyatı" satırında). */
const FIELD_LABELS: Record<string, string> = {
  name: 'Ad',
  subcategory: 'Ana kategori',
  category: 'Alt kategori',
  unit: 'Birim',
  supplier_price: 'Alış fiyatı',
  price: 'Satış fiyatı',
  description: 'Açıklama',
  customization_options: 'Seçenekler',
  selectable: 'Seçilebilir',
  spicy_type: 'Acılık',
  customization_note_enabled: 'Not alanı',
  customization_note_label: 'Not başlığı',
};
const MONEY_FIELDS = new Set(['supplier_price', 'price']);

function show(field: string, v: unknown): string {
  if (v == null || v === '') return '—';
  if (MONEY_FIELDS.has(field)) return money(Number(v));
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (Array.isArray(v)) return v.map((g: any) => g?.title ?? '').filter(Boolean).join(', ') || `${v.length} grup`;
  return String(v);
}

/**
 * Ürün Talepleri: tedarikçinin açtığı yeni ürünler ve mevcut ürünlerde yaptığı
 * değişiklikler burada bekler; onaylanınca satışa / canlıya geçer. Önce
 * tedarikçiler (bekleyen talep sayısıyla), tedarikçiye basınca talepleri.
 */
export default function ProductRequests() {
  const t = useTheme();
  const [rows, setRows] = useState<Product[] | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.get<Product[]>('/admin/product-requests'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const bySupplier = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of rows ?? []) {
      const k = p.supplier_group || 'Tedarikçisiz';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'));
  }, [rows]);

  const list = supplier ? bySupplier.find(([k]) => k === supplier)?.[1] ?? [] : [];

  async function decide(p: Product, approve: boolean) {
    const isNew = p.pending_approval?.type === 'new';
    if (!approve && !(await confirmAsync(isNew ? `"${p.name}" reddedilsin mi? Yeni ürün silinir.` : `"${p.name}" değişikliği reddedilsin mi? Ürün eski haliyle kalır.`))) return;
    setBusy(p.id);
    setError(null);
    try {
      await api.post(`/admin/product-requests/${p.id}/${approve ? 'approve' : 'reject'}`);
      setRows((r) => r?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const back = supplier ? <Button small kind="secondary" icon="arrow-back" label="Tedarikçiler" onPress={() => setSupplier(null)} /> : <Button small kind="secondary" icon="refresh" label="Yenile" onPress={load} />;

  return (
    <Page title={supplier ?? 'Ürün Talepleri'} subtitle={supplier ? `${list.length} bekleyen talep` : 'Tedarikçinin eklediği / güncellediği ürünler onayınızı bekler'} right={back}>
      {error && <ErrorBox text={error} onRetry={load} />}
      {!rows && !error && <Loading />}

      {rows && !supplier && (
        bySupplier.length ? (
          <Card style={{ padding: 0, gap: 0 }}>
            {bySupplier.map(([name, items]) => (
              <ListRow key={name} title={name} right={<Badge label={`${items.length} talep`} tone="warn" />} onPress={() => setSupplier(name)} />
            ))}
          </Card>
        ) : (
          <T muted>Bekleyen talep yok.</T>
        )
      )}

      {rows && supplier && list.length === 0 && <T muted>Bu tedarikçinin bekleyen talebi kalmadı.</T>}
      {rows && supplier && list.map((p) => {
        const pa = p.pending_approval!;
        const isNew = pa.type === 'new';
        const changes = pa.changes ?? {};
        const newImage = 'image_url' in changes ? (changes.image_url as string | null) : undefined;
        const fields = Object.keys(FIELD_LABELS).filter((f) => f in changes);
        return (
          <Card key={p.id} style={{ gap: 8 }}>
            <View style={styles.head}>
              <T bold style={{ flex: 1 }}>{p.name}</T>
              <Badge label={isNew ? 'Yeni ürün' : 'Güncelleme'} tone={isNew ? 'tint' : 'warn'} />
            </View>
            <T muted size={12}>{pa.requested_by_name || 'Tedarikçi'} · {dateTime(pa.requested_at)}</T>

            {isNew ? (
              <View style={styles.row}>
                {!!p.image_url && <Image source={{ uri: p.image_url }} style={[styles.img, { borderColor: t.border }]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={13}>{p.subcategory ?? '—'} › {p.category} · {p.unit}</T>
                  <T size={13}>Alış {money(p.supplier_price)} → Satış {money(p.price)}</T>
                  {!!p.description && <T muted size={12.5}>{p.description}</T>}
                  {!p.image_url && <T muted size={12.5}>Resim yok</T>}
                </View>
              </View>
            ) : (
              <>
                {newImage !== undefined && (
                  <View style={styles.row}>
                    <View style={styles.imgCol}>
                      <T muted size={11}>Eski resim</T>
                      {p.image_url ? <Image source={{ uri: p.image_url }} style={[styles.img, { borderColor: t.border }]} /> : <T muted>—</T>}
                    </View>
                    <View style={styles.imgCol}>
                      <T muted size={11}>Yeni resim</T>
                      {newImage ? <Image source={{ uri: newImage }} style={[styles.img, { borderColor: t.tint }]} /> : <T muted>Kaldırıldı</T>}
                    </View>
                  </View>
                )}
                {fields.map((f) => (
                  <View key={f} style={styles.change}>
                    <T muted size={12.5} style={{ width: 96 }}>{FIELD_LABELS[f]}</T>
                    <T size={13} style={{ flex: 1 }}>
                      <T muted size={13}>{show(f, (p as any)[f])}</T>  →  <T bold size={13}>{show(f, changes[f])}</T>
                    </T>
                  </View>
                ))}
              </>
            )}

            <View style={styles.row}>
              <Button small icon="checkmark" label="Onayla" loading={busy === p.id} onPress={() => decide(p, true)} />
              <Button small kind="danger" icon="close" label="Reddet" disabled={busy === p.id} onPress={() => decide(p, false)} />
            </View>
          </Card>
        );
      })}
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  imgCol: { gap: 4 },
  img: { width: 84, height: 84, borderRadius: 8, borderWidth: 1 },
  change: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
