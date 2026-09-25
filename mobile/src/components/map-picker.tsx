import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form-card';
import { ThemedText } from '@/components/themed-text';
import { SHEET_BG, surface } from '@/constants/surfaces';
import { Spacing, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import type { AddressInput } from '@/lib/addresses';
import {
  DARK_MAP_STYLE,
  DEFAULT_CENTER,
  addressFieldsFromGeocode,
  loadGoogleMaps,
  onMapsAuthFailure,
  previewLine,
  type GMaps,
} from '@/lib/google-maps';

export type PickedLocation = { lat: number; lng: number; fields: Partial<AddressInput> };

type LatLng = { lat: number; lng: number };

/**
 * Tam ekran konum seçici (eski sitedeki gibi): harita kaydırılır, ortadaki
 * iğne kapı girişine getirilir; iğnenin altındaki adres canlı çözülür ve
 * "Bu Konumu Onayla" ile koordinat + adres alanları forma döner.
 * Şimdilik web (Google Maps JS); uygulamaya çevrilince yerel harita eklenecek.
 */
export function MapPicker({
  visible,
  initial,
  onClose,
  onPicked,
}: {
  visible: boolean;
  initial?: LatLng | null;
  onClose: () => void;
  onPicked: (p: PickedLocation) => void;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const mapHost = useRef<View>(null);
  const mapRef = useRef<GMaps>(null);
  const geocoderRef = useRef<GMaps>(null);
  const geocodeSeq = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [fields, setFields] = useState<Partial<AddressInput> | null>(null);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const lift = useRef(new Animated.Value(0)).current;

  // İğne harita sürüklenirken hafifçe kalkar, bırakınca iner.
  useEffect(() => {
    Animated.timing(lift, {
      toValue: dragging ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [dragging, lift]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    let cancelled = false;
    const listeners: GMaps[] = [];
    setStatus('loading');
    setFields(null);
    const offAuth = onMapsAuthFailure(() => !cancelled && setStatus('error'));

    loadGoogleMaps()
      .then((maps) => {
        // Modal içeriği bir sonraki karede DOM'a yerleşiyor.
        requestAnimationFrame(() => {
          const el = mapHost.current as unknown as HTMLElement | null;
          if (cancelled || !el) return;
          const start = initial ?? DEFAULT_CENTER;
          const map = new maps.Map(el, {
            center: start,
            zoom: initial ? 18 : 16,
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
            gestureHandling: 'greedy',
            styles: isDark ? DARK_MAP_STYLE : undefined,
          });
          mapRef.current = map;
          geocoderRef.current = new maps.Geocoder();
          listeners.push(map.addListener('dragstart', () => setDragging(true)));
          listeners.push(map.addListener('dragend', () => setDragging(false)));
          listeners.push(
            map.addListener('idle', () => {
              const c = map.getCenter();
              const next = { lat: c.lat(), lng: c.lng() };
              setCenter(next);
              resolve(next);
            }),
          );
          // Map tıklanınca iğne oraya gelsin (eski sitedeki gibi).
          listeners.push(map.addListener('click', (e: GMaps) => e.latLng && map.panTo(e.latLng)));
          setStatus('ready');
          if (!initial) locate(true);
        });
      })
      .catch(() => !cancelled && setStatus('error'));

    return () => {
      cancelled = true;
      offAuth();
      listeners.forEach((l) => l.remove());
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reloadKey]);

  function resolve(pos: LatLng) {
    const g = geocoderRef.current;
    if (!g) return;
    const seq = ++geocodeSeq.current;
    setResolving(true);
    g.geocode({ location: pos, language: 'tr' })
      .then((res: GMaps) => {
        if (seq !== geocodeSeq.current) return;
        setFields(addressFieldsFromGeocode(res.results ?? []));
      })
      .catch(() => seq === geocodeSeq.current && setFields({}))
      .finally(() => seq === geocodeSeq.current && setResolving(false));
  }

  function locate(silent = false) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        map.panTo({ lat: p.coords.latitude, lng: p.coords.longitude });
        map.setZoom(18);
      },
      () => {
        setLocating(false);
        if (!silent) alertOnce('Konumuna erişilemedi. Tarayıcı ayarlarından konum iznini açabilir ya da haritayı elle kaydırabilirsin.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  function confirm() {
    if (!center) return;
    onPicked({ lat: center.lat, lng: center.lng, fields: fields ?? {} });
  }

  const sheetBg = isDark ? SHEET_BG.dark : SHEET_BG.light;
  const preview = fields ? previewLine(fields) : '';
  const pinTranslate = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: sheetBg }]}>
        <View ref={mapHost} style={StyleSheet.absoluteFill} />

        {status === 'ready' && (
          <View pointerEvents="none" style={styles.pinWrap}>
            <Animated.View style={{ alignItems: 'center', transform: [{ translateY: pinTranslate }] }}>
              <View style={[styles.pinHead, { backgroundColor: theme.tint }]}>
                <MaterialCommunityIcons name="door" size={18} color="#fff" />
              </View>
              <View style={[styles.pinStem, { backgroundColor: theme.tint }]} />
            </Animated.View>
            <View style={[styles.pinShadow, { opacity: dragging ? 0.18 : 0.32 }]} />
          </View>
        )}

        {/* Üst: kapat + not */}
        <View style={[styles.top, { paddingTop: insets.top + Spacing.two }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Kapat" style={[styles.roundBtn, surface.shadow, { backgroundColor: sheetBg }]}>
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>
          <View style={[styles.note, surface.shadow, { backgroundColor: sheetBg }]}>
            <MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={theme.tint} />
            <ThemedText style={styles.noteText}>
              Lütfen apartman / ev girişini iğnenin tam üzerine gelecek şekilde seçiniz.
            </ThemedText>
          </View>
        </View>

        {status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.tint} />
            <ThemedText themeColor="textSecondary" style={styles.centerText}>Harita yükleniyor…</ThemedText>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.center}>
            <View style={[styles.errorCard, surface.shadow, { backgroundColor: sheetBg }]}>
              <MaterialCommunityIcons name="map-marker-off-outline" size={30} color={theme.tint} />
              <ThemedText style={styles.errorTitle}>Harita yüklenemedi</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                İnternet bağlantını kontrol et. Adresi harita olmadan da yazabilirsin.
              </ThemedText>
              <PrimaryButton label="Tekrar Dene" arrow={false} onPress={() => setReloadKey((k) => k + 1)} />
              <Pressable onPress={onClose} hitSlop={8}>
                <ThemedText style={[styles.link, { color: theme.tint }]}>Adresi elle yaz</ThemedText>
              </Pressable>
            </View>
          </View>
        )}

        {/* Alt: konumum + seçilen adres + onay */}
        {status === 'ready' && (
          <View style={styles.bottom} pointerEvents="box-none">
            <Pressable
              onPress={() => locate(false)}
              accessibilityLabel="Konumumu bul"
              style={[styles.roundBtn, styles.locateBtn, surface.shadow, { backgroundColor: sheetBg }]}
            >
              {locating ? <ActivityIndicator size="small" color={theme.tint} /> : <MaterialCommunityIcons name="crosshairs-gps" size={22} color={theme.tint} />}
            </Pressable>
            <View style={[styles.sheet, surface.shadow, { backgroundColor: sheetBg, paddingBottom: insets.bottom + Spacing.three }]}>
              <View style={styles.addrRow}>
                <View style={[surface.iconCircle, { backgroundColor: withAlpha(theme.tint, 0.14) }]}>
                  <MaterialCommunityIcons name="home-map-marker" size={20} color={theme.tint} />
                </View>
                <View style={styles.flex}>
                  <ThemedText themeColor="textSecondary" style={styles.addrLabel}>Seçilen konum</ThemedText>
                  <ThemedText style={styles.addrText} numberOfLines={2}>
                    {dragging || (resolving && !preview) ? 'Adres bulunuyor…' : preview || 'Adres bulunamadı — kaydettikten sonra elle yazabilirsin'}
                  </ThemedText>
                </View>
              </View>
              <PrimaryButton label="Bu Konumu Onayla" arrow={false} onPress={confirm} disabled={!center || dragging} />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

let alerted = false;
function alertOnce(msg: string) {
  if (alerted || typeof window === 'undefined') return;
  alerted = true;
  window.alert(msg);
  setTimeout(() => (alerted = false), 5000);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: Spacing.three },
  roundBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  note: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 18, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 17, fontWeight: '800' },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // İğnenin ucu tam harita merkezine denk gelsin diye yukarı kaydırılır (baş 36 + sap 14).
  pinHead: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: -50, borderWidth: 3, borderColor: '#fff' },
  pinStem: { width: 3, height: 14, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pinShadow: { width: 14, height: 5, borderRadius: 7, backgroundColor: '#000', marginTop: -2 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  centerText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  errorCard: { width: '100%', maxWidth: 380, borderRadius: 26, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  errorTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  link: { fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: Spacing.one },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  locateBtn: { alignSelf: 'flex-end', marginRight: Spacing.three, marginBottom: Spacing.three },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4 },
  addrLabel: { fontSize: 12, lineHeight: 15, fontWeight: '800' },
  addrText: { fontSize: 15, lineHeight: 20, fontWeight: '900' },
});
