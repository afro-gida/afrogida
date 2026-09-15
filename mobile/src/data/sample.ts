/**
 * ÖRNEK VERİ — gerçek backend'e henüz bağlanmadık (bkz. src/lib/api.ts).
 * Kategoriler backend/core/config.py::ORDERED_CATEGORIES ile birebir aynı;
 * ürünler ve fiyatlar temsili örnektir, gerçek stok/fiyat değildir.
 */
import type { Campaign, Market, Order, Product } from '@/lib/types';

export const CATEGORIES = ['Domates', 'Salata', 'Kabak', 'Patlıcan', 'Biber', 'Fasulye & Bakliyat', 'Çeşitler'] as const;

export const SAMPLE_PRODUCTS: Product[] = [
  { id: 'p1', name: 'Salkım Domates', category: 'Domates', unit: 'Kg', gel_al_price: 32, eve_servis_price: 36, in_stock: true, active: true, description: 'Günlük toplanmış, tam olgun salkım domates.' },
  { id: 'p2', name: 'Pembe Domates', category: 'Domates', unit: 'Kg', gel_al_price: 45, eve_servis_price: 50, in_stock: true, active: true },
  { id: 'p3', name: 'Marul', category: 'Salata', unit: 'Adet', gel_al_price: 18, eve_servis_price: 20, in_stock: true, active: true },
  { id: 'p4', name: 'Roka', category: 'Salata', unit: 'Demet', gel_al_price: 12, eve_servis_price: 14, in_stock: true, active: true },
  { id: 'p5', name: 'Sakız Kabağı', category: 'Kabak', unit: 'Kg', gel_al_price: 22, eve_servis_price: 25, in_stock: true, active: true },
  { id: 'p6', name: 'Kemer Patlıcan', category: 'Patlıcan', unit: 'Kg', gel_al_price: 28, eve_servis_price: 32, in_stock: false, active: true },
  {
    id: 'p7', name: 'Çarliston Biber', category: 'Biber', unit: 'Kg', gel_al_price: 30, eve_servis_price: 34, in_stock: true, active: true,
    campaign_discount_percent: 10, campaign_min_qty: 3,
    customization_options: [
      { title: 'Boyut', choices: [
        { label: 'Büyük', price_delta: 10 },
        { label: 'Orta', price_delta: 10 },
        { label: 'Küçük', price_delta: 10 },
        { label: 'İstemiyorum', price_delta: 0 },
      ] },
      { title: 'Şekil', choices: [
        { label: '4 Burun', price_delta: 10 },
        { label: '3 Burun', price_delta: 10 },
        { label: 'İstemiyorum', price_delta: 0 },
      ] },
    ],
  },
  { id: 'p8', name: 'Sivri Biber', category: 'Biber', unit: 'Kg', gel_al_price: 26, eve_servis_price: 30, in_stock: true, active: true },
  { id: 'p9', name: 'Kuru Fasulye', category: 'Fasulye & Bakliyat', unit: 'Kg', gel_al_price: 65, eve_servis_price: 70, in_stock: true, active: true },
  { id: 'p10', name: 'Nohut', category: 'Fasulye & Bakliyat', unit: 'Kg', gel_al_price: 55, eve_servis_price: 60, in_stock: true, active: true },
  { id: 'p11', name: 'Taze Soğan', category: 'Çeşitler', unit: 'Demet', gel_al_price: 10, eve_servis_price: 12, in_stock: true, active: true },
  { id: 'p12', name: 'Maydanoz', category: 'Çeşitler', unit: 'Demet', gel_al_price: 8, eve_servis_price: 10, in_stock: true, active: true },
];

export const SAMPLE_CAMPAIGNS: Campaign[] = [
  { id: 'c1', title: 'Üyelere Özel %10', description: 'Biberlerde bu hafta üyelere özel %10 indirim.', discount_text: '%10', members_only: true, active: true },
];

export const SAMPLE_MARKETS: Market[] = [
  {
    id: 'm1', name: 'Mudanya Güzelyalı Pazarı', day: 'Perşembe', location: 'Güzelyalı, Mudanya / Bursa',
    active: true, is_open: true, orders_enabled: true, delivery_enabled: true,
    active_gel_al: true, active_eve_servis: true, delivery_neighborhoods: ['Güzelyalı', 'Bademli'],
    note: 'Sabah erken taze ürünlerle tezgahtayız.',
  },
  {
    id: 'm2', name: 'Mudanya Cumartesi Pazarı', day: 'Cumartesi', location: 'Mudanya Merkez / Bursa',
    active: true, is_open: false, orders_enabled: false, delivery_enabled: false,
    active_gel_al: true, active_eve_servis: false, delivery_neighborhoods: [],
  },
];

export const SAMPLE_ORDERS: Order[] = [
  {
    tx_id: 'TX-20260908-1',
    order_status: 'teslim_edildi',
    delivery_type: 'eve_servis',
    amount: 128.5,
    created_at: '2026-09-08T09:12:00Z',
    items: [
      { name: 'Salkım Domates', qty: 2, unit: 'Kg' },
      { name: 'Marul', qty: 1, unit: 'Adet' },
    ],
  },
  {
    tx_id: 'TX-20260911-2',
    order_status: 'hazirlaniyor',
    delivery_type: 'gel_al',
    amount: 54,
    created_at: '2026-09-11T07:40:00Z',
    items: [{ name: 'Çarliston Biber', qty: 1.5, unit: 'Kg' }],
  },
];
