/**
 * "Kg" ile ölçülen ürünler 0.5'lik adımlarla artıp azalır (0.5, 1.0, 1.5...);
 * "Adet"/"Demet" gibi tam sayı birimler 1'er 1'er. Gerçek sitedeki davranışla
 * aynı. Gerçek veride birim büyük/küçük harf karışık gelebiliyor (ör. "kg"),
 * bu yüzden karşılaştırma büyük/küçük harf duyarsız yapılıyor.
 */
function isKg(unit: string): boolean {
  return (unit || '').trim().toLowerCase() === 'kg';
}

export function qtyStep(unit: string): number {
  return isKg(unit) ? 0.5 : 1;
}

export function formatQty(qty: number, unit: string): string {
  return isKg(unit) ? qty.toFixed(1) : String(qty);
}

/** Ekranda gösterilecek birim adı — "kg"/"KG" gibi varyasyonları "Kg" olarak
 *  normalleştirir, diğer birimleri (Adet, Demet...) olduğu gibi bırakır. */
export function formatUnit(unit: string): string {
  return isKg(unit) ? 'Kg' : unit;
}
