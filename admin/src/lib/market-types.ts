export interface Market {
  id: string;
  name: string;
  day: string;
  image_url?: string | null;
  location?: string | null;
  location_url?: string | null;
  google_maps_url?: string | null;
  note?: string | null;
  active: boolean;
  is_open?: boolean;
  orders_enabled: boolean;
  delivery_enabled: boolean;
  online_payment_enabled: boolean;
  active_eve_servis: boolean;
  active_gel_al: boolean;
  delivery_neighborhoods: string[];

  // Pazar bazlı Eve Servis / Gel-Al / Ödeme ayarları
  eve_servis_urun_gorunurlugu?: boolean;
  eve_servis_min_tutar?: number;
  eve_servis_saati?: string;
  kapida_nakit_odeme_enabled?: boolean;
  nakit_tezgah_limit_enabled?: boolean;
  nakit_tezgah_maksimum_tutari?: number;
  gel_al_min_tutar?: number;
  teslimat_ucreti?: number;
  ucretsiz_teslimat_alt_limiti?: number;
  pazar_saati?: string;
  gel_al_saati?: string;
}
