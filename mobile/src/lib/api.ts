/**
 * Backend API istemcisi. Taban adres EXPO_PUBLIC_API_URL env değişkeninden gelir;
 * verilmezse yerel geliştirme backend'ini varsayar.
 *
 * NOT: Henüz gerçek backend'e bağlanmıyoruz (bkz. proje notları — .env içinde
 * gerçek PayTR/SMS anahtarları var, test modu kapalı). Ekranlar şimdilik
 * `src/data/sample.ts` içindeki örnek veriyle çalışıyor.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      // yanıt JSON değil, statusText kalsın
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
};
