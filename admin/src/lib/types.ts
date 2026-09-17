export interface AdminUser {
  user_id: string;
  name?: string;
  phone?: string;
  role?: string;
}

export interface Address {
  id: string;
  title: string;
  city: string;
  district: string;
  neighborhood: string;
  street: string;
  building_no: string;
  floor?: string;
  apartment_no?: string;
  site_name?: string;
  description?: string;
  is_default: boolean;
}

export interface Member {
  user_id: string;
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
  auth_type?: string;
  created_at?: string;
  addresses?: Address[];
  is_restricted?: boolean;
  restriction_reason?: string;
  restriction_until?: string;
  no_show_status?: {
    count: number;
    message?: string;
    until?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface MemberLogEntry {
  category: string;
  action: string;
  label: string;
  timestamp: string;
  timestamp_tr: string;
  order_id?: string;
  note?: string;
  admin_name?: string;
  [key: string]: unknown;
}

export interface MemberLogsResponse {
  total: number;
  counts: Record<string, number>;
  logs: MemberLogEntry[];
}

export interface OrderItemSelectedOption {
  title?: string;
  label?: string;
  price_delta?: number;
}

export interface OrderItem {
  product_name?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  price?: number;
  unit_price_snapshot?: number;
  options_fee_unit?: number;
  line_total?: number;
  total_price?: number;
  refunded?: boolean;
  refunded_amount?: number;
  selected_options?: OrderItemSelectedOption[];
  customization_note?: string;
}

export interface Order {
  tx_id: string;
  order_status?: string;
  payment_status?: string;
  payment_method?: string;
  items?: OrderItem[];
  total_amount?: number;
  amount?: number;
  refund_amount?: number;
  refund_status?: string;
  cancel_reason?: string;
  admin_note?: string;
  delivery_code?: string;
  delivery_code_expires_at?: string;
  delivery_sms_sent?: boolean;
  delivery_verified?: boolean;
  sms_status?: string;
  delivered_at?: string;
  market_name?: string;
  stall_id?: string;
  address?: string;
  courier_id?: string;
  courier_name?: string;
  user_id?: string;
  phone?: string;
  customer_phone?: string;
  customer_name?: string;
  delivery_type?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}
