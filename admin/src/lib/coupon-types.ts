export interface CouponAssignment {
  user_id: string;
  limit: number;
  used_count: number;
  last_used_at?: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  discount_percent: number;
  discount_amount?: number | null;
  min_amount: number;
  members_only: boolean;
  assigned_user_ids: string[];
  assignments: CouponAssignment[];
  per_user_limit: number;
  single_use: boolean;
  used: boolean;
  active: boolean;
  valid_until?: string | null;
  created_at?: string;
}

export type CouponForm = {
  code: string;
  title: string;
  description?: string;
  discount_percent: number;
  discount_amount: number | '';
  min_amount: number | '';
  members_only: boolean;
  single_use: boolean;
  active: boolean;
  valid_until: string;
};

export interface CouponAssignedUser {
  user_id: string;
  user_name: string;
  phone?: string;
  limit: number;
  used_count: number;
  remaining: number;
  last_used_at?: string | null;
}

export interface CouponUsageLog {
  coupon_id: string;
  code: string;
  title?: string;
  user_id?: string;
  discount_amount?: number;
  used_at: string;
}

export interface MemberCoupon {
  coupon_id: string;
  code: string;
  title: string;
  discount_amount?: number | null;
  discount_percent?: number;
  min_amount: number;
  active: boolean;
  valid_until?: string | null;
  auto_issued: boolean;
  single_use: boolean;
  used: boolean;
  limit: number;
  used_count: number;
  remaining: number;
  last_used_at?: string | null;
}

export interface CouponDetails {
  coupon: Coupon;
  assigned_count: number;
  total_uses: number;
  assigned_users: CouponAssignedUser[];
  usage_logs: CouponUsageLog[];
}
