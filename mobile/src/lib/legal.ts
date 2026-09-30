import { Linking, Platform } from 'react-native';

import { api } from '@/lib/api';

export type LegalCode =
  | 'kvkk' | 'privacy' | 'membership' | 'pickupTerms' | 'homeDeliveryTerms' | 'refundComplaintPolicy' | 'couponTerms';

type LegalDoc = { document_code: LegalCode; name: string; version: string | null; pdf_url: string | null };

let cache: Promise<LegalDoc[]> | null = null;

/** Yürürlükteki sözleşmeler (Yönetim > Sözleşmeler'de yayınlanan ya da varsayılan PDF). */
export function fetchLegalDocs(): Promise<LegalDoc[]> {
  if (!cache) {
    cache = api.get<LegalDoc[]>('/legal-docs').catch((e) => {
      cache = null; // hata olursa bir sonraki denemede tekrar iste
      throw e;
    });
  }
  return cache;
}

/** PDF adresini açar ("/legal/…" ya da "/uploads/…" sitenin kendi adresinden). */
export function openPdf(path: string) {
  const url = /^https?:\/\//.test(path)
    ? path
    : Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}${path}`
      : `https://afrogida.com.tr${path}`;
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener,noreferrer');
  else Linking.openURL(url);
}

/** Belgenin yürürlükteki PDF'ini yeni sekmede açar. Web'de açılır pencere
 *  engeline takılmasın diye sekme tıklama anında açılır, adres sonra yazılır. */
export async function openLegal(code: LegalCode) {
  const win = Platform.OS === 'web' && typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  try {
    const doc = (await fetchLegalDocs()).find((d) => d.document_code === code);
    if (!doc?.pdf_url) {
      win?.close();
      return;
    }
    if (win) {
      win.opener = null;
      win.location.href = /^https?:\/\//.test(doc.pdf_url) ? doc.pdf_url : `${window.location.origin}${doc.pdf_url}`;
    } else {
      openPdf(doc.pdf_url);
    }
  } catch {
    win?.close();
  }
}
