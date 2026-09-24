import { api, ApiError } from '@/lib/api';
import { SAMPLE_PRODUCTS } from '@/data/sample';
import type { Product } from '@/lib/types';

/** Sunucu tahsilatta ÖNCE `price`'ı kullanır, sadece o yoksa/0 ise
 *  gel_al_price/eve_servis_price'a düşer (backend/services/orders.py) —
 *  ekranda da aynı sıra. Tedarikçi fiyat değiştirince sadece `price`
 *  güncelleniyor; gel_al_price'ı öne almak ekranda eski fiyatı gösteriyordu. */
function normalizeProduct(raw: any): Product {
  const base = typeof raw.price === 'number' && raw.price > 0 ? raw.price : null;
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    subcategory: raw.subcategory,
    unit: raw.unit,
    gel_al_price: base ?? raw.gel_al_price,
    eve_servis_price: base ?? raw.eve_servis_price,
    image_url: raw.image_url,
    description: raw.description,
    in_stock: !!raw.in_stock,
    active: !!raw.active,
    campaign_discount_percent: raw.campaign_discount_percent || null,
    campaign_min_qty: raw.campaign_min_qty || null,
    customization_options: Array.isArray(raw.customization_options) ? raw.customization_options : null,
  };
}

/**
 * Ürünleri backend'den çek. Backend'e ulaşılamazsa (yerel sunucu kapalıysa)
 * örnek veriye düşer — uygulama her koşulda açılabilsin diye.
 */
export async function fetchProducts(market?: string): Promise<{ products: Product[]; isLive: boolean }> {
  try {
    const query = market ? `?market=${encodeURIComponent(market)}` : '';
    const raw = await api.get<any[]>(`/products${query}`);
    const products = raw.filter((p) => p.active && !p.hidden).map(normalizeProduct);
    return { products, isLive: true };
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /products hata döndü, örnek veriye geçiliyor:', err.status, err.message);
    } else {
      console.warn('[api] backend’e ulaşılamadı, örnek veriye geçiliyor:', err);
    }
    return { products: SAMPLE_PRODUCTS, isLive: false };
  }
}
