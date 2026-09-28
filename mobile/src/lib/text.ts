/** Türkçe baş harf düzeltmesi ("görükle" -> "Görükle", "irfaniye" -> "İrfaniye").
 *  Sunucudaki core/text.py::tr_title ile aynı kural; sunucu artık kaydederken
 *  düzeltiyor, bu da eski kayıtların sitede düzgün görünmesi için. */
export function trTitle(value?: string | null): string {
  if (!value) return '';
  const cap = (w: string) => (w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1).toLocaleLowerCase('tr-TR') : w);
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.split('-').map(cap).join('-'))
    .join(' ');
}
