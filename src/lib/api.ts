import type { AuthUser } from '../shared/types';

const TOKEN_KEY = 'bignet_auth_token';
let memoryToken: string | null = null;

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveApiBase(): string {
  const configured = (
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (!configured) return '';

  if (typeof window !== 'undefined') {
    try {
      const apiUrl = new URL(configured, window.location.origin);
      // Never route a remote browser (HTTPS preview, tunnel, LAN, or production)
      // to a local loopback URL; use same-origin relative /api paths instead.
      if (isLoopbackHost(apiUrl.hostname) && !isLoopbackHost(window.location.hostname)) {
        return '';
      }
      // Prevent HTTPS pages from making blocked HTTP mixed-content API calls.
      if (window.location.protocol === 'https:' && apiUrl.protocol === 'http:') {
        return '';
      }
    } catch {
      return '';
    }
  }

  return configured;
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveApiBase();
  return `${base}${path}`;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setStoredToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Fallback to in-memory token when storage is blocked in embedded contexts
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(buildApiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || 'Respons server tidak valid' };
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Permintaan gagal (${res.status})`) || 'Terjadi kesalahan';
    const err = new Error(errMsg) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data as T;
}

export function getAuthorizedPhotoUrl(sessionId: number): string {
  const token = getStoredToken();
  return buildApiUrl(
    token ? `/api/v1/photos/${sessionId}?token=${encodeURIComponent(token)}` : `/api/v1/photos/${sessionId}`
  );
}

export function getAuthorizedAvatarUrl(karyawanId: number, version?: string | null): string {
  const token = getStoredToken();
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  if (version) qs.set('v', version);
  const query = qs.toString();
  return buildApiUrl(`/api/v1/avatars/karyawan/${karyawanId}${query ? `?${query}` : ''}`);
}

export function getAuthorizedUserAvatarUrl(userId: number, version?: string | null): string {
  const token = getStoredToken();
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  if (version) qs.set('v', version);
  const query = qs.toString();
  return buildApiUrl(`/api/v1/avatars/pengguna/${userId}${query ? `?${query}` : ''}`);
}

export function getAuthorizedRegistrationAvatarUrl(regId: number): string {
  const token = getStoredToken();
  return buildApiUrl(
    token
      ? `/api/v1/avatars/registration/${regId}?token=${encodeURIComponent(token)}`
      : `/api/v1/avatars/registration/${regId}`
  );
}

export async function loginApi(identifier: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await apiFetch<{ token: string; user: AuthUser }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
  setStoredToken(res.token);
  return res;
}

export async function logoutApi(): Promise<void> {
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    setStoredToken(null);
  }
}
