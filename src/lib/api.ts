import type { AuthUser } from '../shared/types';

const TOKEN_KEY = 'bignet_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
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

  const res = await fetch(path, {
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
  return token ? `/api/v1/photos/${sessionId}?token=${encodeURIComponent(token)}` : `/api/v1/photos/${sessionId}`;
}

export function getAuthorizedAvatarUrl(karyawanId: number, version?: string | null): string {
  const token = getStoredToken();
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  if (version) qs.set('v', version);
  const query = qs.toString();
  return `/api/v1/avatars/karyawan/${karyawanId}${query ? `?${query}` : ''}`;
}

export function getAuthorizedRegistrationAvatarUrl(regId: number): string {
  const token = getStoredToken();
  return token
    ? `/api/v1/avatars/registration/${regId}?token=${encodeURIComponent(token)}`
    : `/api/v1/avatars/registration/${regId}`;
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
