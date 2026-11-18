import type { AuthUser } from '../shared/types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const entry = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = readCookie('bignet_csrf');
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }

  const res = await fetch(buildApiUrl(path), {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
    cache: options.cache || 'no-store',
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
  return buildApiUrl(`/api/v1/photos/${sessionId}`);
}

export function getAuthorizedAvatarUrl(karyawanId: number, version?: string | null): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return buildApiUrl(`/api/v1/avatars/karyawan/${karyawanId}${query}`);
}

export function getAuthorizedUserAvatarUrl(userId: number, version?: string | null): string {
  const query = version ? `?v=${encodeURIComponent(version)}` : '';
  return buildApiUrl(`/api/v1/avatars/pengguna/${userId}${query}`);
}

export function getAuthorizedRegistrationAvatarUrl(regId: number): string {
  return buildApiUrl(`/api/v1/avatars/registration/${regId}`);
}

export interface LoginStartResult {
  user?: AuthUser;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  challengeId?: string;
}

export async function loginApi(identifier: string, password: string): Promise<LoginStartResult> {
  return apiFetch<LoginStartResult>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export async function logoutApi(): Promise<void> {
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Even if the server session expired, the browser will stop using its cookie
    // when the user reloads or the browser expires it.
  }
}
