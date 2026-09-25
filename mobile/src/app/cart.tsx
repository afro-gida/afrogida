import { LegacyPaymentReturn } from '@/components/legacy-payment-return';

/** Eski PayTR "başarısız" dönüş adresi. */
export default function LegacyCart() {
  return <LegacyPaymentReturn result="hata" />;
}
