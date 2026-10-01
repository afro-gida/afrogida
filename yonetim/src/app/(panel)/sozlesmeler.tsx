import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, ErrorBox, Field, Loading, Notice, Page, Section, T, confirmAsync, dateTime } from '@/components/ui';
import { api, docUrl, errMsg, pickPdf, uploadPdf } from '@/lib/api';

type DocVersion = {
  id: string; version: string; pdf_url?: string; is_active?: boolean; status?: string;
  published_at?: string; created_at?: string; change_reason?: string;
};
type CatalogDoc = {
  code: string; name: string; where: string; default_pdf: string | null; login_gate: boolean;
  current: { version: string | null; pdf_url: string | null; updated_at?: string | null };
  using_default: boolean; missing_file?: boolean; history: DocVersion[]; accepted_count: number | null; member_count: number | null;
};
type SupplierStatus = {
  contract: { url?: string; version?: string; title?: string };
  suppliers: { user_id: string; name: string; supplier_group: string; accepted: boolean; accepted_at?: string | null }[];
};

function openDoc(path?: string | null) {
  const url = docUrl(path);
  if (!url) return;
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else Linking.openURL(url);
}

/** Sonraki sürüm önerisi: "2.1" -> "2.2", yoksa "YYYY-AA". */
function nextVersion(v?: string | null) {
  const m = /^(\d+)\.(\d+)$/.exec(v ?? '');
  if (m) return `${m[1]}.${Number(m[2]) + 1}`;
  if (/^\d+$/.test(v ?? '')) return `${Number(v) + 1}`;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }).slice(0, 7);
}

/** Yeni sürüm formu: PDF seç -> yükle, sürüm + değişiklik notu, yayınla. */
function PublishForm({ suggested, onPublish, onCancel, warn }: {
  suggested: string; onPublish: (v: { pdf_url: string; version: string; change_reason: string }) => Promise<void>;
  onCancel: () => void; warn?: string;
}) {
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [version, setVersion] = useState(suggested);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'up' | 'pub' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    const f = await pickPdf();
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return setError('PDF en fazla 20 MB olabilir');
    setBusy('up');
    setError(null);
    try {
      setPdf({ url: await uploadPdf(f, f.name), name: f.name });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!pdf) return setError('Önce PDF seç');
    if (!version.trim()) return setError('Sürüm gir');
    if (!(await confirmAsync(`${version.trim()} sürümü yayınlansın mı?${warn ? `\n\n${warn}` : ''}`))) return;
    setBusy('pub');
    setError(null);
    try {
      await onPublish({ pdf_url: pdf.url, version: version.trim(), change_reason: reason.trim() });
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.rowWrap}>
        <Button kind="secondary" icon="cloud-upload-outline" label={pdf ? 'Başka PDF seç' : 'PDF seç'} onPress={choose} loading={busy === 'up'} />
        {pdf && <Button small kind="ghost" icon="open-outline" label={`${pdf.name} ✓`} onPress={() => openDoc(pdf.url)} />}
      </View>
      <View style={styles.pair}>
        <Field style={styles.half} label="Sürüm" value={version} onChangeText={setVersion} placeholder="Örn: 2.0 ya da 2026-10" />
        <Field style={styles.grow} label="Neler değişti? (isteğe bağlı)" value={reason} onChangeText={setReason} placeholder="Örn: İade süresi 14 güne çıktı" />
      </View>
      {!!warn && <T muted size={12.5}>{warn}</T>}
      {error && <ErrorBox text={error} />}
      <View style={styles.actions}>
        <Button kind="ghost" label="Vazgeç" onPress={onCancel} />
        <Button icon="checkmark-circle-outline" label="Yayınla" onPress={publish} loading={busy === 'pub'} disabled={!pdf} />
      </View>
    </View>
  );
}

/**
 * Sözleşmeler (eski paneldeki "Gizlilik ve Sözleşmeler"): her belgenin
 * yürürlükteki PDF'i, yeni sürüm yükleme, sürüm geçmişi / geri dönme,
 * varsayılana dönme, giriş onayı durumu; ayrıca Tedarikçi Sözleşmesi.
 */
export default function Contracts() {
  const [docs, setDocs] = useState<CatalogDoc[] | null>(null);
  const [sup, setSup] = useState<SupplierStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, s] = await Promise.all([
        api.get<CatalogDoc[]>('/admin/legal-catalog'),
        api.get<SupplierStatus>('/admin/supplier-contract-status'),
      ]);
      setDocs(d);
      setSup(s);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(msg: string, fn: () => Promise<unknown>) {
    setError(null);
    setDone(null);
    try {
      await fn();
      await load();
      setDone(msg);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const pendingSuppliers = sup?.suppliers.filter((s) => !s.accepted) ?? [];

  return (
    <Page title="Sözleşmeler" subtitle="Müşteri ve tedarikçi sözleşmeleri · PDF yükle, sürüm yayınla">
      {error && <ErrorBox text={error} onRetry={load} />}
      {done && <Notice text={done} />}
      {!docs && !error && <Loading />}

      {docs?.map((d) => {
        const active = d.history.find((h) => h.is_active);
        const gateText = d.login_gate && d.current.version && d.member_count != null
          ? `${d.accepted_count ?? 0}/${d.member_count} üye bu sürümü onayladı`
          : null;
        return (
          <Card key={d.code} style={styles.card}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <T bold size={16}>{d.name}</T>
                <T muted size={12.5}>{d.where}</T>
              </View>
              {d.missing_file
                ? <Badge label="PDF dosyası yok" tone="danger" />
                : d.using_default
                  ? <Badge label={d.default_pdf ? 'Varsayılan PDF' : 'PDF yok'} tone={d.default_pdf ? 'muted' : 'danger'} />
                  : <Badge label={`Sürüm ${d.current.version}`} tone="ok" />}
            </View>
            {d.missing_file && (
              <T size={12.5} color="#dc2626">
                Yürürlükteki kaydın ({active?.version ?? '-'}) PDF dosyası sunucuda yok (eski siteden kalma).
                {d.current.pdf_url ? ' Müşteriye şimdilik varsayılan PDF gösteriliyor.' : ' Müşteri bu belgeyi açamıyor.'} Yeni sürüm yükle.
              </T>
            )}
            <T muted size={12.5}>
              {d.using_default ? 'Henüz yeni sürüm yüklenmedi.' : `Yayın: ${dateTime(active?.published_at)}${active?.change_reason ? ` · ${active.change_reason}` : ''}`}
              {gateText ? ` · ${gateText}` : ''}
            </T>
            <View style={styles.rowWrap}>
              <Button small kind="secondary" icon="open-outline" label="PDF'i aç" onPress={() => openDoc(d.current.pdf_url)} disabled={!d.current.pdf_url} />
              <Button small icon="cloud-upload-outline" label="Yeni sürüm yükle" onPress={() => setPublishing(publishing === d.code ? null : d.code)} />
              {d.history.length > 0 && (
                <Button small kind="ghost" icon="time-outline" label={`Geçmiş (${d.history.length})`} onPress={() => setHistoryOf(historyOf === d.code ? null : d.code)} />
              )}
            </View>

            {publishing === d.code && (
              <PublishForm
                suggested={nextVersion(d.current.version)}
                warn={d.login_gate ? 'Üyeler bir sonraki girişlerinde yeni sürümü onaylayacak.' : 'Yeni siparişlerde bu sürüm onaylanır.'}
                onCancel={() => setPublishing(null)}
                onPublish={async (v) => {
                  await api.post(`/admin/legal-catalog/${d.code}/publish`, v);
                  setPublishing(null);
                  await load();
                  setDone(`${d.name} ${v.version} sürümü yayınlandı.`);
                }}
              />
            )}

            {historyOf === d.code && (
              <View style={styles.history}>
                {d.history.map((h) => (
                  <View key={h.id} style={styles.histRow}>
                    <View style={{ flex: 1 }}>
                      <T bold size={13.5}>Sürüm {h.version} {h.is_active ? '· yürürlükte' : ''}</T>
                      <T muted size={12}>{dateTime(h.published_at || h.created_at)}{h.change_reason ? ` · ${h.change_reason}` : ''}</T>
                    </View>
                    <Button small kind="ghost" label="Aç" onPress={() => openDoc(h.pdf_url)} />
                    {!h.is_active && (
                      <Button
                        small
                        kind="secondary"
                        label="Yürürlüğe al"
                        onPress={async () => {
                          if (await confirmAsync(`${d.name} için ${h.version} sürümüne dönülsün mü?`)) {
                            act(`${h.version} sürümü yeniden yürürlükte.`, () => api.post(`/admin/legal-catalog/${d.code}/activate`, { doc_id: h.id }));
                          }
                        }}
                      />
                    )}
                  </View>
                ))}
                {!d.using_default && !!d.default_pdf && (
                  <Button
                    small
                    kind="ghost"
                    icon="refresh"
                    label="Varsayılan PDF'e dön"
                    onPress={async () => {
                      if (await confirmAsync(`${d.name} varsayılan PDF'e dönsün mü?`)) {
                        act('Varsayılan PDF kullanılıyor.', () => api.post(`/admin/legal-catalog/${d.code}/use-default`));
                      }
                    }}
                  />
                )}
              </View>
            )}
          </Card>
        );
      })}

      {sup && (
        <Section title="Tedarikçi Sözleşmesi">
          <T muted size={12.5}>Tedarikçiler panele girmeden bu sözleşmeyi onaylar. Yeni sürüm yayınlanınca hepsi tekrar onaylamak zorunda kalır (onaylayana kadar ürün ekleyip düzenleyemez).</T>
          <View style={styles.head}>
            <T bold style={{ flex: 1 }}>{sup.contract.title || 'Tedarikçi Sözleşmesi'} · sürüm {sup.contract.version}</T>
            <Badge label={`${sup.suppliers.length - pendingSuppliers.length} onayladı`} tone="ok" />
            {pendingSuppliers.length > 0 && <Badge label={`${pendingSuppliers.length} bekliyor`} tone="warn" />}
          </View>
          <View style={styles.rowWrap}>
            <Button small kind="secondary" icon="open-outline" label="PDF'i aç" onPress={() => openDoc(sup.contract.url)} />
            <Button small icon="cloud-upload-outline" label="Yeni sürüm yükle" onPress={() => setPublishing(publishing === 'supplier' ? null : 'supplier')} />
          </View>
          {publishing === 'supplier' && (
            <PublishForm
              suggested={nextVersion(sup.contract.version)}
              warn="Tüm tedarikçiler yeni sürümü onaylayana kadar ürün ekleyip düzenleyemez."
              onCancel={() => setPublishing(null)}
              onPublish={async (v) => {
                await api.post('/admin/supplier-contract', { url: v.pdf_url, version: v.version, title: sup.contract.title || 'Tedarikçi Sözleşmesi' });
                setPublishing(null);
                await load();
                setDone(`Tedarikçi Sözleşmesi ${v.version} sürümü yayınlandı.`);
              }}
            />
          )}
          {pendingSuppliers.length > 0 && (
            <View style={{ gap: 2 }}>
              <T size={12.5} bold>Onay bekleyenler</T>
              {pendingSuppliers.map((s) => (
                <T key={s.user_id} muted size={12.5}>{s.name || 'İsimsiz'}{s.supplier_group ? ` · ${s.supplier_group}` : ''}</T>
              ))}
            </View>
          )}
        </Section>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  pair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' },
  half: { width: 160 },
  grow: { flexGrow: 1, flexBasis: 220 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  form: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#9993', paddingTop: 10 },
  history: { gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#9993', paddingTop: 8 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
});
