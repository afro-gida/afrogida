/**
 * Kademeli kâr tablosu — sunucudaki backend/core/pricing.py ile AYNI olmalı.
 * Burada sadece ekranda önizleme için; asıl hesabı sunucu yapar.
 */
const TIERS: [number, number][] = [
  [20, 15], //   0,00 –  19,99
  [40, 25], //  20,00 –  39,99
  [60, 35], //  40,00 –  59,99
  [90, 50], //  60,00 –  89,99
  [130, 70], //  90,00 – 129,99
  [180, 90], // 130,00 – 179,99
  [250, 110], // 180,00 – 249,99
  [350, 150], // 250,00 – 349,99
];
export const LAST_TIER_MAX = Infinity; // 350,00 ve üstü (üst sınır yok)
const LAST_TIER_PROFIT = 200;

export function profitFor(supplierPrice: number): number | null {
  const p = Math.round((supplierPrice || 0) * 100) / 100;
  if (p <= 0) return null;
  for (const [upper, profit] of TIERS) if (p < upper) return profit;
  return p <= LAST_TIER_MAX ? LAST_TIER_PROFIT : null;
}

export const PROFIT_TABLE_TEXT = [
  '0–19,99 → +15', '20–39,99 → +25', '40–59,99 → +35', '60–89,99 → +50', '90–129,99 → +70',
  '130–179,99 → +90', '180–249,99 → +110', '250–349,99 → +150', '350 ve üstü → +200',
];
