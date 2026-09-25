/** backend/models.py ile eşleşen tipler (yalnızca müşteri akışında kullanılan alanlar). */

/** Ürün özelleştirme seçeneği — ör. "Boyut" grubu → "Büyük" (+10₺) seçeneği.
 *  Admin panelinden tanımlanıyor (bkz. backend Product.customization_options). */
export type CustomizationChoice = { label: string; price_delta: number };
export type CustomizationGroup = { title: string; choices: CustomizationChoice[] };

export type Product = {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  unit: string; // "Kg", "Adet", "Demet" ...
  gel_al_price?: number | null; // Gel-Al (tezgahtan alım) fiyatı
  eve_servis_price?: number | null; // Eve servis fiyatı
  image_url?: string | null;
  description?: string | null;
  in_stock: boolean;
  active: boolean;
  campaign_discount_percent?: number | null;
  /** İndirimin uygulanması için gereken minimum miktar (ör. "3 Kg ve üzeri %10"). */
  campaign_min_qty?: number | null;
  /** Müşterinin seçebileceği gruplar (Boyut, Şekil...) — her grupta tek seçim. */
  customization_options?: CustomizationGroup[] | null;
};

/** Sepetteki bir satırda seçilmiş tek bir özelleştirme (ör. Boyut: Büyük). */
export type SelectedOption = { title: string; label: string; price_delta: number };

export type Campaign = {
  id: string;
  title: string;
  description: string;
  image_url?: string | null;
  discount_text?: string | null;
  members_only: boolean;
  active: boolean;
  valid_until?: string | null;
};

export type Market = {
  id: string;
  name: string;
  day: string;
  image_url?: string | null;
  location?: string | null;
  location_url?: string | null;
  google_maps_url?: string | null;
  note?: string | null;
  active: boolean;
  is_open: boolean;
  orders_enabled: boolean;
  delivery_enabled: boolean;
  active_eve_servis: boolean;
  active_gel_al: boolean;
  delivery_neighborhoods?: string[];
  // Pazar bazlı sipariş ayarları — sunucu siparişi BUNLARLA hesaplar
  // (backend/services/orders.py::_prepare_order_payload, models.Market).
  eve_servis_min_tutar?: number;
  eve_servis_saati?: string;
  kapida_nakit_odeme_enabled?: boolean;
  nakit_tezgah_limit_enabled?: boolean;
  nakit_tezgah_maksimum_tutari?: number;
  gel_al_min_tutar?: number;
  teslimat_ucreti?: number;
  ucretsiz_teslimat_alt_limiti?: number;
  pazar_saati?: string;
  gel_al_saati?: string;
};

export type CartLine = {
  /** Ürün id'si + seçili özelleştirmelerden türetilen benzersiz satır id'si
   *  — özelleştirmesi olmayan ürünlerde product.id ile aynıdır (eski
   *  davranışla uyumlu), farklı seçimler ayrı satır olarak tutulur. */
  lineId: string;
  product: Product;
  qty: number;
  selectedOptions?: SelectedOption[];
};

export type OrderStatus =
  | 'talep_alindi'
  | 'hazirlik_bekliyor'
  | 'hazirlaniyor'
  | 'hazir'
  | 'yolda'
  | 'teslim_edildi'
  | 'iptal_edildi';

export type OrderItem = {
  name: string;
  qty: number;
  unit: string;
  /** Satır tutarı (seçenek farkları dahil) — sunucunun hesapladığı. */
  line_total?: number;
  selected_options?: { title: string; label: string }[];
};

export type Order = {
  tx_id: string;
  order_status: OrderStatus;
  delivery_type: 'gel_al' | 'eve_servis';
  amount: number;
  created_at: string;
  items: OrderItem[];
  // Takip ekranı (app/siparis/[tx].tsx) için ek alanlar — eski siparişlerde
  // bazıları boş olabilir.
  subtotal?: number;
  delivery_fee?: number;
  discount?: number;
  payment_method?: string;
  /** "paid" | "pending" | "failed" | "unpaid" ... (online ödemede PayTR bildirimiyle güncellenir) */
  payment_status?: string;
  market_name?: string;
  pickup_time?: string | null;
  delivery_slot_start?: string | null;
  delivery_slot_end?: string | null;
  address?: string | null;
  delivered_at?: string | null;
  cancel_reason?: string | null;
};
