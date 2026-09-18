import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import type { DeliveryType } from '@/lib/orders';
import type { CartLine, Product, SelectedOption } from '@/lib/types';

type CartContextValue = {
  lines: CartLine[];
  addItem: (product: Product, qty?: number, selectedOptions?: SelectedOption[]) => void;
  /** Sepetteki mevcut bir satırın miktarını/özelleştirmesini değiştirir
   *  (ör. sepet ekranından "Orta" seçimini "Büyük" yapmak). Yeni seçim
   *  başka bir satırla aynı kombinasyona denk gelirse miktarlar birleşir. */
  updateLine: (oldLineId: string, product: Product, qty: number, selectedOptions?: SelectedOption[]) => void;
  removeItem: (lineId: string) => void;
  setQty: (lineId: string, qty: number) => void;
  clear: () => void;
  /** Bir pazara girildiğinde çağrılır. Farklı bir pazarsa sepeti sıfırlar
   *  (her pazarın sepeti ayrıdır); aynı pazara tekrar girilirse dokunmaz. */
  enterMarket: (marketId: string) => void;
  totalQty: number;
  totalPrice: number;
  /** Gel-Al/Eve Servis seçimi — sepet ekranında değil BURADA tutuluyor ki
   *  kullanıcı pazar listesine geri gidip aynı pazara tekrar girdiğinde
   *  (sepet ekranı yeniden mount olduğunda) seçim sıfırlanmasın (kullanıcı
   *  talimatıyla bulunan hata: "eve serviste kapanıyor"). */
  deliveryType: DeliveryType;
  setDeliveryType: (t: DeliveryType) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/** Özelleştirmesi olmayan ürünlerde satır id'si product.id ile aynı kalır
 *  (eski davranışla uyumlu); farklı seçim kombinasyonları ayrı satır olur. */
function computeLineId(productId: string, selectedOptions?: SelectedOption[]) {
  if (!selectedOptions || selectedOptions.length === 0) return productId;
  const key = selectedOptions.map((o) => `${o.title}:${o.label}`).join('|');
  return `${productId}::${key}`;
}

function optionsDelta(selectedOptions?: SelectedOption[]) {
  return (selectedOptions ?? []).reduce((sum, o) => sum + (o.price_delta || 0), 0);
}

/** Satırın birim fiyatı: ürünün Gel-Al fiyatı + seçili özelleştirme farkları. */
export function lineUnitPrice(line: CartLine) {
  return (line.product.gel_al_price ?? 0) + optionsDelta(line.selectedOptions);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('gel_al');
  const currentMarketId = useRef<string | null>(null);

  const addItem = (product: Product, qty = 1, selectedOptions?: SelectedOption[]) => {
    const lineId = computeLineId(product.id, selectedOptions);
    setLines((prev) => {
      const existing = prev.find((l) => l.lineId === lineId);
      if (existing) {
        return prev.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, { lineId, product, qty, selectedOptions }];
    });
  };

  const updateLine = (oldLineId: string, product: Product, qty: number, selectedOptions?: SelectedOption[]) => {
    const newLineId = computeLineId(product.id, selectedOptions);
    setLines((prev) => {
      const withoutOld = prev.filter((l) => l.lineId !== oldLineId);
      const existingIdx = withoutOld.findIndex((l) => l.lineId === newLineId);
      if (existingIdx >= 0) {
        const merged = [...withoutOld];
        merged[existingIdx] = { ...merged[existingIdx], qty: merged[existingIdx].qty + qty };
        return merged;
      }
      return [...withoutOld, { lineId: newLineId, product, qty, selectedOptions }];
    });
  };

  const removeItem = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const setQty = (lineId: string, qty: number) => {
    if (qty <= 0) {
      removeItem(lineId);
      return;
    }
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty } : l)));
  };

  const clear = () => setLines([]);

  const enterMarket = (marketId: string) => {
    if (currentMarketId.current !== null && currentMarketId.current !== marketId) {
      setLines([]);
      setDeliveryType('gel_al');
    }
    currentMarketId.current = marketId;
  };

  const totalQty = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);
  const totalPrice = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * lineUnitPrice(l), 0),
    [lines]
  );

  return (
    <CartContext.Provider
      value={{ lines, addItem, updateLine, removeItem, setQty, clear, enterMarket, totalQty, totalPrice, deliveryType, setDeliveryType }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart, CartProvider içinde kullanılmalı');
  return ctx;
}
