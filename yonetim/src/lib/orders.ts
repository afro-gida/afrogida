export const ORDER_STATUS: Record<string, string> = {
  talep_alindi: 'Sipariş alındı',
  hazirlik_bekliyor: 'Hazırlık bekliyor',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim edildi',
  iptal_edildi: 'İptal edildi',
  teslim_alinmadi: 'Teslim alınmadı',
  musteri_gelmedi_iptal: 'Müşteri gelmedi (iptal)',
};

export const FINAL_STATUSES = ['teslim_edildi', 'iptal_edildi', 'teslim_alinmadi', 'musteri_gelmedi_iptal'];

export const PAYMENT_STATUS: Record<string, string> = {
  paid: 'Ödendi',
  pending: 'Ödeme bekleniyor',
  unpaid: 'Teslimde ödenecek',
  failed: 'Ödeme başarısız',
  iade_edildi: 'İade edildi',
  kismi_iade_edildi: 'Kısmi iade',
};

export const PAYMENT_METHOD: Record<string, string> = {
  online_card: 'Online kart',
  cash_on_delivery: 'Kapıda nakit',
  pay_at_counter: 'Tezgahta',
};

export type OrderItem = {
  name?: string;
  qty?: number;
  quantity?: number;
  unit?: string;
  price?: number;
  line_total?: number;
  total?: number;
  selected_options?: { title: string; label: string; price_delta?: number }[];
  customizations?: { title?: string; label?: string }[];
  supplier_group_snapshot?: string;
  supplier_price_snapshot?: number;
};

export type Order = {
  tx_id: string;
  user_id?: string;
  user_name?: string;
  user_phone?: string;
  amount?: number;
  total?: number;
  subtotal?: number;
  delivery_fee?: number;
  discount?: number;
  coupon_code?: string | null;
  order_status?: string;
  payment_status?: string;
  payment_method?: string;
  delivery_type?: string;
  items?: OrderItem[];
  address?: string | null;
  market_name?: string;
  pickup_time?: string | null;
  delivery_slot_start?: string | null;
  delivery_slot_end?: string | null;
  admin_note?: string | null;
  cancel_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const orderTotal = (o: Order) => Number(o.amount ?? o.total ?? 0);

export function statusTone(s?: string): 'ok' | 'danger' | 'warn' | 'tint' | 'muted' {
  if (s === 'teslim_edildi') return 'ok';
  if (s && FINAL_STATUSES.includes(s)) return 'danger';
  if (s === 'yolda' || s === 'hazir') return 'tint';
  return 'warn';
}
