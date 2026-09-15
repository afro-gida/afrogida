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
  hazirlaniyor: 'Hazırlanıyor',
  hazir: 'Hazır',
  yola_cikti: 'Yolda',
  teslim_edildi: 'Teslim Edildi',
  iptal_edildi: 'İptal Edildi',
  teslim_alinmadi: 'Teslim Alınmadı',
  musteri_gelmedi_iptal: 'Müşteri Gelmedi',
};

export function orderStatusLabel(status: string | undefined) {
  if (!status) return 'Bilinmiyor';
  return STATUS_LABELS[status] ?? status;
}

export function orderStatusBadgeClass(status: string | undefined) {
  switch (status) {
    case 'teslim_edildi':
      return 'badge-green';
    case 'iptal_edildi':
    case 'teslim_alinmadi':
    case 'musteri_gelmedi_iptal':
      return 'badge-red';
    case 'yola_cikti':
    case 'hazir':
      return 'badge-orange';
    default:
      return 'badge-muted';
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  iade_edildi: 'İade Edildi',
  kismi_iade_edildi: 'Kısmi İade',
  unpaid: 'Ödenmedi',
};

export function paymentStatusLabel(status: string | undefined) {
  if (!status) return '—';
  return PAYMENT_LABELS[status] ?? status;
}
