import type { Request } from 'express';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function safeErrorDetail(err: unknown): string | undefined {
  if (isProduction()) return undefined;
  return err instanceof Error ? err.message : undefined;
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private lastPrune = Date.now();

  constructor(windowMs: number, maxAttempts: number) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
  }

  private prune(now: number) {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [k, v] of this.buckets.entries()) {
      if (now >= v.resetAt) this.buckets.delete(k);
    }
  }

  check(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return { allowed: true, remaining: this.maxAttempts, retryAfterSec: 0 };
    }
    const now = Date.now();
    this.prune(now);
    const entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      return { allowed: true, remaining: this.maxAttempts, retryAfterSec: 0 };
    }
    const remaining = Math.max(0, this.maxAttempts - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: entry.count < this.maxAttempts, remaining, retryAfterSec };
  }

  consume(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      return { allowed: true, remaining: this.maxAttempts, retryAfterSec: 0 };
    }
    const now = Date.now();
    this.prune(now);
    let entry = this.buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.maxAttempts;
    const remaining = Math.max(0, this.maxAttempts - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed, remaining, retryAfterSec };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const loginIpLimiter = new RateLimiter(15 * 60 * 1000, 40);
export const loginFailLimiter = new RateLimiter(15 * 60 * 1000, 8);
export const registerLimiter = new RateLimiter(15 * 60 * 1000, 8);
export const passwordLimiter = new RateLimiter(15 * 60 * 1000, 12);
export const attendanceLimiter = new RateLimiter(5 * 60 * 1000, 30);

function matchesMagicBytes(buf: Buffer, ext: 'png' | 'jpg' | 'webp'): boolean {
  if (ext === 'png') {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }
  if (ext === 'jpg') {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === 'webp') {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

export function validateRasterImageBase64(
  base64Input: string,
  options: { maxBytes: number; label: string }
): { ext: 'png' | 'jpg' | 'webp'; buf: Buffer } {
  const match = base64Input.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error(`Format ${options.label} harus berupa gambar PNG, JPG, atau WEBP yang valid.`);
  }
  const ext: 'png' | 'jpg' | 'webp' =
    match[1] === 'jpeg' || match[1] === 'jpg'
      ? 'jpg'
      : match[1] === 'png'
      ? 'png'
      : 'webp';
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buf.length === 0) {
    throw new Error(`Berkas ${options.label} kosong.`);
  }
  if (buf.length > options.maxBytes) {
    const mb = Math.round((options.maxBytes / (1024 * 1024)) * 10) / 10;
    throw new Error(`Ukuran ${options.label} maksimal ${mb} MB.`);
  }
  if (!matchesMagicBytes(buf, ext)) {
    throw new Error(`Konten biner ${options.label} tidak sesuai dengan deklarasi format ${ext.toUpperCase()}.`);
  }
  return { ext, buf };
}

export function validateAndSanitizeLogoBase64(
  base64Input: string,
  maxBytes: number
): { ext: 'png' | 'jpg' | 'webp' | 'svg'; buf: Buffer } {
  if (base64Input.startsWith('data:image/svg+xml;base64,')) {
    const rawB64 = base64Input.slice('data:image/svg+xml;base64,'.length).replace(/\s+/g, '');
    const buf = Buffer.from(rawB64, 'base64');
    if (buf.length === 0 || buf.length > maxBytes) {
      throw new Error('Ukuran logo SVG maksimal 2 MB.');
    }
    const text = buf.toString('utf8');
    if (!/<svg[\s>]/i.test(text) || !/<\/svg>/i.test(text)) {
      throw new Error('Berkas SVG tidak valid.');
    }
    const dangerousPattern =
      /<\s*(script|foreignObject|iframe|object|embed|applet)\b|on[a-z]+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;
    if (dangerousPattern.test(text)) {
      throw new Error('Logo SVG ditolak karena mengandung elemen atau skrip aktif yang tidak aman.');
    }
    return { ext: 'svg', buf };
  }
  return validateRasterImageBase64(base64Input, { maxBytes, label: 'logo' });
}
