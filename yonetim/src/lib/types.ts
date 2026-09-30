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
  orders_enabled: boolean;
  delivery_enabled: boolean;
  online_payment_enabled: boolean;
  active_eve_servis: boolean;
  active_gel_al: boolean;
  delivery_neighborhoods: string[];
  eve_servis_urun_gorunurlugu: boolean;
  eve_servis_min_tutar: number;
  eve_servis_saati: string;
  kapida_nakit_odeme_enabled: boolean;
  nakit_tezgah_limit_enabled: boolean;
  nakit_tezgah_maksimum_tutari: number;
  gel_al_min_tutar: number;
  teslimat_ucreti: number;
  ucretsiz_teslimat_alt_limiti: number;
  pazar_saati: string;
  gel_al_saati: string;
};

export const EMPTY_MARKET: Omit<Market, 'id'> = {
  name: '',
  day: 'Pazartesi',
  image_url: null,
  location: '',
  location_url: null,
  google_maps_url: null,
  note: '',
  active: true,
  orders_enabled: false,
  delivery_enabled: false,
  online_payment_enabled: true,
  active_eve_servis: false,
  active_gel_al: true,
  delivery_neighborhoods: [],
  eve_servis_urun_gorunurlugu: true,
  eve_servis_min_tutar: 500,
  eve_servis_saati: '11:00-19:00',
  kapida_nakit_odeme_enabled: true,
  nakit_tezgah_limit_enabled: false,
  nakit_tezgah_maksimum_tutari: 0,
  gel_al_min_tutar: 200,
  teslimat_ucreti: 50,
  ucretsiz_teslimat_alt_limiti: 1000,
  pazar_saati: '08:00-20:00',
  gel_al_saati: '11:00-19:00',
};

export const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

/** Bugünün Türkçe gün adı (Pazartesi ... Pazar). */
export function todayName() {
  return DAYS[(new Date().getDay() + 6) % 7];
}

export type Choice = { label: string; price_delta?: number };
export type OptionGroup = { title: string; choices: Choice[] };

export type Product = {
  id: string;
  name: string;
  category: string;
  subcategory?: string | null;
  supplier_group?: string | null;
  price?: number | null;
  gel_al_price?: number | null;
  eve_servis_price?: number | null;
  supplier_price?: number | null;
  sale_price?: number | null;
  profit_margin_amount?: number | null;
  unit: string;
  image_url?: string | null;
  description?: string | null;
  in_stock: boolean;
  active: boolean;
  hidden: boolean;
  campaign_discount_percent?: number | null;
  campaign_min_qty?: number | null;
  customization_options?: OptionGroup[] | null;
  created_at?: string;
  updated_at?: string;};

/** Sunucunun "gönderilmediyse koru" dediği fiyat alanları (routers/products.py
 *  DUAL_PRICE_FIELDS). Sadece stok/durum değişirken bunlar GÖNDERİLMEZ — yoksa
 *  sunucu satış fiyatını alış + kârdan yeniden hesaplar. */
export const DUAL_PRICE_FIELDS = ['supplier_price', 'sale_price', 'profit_margin_amount', 'price_updated_at', 'price_updated_by'] as const;

export function withoutPriceFields(p: Product): Record<string, unknown> {
  const body: Record<string, unknown> = { ...p };
  for (const f of DUAL_PRICE_FIELDS) delete body[f];
  delete body.id;
  delete body.created_at;
  delete body.updated_at;
  return body;
}

export type CatalogConfig = {
  categories?: string[];
  subcategories?: Record<string, string[]>;
  suppliers?: string[];
  supplier_markets?: Record<string, string[]>;
  [k: string]: unknown;
};

/** Ürünün satış fiyatı (sunucu tahsilatta önce `price`'ı kullanır). */
export function salePrice(p: Product) {
  return Number(p.price || p.sale_price || p.gel_al_price || 0);
}

/** Kupona tanımlı üye (kişiye özel kullanım hakkı + son kullanma). */
export type CouponAssignment = {
  user_id: string;
  limit: number;
  used_count?: number;
  last_used_at?: string | null;
  valid_until?: string | null;
};

export type Coupon = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  discount_percent: number;
  /** Doluysa sabit TL indirim (yüzdeden önceliklidir). */
  discount_amount?: number | null;
  min_amount: number;
  members_only?: boolean;
  per_user_limit?: number;
  active: boolean;
  /** "YYYY-AA-GG" — o günün sonuna kadar geçerli; boş = süresiz. */
  valid_until?: string | null;
  assigned_user_ids?: string[];
  assignments?: CouponAssignment[];
  created_at?: string;
};

export type CouponDetail = {
  coupon: Coupon;
  assigned_count: number;
  total_uses: number;
  assigned_users: {
    user_id: string;
    user_name: string;
    phone?: string | null;
    limit: number;
    used_count: number;
    remaining: number;
    last_used_at?: string | null;
    valid_until?: string | null;
    expired?: boolean;
  }[];
  usage_logs: { user_id?: string; used_at?: string; discount_amount?: number | null }[];
};

export const couponDiscountText = (c: Pick<Coupon, 'discount_amount' | 'discount_percent'>) =>
  c.discount_amount ? `${c.discount_amount.toLocaleString('tr-TR')} ₺ indirim` : `%${c.discount_percent} indirim`;
