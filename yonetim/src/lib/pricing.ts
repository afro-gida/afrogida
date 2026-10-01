import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * Kademeli kâr: satış = alış + kâr. Tablolar sunucuda (Yönetim > Kâr
 * Profilleri, backend/core/pricing.py); burada sadece ekranda önizleme için.
 * Biçim: [{ from: alt sınır ₺, profit: kâr ₺ }] artan, ilki 0.
 */
export type Tier = { from: number; profit: number };
export type ProfileId = 'dusuk' | 'orta' | 'yuksek';
export type Profile = { name: string; tiers: Tier[] };
export type PricingState = { active: ProfileId; order: ProfileId[]; profiles: Record<ProfileId, Profile> };

/** Sunucu yanıt vermezse (önizleme için) kullanılan Orta tablo. */
const FALLBACK: Tier[] = [0, 20, 40, 60, 90, 130, 180, 250, 350].map((from, i) => ({ from, profit: [15, 25, 35, 50, 70, 90, 110, 150, 200][i] }));

export function profitFor(supplierPrice: number, tiers: Tier[] = FALLBACK): number | null {
  const p = Math.round((supplierPrice || 0) * 100) / 100;
  if (p <= 0) return null;
  let profit: number | null = null;
  for (const t of [...tiers].sort((a, b) => a.from - b.from)) if (p >= t.from) profit = t.profit;
  return profit;
}

let cache: Promise<PricingState> | null = null;
export function fetchPricing(force = false): Promise<PricingState> {
  if (!cache || force) cache = api.get<PricingState>('/admin/pricing').catch((e) => { cache = null; throw e; });
  return cache;
}

/** Aktif profilin tablosu (ürün ekranındaki satış fiyatı önizlemesi için). */
export function useActiveTiers(): Tier[] {
  const [tiers, setTiers] = useState<Tier[]>(FALLBACK);
  useEffect(() => {
    fetchPricing().then((s) => setTiers(s.profiles[s.active]?.tiers ?? FALLBACK)).catch(() => {});
  }, []);
  return tiers;
}

/** "40 – 59,99 ₺" / "350 ₺ ve üstü" (tablo sıralı verilmeli) */
export function rangeText(sorted: Tier[], i: number) {
  const t = sorted[i];
  const next = sorted[i + 1];
  const fmt = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  return next ? `${fmt(t.from)} – ${fmt(Math.round((next.from - 0.01) * 100) / 100)} ₺` : `${fmt(t.from)} ₺ ve üstü`;
}
