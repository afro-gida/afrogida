import { api, ApiError } from '@/lib/api';
import { SAMPLE_MARKETS } from '@/data/sample';
import type { Market } from '@/lib/types';

export async function fetchMarkets(): Promise<{ markets: Market[]; isLive: boolean }> {
  try {
    const raw = await api.get<Market[]>('/markets');
    return { markets: raw.filter((m) => m.active), isLive: true };
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /markets hata döndü, örnek veriye geçiliyor:', err.status, err.message);
    } else {
      console.warn('[api] backend’e ulaşılamadı, örnek veriye geçiliyor:', err);
    }
    return { markets: SAMPLE_MARKETS, isLive: false };
  }
}
