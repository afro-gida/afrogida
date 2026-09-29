/**
 * Web'de resim seçme / kamera + yüklemeden ÖNCE küçültme. Telefon fotoğrafları
 * 3–8 MB; burada en uzun kenar 1200 px JPEG'e iner (~150–300 KB), sunucu da
 * ayrıca 600 px WebP'ye çevirir (~30–60 KB) — site hızlı kalır.
 */
export function pickImage(camera = false): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Telefonda doğrudan arka kamerayı açar; bilgisayarda normal dosya seçici
    if (camera) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function shrinkImage(file: File, maxEdge = 1200, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // küçültülemezse (ör. eski tarayıcı) orijinal gider; sunucu yine küçültür
  }
}
