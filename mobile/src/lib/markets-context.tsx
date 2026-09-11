import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { fetchMarkets } from '@/lib/markets';
import { SAMPLE_MARKETS } from '@/data/sample';
import type { Market } from '@/lib/types';

type MarketsContextValue = {
  markets: Market[];
  isLive: boolean;
  loading: boolean;
};

const MarketsContext = createContext<MarketsContextValue | null>(null);

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<Market[]>(SAMPLE_MARKETS);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return <MarketsContext.Provider value={{ markets, isLive, loading }}>{children}</MarketsContext.Provider>;
}

export function useMarkets() {
  const ctx = useContext(MarketsContext);
  if (!ctx) throw new Error('useMarkets, MarketsProvider içinde kullanılmalı');
  return ctx;
}
