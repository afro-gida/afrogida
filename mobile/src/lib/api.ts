/**
 * Backend API istemcisi. Taban adres EXPO_PUBLIC_API_URL env değişkeninden gelir;
 * verilmezse yerel geliştirme backend'ini (backend/run_dev_server.py) varsayar.
 */
export const API_BASE_URL = resolveApiBase(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api');

/**
 * Web'de sayfa telefondan bilgisayarın ağ adresiyle açılırsa (ör.
 * http://192.168.1.2:8081) "localhost" telefonun kendisi olur ve API'ye
 * ulaşılamaz — bu durumda API'yi de sayfanın açıldığı makineden iste.
 */
function resolveApiBase(base: string) {
  if (typeof window === 'undefined' || !window.location?.hostname) return base;
  const pageHost = window.location.hostname;
  if (pageHost === 'localhost' || pageHost === '127.0.0.1') return base;
  return base.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/])/, `//${pageHost}`);
}

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
