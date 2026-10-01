import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Badge, Button, Chips, ErrorBox, Field, Loading, Notice, Page, Section, T, confirmAsync, money } from '@/components/ui';
import { api, errMsg } from '@/lib/api';
import { fetchPricing, profitFor, rangeText, type PricingState, type ProfileId, type Tier } from '@/lib/pricing';
import { useTheme } from '@/lib/theme';

type Preview = {
  changed: number; old_profit_total: number; new_profit_total: number;
  examples: { name: string; supplier_group?: string; supplier_price: number; old_price: number; new_price: number; old_profit: number; new_profit: number }[];
};

const SAMPLES = [10, 30, 50, 75, 100, 150, 200, 300, 400, 600];
const num = (s: string) => {
  const n = Number(s.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const sortTiers = (t: Tier[]) => [...t].sort((a, b) => a.from - b.from);

/**
 * Kâr Profilleri: Düşük / Orta / Yüksek kazanç tabloları. Satış = alış +
 * aralığın kârı. Biri aktif; "Uygula" onu aktif yapıp mevcut ürünleri yeniden
 * fiyatlar (önce önizleme gösterilir).
 */
export default function ProfitProfiles() {
  const t = useTheme();
  const [state, setState] = useState<PricingState | null>(null);
  const [sel, setSel] = useState<ProfileId>('orta');
  // Düzenlenen tablolar (kaydedilmemiş olabilir): metin olarak tutulur ("12," yazarken bozulmasın)
  const [drafts, setDrafts] = useState<Record<ProfileId, { name: string; rows: { from: string; profit: string }[] }> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | 'apply' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchPricing(true);
      setState(s);
      setSel((cur) => cur ?? s.active);
      const d = {} as Record<ProfileId, { name: string; rows: { from: string; profit: string }[] }>;
      for (const id of s.order) {
        d[id] = { name: s.profiles[id].name, rows: sortTiers(s.profiles[id].tiers).map((x) => ({ from: String(x.from), profit: String(x.profit) })) };
      }
      setDrafts(d);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tiersOf = useCallback((id: ProfileId): Tier[] =>
    sortTiers((drafts?.[id]?.rows ?? []).map((r) => ({ from: num(r.from), profit: num(r.profit) }))), [drafts]);

  const dirty = useMemo(() => {
    if (!state || !drafts) return false;
    const a = JSON.stringify({ n: drafts[sel].name, t: tiersOf(sel) });
    const b = JSON.stringify({ n: state.profiles[sel].name, t: sortTiers(state.profiles[sel].tiers) });
    return a !== b;
  }, [state, drafts, sel, tiersOf]);

  if (!state || !drafts) return <Page title="Kâr Profilleri">{error ? <ErrorBox text={error} onRetry={load} /> : <Loading />}</Page>;

  const draft = drafts[sel];
  const tiers = tiersOf(sel);
  const setRows = (rows: { from: string; profit: string }[]) => {
    setPreview(null);
    setDone(null);
    setDrafts({ ...drafts, [sel]: { ...draft, rows } });
  };

  async function save() {
    setBusy('save');
    setError(null);
    try {
      await api.put(`/admin/pricing/profiles/${sel}`, { name: draft.name, tiers });
      await load();
      setDone(sel === state!.active
        ? 'Kaydedildi. Bu profil aktif: yeni fiyatlamalar bu tabloyla. Mevcut ürünler için "Uygula".'
        : 'Kaydedildi.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function showPreview() {
    setBusy('preview');
    setError(null);
    setDone(null);
    try {
      setPreview(await api.post<Preview>('/admin/pricing/preview', { profile_id: sel, tiers }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (dirty) return setError('Önce değişiklikleri kaydet.');
    if (!(await confirmAsync(`"${draft.name}" aktif yapılsın ve ${preview?.changed ?? 'tüm'} ürünün satış fiyatı güncellensin mi?`))) return;
    setBusy('apply');
    setError(null);
    try {
      const r = await api.post<{ updated: number }>('/admin/pricing/apply', { profile_id: sel });
      setPreview(null);
      await load();
      setDone(`"${draft.name}" aktif. ${r.updated} ürünün fiyatı güncellendi.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const input = [styles.cell, { backgroundColor: t.input, borderColor: t.border, color: t.text }];

  return (
    <Page title="Kâr Profilleri" subtitle={`Aktif: ${state.profiles[state.active].name} · satış = alış + aralığın kârı`}>
      <Chips<ProfileId>
        options={state.order.map((id) => ({ value: id, label: `${drafts[id].name}${id === state.active ? ' ✓' : ''}` }))}
        value={sel}
        onChange={(v) => { setSel(v); setPreview(null); setDone(null); setError(null); }}
      />

      <Section title={draft.name} right={sel === state.active ? <Badge label="Aktif profil" tone="ok" /> : <Badge label="Pasif" />}>
        <Field label="Profil adı" value={draft.name} onChangeText={(v) => setDrafts({ ...drafts, [sel]: { ...draft, name: v } })} />
        <View style={styles.headRow}>
          <T size={12} bold muted style={styles.colFrom}>Alış ≥ (₺)</T>
          <T size={12} bold muted style={styles.colProfit}>Kâr (₺)</T>
          <T size={12} bold muted style={styles.flex}>Aralık · örnek</T>
          <View style={{ width: 34 }} />
        </View>
        {draft.rows.map((r, i) => {
          const sortedIdx = tiers.findIndex((x) => x.from === num(r.from) && x.profit === num(r.profit));
          const example = num(r.from) > 0 ? num(r.from) : 10;
          return (
            <View key={i} style={styles.row}>
              <TextInput value={r.from} editable={i !== 0} keyboardType="decimal-pad" onChangeText={(v) => setRows(draft.rows.map((x, j) => (j === i ? { ...x, from: v.replace(/[^\d.,]/g, '') } : x)))} style={[input, styles.colFrom, i === 0 && { opacity: 0.6 }]} />
              <TextInput value={r.profit} keyboardType="decimal-pad" onChangeText={(v) => setRows(draft.rows.map((x, j) => (j === i ? { ...x, profit: v.replace(/[^\d.,]/g, '') } : x)))} style={[input, styles.colProfit]} />
              <T size={12.5} muted style={styles.flex}>
                {sortedIdx >= 0 ? rangeText(tiers, sortedIdx) : ''} · {example} ₺ → {money(example + (profitFor(example, tiers) ?? 0))}
              </T>
              <Pressable onPress={() => setRows(draft.rows.filter((_, j) => j !== i))} disabled={i === 0} style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]} accessibilityLabel="Satırı sil">
                <Ionicons name="close" size={18} color={t.danger} />
              </Pressable>
            </View>
          );
        })}
        <View style={styles.actions}>
          <Button small kind="ghost" icon="add" label="Aralık ekle" onPress={() => {
            const last = tiers[tiers.length - 1];
            setRows([...draft.rows, { from: String((last?.from ?? 0) + 50), profit: String(last?.profit ?? 0) }]);
          }} />
          <View style={styles.flex} />
          <Button kind="secondary" icon="save-outline" label="Kaydet" onPress={save} loading={busy === 'save'} disabled={!dirty} />
          <Button icon="eye-outline" label={sel === state.active ? 'Ürünlere uygula' : 'Bu profili uygula'} onPress={showPreview} loading={busy === 'preview'} />
        </View>
        {dirty && <T size={12.5} color={t.warn}>Kaydedilmemiş değişiklik var.</T>}
      </Section>

      {error && <ErrorBox text={error} />}
      {done && <Notice text={done} />}

      {preview && (
        <Section title="Önizleme" right={<Button small kind="ghost" label="Kapat" onPress={() => setPreview(null)} />}>
          <T>
            <T bold>{preview.changed}</T> ürünün satış fiyatı değişecek. Ürün başı kârların toplamı{' '}
            <T bold>{money(preview.old_profit_total)}</T> → <T bold color={preview.new_profit_total >= preview.old_profit_total ? t.ok : t.danger}>{money(preview.new_profit_total)}</T>
          </T>
          {preview.examples.slice(0, 15).map((e, i) => (
            <View key={i} style={styles.exRow}>
              <T size={13} style={styles.flex} numberOfLines={1}>{e.name}{e.supplier_group ? ` · ${e.supplier_group}` : ''}</T>
              <T size={13} muted>alış {money(e.supplier_price)}</T>
              <T size={13}>{money(e.old_price)} → <T bold size={13}>{money(e.new_price)}</T></T>
            </View>
          ))}
          {preview.changed > Math.min(15, preview.examples.length) && (
            <T muted size={12.5}>… ve {preview.changed - Math.min(15, preview.examples.length)} ürün daha</T>
          )}
          <View style={styles.actions}>
            <Button kind="ghost" label="Vazgeç" onPress={() => setPreview(null)} />
            <Button icon="checkmark-circle-outline" label="Onayla ve uygula" onPress={apply} loading={busy === 'apply'} disabled={dirty} />
          </View>
          {dirty && <T size={12.5} color={t.warn}>Uygulamadan önce kaydet.</T>}
        </Section>
      )}

      <Section title="Karşılaştırma (satış fiyatı · kâr)">
        <View style={styles.cmpRow}>
          <T size={12} bold muted style={styles.cmpFirst}>Alış</T>
          {state.order.map((id) => (
            <T key={id} size={12} bold muted style={styles.cmpCol}>{drafts[id].name}{id === state.active ? ' ✓' : ''}</T>
          ))}
        </View>
        {SAMPLES.map((s) => (
          <View key={s} style={[styles.cmpRow, { borderTopColor: t.border }]}>
            <T size={13} bold style={styles.cmpFirst}>{s} ₺</T>
            {state.order.map((id) => {
              const k = profitFor(s, tiersOf(id)) ?? 0;
              return (
                <T key={id} size={13} style={[styles.cmpCol, id === sel && { fontWeight: '700' }]}>
                  {money(s + k)} <T size={12} muted>(+{k})</T>
                </T>
              );
            })}
          </View>
        ))}
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cell: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, textAlign: 'center' },
  colFrom: { width: 110 },
  colProfit: { width: 100 },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end' },
  exRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'transparent' },
  cmpFirst: { width: 70 },
  cmpCol: { flex: 1, minWidth: 0 },
});
