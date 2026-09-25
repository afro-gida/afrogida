/**
 * Backend API istemcisi. Taban adres EXPO_PUBLIC_API_URL env değişkeninden gelir;
 * verilmezse yerel geliştirme backend'ini (backend/run_dev_server.py) varsayar.
 */
/**
 * Web'de geliştirme backend'i HER ZAMAN sayfanın açıldığı makineden istenir:
 *  - telefondan http://192.168.1.2:8081 ile açılınca "localhost" telefonun
 *    kendisi olur, API'ye ulaşılamaz;
 *  - .env'deki yerel ağ adresi (ör. 192.168.1.5) bilgisayarın adresi
 *    değişince bayatlar, giriş/veri istekleri sessizce düşer.
 * Bu yüzden adres localhost veya bir yerel ağ adresiyse (10.x, 172.16-31.x,
 * 192.168.x) yerine sayfanın adresi konur. Gerçek sunucu adresleri
 * (https://...afrogida.com.tr) olduğu gibi kalır.
 */
const LOCAL_API_HOST = /\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?=[:/])/;

function resolveApiBase(base: string) {
  if (typeof window === 'undefined' || !window.location?.hostname) return base;
  return base.replace(LOCAL_API_HOST, `//${window.location.hostname}`);
}

export const API_BASE_URL = resolveApiBase(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = null;

/** AuthProvider oturum açtığında/kapattığında çağırır; sonraki tüm isteklere eklenir. */
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
