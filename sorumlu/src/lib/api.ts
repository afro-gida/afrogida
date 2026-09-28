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
let deviceToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Oturum sunucuda düşerse (süre doldu / başka yerden kapatıldı) çağrılır. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** "Bu cihazı hatırla" anahtarı — girişte gönderilir; sunucu tanıdığı
 *  cihazda SMS kodu istemez (bkz. backend routers/auth.py yeni cihaz doğrulaması). */
export function setDeviceToken(token: string | null) {
  deviceToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as any) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (deviceToken && path.startsWith('/auth/login')) headers['X-Device-Token'] = deviceToken;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401 && authToken && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
