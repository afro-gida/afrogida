/** backend/models.py ile eşleşen tipler (yalnızca müşteri akışında kullanılan alanlar). */

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
};

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
  note?: string | null;
  active: boolean;
  is_open: boolean;
  orders_enabled: boolean;
  delivery_enabled: boolean;
};

export type CartLine = {
  product: Product;
  qty: number;
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
