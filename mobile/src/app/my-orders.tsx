import { LegacyPaymentReturn } from '@/components/legacy-payment-return';

/** Eski PayTR "başarılı" dönüş adresi. */
export default function LegacyMyOrders() {
  return <LegacyPaymentReturn result="tamam" />;
}
