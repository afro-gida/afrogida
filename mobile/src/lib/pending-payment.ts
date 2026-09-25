import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DeliveryType } from '@/lib/orders';
import type { CartLine } from '@/lib/types';

/**
 * Online ödemeye geçerken sepetin yedeği. Web'de PayTR'a tam sayfa
 * yönlendirme yapıldığı için bellekteki sepet kaybolur; ödeme reddedilirse
 * müşteri sepetine ürünleriyle geri dönebilsin diye sipariş no ile saklanır
 * (bkz. app/odeme/[tx].tsx). Ödeme onaylanınca silinir.
 */
export type PendingPayment = {
  txId: string;
  marketId: string;
  deliveryType: DeliveryType;
  lines: CartLine[];
  savedAt: number;
};

const KEY = 'afro_pending_payment';

export async function savePendingPayment(p: Omit<PendingPayment, 'savedAt'>) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...p, savedAt: Date.now() }));
  } catch {
    // saklanamazsa ödeme yine yapılır; sadece red durumunda sepet geri gelmez
  }
}

/** Sadece bu siparişe ait yedeği döndürür (başka siparişinki karışmasın). */
export async function loadPendingPayment(txId: string): Promise<PendingPayment | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPayment;
    return p && p.txId === txId && Array.isArray(p.lines) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Sipariş no bilinmeden son yedek (1 saatten eskiyse yok sayılır). Sunucu
 * dönüş adresini eski biçimde (/my-orders, /cart) verdiğinde hangi ödemenin
 * beklendiğini bulmak için (bkz. app/my-orders.tsx, app/cart.tsx).
 */
export async function loadLatestPendingPayment(): Promise<PendingPayment | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPayment;
    if (!p?.txId || Date.now() - (p.savedAt ?? 0) > 60 * 60 * 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearPendingPayment() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // yok say
  }
}
