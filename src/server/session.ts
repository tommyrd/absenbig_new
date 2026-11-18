import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response } from 'express';
import type { AuthUser, Role } from '../shared/types.ts';
import {
  buildAuthCookie,
  buildCsrfCookie,
  decryptMfaSecret,
  encryptMfaSecret,
  generateTotpSecret,
  hashOpaqueSecret,
  hashRecoveryCode,
  signToken,
  verifyTotpCode,
} from './auth.ts';
import { getClientIp } from './security.ts';
import { getWibIsoString } from './time.ts';

export type SessionUser = AuthUser & { tokenVersion: number };

export const SESSION_POLICIES: Record<Role, { idleMs: number; absoluteMs: number }> = {
  KARYAWAN: { idleMs: 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
  ADMIN: { idleMs: 30 * 60 * 1000, absoluteMs: 8 * 60 * 60 * 1000 },
  SUPERADMIN: { idleMs: 15 * 60 * 1000, absoluteMs: 4 * 60 * 60 * 1000 },
};

export function issueAuthSession(
  db: DatabaseSync,
  user: SessionUser,
  req: Request,
  res: Response
): { jti: string; csrfToken: string; absoluteExpiresAt: number; idleExpiresAt: number } {
  const now = Date.now();
  const policy = SESSION_POLICIES[user.role];
  const absoluteExpiresAt = now + policy.absoluteMs;
  const idleExpiresAt = Math.min(now + policy.idleMs, absoluteExpiresAt);
  const jti = crypto.randomUUID();
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const nowIso = getWibIsoString(new Date(now));
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

  db.prepare(`
    INSERT INTO auth_sessions (
      jti, user_id, created_at, last_seen_at, idle_expires_at,
      absolute_expires_at, revoked_at, ip_address, user_agent, csrf_hash
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    jti,
    user.id,
    nowIso,
    nowIso,
    idleExpiresAt,
    absoluteExpiresAt,
    getClientIp(req),
    userAgent,
    hashOpaqueSecret(csrfToken)
  );

  const token = signToken({
    userId: user.id,
    role: user.role,
    jti,
    tv: user.tokenVersion,
    exp: absoluteExpiresAt,
  });
  const maxAgeSeconds = Math.max(1, Math.ceil((idleExpiresAt - now) / 1000));
  res.setHeader('Set-Cookie', [
    buildAuthCookie(token, req, maxAgeSeconds),
    buildCsrfCookie(csrfToken, req, maxAgeSeconds),
  ]);

  return { jti, csrfToken, absoluteExpiresAt, idleExpiresAt };
}

export function clearAuthCookies(req: Request, res: Response): void {
  res.setHeader('Set-Cookie', [
    buildAuthCookie('', req, 0),
    buildCsrfCookie('', req, 0),
  ]);
}

export type AuthChallengePurpose = 'MFA_LOGIN' | 'MFA_ENROLLMENT';

export function createAuthChallenge(
  db: DatabaseSync,
  userId: number,
  purpose: AuthChallengePurpose
): string {
  const challengeId = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now);
  db.prepare(`
    INSERT INTO auth_challenges (challenge_hash, user_id, purpose, created_at, expires_at, failed_attempts)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(
    hashOpaqueSecret(challengeId),
    userId,
    purpose,
    getWibIsoString(new Date(now)),
    now + 5 * 60 * 1000
  );
  return challengeId;
}

export function findAuthChallenge(
  db: DatabaseSync,
  challengeId: string,
  purpose?: AuthChallengePurpose
): { challenge_hash: string; user_id: number; purpose: AuthChallengePurpose; expires_at: number; failed_attempts: number } | undefined {
  if (!challengeId || challengeId.length > 128) return undefined;
  const hash = hashOpaqueSecret(challengeId);
  const row = db.prepare(`
    SELECT challenge_hash, user_id, purpose, expires_at, failed_attempts
    FROM auth_challenges WHERE challenge_hash = ?
  `).get(hash) as
    | { challenge_hash: string; user_id: number; purpose: AuthChallengePurpose; expires_at: number; failed_attempts: number }
    | undefined;
  if (!row || row.expires_at <= Date.now() || (purpose && row.purpose !== purpose)) return undefined;
  return row;
}

export function recordChallengeFailure(db: DatabaseSync, challengeHash: string): number {
  db.prepare('UPDATE auth_challenges SET failed_attempts = failed_attempts + 1 WHERE challenge_hash = ?')
    .run(challengeHash);
  const row = db.prepare('SELECT failed_attempts FROM auth_challenges WHERE challenge_hash = ?')
    .get(challengeHash) as { failed_attempts: number } | undefined;
  const attempts = row?.failed_attempts ?? 99;
  if (attempts >= 5) {
    db.prepare('DELETE FROM auth_challenges WHERE challenge_hash = ?').run(challengeHash);
  }
  return attempts;
}

export function createMfaEnrollmentSecret(): { secret: string; encrypted: string } {
  const secret = generateTotpSecret();
  return { secret, encrypted: encryptMfaSecret(secret) };
}

export function createRecoveryCodes(db: DatabaseSync, userId: number): string[] {
  const nowIso = getWibIsoString();
  const codes = Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
  db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
  const insert = db.prepare(`
    INSERT INTO mfa_recovery_codes (user_id, code_hash, created_at, used_at)
    VALUES (?, ?, ?, NULL)
  `);
  for (const code of codes) insert.run(userId, hashRecoveryCode(code), nowIso);
  return codes;
}

export function verifyMfaOrRecoveryCode(
  db: DatabaseSync,
  userId: number,
  encryptedSecret: string,
  code: string
): { valid: boolean; recoveryCodeUsed: boolean } {
  // Decryption is kept at the route boundary so callers cannot accidentally
  // persist or return the shared secret.
  try {
    if (verifyTotpCode(decryptMfaSecret(encryptedSecret), code)) {
      return { valid: true, recoveryCodeUsed: false };
    }
  } catch {
    return { valid: false, recoveryCodeUsed: false };
  }

  const codeHash = hashRecoveryCode(code);
  const row = db.prepare(`
    SELECT id FROM mfa_recovery_codes
    WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
    LIMIT 1
  `).get(userId, codeHash) as { id: number } | undefined;
  if (!row) return { valid: false, recoveryCodeUsed: false };

  const updated = db.prepare(`
    UPDATE mfa_recovery_codes SET used_at = ?
    WHERE id = ? AND user_id = ? AND used_at IS NULL
  `).run(getWibIsoString(), row.id, userId);
  return { valid: Number(updated.changes) === 1, recoveryCodeUsed: Number(updated.changes) === 1 };
}

