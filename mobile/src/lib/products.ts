import { api, ApiError } from '@/lib/api';
import { SAMPLE_PRODUCTS } from '@/data/sample';
import type { Product } from '@/lib/types';

/** Backend'de gel_al_price/eve_servis_price girilmemişse (0) temel `price` alanına düşer. */
function normalizeProduct(raw: any): Product {
  const base = typeof raw.price === 'number' && raw.price > 0 ? raw.price : null;
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    subcategory: raw.subcategory,
    unit: raw.unit,
    gel_al_price: raw.gel_al_price || base,
    eve_servis_price: raw.eve_servis_price || base,
    image_url: raw.image_url,
    description: raw.description,
    in_stock: !!raw.in_stock,
    active: !!raw.active,
    campaign_discount_percent: raw.campaign_discount_percent || null,
  };
}

/**
 * Ürünleri backend'den çek. Backend'e ulaşılamazsa (yerel sunucu kapalıysa)
 * örnek veriye düşer — uygulama her koşulda açılabilsin diye.
 */
export async function fetchProducts(): Promise<{ products: Product[]; isLive: boolean }> {
  try {
    const raw = await api.get<any[]>('/products');
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
