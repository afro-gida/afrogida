import { api, ApiError } from '@/lib/api';

/** Giriş yapmış kullanıcının şikayet/öneri mesajını gönderir (backend/routers/complaints.py
 *  admin_list_complaints'in okuduğu db.complaints koleksiyonuna düşer). */
export async function submitComplaint(message: string): Promise<{ ok: true } | { error: string }> {
  try {
    await api.post('/complaints', { message: message.trim() });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'Bağlantı hatası. Backend çalışıyor mu?' };
  }
}
