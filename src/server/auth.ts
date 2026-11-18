import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser, Role } from '../shared/types.ts';
import { getDataDir } from './paths.ts';

function getAuthSecret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) {
    return process.env.AUTH_SECRET;
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) {
    console.warn(
      '[SECURITY] AUTH_SECRET belum dikonfigurasi (min 32 karakter) pada .env production; menggunakan fallback file .auth_secret di DATA_DIR.'
    );
  }
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, '.auth_secret');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 64) return existing;
    throw new Error('File .auth_secret tidak valid. Pulihkan secret yang benar sebelum menjalankan aplikasi.');
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600, flag: 'wx' });
  return generated;
}

const SECRET = getAuthSecret();

function deriveKey(context: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(SECRET, 'utf8'), Buffer.from('BIGNET-AUTH-V1'), Buffer.from(context), 32));
}

export function hashOpaqueSecret(value: string): string {
  return crypto.createHmac('sha256', deriveKey('opaque-secret-hash')).update(value).digest('hex');
}

export function encryptMfaSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey('mfa-secret-encryption'), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptMfaSecret(value: string): string {
  const [ivText, tagText, cipherText] = value.split('.');
  if (!ivText || !tagText || !cipherText) throw new Error('Data MFA terenkripsi tidak valid.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveKey('mfa-secret-encryption'),
    Buffer.from(ivText, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Secret MFA memiliki format Base32 yang tidak valid.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.randomBytes(20));
}

export function generateTotpCode(secret: string, nowMs = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(nowMs / 30_000);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function getTotpCounterForCode(secret: string, code: string, nowMs = Date.now()): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const supplied = Buffer.from(normalized);
  const currentCounter = Math.floor(nowMs / 30_000);
  for (const drift of [-1, 0, 1]) {
    const counter = currentCounter + drift;
    if (counter < 0) continue;
    const expected = Buffer.from(generateTotpCode(secret, counter * 30_000));
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return counter;
  }
  return null;
}

export function verifyTotpCode(secret: string, code: string, nowMs = Date.now()): boolean {
  return getTotpCounterForCode(secret, code, nowMs) !== null;
}

export function hashRecoveryCode(code: string): string {
  return hashOpaqueSecret(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

const PASSWORD_SCRYPT_N = 32_768;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
    maxmem: PASSWORD_SCRYPT_MAXMEM,
  });
  // Versioned format lets future releases increase the work factor while
  // keeping legacy salt:hash passwords verifiable during migration.
  return `$scrypt${PASSWORD_SCRYPT_N}${PASSWORD_SCRYPT_R}${PASSWORD_SCRYPT_P}${salt.toString('base64url')}${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith('$scrypt

export interface TokenPayload {
  userId: number;
  role: Role;
  exp: number;
  jti?: string;
  tv?: number;
}

export function signToken(payload: TokenPayload): string {
  const enriched: TokenPayload = {
    ...payload,
    jti: payload.jti || crypto.randomUUID(),
    tv: payload.tv ?? 1,
  };
  const body = Buffer.from(JSON.stringify(enriched)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (
      !Number.isSafeInteger(parsed.userId) || parsed.userId <= 0 ||
      !Number.isFinite(parsed.exp) || Date.now() >= parsed.exp ||
      !parsed.jti || typeof parsed.jti !== 'string' ||
      !['KARYAWAN', 'ADMIN', 'SUPERADMIN'].includes(parsed.role)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https';
}

export function buildAuthCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function buildCsrfCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_csrf=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0 || pair.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function extractCsrfCookie(req: Request): string | null {
  return readCookie(req, 'bignet_csrf');
}

export function extractToken(req: Request): string | null {
  // Authentication is cookie-only. Tokens in localStorage, Authorization headers,
  // and URL query parameters are intentionally not accepted.
  return readCookie(req, 'bignet_token');
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authTokenPayload?: TokenPayload;
  authSession?: { jti: string; csrfHash: string; idleExpiresAt: number; absoluteExpiresAt: number };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir.' });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Akses ditolak. Peran ${req.authUser.role} tidak memiliki izin untuk operasi ini.`,
      });
      return;
    }
    next();
  };
}
)) {
      const parts = stored.split('

export interface TokenPayload {
  userId: number;
  role: Role;
  exp: number;
  jti?: string;
  tv?: number;
}

export function signToken(payload: TokenPayload): string {
  const enriched: TokenPayload = {
    ...payload,
    jti: payload.jti || crypto.randomUUID(),
    tv: payload.tv ?? 1,
  };
  const body = Buffer.from(JSON.stringify(enriched)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (
      !Number.isSafeInteger(parsed.userId) || parsed.userId <= 0 ||
      !Number.isFinite(parsed.exp) || Date.now() >= parsed.exp ||
      !parsed.jti || typeof parsed.jti !== 'string' ||
      !['KARYAWAN', 'ADMIN', 'SUPERADMIN'].includes(parsed.role)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https';
}

export function buildAuthCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function buildCsrfCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_csrf=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0 || pair.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function extractCsrfCookie(req: Request): string | null {
  return readCookie(req, 'bignet_csrf');
}

export function extractToken(req: Request): string | null {
  // Authentication is cookie-only. Tokens in localStorage, Authorization headers,
  // and URL query parameters are intentionally not accepted.
  return readCookie(req, 'bignet_token');
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authTokenPayload?: TokenPayload;
  authSession?: { jti: string; csrfHash: string; idleExpiresAt: number; absoluteExpiresAt: number };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir.' });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Akses ditolak. Peran ${req.authUser.role} tidak memiliki izin untuk operasi ini.`,
      });
      return;
    }
    next();
  };
}
);
      if (parts.length !== 7) return false;
      const [, scheme, nText, rText, pText, saltText, key] = parts;
      const N = Number(nText);
      const r = Number(rText);
      const p = Number(pText);
      if (
        scheme !== 'scrypt' ||
        !Number.isSafeInteger(N) || N < 16_384 || N > 131_072 || (N & (N - 1)) !== 0 ||
        !Number.isSafeInteger(r) || r < 1 || r > 16 ||
        !Number.isSafeInteger(p) || p < 1 || p > 4 ||
        !/^[a-f0-9]{128}$/i.test(key)
      ) return false;
      const salt = Buffer.from(saltText, 'base64url');
      if (salt.length < 16 || salt.length > 64) return false;
      const maxmem = Math.max(64 * 1024 * 1024, 256 * N * r);
      const derived = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem });
      const keyBuf = Buffer.from(key, 'hex');
      return derived.length === keyBuf.length && crypto.timingSafeEqual(derived, keyBuf);
    }

    // Backward compatibility for existing accounts created before the
    // versioned scrypt format was introduced.
    const [salt, key] = stored.split(':');
    if (!salt || !key || !/^[a-f0-9]{128}$/i.test(key)) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(key, 'hex');
    return derived.length === keyBuf.length && crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}

export interface TokenPayload {
  userId: number;
  role: Role;
  exp: number;
  jti?: string;
  tv?: number;
}

export function signToken(payload: TokenPayload): string {
  const enriched: TokenPayload = {
    ...payload,
    jti: payload.jti || crypto.randomUUID(),
    tv: payload.tv ?? 1,
  };
  const body = Buffer.from(JSON.stringify(enriched)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (
      !Number.isSafeInteger(parsed.userId) || parsed.userId <= 0 ||
      !Number.isFinite(parsed.exp) || Date.now() >= parsed.exp ||
      !parsed.jti || typeof parsed.jti !== 'string' ||
      !['KARYAWAN', 'ADMIN', 'SUPERADMIN'].includes(parsed.role)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https';
}

export function buildAuthCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function buildCsrfCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_csrf=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0 || pair.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function extractCsrfCookie(req: Request): string | null {
  return readCookie(req, 'bignet_csrf');
}

export function extractToken(req: Request): string | null {
  // Authentication is cookie-only. Tokens in localStorage, Authorization headers,
  // and URL query parameters are intentionally not accepted.
  return readCookie(req, 'bignet_token');
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authTokenPayload?: TokenPayload;
  authSession?: { jti: string; csrfHash: string; idleExpiresAt: number; absoluteExpiresAt: number };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Sesi login tidak valid atau telah berakhir.' });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Akses ditolak. Peran ${req.authUser.role} tidak memiliki izin untuk operasi ini.`,
      });
      return;
    }
    next();
  };
}
