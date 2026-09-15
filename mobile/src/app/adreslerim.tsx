import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

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
import { IconGreen, Spacing, withAlpha } from '@/constants/theme';

const TITLE_OPTIONS = ['Ev', 'İş', 'Diğer'];

const CARD_BG_DARK = 'rgba(0, 0, 0, 0.18)';
const CARD_BG_LIGHT = 'rgba(255, 255, 255, 0.35)';

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
  const cardBg = scheme === 'dark' ? CARD_BG_DARK : CARD_BG_LIGHT;

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

  useEffect(() => {
    reload();
  }, []);

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

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ThemedText style={styles.backArrow}>←</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.flex}>
          Adreslerim
        </ThemedText>
        <Pressable onPress={openCreate} hitSlop={12}>
          <Ionicons name="add-circle-outline" size={26} color={theme.tint} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.five }} color={theme.tint} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {error && (
            <ThemedText themeColor="danger" type="small" style={{ marginBottom: Spacing.two }}>
              {error}
            </ThemedText>
          )}
          {addresses.length === 0 && !error && (
            <View style={[styles.emptyWrap, { backgroundColor: cardBg, borderColor: theme.border }]}>
              <Ionicons name="location-outline" size={54} color={IconGreen} />
              <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
                Henüz kayıtlı adresin yok.
              </ThemedText>
            </View>
          )}
          {addresses.map((addr) => (
            <View key={addr.id} style={[styles.card, { backgroundColor: cardBg, borderColor: theme.tint }]}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="home-outline" size={18} color={theme.tint} />
                <ThemedText type="smallBold" style={styles.flex}>
                  {addr.title}
                </ThemedText>
                {addr.is_default && (
                  <View style={[styles.defaultBadge, { backgroundColor: theme.tint }]}>
                    <ThemedText style={styles.defaultBadgeText}>Varsayılan</ThemedText>
                  </View>
                )}
                <Pressable onPress={() => openEdit(addr)} hitSlop={8} style={styles.iconBtnSpacing}>
                  <Ionicons name="pencil-outline" size={18} color={theme.textSecondary} />
                </Pressable>
                <Pressable onPress={() => handleDelete(addr)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.danger} />
                </Pressable>
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: 4 }}>
                {[addr.neighborhood, addr.street].filter(Boolean).join(' ')}
                {addr.building_no ? ` No:${addr.building_no}` : ''}
                {addr.floor ? ` K:${addr.floor}` : ''}
                {addr.apartment_no ? ` D:${addr.apartment_no}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[addr.district, addr.city].filter(Boolean).join(' / ')}
              </ThemedText>
              {!addr.is_default && (
                <Pressable onPress={() => handleSetDefault(addr)} style={{ marginTop: 6 }}>
                  <ThemedText themeColor="tint" type="small" style={{ fontWeight: '700' }}>
                    Varsayılan yap
                  </ThemedText>
                </Pressable>
              )}
            </View>
          ))}

          <Pressable onPress={openCreate} style={[styles.addBtn, { backgroundColor: theme.tint }]}>
            <Ionicons name="add" size={18} color="#fff" />
            <ThemedText style={{ color: '#fff', fontWeight: '700' }}>Adres Ekle</ThemedText>
          </Pressable>
        </ScrollView>
      )}

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
      setForm(initial ? { ...initial } : EMPTY_FORM);
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

  const inputStyle = [
    styles.input,
    {
      borderColor: theme.border,
      color: theme.text,
      backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)',
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modalSheet, { backgroundColor: scheme === 'dark' ? '#0d1210' : '#fff', borderColor: theme.tint }]}>
        <ScrollView contentContainerStyle={{ gap: Spacing.two }}>
          <View style={styles.modalHeaderRow}>
            <ThemedText type="subtitle" style={styles.flex}>
              {initial ? 'Adresi Düzenle' : 'Yeni Adres'}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          <View style={styles.toggleRow}>
            {TITLE_OPTIONS.map((t) => {
              const active = form.title === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => set('title', t)}
                  style={[
                    styles.toggleBtn,
                    { borderColor: theme.tint, backgroundColor: active ? theme.tint : 'transparent' },
                  ]}
                >
                  <ThemedText type="small" style={{ color: active ? '#fff' : theme.text, fontWeight: '600' }}>
                    {t}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {/* Google Haritalar API anahtarı henüz tanımlanmadığı için harita
              ile konum seçme şimdilik yok — adres elle giriliyor. */}
          <View style={styles.labelRow}>
            <Ionicons name="location-outline" size={21} color={IconGreen} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              Haritadan konum seçme yakında eklenecek — şimdilik adresi elle gir.
            </ThemedText>
          </View>

          <View style={styles.row2}>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>İl</ThemedText>
              <TextInput value={form.city} onChangeText={(v) => set('city', v)} style={inputStyle} placeholderTextColor={theme.textSecondary} />
            </View>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>İlçe</ThemedText>
              <TextInput value={form.district} onChangeText={(v) => set('district', v)} style={inputStyle} placeholderTextColor={theme.textSecondary} />
            </View>
          </View>

          <View style={styles.row2}>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Mahalle *</ThemedText>
              <TextInput value={form.neighborhood} onChangeText={(v) => set('neighborhood', v)} style={inputStyle} placeholderTextColor={theme.textSecondary} />
            </View>
            <View style={styles.flex}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Sokak / Cadde *</ThemedText>
              <TextInput value={form.street} onChangeText={(v) => set('street', v)} style={inputStyle} placeholderTextColor={theme.textSecondary} />
            </View>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Site Adı (Varsa)</ThemedText>
          <TextInput
            value={form.site_name}
            onChangeText={(v) => set('site_name', v)}
            placeholder="Örn: Mavi Şehir Sitesi"
            placeholderTextColor={theme.textSecondary}
            style={inputStyle}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Bina Detayları</ThemedText>
          <View style={styles.row3}>
            <TextInput
              value={form.building_no}
              onChangeText={(v) => set('building_no', v)}
              placeholder="No *"
              placeholderTextColor={theme.textSecondary}
              style={[inputStyle, styles.numInput]}
            />
            <TextInput
              value={form.floor}
              onChangeText={(v) => set('floor', v)}
              placeholder="Kat"
              placeholderTextColor={theme.textSecondary}
              style={[inputStyle, styles.numInput]}
            />
            <TextInput
              value={form.apartment_no}
              onChangeText={(v) => set('apartment_no', v)}
              placeholder="Daire"
              placeholderTextColor={theme.textSecondary}
              style={[inputStyle, styles.numInput]}
            />
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Adres Tarifi</ThemedText>
          <TextInput
            value={form.description}
            onChangeText={(v) => set('description', v)}
            placeholder="Örn: Parkın karşısındaki beyaz bina"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]}
          />

          {error && (
            <ThemedText themeColor="danger" type="small">
              {error}
            </ThemedText>
          )}

          <Pressable
            style={[styles.saveBtn, { backgroundColor: '#14B67E' }]}
            onPress={handleSave}
            disabled={submitting}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <ThemedText style={{ color: '#fff' }} type="smallBold">
                Adresi Kaydet
              </ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three },
  backBtn: { padding: Spacing.one },
  backArrow: { fontSize: 20 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  emptyWrap: {
    borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.two, padding: Spacing.five, marginTop: Spacing.four,
  },
  card: { borderRadius: 16, borderWidth: 1.5, padding: Spacing.three },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtnSpacing: { marginLeft: 4 },
  defaultBadge: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  defaultBadgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 999, paddingVertical: Spacing.three, marginTop: Spacing.two,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0,
    padding: Spacing.three,
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  toggleRow: { flexDirection: 'row', gap: Spacing.two },
  labelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  toggleBtn: { flex: 1, borderRadius: 999, borderWidth: 1.5, paddingVertical: Spacing.two, alignItems: 'center' },
  row2: { flexDirection: 'row', gap: Spacing.two },
  row3: { flexDirection: 'row', gap: Spacing.two },
  numInput: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.one, textAlign: 'center' },
  label: { marginBottom: 2 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 14 },
  saveBtn: { borderRadius: 999, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
});
