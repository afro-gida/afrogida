import { api, ApiError } from '@/lib/api';

/** backend/models.py::Coupon ile birebir eşleşir (sadece müşteri tarafında gösterilen alanlar). */
export type Coupon = {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  discount_percent: number;
  discount_amount?: number | null;
  min_amount: number;
  /** Admin bu kuponu belirli üyelere atadıysa dolu gelir — "Size Özel" rozeti için. */
  assigned_user_ids?: string[];
  valid_until?: string | null;
};

export type CouponValidation = {
  code: string;
  title: string;
  /** Sunucuda hesaplanan gerçek indirim tutarı (₺) — client asla kendi hesaplamaz. */
  discount: number;
  min_amount: number;
  message: string;
};

/** Giriş yapmış kullanıcıya (veya genel/misafir) uygun, aktif kuponları listeler. */
export async function fetchCoupons(): Promise<{ coupons: Coupon[]; error: string | null }> {
  try {
    const coupons = await api.get<Coupon[]>('/coupons');
    return { coupons, error: null };
  } catch (err) {
    if (err instanceof ApiError) return { coupons: [], error: err.message };
    return { coupons: [], error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}

/** Kupon kodunu sepet tutarına göre doğrular; indirim SUNUCUDA hesaplanır. */
export async function validateCoupon(
  code: string,
  total: number,
  paymentMethod: string
): Promise<{ result: CouponValidation } | { error: string }> {
  try {
    const res = await api.post<{ code: string; title: string; discount: number; min_amount: number; message: string }>(
      '/coupons/validate',
      { code, total, payment_method: paymentMethod }
    );
    return { result: { code: res.code, title: res.title, discount: res.discount, min_amount: res.min_amount, message: res.message } };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}
