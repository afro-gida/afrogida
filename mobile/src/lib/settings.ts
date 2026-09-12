import { api, ApiError } from '@/lib/api';

export type StoreSettings = {
  delivery_fee?: number;
  free_delivery_min_amount?: number;
};

export async function fetchSettings(): Promise<StoreSettings> {
  try {
    return await api.get<StoreSettings>('/settings');
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /settings hata döndü:', err.status, err.message);
    }
    return {};
  }
}
