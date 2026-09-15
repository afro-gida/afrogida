import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchMarkets } from '@/lib/markets';
import { SAMPLE_MARKETS } from '@/data/sample';
import type { Market } from '@/lib/types';

type MarketsContextValue = {
  markets: Market[];
  isLive: boolean;
  loading: boolean;
  /** Pazar listesini backend'den yeniden çeker (ör. ilk yüklemede bir ekran
   *  henüz gelmemiş pazar id'sini arıyorsa tazelemek için). */
  refetch: () => void;
};

const MarketsContext = createContext<MarketsContextValue | null>(null);

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<Market[]>(SAMPLE_MARKETS);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    let cancelled = false;
    fetchMarkets().then((result) => {
      if (cancelled) return;
      setMarkets(result.markets);
      setIsLive(result.isLive);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }

  useEffect(load, []);

  return (
    <MarketsContext.Provider value={{ markets, isLive, loading, refetch: load }}>
      {children}
    </MarketsContext.Provider>
  );
}

export function useMarkets() {
  const ctx = useContext(MarketsContext);
  if (!ctx) throw new Error('useMarkets, MarketsProvider içinde kullanılmalı');
  return ctx;
}
