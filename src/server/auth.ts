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
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const secretFile = path.join(dataDir, '.auth_secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

const SECRET = getAuthSecret();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
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
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    if (!parsed.userId || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  return false;
}

export function buildAuthCookie(token: string, req: Request, maxAgeSeconds: number): string {
  const parts = [
    `bignet_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function allowsQueryToken(req: Request): boolean {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  return (
    p.startsWith('/photos/') ||
    p.startsWith('/avatars/') ||
    p === '/workforce/stream'
  );
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > -1) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k === 'bignet_token') {
          return decodeURIComponent(v);
        }
      }
    }
  }
  if (allowsQueryToken(req)) {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
    return queryToken;
  }
  return null;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authTokenPayload?: TokenPayload;
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
