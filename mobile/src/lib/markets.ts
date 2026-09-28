import { api, ApiError } from '@/lib/api';
import { SAMPLE_MARKETS } from '@/data/sample';
import { trTitle } from '@/lib/text';
import type { Market } from '@/lib/types';

export async function fetchMarkets(): Promise<{ markets: Market[]; isLive: boolean }> {
  try {
    const raw = await api.get<Market[]>('/markets');
    // Konum / servis mahalleleri baş harfleri büyük görünsün (eski kayıtlar
    // küçük harfle girilmiş olabilir). Pazar ADI değiştirilmez: ürünler pazar
    // adıyla eşleştiriliyor (sunucu kaydederken adı zaten düzeltiyor).
    const markets = raw
      .filter((m) => m.active)
      .map((m) => ({
        ...m,
        location: m.location ? trTitle(m.location) : m.location,
        delivery_neighborhoods: (m.delivery_neighborhoods ?? []).map((n) => trTitle(n)).filter(Boolean),
      }));
    return { markets, isLive: true };
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /markets hata döndü, örnek veriye geçiliyor:', err.status, err.message);
    } else {
      console.warn('[api] backend’e ulaşılamadı, örnek veriye geçiliyor:', err);
    }
    return { markets: SAMPLE_MARKETS, isLive: false };
  }
}
