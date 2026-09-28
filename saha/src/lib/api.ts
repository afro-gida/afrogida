/**
 * Backend API istemcisi. Taban adres EXPO_PUBLIC_API_URL env değişkeninden gelir;
 * verilmezse yerel geliştirme backend'ini (backend/run_dev_server.py) varsayar.
 * mobile/src/lib/api.ts ile aynı desen.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as any) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Ürün resmi yükler (sunucu küçültüp WebP yapar). Kalıcı tam adres döner —
 *  müşteri sitesi ve diğer uygulamalar aynı adresi gösterebilsin. */
export async function uploadImage(file: Blob, filename = 'urun.jpg'): Promise<string> {
  const form = new FormData();
  form.append('file', file, filename);
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE_URL}/admin/upload`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json())?.detail ?? detail;
    } catch {
      // yok say
    }
    throw new ApiError(res.status, detail);
  }
  const { url } = (await res.json()) as { url: string };
  return url.startsWith('http') ? url : `https://afrogida.com.tr${url}`;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
