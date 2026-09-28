import { Platform } from 'react-native';

/**
 * Sunucu adresi. Web (Windows'ta yerel başlatıcı ile): aynı kökene '/api' —
 * yerel sunucu istekleri afrogida.com.tr'ye iletir (CORS gerekmez).
 * iPhone / iPad / Mac: doğrudan canlı sunucu.
 */
export const API_BASE = Platform.OS === 'web' ? '/api' : 'https://afrogida.com.tr/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sunucuya ulaşılamadı. İnternet bağlantısını kontrol edin.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    const detail = data?.detail;
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d?.msg).join(', ') : `Hata (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
};

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Beklenmeyen hata';
}
