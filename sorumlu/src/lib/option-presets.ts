/**
 * Seçenek kısayolları: grup başlığı bunlardan biri yazılınca (ya da "Hızlı
 * ekle"den seçilince) seçenekler 0 TL ile kendiliğinden gelir; fiyatlar
 * sonra değiştirilebilir. "İstemiyorum" her grubun en altında zaten sabit.
 * Aynı liste yönetim uygulamasında da var: yonetim/src/lib/option-presets.ts
 */
export const OPTION_PRESETS: { title: string; choices: string[] }[] = [
  { title: 'Boyut', choices: ['Büyük', 'Orta', 'Küçük'] },
  { title: 'Şekil', choices: ['Düz', 'Farketmez'] },
  { title: 'Olgunluk', choices: ['Olgun', 'Normal', 'Ham'] },
  { title: 'Yumuşaklık', choices: ['Sert', 'Yumuşak'] },
  { title: 'Kalınlık', choices: ['İnce', 'Orta', 'Kalın'] },
  { title: 'Sap', choices: ['Alınsın', 'Alınmasın'] },
];

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR');

/** Başlığa uyan kısayol (büyük/küçük harf ve boşluk farketmez). */
export function presetFor(title: string) {
  const t = norm(title);
  return t ? OPTION_PRESETS.find((p) => norm(p.title) === t) : undefined;
}

/** "Seçim yapılmadı" seçeneği mi? (İstemiyorum / eski yazım Seçmiyorum) —
 *  sipariş ve sepet listelerinde gösterilmez. */
export function isNoneChoice(label: string | null | undefined) {
  return ['istemiyorum', 'seçmiyorum'].includes((label ?? '').trim().toLocaleLowerCase('tr-TR'));
}