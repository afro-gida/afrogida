import { Platform } from 'react-native';

import { api, ApiError } from '@/lib/api';
import type { Order } from '@/lib/types';

type RawOrder = {
  tx_id: string;
  order_status: string;
  delivery_type: string;
  amount?: number;
  subtotal?: number;
  total?: number;
  created_at: string;
  items?: {
    name?: string; product_name_snapshot?: string; qty?: number; quantity?: number; unit?: string; unit_snapshot?: string;
    line_total?: number; total_price?: number; selected_options?: { title?: string; label?: string }[];
  }[];
  delivery_fee?: number;
  discount?: number;
  payment_method?: string;
  payment_status?: string;
  market_name?: string;
  pickup_time?: string | null;
  delivery_slot_start?: string | null;
  delivery_slot_end?: string | null;
  address?: string | null;
  delivered_at?: string | null;
  cancel_reason?: string | null;
};

function normalizeOrder(raw: RawOrder): Order {
  const delivery_type = raw.delivery_type === 'eve_servis' ? 'eve_servis' : 'gel_al';
  return {
    tx_id: raw.tx_id,
    order_status: (raw.order_status as Order['order_status']) || 'talep_alindi',
    delivery_type,
    amount: raw.amount ?? raw.total ?? raw.subtotal ?? 0,
    created_at: raw.created_at,
    items: (raw.items ?? []).map((it) => ({
      name: it.name ?? it.product_name_snapshot ?? 'Ürün',
      qty: it.qty ?? it.quantity ?? 1,
      unit: it.unit ?? it.unit_snapshot ?? '',
      line_total: it.line_total ?? it.total_price,
      selected_options: (it.selected_options ?? [])
        .filter((o) => o.title || o.label)
        .map((o) => ({ title: o.title ?? '', label: o.label ?? '' })),
    })),
    subtotal: raw.subtotal,
    delivery_fee: raw.delivery_fee,
    discount: raw.discount,
    payment_method: raw.payment_method,
    payment_status: raw.payment_status,
    market_name: raw.market_name,
    pickup_time: raw.pickup_time,
    delivery_slot_start: raw.delivery_slot_start,
    delivery_slot_end: raw.delivery_slot_end,
    address: raw.address,
    delivered_at: raw.delivered_at,
    cancel_reason: raw.cancel_reason,
  };
}

/** Tek sipariş (takip ekranı). Ayrı bir uç yok; müşterinin sipariş listesinden bulunur. */
export async function fetchOrder(txId: string): Promise<{ order: Order | null; error: string | null }> {
  const res = await fetchOrders();
  if (res.error) return { order: null, error: res.error };
  const order = res.orders.find((o) => o.tx_id === txId) ?? null;
  return { order, error: order ? null : 'Sipariş bulunamadı.' };
}

/** Giriş yapmış kullanıcının gerçek siparişlerini çeker. Giriş yoksa/hata olursa boş liste döner. */
export async function fetchOrders(): Promise<{ orders: Order[]; error: string | null }> {
  try {
    const raw = await api.get<RawOrder[]>('/orders');
    return { orders: raw.map(normalizeOrder), error: null };
  } catch (err) {
    if (err instanceof ApiError) {
      return { orders: [], error: err.message };
    }
    return { orders: [], error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

export type DeliveryType = 'gel_al' | 'eve_servis';
export type PaymentMethod = 'pay_at_counter' | 'online_card';

/**
 * Gerçek sipariş oluşturur (sunucu fiyatı/tutarı kendi hesaplar).
 * Ödeme yöntemi "online_card" ise backend'in kart ödemesini PayTR üzerinden
 * BAŞLATMASI gerekiyor — bu yüzden o durumda /orders yerine /payments/init
 * çağrılıyor (backend/routers/payments.py); dönen payment_url'e
 * yönlendirilerek ödeme PayTR'nin kendi (hosted) sayfasında tamamlanır,
 * kart bilgisi hiçbir zaman bizim uygulamadan geçmez.
 */
export async function createOrder(
  items: { id: string; qty: number; selected_options?: { title: string; label: string }[] }[],
  opts: {
    /** Siparişin verildiği pazar — sunucu teslimat ücreti, minimum sepet,
     *  nakit limiti ve saat kısıtlarını bu pazarın ayarlarıyla uygular. */
    marketId: string;
    deliveryType: DeliveryType;
    paymentMethod: PaymentMethod;
    address?: string;
    /** Seçilen kayıtlı adresin id'si — sunucu haritadan işaretlenen konumu
     *  bu adresten alıp siparişe (kuryeye) ekler. */
    addressId?: string;
    /** Gel-Al için seçilen saat dilimi, ör. "14:00-15:00". Boşsa "Şimdi" (en yakın uygun saat). */
    pickupTime?: string;
    /** Eve Servis için seçilen saat dilimi. İkisi de boşsa "Şimdi". */
    deliverySlotStart?: string;
    deliverySlotEnd?: string;
    /** Uygulanan kupon kodu — indirim yine sunucuda yeniden hesaplanır. */
    couponCode?: string;
    /** Gel-Al/Eve Servis mesafeli satış sözleşmesi onay kutusu işaretlendiyse true. */
    agreementsAccepted?: boolean;
    /** backend/core/config.py _AFRO_DOC_NAME_TR ile eşleşen belge kodu ("pickup" | "home_delivery"). */
    legalDocumentType?: string;
  }
): Promise<{ tx_id: string; payment_url?: string } | { error: string }> {
  try {
    const path = opts.paymentMethod === 'online_card' ? '/payments/init' : '/orders';
    const res = await api.post<{ success: boolean; tx_id: string; payment_url?: string }>(path, {
      items,
      market_id: opts.marketId,
      delivery_type: opts.deliveryType,
      payment_method: opts.paymentMethod,
      ...(opts.address ? { address: opts.address } : {}),
      ...(opts.address && opts.addressId ? { address_id: opts.addressId } : {}),
      ...(opts.pickupTime ? { pickup_time: opts.pickupTime } : {}),
      ...(opts.deliverySlotStart ? { delivery_slot_start: opts.deliverySlotStart } : {}),
      ...(opts.deliverySlotEnd ? { delivery_slot_end: opts.deliverySlotEnd } : {}),
      ...(opts.couponCode ? { coupon_code: opts.couponCode } : {}),
      ...(opts.agreementsAccepted ? { agreements_accepted: true, legal_document_type: opts.legalDocumentType } : {}),
      // Online ödeme bitince PayTR müşteriyi bu adresteki takip ekranına
      // döndürür (backend izinli adres listesiyle doğrular). Sadece web'de;
      // yoksa backend eski dönüş adresini kullanır.
      ...(opts.paymentMethod === 'online_card' && Platform.OS === 'web' && typeof window !== 'undefined'
        ? { app_url: window.location.origin }
        : {}),
    });
    return { tx_id: res.tx_id, payment_url: res.payment_url };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}
