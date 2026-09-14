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
  items?: { name?: string; product_name_snapshot?: string; qty?: number; quantity?: number; unit?: string; unit_snapshot?: string }[];
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
    })),
  };
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
  items: { id: string; qty: number }[],
  opts: { deliveryType: DeliveryType; paymentMethod: PaymentMethod; address?: string }
): Promise<{ tx_id: string; payment_url?: string } | { error: string }> {
  try {
    const path = opts.paymentMethod === 'online_card' ? '/payments/init' : '/orders';
    const res = await api.post<{ success: boolean; tx_id: string; payment_url?: string }>(path, {
      items,
      delivery_type: opts.deliveryType,
      payment_method: opts.paymentMethod,
      ...(opts.address ? { address: opts.address } : {}),
    });
    return { tx_id: res.tx_id, payment_url: res.payment_url };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}
