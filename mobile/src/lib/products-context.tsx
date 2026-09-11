import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchProducts } from '@/lib/products';
import { SAMPLE_PRODUCTS } from '@/data/sample';
import type { Product } from '@/lib/types';

type ProductsContextValue = {
  products: Product[];
  isLive: boolean;
  loading: boolean;
  getById: (id: string) => Product | undefined;
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

export function ProductsProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(SAMPLE_PRODUCTS);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchProducts().then((result) => {
      if (cancelled) return;
      setProducts(result.products);
      setIsLive(result.isLive);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const getById = (id: string) => products.find((p) => p.id === id);

  return (
    <ProductsContext.Provider value={{ products, isLive, loading, getById }}>
      {children}
    </ProductsContext.Provider>
  );
}

export function useProducts() {
  const ctx = useContext(ProductsContext);
  if (!ctx) throw new Error('useProducts, ProductsProvider içinde kullanılmalı');
  return ctx;
}
