import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import type { CartLine, Product } from '@/lib/types';

type CartContextValue = {
  lines: CartLine[];
  addItem: (product: Product, qty?: number) => void;
  removeItem: (productId: string) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
  /** Bir pazara girildiğinde çağrılır. Farklı bir pazarsa sepeti sıfırlar
   *  (her pazarın sepeti ayrıdır); aynı pazara tekrar girilirse dokunmaz. */
  enterMarket: (marketId: string) => void;
  totalQty: number;
  totalPrice: number;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const currentMarketId = useRef<string | null>(null);

  const addItem = (product: Product, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, { product, qty }];
    });
  };

  const removeItem = (productId: string) => {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  };

  const setQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      removeItem(productId);
      return;
    }
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  };

  const clear = () => setLines([]);

  const enterMarket = (marketId: string) => {
    if (currentMarketId.current !== null && currentMarketId.current !== marketId) {
      setLines([]);
    }
    currentMarketId.current = marketId;
  };

  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);
  const totalPrice = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * (l.product.gel_al_price ?? 0), 0),
    [lines]
  );

  return (
    <CartContext.Provider value={{ lines, addItem, removeItem, setQty, clear, enterMarket, totalQty, totalPrice }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart, CartProvider içinde kullanılmalı');
  return ctx;
}
