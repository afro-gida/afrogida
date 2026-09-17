export interface CustomizationChoice {
  label: string;
  price_delta: number;
}

export interface CustomizationGroup {
  title: string;
  choices: CustomizationChoice[];
}

export interface Product {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  supplier_group?: string;
  price?: number | null;
  gel_al_price?: number | null;
  eve_servis_price?: number | null;
  supplier_price?: number | null;
  sale_price?: number | null;
  profit_margin_amount?: number | null;
  unit: string;
  in_stock: boolean;
  active: boolean;
  hidden?: boolean;
  image_url?: string | null;
  campaign_discount_percent?: number | null;
  campaign_min_qty?: number | null;
  customization_options?: CustomizationGroup[] | null;
}
