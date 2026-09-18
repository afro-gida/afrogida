/** Türk Lirası formatı — elle biçimlendiriyoruz çünkü bu ortamda (Hermes/RN Web)
 *  `toLocaleString('tr-TR', ...)` tam ICU verisi olmadan sessizce İngilizce
 *  biçime (nokta ondalık ayraç) düşüyor, "₺860.00" gibi yanlış bir sonuç
 *  veriyordu — kullanıcı talimatıyla bulunan hata, doğrusu "₺860,00". */
export function formatMoney(n?: number | null): string {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `₺${sign}${withThousands},${decPart}`;
}
