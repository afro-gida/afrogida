import { StyleSheet } from 'react-native';

/**
 * Müşteri uygulamasının premium yüzey dili (sepet, takip, profil, kampanyalar
 * vb. ekranlarla aynı): çerçevesiz dolu kartlar + sıcak hafif gölge; duvar
 * kağıdının üstünde hafif perde ki yazılar net okunsun.
 * Tema kuralı: açık = krem/turuncu (beyaz yüzey yok), koyu = siyah/yeşil.
 */
export const CARD_BG = { light: '#f8ebd6', dark: '#0e1411' } as const;
export const SCRIM = { light: 'rgba(232, 201, 158, 0.32)', dark: 'rgba(0, 0, 0, 0.55)' } as const;
/** Alttan açılan pencere / onay kutusu zemini. */
export const SHEET_BG = { light: '#f7ead6', dark: '#0a0f0c' } as const;

export const surface = StyleSheet.create({
  card: { borderRadius: 22, padding: 16 },
  shadow: {
    shadowColor: '#7a4a1c',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 17 },
  sectionTitle: { fontSize: 16, lineHeight: 20, fontWeight: '800' },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  iconCircleLg: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { borderRadius: 999, height: 52, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primaryBtnText: { color: '#fff', fontSize: 15.5, lineHeight: 19, fontWeight: '900' },
  input: { borderRadius: 16, height: 52, paddingHorizontal: 16, fontSize: 15 },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '800', marginBottom: 6, marginLeft: 4 },
});
