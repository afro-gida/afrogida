import type { AddressInput } from '@/lib/addresses';

/**
 * Google Haritalar (tarayıcı JS API). Anahtar eski sitedekiyle aynı; tarayıcı
 * anahtarı olduğu için sayfada zaten açık görünür, güvenliği Google Cloud
 * tarafındaki alan adı (referrer) kısıtıdır. EXPO_PUBLIC_GOOGLE_MAPS_KEY ile
 * değiştirilebilir.
 */
export const GOOGLE_MAPS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? 'AIzaSyDJIQCluFiJt0GrkAB3t_l88-vux-i4lsA';

/** Harita ilk açıldığında (konum izni yoksa) merkez: Bursa / Nilüfer. */
export const DEFAULT_CENTER = { lat: 40.2215, lng: 28.8617 };

// google.maps tipleri projede yok; kullandığımız kadarını gevşek tutuyoruz.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GMaps = any;

let loader: Promise<GMaps> | null = null;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

/**
 * Anahtar reddedilirse (ör. izin verilmeyen alan adı) Google bunu harita
 * oluşturulduktan SONRA gm_authFailure ile bildirir; ekran hata kartına geçsin.
 */
export function onMapsAuthFailure(cb: () => void): () => void {
  if (authFailed) cb();
  authFailureListeners.add(cb);
  return () => authFailureListeners.delete(cb);
}

/** Harita betiğini bir kez yükler; hata olursa sonraki denemede yeniden dener. */
export function loadGoogleMaps(): Promise<GMaps> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  const w = window as unknown as { google?: { maps?: GMaps }; __afroMapsReady?: () => void; gm_authFailure?: () => void };
  if (w.google?.maps?.Map) return Promise.resolve(w.google.maps);
  if (loader) return loader;
  loader = new Promise<GMaps>((resolve, reject) => {
    const fail = (e: Error) => {
      loader = null;
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('timeout')), 15000);
    w.__afroMapsReady = () => {
      clearTimeout(timer);
      resolve(w.google!.maps);
    };
    w.gm_authFailure = () => {
      authFailed = true;
      authFailureListeners.forEach((cb) => cb());
      fail(new Error('auth'));
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&language=tr&region=TR&callback=__afroMapsReady&loading=async`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      s.remove();
      fail(new Error('network'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

type Component = { long_name: string; short_name: string; types: string[] };
type GeocodeResult = { address_components: Component[]; types: string[] };

const stripNeighborhood = (s: string) => s.replace(/\s+(mahallesi|mah\.?|mh\.?)$/i, '').trim();
const stripDistrict = (s: string) => s.replace(/\s+ilçesi$/i, '').trim();

/**
 * Ters geocode sonuçlarından adres alanları. Türkiye'de mahalle çoğunlukla
 * administrative_area_level_4; bazen neighborhood / sublocality. İlk sonuçta
 * olmayan alan sonraki sonuçlardan tamamlanır.
 */
export function addressFieldsFromGeocode(results: GeocodeResult[]): Partial<AddressInput> {
  const pick = (types: string[]) => {
    for (const t of types) {
      for (const r of results) {
        const c = r.address_components.find((x) => x.types.includes(t));
        if (c) return c.long_name;
      }
    }
    return '';
  };
  // Sokak / bina no yalnızca en yakın (ilk) sonuçtan: uzaktaki bir binanın
  // numarası yanlışlıkla forma dolmasın.
  const first = results[0]?.address_components ?? [];
  const street = first.find((x) => x.types.includes('route'))?.long_name ?? '';
  const buildingNo = first.find((x) => x.types.includes('street_number'))?.long_name ?? '';

  const out: Partial<AddressInput> = {};
  const neighborhood = stripNeighborhood(pick(['administrative_area_level_4', 'neighborhood', 'sublocality_level_1', 'sublocality']));
  const district = stripDistrict(pick(['administrative_area_level_2']));
  const city = pick(['administrative_area_level_1']);
  if (neighborhood) out.neighborhood = neighborhood;
  if (street && street !== 'Unnamed Road') out.street = street;
  if (buildingNo) out.building_no = buildingNo;
  if (district) out.district = district;
  if (city) out.city = city;
  return out;
}

/** Önizleme satırı: "Görükle Mah., Safran Sokak No:5 · Nilüfer/Bursa" */
export function previewLine(f: Partial<AddressInput>): string {
  const a = [f.neighborhood ? `${f.neighborhood} Mah.` : '', [f.street, f.building_no ? `No:${f.building_no}` : ''].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const b = [f.district, f.city].filter(Boolean).join('/');
  return [a, b].filter(Boolean).join(' · ');
}

/** Koyu tema harita görünümü (eski sitedeki koyu stil). */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2320' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#b9c2bd' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2320' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#39413c' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ea7a1' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#16303b' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8a938d' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1b3a24' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2c3530' }] },
];
