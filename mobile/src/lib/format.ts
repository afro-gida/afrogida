/** Türk Lirası tutar formatı (virgüllü ondalık, noktalı binlik) — elle
 *  biçimlendiriyoruz çünkü `toLocaleString('tr-TR', ...)` bu ortamda
 *  (Hermes/RN Web) tam ICU verisi olmadan sessizce yanlış (İngilizce)
 *  biçime düşebiliyor. ₺ işaretini içermez, çağıran yerde eklenir. */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${withThousands},${decPart}`;
}
