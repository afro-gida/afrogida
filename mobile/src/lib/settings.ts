import { api, ApiError } from '@/lib/api';
import type { Market } from '@/lib/types';

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

/**
 * Teslimat ücreti, minimum sepet, nakit limiti ve saatler PAZAR BAZLI —
 * sunucu siparişi seçili pazarın ayarlarıyla hesaplıyor. Ekranda da aynı
 * değerler görünsün diye genel /settings'in üzerine pazarın ayarları yazılır
 * (destek telefonu gibi pazara özel olmayan alanlar genel ayardan gelir).
 */
export function withMarketSettings(global: StoreSettings, market: Market | undefined): StoreSettings {
  if (!market) return global;
  return {
    ...global,
    delivery_fee: market.teslimat_ucreti ?? 0,
    free_delivery_min_amount: market.ucretsiz_teslimat_alt_limiti ?? 0,
    min_pickup_amount: market.gel_al_min_tutar ?? 0,
    min_delivery_amount: market.eve_servis_min_tutar ?? 0,
    market_hours: market.pazar_saati ?? global.market_hours,
    pickup_order_hours: market.gel_al_saati ?? global.pickup_order_hours,
    delivery_order_hours: market.eve_servis_saati ?? global.delivery_order_hours,
    cash_payment_limit_enabled: market.nakit_tezgah_limit_enabled ?? false,
    cash_payment_max_amount: market.nakit_tezgah_maksimum_tutari ?? 0,
  };
}

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
