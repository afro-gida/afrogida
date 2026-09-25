import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/form-card';
import { FormField, Notice } from '@/components/form-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  fetchAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  type Address,
  type AddressInput,
} from '@/lib/addresses';
import { CARD_BG, SCRIM, SHEET_BG, surface } from '@/constants/surfaces';
import { useAuth } from '@/lib/auth-context';
import { Spacing, withAlpha } from '@/constants/theme';

const TITLE_OPTIONS = ['Ev', 'İş', 'Diğer'];


const EMPTY_FORM: AddressInput = {
  title: 'Ev',
  city: 'Bursa',
  district: '',
  neighborhood: '',
  street: '',
  site_name: '',
  building_no: '',
  floor: '',
  apartment_no: '',
  description: '',
};

export default function AddressesScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const cardBg = scheme === 'dark' ? CARD_BG.dark : CARD_BG.light;

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Address | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function reload() {
    setLoading(true);
    const res = await fetchAddresses();
    setAddresses(res.addresses);
    setError(res.error);
    setLoading(false);
  }

  // Oturum geri yüklenmeden istek atılırsa (sayfa yenileme / bağlantıyla açılış)
  // "Yetkilendirme gerekli" dönüyordu -> oturumu bekle.
  const { user, loading: authLoading } = useAuth();
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    reload();
  }, [authLoading, user]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(addr: Address) {
    setEditing(addr);
    setFormOpen(true);
  }

  async function handleDelete(addr: Address) {
    const res = await deleteAddress(addr.id);
    if (!('error' in res)) reload();
  }

  async function handleSetDefault(addr: Address) {
    const res = await setDefaultAddress(addr.id);
    if (!('error' in res)) reload();
  }

  const isDark = scheme === 'dark';

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={[styles.flex, { backgroundColor: isDark ? SCRIM.dark : SCRIM.light }]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={10}
            accessibilityLabel="Geri"
            style={[styles.roundBtn, { backgroundColor: cardBg }]}
          >
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.flex}>
            <ThemedText style={surface.title}>Adreslerim</ThemedText>
            {addresses.length > 0 && (
              <ThemedText themeColor="textSecondary" style={surface.subtitle}>{addresses.length} kayıtlı adres</ThemedText>
            )}
          </View>
          <Pressable onPress={openCreate} hitSlop={10} accessibilityLabel="Adres ekle" style={[styles.roundBtn, { backgroundColor: theme.tint }]}>
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>

        {!authLoading && !user ? (
          <View style={styles.list}>
            <View style={[surface.card, surface.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
              <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                <MaterialCommunityIcons name="lock-outline" size={30} color={theme.tint} />
              </View>
              <ThemedText style={styles.emptyTitle}>Giriş yapmalısın</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emptyText}>Adreslerini görmek için giriş yap.</ThemedText>
              <PrimaryButton label="Giriş Yap" onPress={() => router.push('/giris')} />
            </View>
          </View>
        ) : loading ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} color={theme.tint} />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {error && <Notice text={error} />}
            {addresses.length === 0 && !error && (
              <View style={[surface.card, surface.shadow, styles.emptyCard, { backgroundColor: cardBg }]}>
                <View style={[surface.iconCircleLg, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name="map-marker-plus-outline" size={30} color={theme.tint} />
                </View>
                <ThemedText style={styles.emptyTitle}>Henüz kayıtlı adresin yok</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.emptyText}>
                  Eve servis siparişi verebilmek için bir teslimat adresi ekle.
                </ThemedText>
              </View>
            )}
            {addresses.map((addr) => (
              <AddressCard
                key={addr.id}
                addr={addr}
                cardBg={cardBg}
                onEdit={() => openEdit(addr)}
                onDelete={() => handleDelete(addr)}
                onSetDefault={() => handleSetDefault(addr)}
              />
            ))}

            <PrimaryButton label="Yeni Adres Ekle" arrow={false} onPress={openCreate} />
          </ScrollView>
        )}
      </View>

      <AddressFormModal
        visible={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />
    </Screen>
  );
}

type Mci = keyof typeof MaterialCommunityIcons.glyphMap;

function titleIcon(title?: string): Mci {
  const t = (title ?? '').toLocaleLowerCase('tr-TR');
  if (t === 'ev') return 'home-outline';
  if (t === 'iş') return 'briefcase-outline';
  return 'map-marker-outline';
}

/** Adres kartı. Silme iki adımlı: ilk dokunuşta "Silinsin mi?" sorar. */
function AddressCard({
  addr,
  cardBg,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  addr: Address;
  cardBg: string;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const theme = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const line1 = [
    [addr.neighborhood, addr.street].filter(Boolean).join(' '),
    addr.site_name,
    addr.building_no ? `No:${addr.building_no}` : '',
    addr.floor ? `Kat:${addr.floor}` : '',
    addr.apartment_no ? `Daire:${addr.apartment_no}` : '',
  ].filter(Boolean).join(' · ');
  const line2 = [addr.district, addr.city].filter(Boolean).join(' / ');

  return (
    <View style={[surface.card, surface.shadow, styles.card, { backgroundColor: cardBg }]}>
      <View style={styles.cardTop}>
        <View style={[surface.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
          <MaterialCommunityIcons name={titleIcon(addr.title)} size={20} color={theme.tint} />
        </View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.cardTitle}>{addr.title}</ThemedText>
            {addr.is_default && (
              <View style={[styles.defaultPill, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                <Ionicons name="checkmark-circle" size={12} color={theme.tint} />
                <ThemedText style={[styles.defaultText, { color: theme.tint }]}>Varsayılan</ThemedText>
              </View>
            )}
          </View>
          <ThemedText themeColor="textSecondary" style={styles.addrLine}>{line1}</ThemedText>
          {!!line2 && <ThemedText themeColor="textSecondary" style={styles.addrLine}>{line2}</ThemedText>}
          {!!addr.description && (
            <ThemedText themeColor="textSecondary" style={[styles.addrLine, styles.addrNote]}>{addr.description}</ThemedText>
          )}
          {!addr.is_default && (
            <Pressable onPress={onSetDefault} hitSlop={6} style={styles.setDefault}>
              <ThemedText style={[styles.setDefaultText, { color: theme.tint }]}>Varsayılan yap</ThemedText>
            </Pressable>
          )}
        </View>

        {/* Düzenle / sil: adres bilgisinin sağında, aynı satırda (kart aşağı uzamasın). */}
        <View style={styles.actions}>
          <Pressable onPress={onEdit} accessibilityLabel="Düzenle" hitSlop={6} style={[styles.iconBtn, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
            <MaterialCommunityIcons name="pencil-outline" size={17} color={theme.text} />
          </Pressable>
          {confirmDelete ? (
            <Pressable onPress={onDelete} accessibilityLabel="Silmeyi onayla" style={[styles.iconBtn, { backgroundColor: theme.danger }]}>
              <MaterialCommunityIcons name="check" size={18} color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setConfirmDelete(true)}
              accessibilityLabel="Sil"
              hitSlop={6}
              style={[styles.iconBtn, { backgroundColor: withAlpha(theme.danger, 0.12) }]}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={17} color={theme.danger} />
            </Pressable>
          )}
        </View>
      </View>
      {confirmDelete && (
        <ThemedText style={[styles.confirmText, { color: theme.danger }]}>Silmek için ✓'e tekrar dokun</ThemedText>
      )}
    </View>
  );
}

function AddressFormModal({
  visible,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initial: Address | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [form, setForm] = useState<AddressInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      // Kayıtlı adreste boş alanlar null/undefined gelebiliyor -> boş metinle doldur
      // (yoksa kutu "kontrollü"den "kontrolsüz"e geçiyor, React uyarı veriyordu).
      setForm(
        initial
          ? { ...EMPTY_FORM, ...Object.fromEntries(Object.entries(initial).filter(([, v]) => v != null)) }
          : EMPTY_FORM,
      );
      setError(null);
    }
  }, [visible, initial]);

  function set<K extends keyof AddressInput>(key: K, value: AddressInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.neighborhood?.trim() || !form.street?.trim() || !form.building_no?.trim()) {
      setError('Mahalle, sokak/cadde ve bina no zorunlu.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = initial ? await updateAddress(initial.id, form) : await createAddress(form);
    setSubmitting(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  const sheetBg = scheme === 'dark' ? SHEET_BG.dark : SHEET_BG.light;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modalSheet, { backgroundColor: sheetBg }]}>
        <View style={[styles.grabber, { backgroundColor: withAlpha(theme.text, 0.2) }]} />
        <View style={styles.modalHeaderRow}>
          <ThemedText style={[styles.modalTitle, styles.flex]}>{initial ? 'Adresi düzenle' : 'Yeni adres'}</ThemedText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat" style={[styles.roundBtnSm, { backgroundColor: withAlpha(theme.text, 0.08) }]}>
            <Ionicons name="close" size={20} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.formBody} keyboardShouldPersistTaps="handled">
          <View style={[styles.segment, { backgroundColor: withAlpha(theme.text, 0.06) }]}>
            {TITLE_OPTIONS.map((t) => {
              const active = form.title === t;
              return (
                <Pressable key={t} onPress={() => set('title', t)} style={[styles.segmentBtn, active && { backgroundColor: theme.tint }]}>
                  <MaterialCommunityIcons name={titleIcon(t)} size={16} color={active ? '#fff' : theme.textSecondary} />
                  <ThemedText style={[styles.segmentText, { color: active ? '#fff' : theme.text }]}>{t}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Google Haritalar ile konum seçme henüz yok — adres elle giriliyor
              (anahtar eski sitede var; ayrı iş olarak eklenecek). */}
          <Notice tone="info" text="Haritadan konum seçme yakında eklenecek — şimdilik adresi elle gir." />

          <View style={styles.row2}>
            <View style={styles.flex}>
              <FormField label="İl" value={form.city} onChangeText={(v) => set('city', v)} />
            </View>
            <View style={styles.flex}>
              <FormField label="İlçe" value={form.district} onChangeText={(v) => set('district', v)} />
            </View>
          </View>
          <FormField label="Mahalle *" icon="map-marker-outline" value={form.neighborhood} onChangeText={(v) => set('neighborhood', v)} placeholder="Örn: Beşevler Mah." />
          <FormField label="Sokak / Cadde *" icon="road-variant" value={form.street} onChangeText={(v) => set('street', v)} placeholder="Örn: Demo Sk." />
          <FormField label="Site adı (varsa)" icon="office-building-outline" value={form.site_name} onChangeText={(v) => set('site_name', v)} placeholder="Örn: Mavi Şehir Sitesi" />
          <View style={styles.row3}>
            <View style={styles.flex}>
              <FormField label="Bina no *" value={form.building_no} onChangeText={(v) => set('building_no', v)} style={styles.center} />
            </View>
            <View style={styles.flex}>
              <FormField label="Kat" value={form.floor} onChangeText={(v) => set('floor', v)} style={styles.center} />
            </View>
            <View style={styles.flex}>
              <FormField label="Daire" value={form.apartment_no} onChangeText={(v) => set('apartment_no', v)} style={styles.center} />
            </View>
          </View>
          <FormField
            label="Adres tarifi"
            icon="text-box-outline"
            value={form.description}
            onChangeText={(v) => set('description', v)}
            placeholder="Örn: Parkın karşısındaki beyaz bina"
            multiline
            multilineHeight={90}
          />

          {error && <Notice text={error} />}

          <PrimaryButton label="Adresi Kaydet" arrow={false} onPress={handleSave} loading={submitting} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  roundBtnSm: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five, gap: Spacing.three },
  emptyCard: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.five },
  emptyTitle: { fontSize: 18, lineHeight: 22, fontWeight: '900', marginTop: Spacing.two, textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 19, textAlign: 'center', paddingHorizontal: Spacing.two },
  card: { gap: Spacing.three - 2 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 2 },
  cardTitle: { fontSize: 16, lineHeight: 20, fontWeight: '900' },
  defaultPill: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  defaultText: { fontSize: 11.5, lineHeight: 14, fontWeight: '900' },
  addrLine: { fontSize: 13, lineHeight: 18 },
  addrNote: { fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'center' },
  setDefault: { alignSelf: 'flex-start', marginTop: 6 },
  setDefaultText: { fontSize: 12.5, lineHeight: 16, fontWeight: '900' },
  confirmText: { fontSize: 12, lineHeight: 15, fontWeight: '800', textAlign: 'right', marginTop: -4 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  // Form penceresi
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: Spacing.two,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: Spacing.two },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  modalTitle: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.4 },
  formBody: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three },
  segment: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 12 },
  segmentText: { fontSize: 13.5, lineHeight: 17, fontWeight: '800' },
  row2: { flexDirection: 'row', gap: Spacing.two + 2 },
  row3: { flexDirection: 'row', gap: Spacing.two + 2 },
  center: { textAlign: 'center' },
});
