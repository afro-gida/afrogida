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
}
