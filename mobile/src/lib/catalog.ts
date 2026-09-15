import { api, ApiError } from '@/lib/api';

/**
 * Ana kategori (Sebze/Meyve/Yeşillik...) → alt kategori (Domates/Kabak...)
 * ağacı — admin panelinden düzenleniyor (backend/services/catalog.py).
 * Ürünün kendi `category` alanı ALT kategori seviyesindedir (ör. "Domates");
 * hangi ana kategoriye ait olduğu bu ağaçtan bulunur.
 */
export type CatalogConfig = {
  categories?: string[];
  subcategories?: Record<string, string[]>;
};

export async function fetchCatalogConfig(): Promise<CatalogConfig> {
  try {
    return await api.get<CatalogConfig>('/catalog-config');
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /catalog-config hata döndü:', err.status, err.message);
    }
    return {};
  }
}
