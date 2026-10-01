import type { Address } from '@/lib/addresses';
import { addressFieldsFromGeocode, loadGoogleMaps } from '@/lib/google-maps';

/**
 * Eve Servis siparişinden önce: müşteri şu an sipariş adresinin mahallesinde mi?
 * Telefonun konumu Google ile mahalleye çevrilir ve adresin mahallesiyle
 * karşılaştırılır. Farklıysa sepet "farklı bir adrese mi sipariş veriyorsunuz?"
 * diye sorar. Sadece uyarıdır: konum izni yoksa / bulunamazsa sipariş engellenmez.
 */
export type LocationCheck =
  | { result: 'same' }
  | { result: 'different'; here: string }
  | { result: 'unknown' };

// Mahalle sınırında duran kişiye boşuna soru çıkmasın: haritada işaretli
// kapıya bu kadar yakınsa mahalle adı farklı görünse de "aynı yer" sayılır.
const NEAR_METERS = 300;
// Mahalle bulunamazsa (Google vermezse) bu kadar uzaksa "farklı" sayılır.
const FAR_METERS = 1500;

const norm = (s = '') =>
  s
    .normalize('NFC')
    .replace(/̇/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+(mahallesi|mah\.?|mh\.?)$/, '')
    .replace(/\s+/g, ' ')
    .trim();

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), // izin verilmedi / bulunamadı -> sorma
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

// Kontrol siparişi bekletmesin: konum + Google cevabı bu sürede gelmezse sormadan devam.
const TOTAL_TIMEOUT_MS = 10000;

export function checkAtAddress(address: Address): Promise<LocationCheck> {
  const timeout = new Promise<LocationCheck>((resolve) => setTimeout(() => resolve({ result: 'unknown' }), TOTAL_TIMEOUT_MS));
  return Promise.race([check(address), timeout]);
}

async function check(address: Address): Promise<LocationCheck> {
  try {
    const pos = await currentPosition();
    if (!pos) return { result: 'unknown' };

    const target = typeof address.lat === 'number' && typeof address.lng === 'number' ? { lat: address.lat, lng: address.lng } : null;
    if (target && distanceMeters(pos, target) <= NEAR_METERS) return { result: 'same' };

    const maps = await loadGoogleMaps();
    const res = await new maps.Geocoder().geocode({ location: pos, language: 'tr' });
    const here = addressFieldsFromGeocode(res.results ?? []).neighborhood ?? '';

    if (here && address.neighborhood) {
      return norm(here) === norm(address.neighborhood) ? { result: 'same' } : { result: 'different', here };
    }
    if (target && distanceMeters(pos, target) > FAR_METERS) return { result: 'different', here };
    return { result: 'unknown' };
  } catch {
    return { result: 'unknown' };
  }
}
