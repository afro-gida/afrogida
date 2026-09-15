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

export type Order = {
  tx_id: string;
  order_status: OrderStatus;
  delivery_type: 'gel_al' | 'eve_servis';
  amount: number;
  created_at: string;
  items: { name: string; qty: number; unit: string }[];
};
