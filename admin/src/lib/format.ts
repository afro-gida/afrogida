export function maskPhone(phone: string | undefined | null) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `${digits.slice(0, 4)} *** **${digits.slice(-2)}`;
}

export function formatMoney(value: number | undefined | null) {
  if (value == null) return '—';
  return `₺${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(value: string | undefined | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

const STATUS_LABELS: Record<string, string> = {
  talep_alindi: 'Talep Alındı',
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yola_cikti: 'Yolda',
  yolda: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
  iptal: 'İptal Edildi',
  teslim_alinmadi: 'Teslim Alınmadı',
  musteri_gelmedi_iptal: 'Müşteri Gelmedi',
};

export function orderStatusLabel(status: string | undefined) {
  if (!status) return 'Bilinmiyor';
  return STATUS_LABELS[status] ?? status;
}

/** Sipariş akışındaki yeri: mavi = yeni/bekliyor, turuncu = hazırlanıyor/yolda,
 * yeşil = tamamlandı, kırmızı = iptal/başarısız. */
export function orderStatusBadgeClass(status: string | undefined) {
  switch (status) {
    case 'teslim_edildi':
      return 'badge-green';
    case 'iptal_edildi':
    case 'iptal':
    case 'teslim_alinmadi':
    case 'musteri_gelmedi_iptal':
      return 'badge-red';
    case 'yola_cikti':
    case 'yolda':
    case 'hazir':
    case 'hazirlaniyor':
      return 'badge-orange';
    case 'talep_alindi':
      return 'badge-blue';
    default:
      return 'badge-muted';
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  pending: 'Bekliyor',
  unpaid: 'Ödenmedi',
  failed: 'Başarısız',
  suspicious: 'Şüpheli',
  iade_edildi: 'İade Edildi',
  kismi_iade_edildi: 'Kısmi İade',
};

export function paymentStatusLabel(status: string | undefined) {
  if (!status) return '—';
  return PAYMENT_LABELS[status] ?? status;
}

export function paymentStatusBadgeClass(status: string | undefined) {
  switch (status) {
    case 'paid':
      return 'badge-green';
    case 'pending':
    case 'unpaid':
      return 'badge-orange';
    case 'failed':
    case 'suspicious':
    case 'iade_edildi':
    case 'kismi_iade_edildi':
      return 'badge-red';
    default:
      return 'badge-muted';
  }
}

const DELIVERY_TYPE_LABELS: Record<string, string> = {
  gel_al: 'Gel-Al',
  eve_servis: 'Eve Servis',
};

export function deliveryTypeLabel(type: string | undefined) {
  if (!type) return '—';
  return DELIVERY_TYPE_LABELS[type] ?? type;
}
