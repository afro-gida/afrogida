import { api, ApiError } from '@/lib/api';

/** backend/routers/auth.py::_normalize_address_payload ile birebir eşleşir. */
export type Address = {
  id: string;
  title: string; // "Evim" | "İşim" | "Diğer" ...
  city: string;
  district: string;
  neighborhood: string;
  street: string;
  building_no: string;
  floor?: string;
  apartment_no?: string;
  site_name?: string;
  description?: string;
  lat?: number | null;
  lng?: number | null;
  is_default: boolean;
};

export type AddressInput = Partial<Omit<Address, 'id' | 'is_default'>> & { is_default?: boolean };

export async function fetchAddresses(): Promise<{ addresses: Address[]; error: string | null }> {
  try {
    const addresses = await api.get<Address[]>('/auth/addresses');
    return { addresses, error: null };
  } catch (err) {
    if (err instanceof ApiError) return { addresses: [], error: err.message };
    return { addresses: [], error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

export async function createAddress(data: AddressInput): Promise<{ address: Address } | { error: string }> {
  try {
    const res = await api.post<{ success: boolean; address: Address }>('/auth/addresses', data);
    return { address: res.address };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

export async function updateAddress(id: string, data: AddressInput): Promise<{ address: Address } | { error: string }> {
  try {
    const res = await api.put<{ success: boolean; address: Address }>(`/auth/addresses/${id}`, data);
    return { address: res.address };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

export async function deleteAddress(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await api.del(`/auth/addresses/${id}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

export async function setDefaultAddress(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await api.patch(`/auth/addresses/${id}/default`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

/** Adresin mahallesi, verilen pazarın eve-servis verdiği mahalleler
 *  listesinde mi? (bkz. Market.delivery_neighborhoods — her pazarın kendi
 *  mahalle listesi var, kullanıcı talimatı). Liste boşsa/gelmemişse
 *  KISITLAMA yok sayılır (güvenli varsayılan — mevcut ürün filtresindeki
 *  mantıkla aynı). */
export function addressServesMarket(address: Address, deliveryNeighborhoods?: string[] | null): boolean {
  if (!deliveryNeighborhoods || deliveryNeighborhoods.length === 0) return true;
  const norm = (s: string) => s.trim().toLocaleLowerCase('tr');
  const target = norm(address.neighborhood || '');
  return deliveryNeighborhoods.some((n) => norm(n) === target);
}
