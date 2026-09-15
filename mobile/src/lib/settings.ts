import { api, ApiError } from '@/lib/api';

export type StoreSettings = {
  delivery_fee?: number;
  free_delivery_min_amount?: number;
  /** Gel-Al siparişleri için minimum sepet tutarı (bkz. backend/services/orders.py). */
  min_pickup_amount?: number;
  /** Eve Servis siparişleri için minimum sepet tutarı. */
  min_delivery_amount?: number;
  /** Pazarın kendi açık olduğu saatler (ör. "00:00-22:00"). */
  market_hours?: string;
  /** Gel-Al (tezgahtan alım) saatleri (ör. "11:00-19:00"). */
  pickup_order_hours?: string;
  /** Eve Servis sipariş/teslimat saatleri. */
  delivery_order_hours?: string;
  /** Belirli bir tutarın üzerinde nakit/tezgah ödemesini kapatıp yalnızca
   *  online ödemeyi zorunlu kılan limit (bkz. backend/services/orders.py). */
  cash_payment_limit_enabled?: boolean;
  cash_payment_max_amount?: number;
  /** Destek/iletişim telefonu — boşsa ilgili buton hiç gösterilmez. */
  support_phone?: string;
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
