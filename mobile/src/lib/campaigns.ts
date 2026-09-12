import { api, ApiError } from '@/lib/api';
import { SAMPLE_CAMPAIGNS } from '@/data/sample';
import type { Campaign } from '@/lib/types';

/** Backend zaten uyeye-ozel kampanyalari girisi olmayanlardan gizliyor (get_optional_user). */
export async function fetchCampaigns(): Promise<{ campaigns: Campaign[]; isLive: boolean }> {
  try {
    const raw = await api.get<Campaign[]>('/campaigns');
    return { campaigns: raw, isLive: true };
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn('[api] /campaigns hata döndü, örnek veriye geçiliyor:', err.status, err.message);
    } else {
      console.warn('[api] backend’e ulaşılamadı, örnek veriye geçiliyor:', err);
    }
    return { campaigns: SAMPLE_CAMPAIGNS, isLive: false };
  }
}
