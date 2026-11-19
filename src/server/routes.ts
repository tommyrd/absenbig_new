import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  buildAuthCookie,
  extractToken,
  hashPassword,
  requireRole,
  signToken,
  verifyPassword,
  verifyToken,
  type AuthenticatedRequest,
} from './auth.ts';
import { getDb } from './db.ts';
import { getAssetsDir, getAvatarsDir, getBackupDir, getDbPath, getPhotosDir } from './paths.ts';
import { runBackup, type BackupManifest } from '../../scripts/backup/backup.ts';
import {
  attendanceLimiter,
  getClientIp,
  loginFailLimiter,
  loginIpLimiter,
  passwordLimiter,
  registerLimiter,
  safeErrorDetail,
  validateAndSanitizeLogoBase64,
  validateAndSanitizeFaviconBase64,
  validateRasterImageBase64,
} from './security.ts';
import { writeAuditLog } from './services/audit.ts';
import {
  computeMonthlySummary,
  getWorkforceToday,
  haversineMeters,
  resolveDayForEmployee,
} from './services/resolver.ts';
import { getWibDateString, getWibIsoString, getWibTimeString, parseHmToMinutes } from './time.ts';
import { isGpsAccuracyAcceptable, isWithinVerifiedGeofence, MAX_GPS_ACCURACY_METERS, requiresOfficeGeofence } from '../shared/geofence.ts';
import { getSessionWindowState } from '../shared/session-window.ts';
import { getGeoapifyAddress, reverseGeocodeCoordinates } from './services/reverse-geocode.ts';
import type {
  AttendanceFeedPost,
  AttendanceFeedRosterItem,
  AuthUser,
  Karyawan,
  KebijakanAbsensi,
  Pengajuan,
  Role,
  SesiConfig,
} from '../shared/types.ts';

// SSE clients for real-time workforce status
const sseClients = new Set<Response>();

function asyncRoute(
  handler: (req: AuthenticatedRequest, res: Response) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req as AuthenticatedRequest, res).catch(next);
  };
}

function broadcastWorkforceUpdate(eventType: string) {
  const payload = JSON.stringify({ type: eventType, waktu: getWibIsoString() });
  for (const res of sseClients) {
    try {
      res.write(`event: workforce\ndata: ${payload}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

function loadAuthUserById(userId: number): (AuthUser & { tokenVersion: number }) | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.role, u.karyawan_id, u.aktif as user_aktif,
              COALESCE(u.token_version, 1) as token_version,
              COALESCE(NULLIF(u.nama_tampilan, ''), k.nama_lengkap, 'Superadmin') as nama_lengkap,
              COALESCE(k.nik, '') as nik,
              COALESCE(k.jabatan, 'Pemilik Sistem') as jabatan,
              COALESCE(k.no_hp, u.no_hp, '') as no_hp,
              COALESCE(k.kantor_id, 0) as kantor_id, COALESCE(k.bidang_id, 0) as bidang_id, k.aktif as emp_aktif,
              COALESCE(k.foto_profil_path, u.foto_profil_path) as foto_profil_path,
              COALESCE(k.foto_profil_updated_at, u.foto_profil_updated_at) as foto_profil_updated_at,
              COALESCE(kt.nama, 'Akun Sistem') as kantor_nama,
              COALESCE(kt.lat, 0) as kantor_lat, COALESCE(kt.lng, 0) as kantor_lng,
              COALESCE(kt.radius_meter, 0) as kantor_radius,
              COALESCE(kt.geofence_mode, 'TOLAK_LUAR_RADIUS') as kantor_geofence_mode,
              COALESCE(b.nama, 'Non-Karyawan') as bidang_nama
       FROM pengguna u
       LEFT JOIN karyawan k ON u.karyawan_id = k.id
       LEFT JOIN kantor kt ON k.kantor_id = kt.id
       LEFT JOIN bidang_kerja b ON k.bidang_id = b.id
       WHERE u.id = ? AND u.aktif = 1 AND (u.role = 'SUPERADMIN' OR k.aktif = 1)`
    )
    .get(userId) as
    | (AuthUser & { user_aktif: number; emp_aktif: number | null; foto_profil_path: string | null; token_version: number })
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    no_hp: row.no_hp,
    role: row.role,
    karyawan_id: row.karyawan_id ?? null,
    nama_lengkap: row.nama_lengkap,
    nik: row.nik,
    jabatan: row.jabatan,
    kantor_id: row.kantor_id,
    kantor_nama: row.kantor_nama,
    kantor_lat: row.kantor_lat,
    kantor_lng: row.kantor_lng,
    kantor_radius: row.kantor_radius,
    kantor_geofence_mode: row.kantor_geofence_mode,
    bidang_id: row.bidang_id,
    bidang_nama: row.bidang_nama,
    has_foto_profil: Boolean(row.foto_profil_path),
    foto_profil_updated_at: row.foto_profil_updated_at ?? null,
    tokenVersion: row.token_version,
  };
}

function stripInternalAuthFields(user: AuthUser & { tokenVersion?: number }): AuthUser {
  const { tokenVersion: _tv, ...clean } = user;
  return clean;
}

function saveAvatarBase64(base64Input: string, prefix: string): string {
  const { ext, buf } = validateRasterImageBase64(base64Input, {
    maxBytes: 2 * 1024 * 1024,
    label: 'foto profil',
  });
  const avatarsDir = getAvatarsDir();
  if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
  const fileName = `${prefix}_${crypto.randomBytes(10).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(avatarsDir, fileName), buf);
  return fileName;
}

function deleteAvatarFile(fileName: string | null | undefined) {
  if (!fileName) return;
  const safePath = path.join(getAvatarsDir(), path.basename(fileName));
  if (fs.existsSync(safePath)) {
    fs.unlinkSync(safePath);
  }
}

function buildDefaultAvatarSvg(namaLengkap: string, role?: string): string {
  const words = (namaLengkap || 'BG').trim().split(/\s+/);
  const initials = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
  const bg =
    role === 'SUPERADMIN' ? '#4a0e0a' : role === 'ADMIN' ? '#c0392b' : '#7c1c13';
  const ring =
    role === 'SUPERADMIN' ? '#fbbf24' : role === 'ADMIN' ? '#fad2ce' : '#f5aba3';
  const safeInitials = initials.replace(/[<>&'"]/g, '') || 'BG';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" fill="none">
  <rect width="160" height="160" rx="36" fill="${bg}"/>
  <rect x="6" y="6" width="148" height="148" rx="30" stroke="${ring}" stroke-opacity="0.45" stroke-width="3"/>
  <circle cx="80" cy="60" r="24" fill="white" fill-opacity="0.16"/>
  <path d="M38 134 C38 104 122 104 122 134" fill="white" fill-opacity="0.14"/>
  <text x="80" y="92" text-anchor="middle" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${safeInitials}</text>
</svg>`;
}

function attachUser(req: AuthenticatedRequest, _res: Response, next: () => void) {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const db = getDb();
      if (payload.jti) {
        const revoked = db
          .prepare(`SELECT 1 FROM revoked_tokens WHERE jti = ? LIMIT 1`)
          .get(payload.jti);
        if (revoked) {
          next();
          return;
        }
      }
      const user = loadAuthUserById(payload.userId);
      if (user && (payload.tv ?? 1) === user.tokenVersion) {
        req.authUser = stripInternalAuthFields(user);
        req.authTokenPayload = payload;
      }
    }
  }
  next();
}

const KARYAWAN_ONLY_SQL = `NOT EXISTS (SELECT 1 FROM pengguna u_role WHERE u_role.karyawan_id = k.id AND u_role.role IN ('ADMIN', 'SUPERADMIN'))`;

function isAttendanceEligibleEmployee(karyawanId: number): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT k.id
       FROM karyawan k
       WHERE k.id = ?
         AND COALESCE(k.is_system_archive, 0) = 0
         AND ${KARYAWAN_ONLY_SQL}
       LIMIT 1`
    )
    .get(karyawanId);
  return Boolean(row);
}

function getKaryawanById(id: number): Karyawan | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT k.*, kt.nama as kantor_nama, kt.kode as kantor_kode, b.nama as bidang_nama
       FROM karyawan k
       JOIN kantor kt ON k.kantor_id = kt.id
       JOIN bidang_kerja b ON k.bidang_id = b.id
       WHERE k.id = ?`
    )
    .get(id) as Karyawan | undefined;
}

interface ActiveCheckinOverride {
  id: number;
  urutan_sesi: number;
  nama_sesi: string;
  alasan: string;
  berlaku_sampai: string;
  created_at: string;
  admin_id: number;
  admin_nama: string;
}

function getActiveCheckinOverride(
  db: ReturnType<typeof getDb>,
  karyawanId: number,
  tanggal: string,
  urutanSesi: number,
  nowIso: string
): ActiveCheckinOverride | null {
  const row = db
    .prepare(
      `SELECT o.id, o.urutan_sesi, o.nama_sesi, o.alasan, o.berlaku_sampai,
              o.created_at, o.admin_id,
              COALESCE(NULLIF(u.nama_tampilan, ''), k.nama_lengkap, u.username) as admin_nama
       FROM override_akses_absensi o
       JOIN pengguna u ON u.id = o.admin_id
       LEFT JOIN karyawan k ON k.id = u.karyawan_id
       WHERE o.karyawan_id = ? AND o.tanggal = ? AND o.urutan_sesi = ?
         AND o.status = 'AKTIF' AND o.used_at IS NULL AND o.berlaku_sampai > ?
       ORDER BY o.id DESC LIMIT 1`
    )
    .get(karyawanId, tanggal, urutanSesi, nowIso) as ActiveCheckinOverride | undefined;
  return row ?? null;
}

export function registerApiRoutes(app: Express) {
  const db = getDb();
  app.use('/api/v1', attachUser);

  // 0. Healthcheck (unauthenticated for load balancers / PM2 / Nginx probes)
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({
        status: 'ok',
        app: 'Absensi BIGNET',
        timezone: 'Asia/Jakarta',
        serverTimeIso: getWibIsoString(),
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch {
      res.status(503).json({ status: 'error', error: 'Database tidak tersedia.' });
    }
  });

  // 1. Server Time
  app.get('/api/v1/time', (_req: Request, res: Response) => {
    const now = new Date();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      serverTimeIso: getWibIsoString(now),
      date: getWibDateString(now),
      time: getWibTimeString(now),
      timezone: 'Asia/Jakarta',
      epochMs: now.getTime(),
    });
  });

  // 2. Auth
  app.post('/api/v1/auth/login', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    const ipLimit = loginIpLimiter.consume(clientIp);
    if (!ipLimit.allowed) {
      res.setHeader('Retry-After', String(ipLimit.retryAfterSec));
      res.status(429).json({
        error: `Terlalu banyak percobaan login dari jaringan Anda. Coba lagi dalam ${ipLimit.retryAfterSec} detik.`,
      });
      return;
    }

    const { identifier, password } = req.body as { identifier?: string; password?: string };
    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email dan kata sandi wajib diisi.' });
      return;
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const failKey = `${clientIp}:${cleanIdentifier}`;
    const failLimit = loginFailLimiter.check(failKey);
    if (!failLimit.allowed) {
      res.setHeader('Retry-After', String(failLimit.retryAfterSec));
      res.status(429).json({
        error: `Akun sementara dikunci karena percobaan gagal berulang. Coba lagi dalam ${failLimit.retryAfterSec} detik.`,
      });
      return;
    }

    const row = db
      .prepare(
        `SELECT u.id, u.password_hash, u.role, u.aktif, COALESCE(u.token_version, 1) as token_version, k.aktif as emp_aktif
         FROM pengguna u
         LEFT JOIN karyawan k ON u.karyawan_id = k.id
         WHERE (LOWER(u.username) = LOWER(?) OR LOWER(u.email) = LOWER(?)) LIMIT 1`
      )
      .get(cleanIdentifier, cleanIdentifier) as
      | { id: number; password_hash: string; role: Role; aktif: number; token_version: number; emp_aktif: number | null }
      | undefined;

    if (!row) {
      const reg = db
        .prepare(
          `SELECT status, password_hash, alasan_keputusan
           FROM pendaftaran_akun
           WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))
           ORDER BY id DESC LIMIT 1`
        )
        .get(cleanIdentifier, cleanIdentifier) as
        | { status: string; password_hash: string; alasan_keputusan: string | null }
        | undefined;

      if (reg && verifyPassword(password, reg.password_hash)) {
        if (reg.status === 'PENDING') {
          res.status(403).json({
            error: 'Pendaftaran akun Anda sedang menunggu persetujuan (ACC) Superadmin.',
          });
          return;
        }
        if (reg.status === 'REJECTED') {
          res.status(403).json({
            error: `Pendaftaran akun Anda ditolak Superadmin.${
              reg.alasan_keputusan ? ` Alasan: ${reg.alasan_keputusan}` : ''
            }`,
          });
          return;
        }
      }
      loginFailLimiter.consume(failKey);
      res.status(401).json({ error: 'Username/email atau kata sandi salah.' });
      return;
    }

    if (!verifyPassword(password, row.password_hash)) {
      loginFailLimiter.consume(failKey);
      res.status(401).json({ error: 'Username/email atau kata sandi salah.' });
      return;
    }

    if (row.aktif !== 1 || (row.role !== 'SUPERADMIN' && row.emp_aktif !== 1)) {
      res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan. Hubungi Superadmin.' });
      return;
    }

    const userWithMeta = loadAuthUserById(row.id);
    if (!userWithMeta) {
      res.status(403).json({ error: 'Akun karyawan tidak aktif.' });
      return;
    }

    loginFailLimiter.reset(failKey);
    const user = stripInternalAuthFields(userWithMeta);
    const token = signToken({
      userId: user.id,
      role: user.role,
      tv: userWithMeta.tokenVersion,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });

    res.setHeader('Set-Cookie', buildAuthCookie(token, req, 60 * 60 * 24 * 7));

    writeAuditLog(db, {
      actor: user,
      req,
      modul: 'AUTH',
      aksi: 'LOGIN',
      targetEntity: 'pengguna',
      targetId: user.id,
      karyawanId: user.karyawan_id,
      alasan: `Login berhasil via web (${user.role})`,
    });

    res.json({ token, user });
  });

  app.post('/api/v1/auth/logout', (req: AuthenticatedRequest, res: Response) => {
    if (req.authTokenPayload?.jti) {
      db.prepare(
        `INSERT OR IGNORE INTO revoked_tokens (jti, expires_at, revoked_at) VALUES (?, ?, ?)`
      ).run(req.authTokenPayload.jti, req.authTokenPayload.exp, getWibIsoString());
      db.prepare(`DELETE FROM revoked_tokens WHERE expires_at < ?`).run(Date.now());
    }
    if (req.authUser) {
      writeAuditLog(db, {
        actor: req.authUser,
        req,
        modul: 'AUTH',
        aksi: 'LOGOUT',
        targetEntity: 'pengguna',
        targetId: req.authUser.id,
        karyawanId: req.authUser.karyawan_id,
      });
    }
    res.setHeader('Set-Cookie', buildAuthCookie('', req, 0));
    res.json({ ok: true });
  });

  app.get('/api/v1/auth/me', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.authUser });
  });

  app.get('/api/v1/auth/register-options', (_req: Request, res: Response) => {
    const offices = db
      .prepare(`SELECT id, kode, nama FROM kantor WHERE aktif = 1 ORDER BY id ASC`)
      .all();
    const bidangList = db
      .prepare(`SELECT id, kode, nama, deskripsi FROM bidang_kerja ORDER BY id ASC`)
      .all();
    res.json({ offices, bidangList });
  });

  app.post('/api/v1/auth/register', (req: Request, res: Response) => {
    const regLimit = registerLimiter.consume(getClientIp(req));
    if (!regLimit.allowed) {
      res.setHeader('Retry-After', String(regLimit.retryAfterSec));
      res.status(429).json({
        error: `Terlalu banyak pengiriman pendaftaran. Coba lagi dalam ${regLimit.retryAfterSec} detik.`,
      });
      return;
    }

    const {
      nama_lengkap,
      username,
      email,
      no_hp,
      password,
      role_diminta,
      jabatan,
      kantor_id,
      bidang_id,
      catatan_pendaftar,
      fotoBase64,
    } = req.body as {
      nama_lengkap?: string;
      username?: string;
      email?: string;
      no_hp?: string;
      password?: string;
      role_diminta?: 'KARYAWAN' | 'ADMIN';
      jabatan?: string;
      kantor_id?: number;
      bidang_id?: number;
      catatan_pendaftar?: string;
      fotoBase64?: string | null;
    };

    const cleanName = (nama_lengkap || '').trim();
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanHp = (no_hp || '').trim();
    const requestedRole: 'KARYAWAN' | 'ADMIN' = role_diminta === 'ADMIN' ? 'ADMIN' : 'KARYAWAN';

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Nama lengkap minimal 2 karakter.' });
      return;
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUser)) {
      res.status(400).json({
        error: 'Username harus 3–30 karakter (huruf kecil, angka, titik, underscore, atau strip).',
      });
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Format email tidak valid.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    const officeRow = db
      .prepare(`SELECT id FROM kantor WHERE id = ? AND aktif = 1`)
      .get(Number(kantor_id));
    const bidangRow = db.prepare(`SELECT id FROM bidang_kerja WHERE id = ?`).get(Number(bidang_id));
    if (!officeRow || !bidangRow) {
      res.status(400).json({ error: 'Pilihan kantor dan bidang kerja wajib valid.' });
      return;
    }

    const existingUser = db
      .prepare(`SELECT id FROM pengguna WHERE LOWER(username) = ? OR LOWER(email) = ?`)
      .get(cleanUser, cleanEmail);
    const existingEmp = db
      .prepare(`SELECT id FROM karyawan WHERE LOWER(email) = ?`)
      .get(cleanEmail);
    const existingPending = db
      .prepare(
        `SELECT id FROM pendaftaran_akun WHERE status = 'PENDING' AND (LOWER(username) = ? OR LOWER(email) = ?)`
      )
      .get(cleanUser, cleanEmail);

    if (existingUser || existingEmp) {
      res.status(409).json({
        error: 'Username atau email sudah terdaftar pada sistem. Silakan gunakan yang lain atau langsung masuk.',
      });
      return;
    }
    if (existingPending) {
      res.status(409).json({
        error: 'Username atau email ini sudah memiliki pengajuan pendaftaran yang menunggu persetujuan Superadmin.',
      });
      return;
    }

    let savedFoto: string | null = null;
    if (fotoBase64) {
      try {
        savedFoto = saveAvatarBase64(fotoBase64, `reg_${cleanUser}`);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Foto profil tidak valid.',
        });
        return;
      }
    }

    const nowIso = getWibIsoString();
    const defaultJabatan =
      (jabatan || '').trim() ||
      (requestedRole === 'ADMIN' ? 'Admin Operasional' : 'Teknisi Lapangan');

    const info = db
      .prepare(
        `INSERT INTO pendaftaran_akun (
          nama_lengkap, username, email, no_hp, password_hash, role_diminta, jabatan,
          kantor_id, bidang_id, foto_profil_path, catatan_pendaftar, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      )
      .run(
        cleanName,
        cleanUser,
        cleanEmail,
        cleanHp,
        hashPassword(password),
        requestedRole,
        defaultJabatan,
        Number(kantor_id),
        Number(bidang_id),
        savedFoto,
        (catatan_pendaftar || '').trim(),
        nowIso
      );

    const regId = Number(info.lastInsertRowid);
    writeAuditLog(db, {
      actor: { id: 0, nama_lengkap: cleanName, role: requestedRole },
      req,
      modul: 'PENDAFTARAN_AKUN',
      aksi: 'SUBMIT_REGISTRATION',
      targetEntity: 'pendaftaran_akun',
      targetId: regId,
      after: {
        username: cleanUser,
        email: cleanEmail,
        role_diminta: requestedRole,
        kantor_id: Number(kantor_id),
        bidang_id: Number(bidang_id),
        status: 'PENDING',
      },
      alasan: (catatan_pendaftar || '').trim() || `Pendaftaran akun ${requestedRole} menunggu ACC Superadmin`,
    });

    res.status(201).json({
      ok: true,
      id: regId,
      status: 'PENDING',
      message: 'Pendaftaran berhasil dikirim dan menunggu persetujuan (ACC) Superadmin sebelum dapat digunakan.',
    });
  });

  // 3. Workforce Feed + SSE
  app.get('/api/v1/workforce/today', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const kantorId = req.query.kantorId ? Number(req.query.kantorId) : undefined;
    const bidangId = req.query.bidangId ? Number(req.query.bidangId) : undefined;
    const rawList = getWorkforceToday(db, kantorId, bidangId);
    let list = rawList;
    if (req.authUser && req.authUser.role !== 'KARYAWAN') {
      const phoneRows = db
        .prepare(`SELECT id, no_hp FROM karyawan WHERE aktif = 1`)
        .all() as { id: number; no_hp: string }[];
      const phoneMap = new Map(phoneRows.map((p) => [p.id, p.no_hp || '']));
      list = rawList.map((w) => ({
        ...w,
        noHp: phoneMap.get(w.karyawanId) || '',
      }));
    }
    res.json({
      tanggal: getWibDateString(),
      serverTime: getWibTimeString(),
      totalBekerja: list.filter((w) => w.isWorkingToday).length,
      totalHadirSelesai: list.filter((w) => w.operationalStatus === 'HADIR').length,
      items: list,
    });
  });

  // 3a. Daily Attendance Map (ADMIN & SUPERADMIN only — preserves GPS privacy from KARYAWAN)
  app.get('/api/v1/workforce/today-map', requireRole('ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const today = getWibDateString();
    const kantorId = req.query.kantorId ? Number(req.query.kantorId) : undefined;
    const offices = db
      .prepare(`SELECT id, kode, nama, alamat, lat, lng, radius_meter FROM kantor WHERE aktif = 1 ORDER BY id ASC`)
      .all() as {
        id: number;
        kode: string;
        nama: string;
        alamat: string;
        lat: number;
        lng: number;
        radius_meter: number;
      }[];

    let sql = `
      SELECT s.id, s.karyawan_id, s.urutan_sesi, s.nama_sesi, s.waktu_server,
             s.status_ketepatan, s.keterlambatan_menit, s.lat, s.lng, s.accuracy_meter,
             s.jarak_kantor_meter, s.dalam_geofence, s.tipe_aktivitas, s.deskripsi_aktivitas,
             COALESCE(NULLIF(s.lokasi_alamat, ''), alc.alamat) as lokasi_alamat,
             k.nik, k.nama_lengkap, k.jabatan, k.kantor_id, k.bidang_id,
             kt.nama as kantor_nama, b.nama as bidang_nama
      FROM absensi_sesi s
      LEFT JOIN absensi_lokasi_cache alc ON alc.absensi_sesi_id = s.id
      JOIN karyawan k ON s.karyawan_id = k.id
      JOIN kantor kt ON k.kantor_id = kt.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      WHERE s.tanggal = ?
        AND s.lat IS NOT NULL AND s.lng IS NOT NULL
        AND k.aktif = 1
        AND COALESCE(k.is_system_archive, 0) = 0
        AND ${KARYAWAN_ONLY_SQL}
    `;
    const params: (string | number)[] = [today];
    if (kantorId) {
      sql += ` AND k.kantor_id = ?`;
      params.push(kantorId);
    }
    sql += ` ORDER BY s.waktu_server DESC`;

    const rows = db.prepare(sql).all(...params) as Array<{
      id: number;
      karyawan_id: number;
      urutan_sesi: number;
      nama_sesi: string;
      waktu_server: string;
      status_ketepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
      keterlambatan_menit: number;
      lat: number;
      lng: number;
      accuracy_meter: number | null;
      jarak_kantor_meter: number | null;
      dalam_geofence: number;
      tipe_aktivitas: string;
      deskripsi_aktivitas: string;
      lokasi_alamat: string | null;
      nik: string;
      nama_lengkap: string;
      jabatan: string;
      kantor_id: number;
      bidang_id: number;
      kantor_nama: string;
      bidang_nama: string;
    }>;

    res.json({
      tanggal: today,
      serverTime: getWibTimeString(),
      offices: offices.map((o) => ({
        id: o.id,
        kode: o.kode,
        nama: o.nama,
        alamat: o.alamat,
        lat: o.lat,
        lng: o.lng,
        radiusMeter: o.radius_meter,
      })),
      points: rows.map((r) => ({
        sessionId: r.id,
        karyawanId: r.karyawan_id,
        nik: r.nik,
        namaLengkap: r.nama_lengkap,
        jabatan: r.jabatan,
        kantorId: r.kantor_id,
        kantorNama: r.kantor_nama,
        bidangNama: r.bidang_nama,
        urutanSesi: r.urutan_sesi,
        namaSesi: r.nama_sesi,
        jamWib: r.waktu_server.slice(11, 16),
        statusKetepatan: r.status_ketepatan,
        keterlambatanMenit: r.keterlambatan_menit,
        lat: r.lat,
        lng: r.lng,
        accuracyMeter: r.accuracy_meter,
        jarakKantorMeter: r.jarak_kantor_meter,
        dalamGeofence: Boolean(r.dalam_geofence),
        tipeAktivitas: r.tipe_aktivitas,
        deskripsiAktivitas: r.deskripsi_aktivitas,
        lokasiAlamat: r.lokasi_alamat,
      })),
    });
  });

  // 3b-analytics. Attendance & Lateness Trend Analytics (ADMIN & SUPERADMIN)
  app.get('/api/v1/analytics/attendance-trend', requireRole('ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const rawDays = Number(req.query.days) || 14;
    const windowDays = rawDays <= 7 ? 7 : rawDays <= 14 ? 14 : 30;
    const kantorId = req.query.kantorId ? Number(req.query.kantorId) : undefined;
    const today = getWibDateString();

    let empSql = `
      SELECT k.*, kt.nama as kantor_nama, b.nama as bidang_nama
      FROM karyawan k
      JOIN kantor kt ON k.kantor_id = kt.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      WHERE k.aktif = 1
        AND COALESCE(k.is_system_archive, 0) = 0
        AND ${KARYAWAN_ONLY_SQL}
    `;
    const empParams: number[] = [];
    if (kantorId) {
      empSql += ` AND k.kantor_id = ?`;
      empParams.push(kantorId);
    }
    const employees = db.prepare(empSql).all(...empParams) as unknown as Karyawan[];

    // Build chronological date list ending on WIB today
    const dates: string[] = [];
    const baseDate = new Date(`${today}T00:00:00Z`);
    for (let offset = windowDays - 1; offset >= 0; offset--) {
      const d = new Date(baseDate.getTime() - offset * 86_400_000);
      dates.push(d.toISOString().slice(0, 10));
    }

    const dayNamesShort = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const officeTotals = new Map<
      number,
      { kantorId: number; kantorNama: string; tepatWaktu: number; terlambat: number; izinSakitCuti: number; tidakHadir: number; totalKerja: number }
    >();

    const series = dates.map((tanggal) => {
      let tepatWaktu = 0;
      let terlambat = 0;
      let izinSakitCuti = 0;
      let tidakHadir = 0;
      let belumSelesai = 0;
      let libur = 0;

      for (const emp of employees) {
        const resolved = resolveDayForEmployee(db, emp, tanggal);
        const officeEntry = officeTotals.get(emp.kantor_id) || {
          kantorId: emp.kantor_id,
          kantorNama: (emp.kantor_nama || 'Kantor').split('(')[0].trim(),
          tepatWaktu: 0,
          terlambat: 0,
          izinSakitCuti: 0,
          tidakHadir: 0,
          totalKerja: 0,
        };

        const sesi1 = resolved.sessionRecords.find((s) => s.urutan_sesi === 1);
        if (resolved.operationalStatus === 'HARI_LIBUR' || resolved.operationalStatus === 'OFF_PENGGANTI' || resolved.operationalStatus === 'OFF') {
          libur += 1;
        } else if (
          resolved.operationalStatus === 'CUTI' ||
          resolved.operationalStatus === 'SAKIT' ||
          resolved.operationalStatus === 'IZIN'
        ) {
          izinSakitCuti += 1;
          officeEntry.izinSakitCuti += 1;
          officeEntry.totalKerja += 1;
        } else if (sesi1) {
          officeEntry.totalKerja += 1;
          if (sesi1.status_ketepatan === 'TERLAMBAT') {
            terlambat += 1;
            officeEntry.terlambat += 1;
          } else {
            tepatWaktu += 1;
            officeEntry.tepatWaktu += 1;
          }
        } else if (resolved.operationalStatus === 'HADIR') {
          tepatWaktu += 1;
          officeEntry.tepatWaktu += 1;
          officeEntry.totalKerja += 1;
        } else if (resolved.operationalStatus === 'TIDAK_HADIR') {
          tidakHadir += 1;
          officeEntry.tidakHadir += 1;
          officeEntry.totalKerja += 1;
        } else {
          belumSelesai += 1;
          officeEntry.totalKerja += 1;
        }
        officeTotals.set(emp.kantor_id, officeEntry);
      }

      const dObj = new Date(`${tanggal}T00:00:00Z`);
      const label = `${dayNamesShort[dObj.getUTCDay()]} ${tanggal.slice(8, 10)}/${tanggal.slice(5, 7)}`;
      return {
        tanggal,
        label,
        tepatWaktu,
        terlambat,
        izinSakitCuti,
        tidakHadir,
        belumSelesai,
        libur,
        totalWajibKerja: tepatWaktu + terlambat + izinSakitCuti + tidakHadir + belumSelesai,
      };
    });

    const officeComparison = Array.from(officeTotals.values()).map((o) => {
      const hadirTotal = o.tepatWaktu + o.terlambat;
      const denom = Math.max(1, hadirTotal + o.tidakHadir);
      return {
        ...o,
        hadirTotal,
        persenHadir: Math.round((hadirTotal / denom) * 100),
        persenTepatWaktu: hadirTotal > 0 ? Math.round((o.tepatWaktu / hadirTotal) * 100) : 100,
      };
    });

    const totals = series.reduce(
      (acc, d) => ({
        tepatWaktu: acc.tepatWaktu + d.tepatWaktu,
        terlambat: acc.terlambat + d.terlambat,
        izinSakitCuti: acc.izinSakitCuti + d.izinSakitCuti,
        tidakHadir: acc.tidakHadir + d.tidakHadir,
      }),
      { tepatWaktu: 0, terlambat: 0, izinSakitCuti: 0, tidakHadir: 0 }
    );

    res.json({
      days: windowDays,
      today,
      totals,
      series,
      officeComparison,
    });
  });

  app.get('/api/v1/workforce/stream', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ waktu: getWibIsoString() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // 3b. Instagram-Style Attendance Feed (All Roles: Karyawan, Admin, Superadmin)
  app.get('/api/v1/feed/today', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const today = getWibDateString();
    const kantorId = req.query.kantorId ? Number(req.query.kantorId) : undefined;
    const bidangId = req.query.bidangId ? Number(req.query.bidangId) : undefined;

    const workforce = getWorkforceToday(db, kantorId, bidangId);
    const metaRows = db
      .prepare(
        `SELECT k.id as karyawan_id, k.foto_profil_updated_at, COALESCE(u.role, 'KARYAWAN') as role
         FROM karyawan k
         LEFT JOIN pengguna u ON u.karyawan_id = k.id AND u.aktif = 1
         WHERE k.aktif = 1
           AND COALESCE(k.is_system_archive, 0) = 0
           AND ${KARYAWAN_ONLY_SQL}`
      )
      .all() as { karyawan_id: number; foto_profil_updated_at: string | null; role: Role }[];

    const metaMap = new Map(metaRows.map((m) => [m.karyawan_id, m]));
    const wfMap = new Map(workforce.map((w) => [w.karyawanId, w]));

    const roster: AttendanceFeedRosterItem[] = workforce.map((w) => {
      const m = metaMap.get(w.karyawanId);
      return {
        ...w,
        role: m?.role || 'KARYAWAN',
        fotoProfilUpdatedAt: m?.foto_profil_updated_at || null,
      };
    });

    const scope = req.query.scope === 'today' ? 'today' : 'recent';
    let postSql = `
      SELECT s.*,
             COALESCE(NULLIF(s.lokasi_alamat, ''), alc.alamat) as lokasi_aktual_alamat,
             k.nik, k.nama_lengkap, k.jabatan, k.kantor_id, k.bidang_id, k.foto_profil_updated_at,
             kt.nama as kantor_nama, kt.alamat as kantor_alamat,
             b.nama as bidang_nama,
             COALESCE(u.role, 'KARYAWAN') as role
      FROM absensi_sesi s
      JOIN karyawan k ON s.karyawan_id = k.id
      JOIN kantor kt ON k.kantor_id = kt.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      LEFT JOIN absensi_lokasi_cache alc ON alc.absensi_sesi_id = s.id
      LEFT JOIN pengguna u ON u.karyawan_id = k.id AND u.aktif = 1
      WHERE k.aktif = 1
        AND COALESCE(k.is_system_archive, 0) = 0
        AND ${KARYAWAN_ONLY_SQL}
    `;
    const postParams: (string | number)[] = [];
    if (scope === 'today') {
      postSql += ` AND s.tanggal = ?`;
      postParams.push(today);
    }
    if (kantorId) {
      postSql += ` AND k.kantor_id = ?`;
      postParams.push(kantorId);
    }
    if (bidangId) {
      postSql += ` AND k.bidang_id = ?`;
      postParams.push(bidangId);
    }
    postSql += ` ORDER BY s.waktu_server DESC, s.id DESC LIMIT 60`;

    const rawPosts = db.prepare(postSql).all(...postParams) as {
      id: number;
      karyawan_id: number;
      nik: string;
      nama_lengkap: string;
      jabatan: string;
      role: Role;
      foto_profil_updated_at: string | null;
      bidang_id: number;
      bidang_nama: string;
      kantor_id: number;
      kantor_nama: string;
      kantor_alamat: string;
      lokasi_aktual_alamat: string | null;
      tanggal: string;
      urutan_sesi: number;
      nama_sesi: string;
      waktu_server: string;
      status_ketepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
      keterlambatan_menit: number;
      jarak_kantor_meter: number | null;
      dalam_geofence: number;
      lat: number | null;
      lng: number | null;
      tipe_aktivitas: 'CHECK_IN' | 'AKTIVITAS' | 'STANDBY';
      deskripsi_aktivitas: string;
      foto_path: string | null;
    }[];

    const posts: AttendanceFeedPost[] = rawPosts.map((p) => {
      const wf = wfMap.get(p.karyawan_id);
      return {
        id: p.id,
        karyawanId: p.karyawan_id,
        nik: p.nik,
        namaLengkap: p.nama_lengkap,
        jabatan: p.jabatan,
        role: p.role || 'KARYAWAN',
        fotoProfilUpdatedAt: p.foto_profil_updated_at,
        bidangId: p.bidang_id,
        bidangNama: p.bidang_nama,
        kantorId: p.kantor_id,
        kantorNama: p.kantor_nama,
        kantorAlamat: p.kantor_alamat,
        lokasiAktualAlamat: p.lokasi_aktual_alamat ?? null,
        tanggal: p.tanggal,
        urutanSesi: p.urutan_sesi,
        namaSesi: p.nama_sesi,
        waktuServer: p.waktu_server,
        jamWib: p.waktu_server.slice(11, 16),
        statusKetepatan: p.status_ketepatan,
        keterlambatanMenit: p.keterlambatan_menit,
        jarakKantorMeter: p.jarak_kantor_meter,
        dalamGeofence: Boolean(p.dalam_geofence),
        lat: p.lat,
        lng: p.lng,
        tipeAktivitas: p.tipe_aktivitas,
        deskripsiAktivitas: p.deskripsi_aktivitas,
        hasFoto: Boolean(p.foto_path),
        sessionsCompletedToday: wf?.sessionsCompleted ?? 1,
        sessionsTotalToday: wf?.sessionsTotal ?? 1,
        operationalStatusToday: wf?.operationalStatus ?? 'BELUM_SELESAI',
      };
    });

    res.json({
      tanggal: today,
      serverTime: getWibTimeString(),
      totalBekerja: roster.filter((w) => w.isWorkingToday).length,
      totalHadirSelesai: roster.filter((w) => w.operationalStatus === 'HADIR').length,
      totalSudahAbsen: roster.filter((w) => w.sessionsCompleted > 0).length,
      roster,
      posts,
    });
  });

  // 4. Employee Today Status & Session Check-in (Strictly KARYAWAN only)
  app.get('/api/v1/attendance/today', requireRole('KARYAWAN'), (req: AuthenticatedRequest, res: Response) => {
    if (req.authUser!.karyawan_id === null) {
      res.status(403).json({ error: 'Hanya akun Karyawan yang memiliki jadwal absensi pribadi.' });
      return;
    }
    const emp = getKaryawanById(req.authUser!.karyawan_id);
    if (!emp) {
      res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
      return;
    }
    // Capture one authoritative server instant for the date, session gate,
    // override validity, and clock values returned to the browser.
    const serverNow = new Date();
    const today = getWibDateString(serverNow);
    const serverTime = getWibTimeString(serverNow);
    const serverNowIso = getWibIsoString(serverNow);
    const serverEpochMs = serverNow.getTime();
    const serverNowMinutes = parseHmToMinutes(serverTime.slice(0, 5));
    const resolved = resolveDayForEmployee(db, emp, today);
    const pendingRequests = db
      .prepare(
        `SELECT * FROM pengajuan WHERE karyawan_id = ? AND status = 'PENDING' AND tanggal_mulai <= ? AND tanggal_akhir >= ?`
      )
      .all(emp.id, today, today);

    const serverSessionWindowStates = resolved.policySnapshot.sesiList.map((session) =>
      getSessionWindowState(serverNowMinutes, session.jam_mulai, session.jam_selesai)
    );
    const nextSessionIndex = resolved.sessionsCompleted;
    const nextSession = resolved.policySnapshot.sesiList[nextSessionIndex];
    const serverWindowState = nextSession
      ? serverSessionWindowStates[nextSessionIndex]
      : null;
    const serverMinutesUntilStart =
      nextSession && serverWindowState === 'NOT_STARTED'
        ? Math.max(0, parseHmToMinutes(nextSession.jam_mulai) - serverNowMinutes)
        : 0;
    const activeGrant = nextSession
      ? getActiveCheckinOverride(db, emp.id, today, nextSession.urutan, serverNowIso)
      : null;
    const day = {
      ...resolved,
      checkinOverride: activeGrant
        ? {
            id: activeGrant.id,
            active: true,
            urutanSesi: activeGrant.urutan_sesi,
            namaSesi: activeGrant.nama_sesi,
            alasan: activeGrant.alasan,
            berlakuSampai: activeGrant.berlaku_sampai,
            adminNama: activeGrant.admin_nama,
          }
        : null,
    };

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      serverDate: today,
      serverTime,
      serverEpochMs,
      serverWindowCheckedAt: serverTime,
      serverWindowState,
      serverSessionWindowStates,
      serverMinutesUntilStart,
      karyawan: emp,
      day,
      pendingRequestsToday: pendingRequests,
    });
  });

  // Admin-only exception workflow: reopen a single expired next session for a short time.
  app.get('/api/v1/admin/attendance/override-checkins', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const today = getWibDateString();
    const nowIso = getWibIsoString();
    const nowMin = parseHmToMinutes(getWibTimeString().slice(0, 5));
    const employees = db
      .prepare(
        `SELECT k.*, kt.nama as kantor_nama, kt.kode as kantor_kode, b.nama as bidang_nama
         FROM karyawan k
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN bidang_kerja b ON k.bidang_id = b.id
         WHERE k.aktif = 1
           AND COALESCE(k.is_system_archive, 0) = 0
           AND ${KARYAWAN_ONLY_SQL}
         ORDER BY k.nama_lengkap ASC`
      )
      .all() as unknown as Karyawan[];

    const items = employees.flatMap((employee) => {
      const day = resolveDayForEmployee(db, employee, today);
      if (!day.mustCheckIn || day.sessionsCompleted >= day.policySnapshot.jumlahSesi) return [];
      const next = day.policySnapshot.sesiList[day.sessionsCompleted];
      if (!next) return [];
      const windowState = getSessionWindowState(nowMin, next.jam_mulai, next.jam_selesai);
      if (windowState !== 'EXPIRED') return [];
      const activeGrant = getActiveCheckinOverride(db, employee.id, today, next.urutan, nowIso);
      return [{
        karyawanId: employee.id,
        nik: employee.nik,
        namaLengkap: employee.nama_lengkap,
        jabatan: employee.jabatan,
        kantorNama: employee.kantor_nama || '',
        bidangNama: employee.bidang_nama || '',
        urutanSesi: next.urutan,
        namaSesi: next.nama,
        jamMulai: next.jam_mulai,
        jamSelesai: next.jam_selesai,
        terlambatMenit: Math.max(0, nowMin - parseHmToMinutes(next.jam_mulai)),
        activeGrant: activeGrant
          ? {
              id: activeGrant.id,
              berlakuSampai: activeGrant.berlaku_sampai,
              alasan: activeGrant.alasan,
              adminNama: activeGrant.admin_nama,
              createdAt: activeGrant.created_at,
            }
          : null,
      }];
    });

    res.json({ tanggal: today, serverTime: getWibTimeString(), items });
  });

  app.post('/api/v1/admin/attendance/override-checkins', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { karyawanId, alasan } = req.body as { karyawanId?: number; alasan?: string };
    const durasiMenit = Number((req.body as { durasiMenit?: number }).durasiMenit ?? 15);
    if (!Number.isSafeInteger(Number(karyawanId)) || Number(karyawanId) <= 0) {
      res.status(400).json({ error: 'Karyawan yang akan diberi izin wajib dipilih.' });
      return;
    }
    if (typeof alasan !== 'string' || alasan.trim().length < 5 || alasan.trim().length > 500) {
      res.status(400).json({ error: 'Alasan wajib diisi antara 5 sampai 500 karakter.' });
      return;
    }
    if (![5, 10, 15, 30].includes(durasiMenit)) {
      res.status(400).json({ error: 'Masa berlaku izin harus 5, 10, 15, atau 30 menit.' });
      return;
    }

    const employee = getKaryawanById(Number(karyawanId));
    if (!employee || employee.aktif !== 1 || !isAttendanceEligibleEmployee(employee.id)) {
      res.status(404).json({ error: 'Karyawan aktif (role KARYAWAN) tidak ditemukan.' });
      return;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const today = getWibDateString();
      const nowIso = getWibIsoString();
      const nowMin = parseHmToMinutes(getWibTimeString().slice(0, 5));
      const day = resolveDayForEmployee(db, employee, today);
      if (!day.mustCheckIn || day.sessionsCompleted >= day.policySnapshot.jumlahSesi) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Karyawan tidak memiliki sesi absensi yang masih harus diselesaikan hari ini.' });
        return;
      }

      const next = day.policySnapshot.sesiList[day.sessionsCompleted];
      if (!next) {
        db.exec('ROLLBACK');
        res.status(409).json({ error: 'Konfigurasi sesi berikutnya tidak ditemukan.' });
        return;
      }
      const windowState = getSessionWindowState(nowMin, next.jam_mulai, next.jam_selesai);
      if (windowState !== 'EXPIRED') {
        db.exec('ROLLBACK');
        res.status(409).json({
          error: windowState === 'NOT_STARTED'
            ? `Sesi ${next.nama} belum dimulai; Admin hanya dapat membuka kembali sesi yang sudah berakhir.`
            : windowState === 'INVALID'
              ? `Jadwal sesi ${next.nama} tidak valid. Perbaiki kebijakan absensi terlebih dahulu.`
              : `Sesi ${next.nama} masih terbuka dan dapat diabsen secara normal.`,
        });
        return;
      }

      db.prepare(
        `UPDATE override_akses_absensi
         SET status = 'KEDALUWARSA'
         WHERE karyawan_id = ? AND tanggal = ? AND urutan_sesi = ?
           AND status = 'AKTIF' AND used_at IS NULL AND berlaku_sampai <= ?`
      ).run(employee.id, today, next.urutan, nowIso);

      const existingGrant = getActiveCheckinOverride(db, employee.id, today, next.urutan, nowIso);
      if (existingGrant) {
        db.exec('ROLLBACK');
        res.status(409).json({
          error: `Izin check-in untuk ${next.nama} masih aktif sampai ${existingGrant.berlaku_sampai.slice(11, 16)} WIB.`,
          activeGrant: {
            id: existingGrant.id,
            berlakuSampai: existingGrant.berlaku_sampai,
            adminNama: existingGrant.admin_nama,
          },
        });
        return;
      }

      const berlakuSampai = getWibIsoString(new Date(Date.now() + durasiMenit * 60 * 1000));
      const info = db
        .prepare(
          `INSERT INTO override_akses_absensi (
             karyawan_id, tanggal, urutan_sesi, nama_sesi, alasan, admin_id,
             status, berlaku_sampai, used_at, used_session_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'AKTIF', ?, NULL, NULL, ?)`
        )
        .run(employee.id, today, next.urutan, next.nama, alasan.trim(), req.authUser!.id, berlakuSampai, nowIso);

      const grantId = Number(info.lastInsertRowid);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'OVERRIDE_ABSENSI',
        aksi: 'BUKA_AKSES_CHECKIN',
        targetEntity: 'override_akses_absensi',
        targetId: grantId,
        karyawanId: employee.id,
        tanggalTerdampak: today,
        before: {
          statusSesi: 'EXPIRED',
          sesiBerikutnya: next.urutan,
          namaSesi: next.nama,
        },
        after: {
          statusIzin: 'AKTIF',
          berlakuSampai,
          durasiMenit,
          penggunaan: 'SATU_KALI',
        },
        alasan: alasan.trim(),
      });

      db.exec('COMMIT');
      broadcastWorkforceUpdate('CHECKIN_ACCESS_GRANTED');
      res.status(201).json({
        ok: true,
        id: grantId,
        karyawanId: employee.id,
        urutanSesi: next.urutan,
        namaSesi: next.nama,
        berlakuSampai,
        durasiMenit,
        status: 'AKTIF',
      });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  app.get('/api/v1/location/reverse', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), asyncRoute(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      res.status(400).json({ error: 'Koordinat lat/lng tidak valid.' });
      return;
    }
    const result = await reverseGeocodeCoordinates(lat, lng);
    res.json({
      lat,
      lng,
      address: result.address,
      provider: result.provider,
    });
  }));

  app.post('/api/v1/attendance/session', requireRole('KARYAWAN'), asyncRoute(async (req, res) => {
    const user = req.authUser!;
    const attLimit = attendanceLimiter.consume(`att:${user.id}`);
    if (!attLimit.allowed) {
      res.setHeader('Retry-After', String(attLimit.retryAfterSec));
      res.status(429).json({
        error: `Terlalu banyak percobaan pengiriman absensi. Coba lagi dalam ${attLimit.retryAfterSec} detik.`,
      });
      return;
    }
    if (user.karyawan_id === null) {
      res.status(403).json({ error: 'Hanya akun Karyawan yang dapat melakukan absensi sesi.' });
      return;
    }
    const emp = getKaryawanById(user.karyawan_id);
    if (!emp) {
      res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
      return;
    }

    const {
      urutanSesi,
      lat,
      lng,
      accuracyMeter,
      tipeAktivitas,
      deskripsiAktivitas,
      fotoBase64,
      fotoSource,
    } = req.body as {
      urutanSesi?: number;
      lat?: number | null;
      lng?: number | null;
      accuracyMeter?: number | null;
      tipeAktivitas?: 'CHECK_IN' | 'AKTIVITAS' | 'STANDBY';
      deskripsiAktivitas?: string;
      fotoBase64?: string;
      fotoSource?: string;
    };

    const today = getWibDateString();
    const nowTime = getWibTimeString();
    const nowIso = getWibIsoString();
    const day = resolveDayForEmployee(db, emp, today);

    if (!day.mustCheckIn) {
      res.status(400).json({
        error: `Hari ini berstatus ${day.dayLabel}. Anda tidak perlu melakukan absensi sesi.`,
      });
      return;
    }

    const expectedNext = day.sessionsCompleted + 1;
    if (expectedNext > day.policySnapshot.jumlahSesi) {
      res.status(400).json({ error: 'Semua sesi absensi hari ini sudah selesai tercatat.' });
      return;
    }

    if (urutanSesi && urutanSesi !== expectedNext) {
      res.status(400).json({
        error: `Sesi harus dilakukan berurutan. Sesi berikutnya yang sah adalah Sesi ${expectedNext}.`,
      });
      return;
    }

    const targetSesiConfig = day.policySnapshot.sesiList[expectedNext - 1];
    if (!targetSesiConfig) {
      res.status(400).json({ error: 'Konfigurasi sesi tidak ditemukan.' });
      return;
    }

    // Enforce the complete session window using server WIB time.
    // The session is open from jam_mulai through jam_selesai (inclusive).
    const nowMin = parseHmToMinutes(nowTime.slice(0, 5));
    const sessionWindow = getSessionWindowState(
      nowMin,
      targetSesiConfig.jam_mulai,
      targetSesiConfig.jam_selesai
    );
    const checkinOverride = sessionWindow === 'EXPIRED'
      ? getActiveCheckinOverride(db, emp.id, today, expectedNext, nowIso)
      : null;
    if (sessionWindow === 'INVALID') {
      res.status(400).json({
        error: `Konfigurasi waktu ${targetSesiConfig.nama} tidak valid. Admin harus memperbaiki jam mulai dan jam selesai.`,
      });
      return;
    }
    if (sessionWindow === 'NOT_STARTED') {
      res.status(400).json({
        error: `Absensi ${targetSesiConfig.nama} belum dimulai. Sesi ini baru dapat dilakukan mulai pukul ${targetSesiConfig.jam_mulai} WIB (waktu server saat ini ${nowTime.slice(0, 5)} WIB).`,
      });
      return;
    }
    if (sessionWindow === 'EXPIRED' && !checkinOverride) {
      res.status(400).json({
        error: `Waktu absensi ${targetSesiConfig.nama} sudah berakhir pada pukul ${targetSesiConfig.jam_selesai} WIB. Minta Admin membuka akses check-in khusus sebelum melakukan absensi.`,
      });
      return;
    }
    const startMin = parseHmToMinutes(targetSesiConfig.jam_mulai);

    // Validate activity/standby description for session >= 2 if required
    const requireActivity =
      expectedNext >= 2 &&
      (day.policySnapshot.wajibAktivitasSesiLanjut || targetSesiConfig.wajib_aktivitas === 1);
    const cleanDesc = (deskripsiAktivitas || '').trim();
    if (requireActivity && !cleanDesc) {
      res.status(400).json({
        error: 'Sesi lanjutan wajib mengisi deskripsi aktivitas atau keterangan standby.',
      });
      return;
    }

    // Validate photo & enforce browser camera-only capture (no file upload)
    const requirePhoto = day.policySnapshot.wajibFotoSemuaSesi || targetSesiConfig.wajib_foto === 1;
    if (requirePhoto && !fotoBase64) {
      res.status(400).json({ error: 'Foto selfie/bukti sesi wajib diambil langsung melalui kamera browser.' });
      return;
    }
    if (fotoBase64 && fotoSource !== 'BROWSER_CAMERA') {
      res.status(400).json({
        error: 'Absensi hanya diperbolehkan menggunakan kamera browser secara langsung. Unggah foto dari file/galeri tidak diizinkan.',
      });
      return;
    }

    // Validate Geofence & GPS coordinates bounds
    const office = db.prepare(`SELECT lat, lng, radius_meter FROM kantor WHERE id = ?`).get(emp.kantor_id) as
      | { lat: number; lng: number; radius_meter: number }
      | undefined;

    if (!office) {
      res.status(400).json({ error: 'Lokasi kantor karyawan tidak ditemukan. Hubungi Admin.' });
      return;
    }

    const hasValidCoords =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

    if (!hasValidCoords) {
      res.status(400).json({
        error: 'Lokasi GPS wajib tersedia dan valid. Absensi tidak dapat dilakukan tanpa koordinat GPS.',
      });
      return;
    }

    if (
      typeof accuracyMeter !== 'number' ||
      !Number.isFinite(accuracyMeter) ||
      accuracyMeter < 0
    ) {
      res.status(400).json({
        error: 'Informasi akurasi lokasi tidak tersedia. Aktifkan layanan lokasi perangkat dan coba kembali.',
      });
      return;
    }

    const jarakMeter = haversineMeters(lat!, lng!, office.lat, office.lng);
    const accuracyAcceptable = isGpsAccuracyAcceptable(accuracyMeter);
    const dalamGeofence =
      accuracyAcceptable &&
      isWithinVerifiedGeofence(jarakMeter, accuracyMeter, office.radius_meter)
        ? 1
        : 0;
    const wajibDiKantor = requiresOfficeGeofence(
      day.policySnapshot.aturanLokasi,
      expectedNext
    );

    if (wajibDiKantor && !accuracyAcceptable) {
      res.status(400).json({
        error: `Sesi ini wajib dilakukan di kantor. Akurasi GPS harus maksimal ±${MAX_GPS_ACCURACY_METERS}m; hasil saat ini ±${Math.ceil(accuracyMeter)}m. Aktifkan lokasi presisi atau gunakan perangkat GPS yang lebih akurat.`,
      });
      return;
    }

    if (wajibDiKantor && !dalamGeofence) {
      res.status(400).json({
        error: `Absensi ditolak. Sesi ${expectedNext} wajib berada di kantor. Jarak titik GPS ${jarakMeter}m dengan estimasi akurasi ±${Math.ceil(accuracyMeter)}m belum dapat dipastikan di dalam radius kantor ${office.radius_meter}m.`,
      });
      return;
    }

    // Check lateness against session start + tolerance (emergency holiday work is flexible 00:00-23:59)
    const isHolidayEmergencySession =
      day.holidayEmergencyRequest?.status === 'PENDING' ||
      Boolean(day.kerjaKhususInfo && day.holidayEmergencyRequest?.status === 'APPROVED');
    const tol = day.policySnapshot.toleransiTerlambatMenit;
    const lateDiff = nowMin - (startMin + tol);
    const isLate = !isHolidayEmergencySession && expectedNext === 1 && lateDiff > 0;
    const keterlambatanMenit = isLate ? nowMin - startMin : 0;

    // Store a display-only address snapshot resolved by the server from the
    // submitted GPS coordinates. Geocoding failures never block attendance.
    const actualLocationAddress = await getGeoapifyAddress(lat!, lng!)
      .then((result) => result.address)
      .catch(() => null);

    // Save photo file securely (camera capture raster image + magic-byte check + unpredictable filename)
    let savedPhotoName: string | null = null;
    let fotoChecksum: string | null = null;
    if (fotoBase64) {
      let ext: 'png' | 'jpg' | 'webp';
      let buf: Buffer;
      try {
        const parsed = validateRasterImageBase64(fotoBase64, {
          maxBytes: 5 * 1024 * 1024,
          label: 'foto absensi',
        });
        ext = parsed.ext;
        buf = parsed.buf;
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Format foto tidak valid.',
        });
        return;
      }
      const photosDir = getPhotosDir();
      if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
      savedPhotoName = `abs_${emp.id}_${today}_s${expectedNext}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(photosDir, savedPhotoName), buf);
      fotoChecksum = crypto.createHash('sha256').update(buf).digest('hex');
    }

    const actType =
      expectedNext === 1 ? 'CHECK_IN' : tipeAktivitas === 'STANDBY' ? 'STANDBY' : 'AKTIVITAS';
    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '127.0.0.1';
    const ua = req.headers['user-agent']?.toString() || 'Browser';

    let createdSessionId = 0;
    try {
      db.exec('BEGIN IMMEDIATE');
      const info = db
        .prepare(
          `INSERT INTO absensi_sesi (
            karyawan_id, tanggal, urutan_sesi, nama_sesi, waktu_server,
            status_ketepatan, keterlambatan_menit, lat, lng, accuracy_meter,
            jarak_kantor_meter, dalam_geofence, lokasi_alamat, ip_address, user_agent,
            tipe_aktivitas, deskripsi_aktivitas, foto_path, foto_checksum,
            policy_snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          emp.id,
          today,
          expectedNext,
          targetSesiConfig.nama,
          nowIso,
          isLate ? 'TERLAMBAT' : 'TEPAT_WAKTU',
          keterlambatanMenit,
          typeof lat === 'number' ? lat : null,
          typeof lng === 'number' ? lng : null,
          typeof accuracyMeter === 'number' ? accuracyMeter : null,
          jarakMeter,
          dalamGeofence,
          actualLocationAddress,
          ip,
          ua,
          actType,
          cleanDesc || (expectedNext === 1 ? 'Absensi masuk sesi 1' : 'Melanjutkan aktivitas kerja'),
          savedPhotoName,
          fotoChecksum,
          JSON.stringify(day.policySnapshot),
          nowIso
        );
      createdSessionId = Number(info.lastInsertRowid);

      if (checkinOverride) {
        const used = db
          .prepare(
            `UPDATE override_akses_absensi
             SET status = 'DIGUNAKAN', used_at = ?, used_session_id = ?
             WHERE id = ? AND status = 'AKTIF' AND used_at IS NULL AND berlaku_sampai > ?`
          )
          .run(nowIso, createdSessionId, checkinOverride.id, nowIso);
        if (Number(used.changes) !== 1) {
          throw new Error('Izin Admin sudah digunakan atau kedaluwarsa. Muat ulang halaman dan hubungi Admin.');
        }
        writeAuditLog(db, {
          actor: user,
          req,
          modul: 'OVERRIDE_ABSENSI',
          aksi: 'GUNAKAN_AKSES_CHECKIN',
          targetEntity: 'override_akses_absensi',
          targetId: checkinOverride.id,
          karyawanId: emp.id,
          tanggalTerdampak: today,
          before: { statusIzin: 'AKTIF' },
          after: { statusIzin: 'DIGUNAKAN', sessionId: createdSessionId, waktuServer: nowIso },
          alasan: checkinOverride.alasan,
        });
      }

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'ABSENSI',
        aksi: checkinOverride ? 'CHECKIN_SESI_DENGAN_OVERRIDE' : 'CHECKIN_SESI',
        targetEntity: 'absensi_sesi',
        targetId: createdSessionId,
        karyawanId: emp.id,
        tanggalTerdampak: today,
        after: {
          urutanSesi: expectedNext,
          namaSesi: targetSesiConfig.nama,
          waktuServer: nowIso,
          dalamGeofence: Boolean(dalamGeofence),
          jarakMeter,
          tipeAktivitas: actType,
          adminOverrideCheckin: Boolean(checkinOverride),
          overrideCheckinId: checkinOverride?.id ?? null,
          pemberiIzin: checkinOverride?.admin_nama ?? null,
        },
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(409).json({
        error: 'Gagal menyimpan sesi absensi (kemungkinan sesi sudah tercatat).',
        detail: safeErrorDetail(err),
      });
      return;
    }

    broadcastWorkforceUpdate('SESSION_SUBMITTED');
    const updatedDay = resolveDayForEmployee(db, emp, today);
    const responseNow = new Date();
    res.status(201).json({
      ok: true,
      sessionId: createdSessionId,
      day: updatedDay,
      urutanSesi: expectedNext,
      namaSesi: targetSesiConfig.nama,
      waktuServer: nowIso,
      serverTime: getWibTimeString(responseNow),
      serverEpochMs: responseNow.getTime(),
      statusKetepatan: isLate ? 'TERLAMBAT' : 'TEPAT_WAKTU',
      keterlambatanMenit,
    });
  }));

  // 4b. Self-Initiated Holiday / Emergency Work Check-in Activation ("Capture First, Verify Later")
  app.post('/api/v1/attendance/holiday-work/start', requireRole('KARYAWAN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    if (user.karyawan_id === null) {
      res.status(403).json({ error: 'Hanya akun Karyawan yang dapat mengaktifkan absensi kerja hari libur.' });
      return;
    }
    const emp = getKaryawanById(user.karyawan_id);
    if (!emp) {
      res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
      return;
    }

    const { alasan, catatan } = req.body as { alasan?: string; catatan?: string };
    const cleanAlasan = (alasan || '').trim();
    const cleanCatatan = (catatan || '').trim().slice(0, 500);
    if (cleanAlasan.length < 5) {
      res.status(400).json({
        error: 'Alasan atau nama pekerjaan urgent wajib diisi minimal 5 karakter.',
      });
      return;
    }
    if (cleanAlasan.length > 300) {
      res.status(400).json({ error: 'Alasan pekerjaan urgent maksimal 300 karakter.' });
      return;
    }

    const today = getWibDateString();
    const day = resolveDayForEmployee(db, emp, today);
    if (day.dayType !== 'HARI_LIBUR' || day.kerjaKhususInfo) {
      res.status(400).json({
        error: 'Mode kerja darurat hanya dapat diaktifkan pada hari libur yang belum memiliki penugasan kerja khusus.',
      });
      return;
    }
    if (day.holidayEmergencyRequest?.status === 'PENDING' || day.holidayEmergencyRequest?.status === 'APPROVED') {
      res.status(400).json({ error: 'Mode kerja darurat hari libur sudah aktif untuk hari ini.' });
      return;
    }
    if (day.holidayEmergencyRequest?.status === 'REJECTED') {
      res.status(400).json({
        error: 'Pengajuan kerja hari libur Anda hari ini sudah ditolak Admin. Hubungi Admin Operasional jika ada penugasan baru.',
      });
      return;
    }

    const nowIso = getWibIsoString();
    let requestId = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO pengajuan (
            karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan,
            lampiran_nama, hak_off_id, status, created_at, updated_at
          ) VALUES (?, 'KERJA_HARI_LIBUR', ?, ?, ?, ?, NULL, NULL, 'PENDING', ?, ?)`
        )
        .run(emp.id, today, today, cleanAlasan, cleanCatatan, nowIso, nowIso);
      requestId = Number(info.lastInsertRowid);

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'ABSENSI',
        aksi: 'START_KERJA_HARI_LIBUR',
        targetEntity: 'pengajuan',
        targetId: requestId,
        karyawanId: emp.id,
        tanggalTerdampak: today,
        after: { jenis: 'KERJA_HARI_LIBUR', alasan: cleanAlasan, catatan: cleanCatatan, status: 'PENDING' },
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Gagal mengaktifkan mode kerja darurat hari libur.',
        detail: safeErrorDetail(err),
      });
      return;
    }

    broadcastWorkforceUpdate('HOLIDAY_WORK_STARTED');
    const updatedDay = resolveDayForEmployee(db, emp, today);
    const responseNow = new Date();
    res.status(201).json({
      ok: true,
      requestId,
      day: updatedDay,
      serverTime: getWibTimeString(responseNow),
      serverEpochMs: responseNow.getTime(),
    });
  });

  // 5. Attendance Photo Access (own history + today's shared Beranda feed; Admin/Superadmin all)
  app.get('/api/v1/photos/:sessionId', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const sessionId = Number(req.params.sessionId);
    const row = db
      .prepare(`SELECT id, karyawan_id, tanggal, foto_path FROM absensi_sesi WHERE id = ?`)
      .get(sessionId) as
      | { id: number; karyawan_id: number; tanggal: string; foto_path: string | null }
      | undefined;

    if (!row || !row.foto_path) {
      res.status(404).json({ error: 'Foto absensi tidak ditemukan.' });
      return;
    }

    const user = req.authUser!;
    const cutoff = getWibDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    if (user.role === 'KARYAWAN' && row.karyawan_id !== user.karyawan_id && row.tanggal < cutoff) {
      res.status(403).json({ error: 'Anda tidak berwenang melihat arsip foto lama rekan kerja.' });
      return;
    }

    const safeFile = path.basename(row.foto_path);
    const fullPath = path.join(getPhotosDir(), safeFile);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Berkas foto tidak tersedia di penyimpanan.' });
      return;
    }

    const ext = path.extname(safeFile).toLowerCase();
    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(fullPath).pipe(res);
  });

  // 6. Monthly History & Payroll Rekap (Single source of truth)
  app.get('/api/v1/history/monthly', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const bulan = typeof req.query.bulan === 'string' && /^\d{4}-\d{2}$/.test(req.query.bulan)
      ? req.query.bulan
      : getWibDateString().slice(0, 7);

    let targetEmpId: number | null = user.role === 'KARYAWAN' ? user.karyawan_id : null;
    if (req.query.karyawanId && (user.role === 'ADMIN' || user.role === 'SUPERADMIN')) {
      targetEmpId = Number(req.query.karyawanId);
    }

    if (targetEmpId === null || !isAttendanceEligibleEmployee(targetEmpId)) {
      res.status(400).json({ error: 'Akun Admin Operasional dan Superadmin tidak memiliki riwayat absensi pribadi. Pilih karyawan yang ingin dipantau.' });
      return;
    }
    const summary = computeMonthlySummary(db, targetEmpId, bulan);
    if (!summary) {
      res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
      return;
    }

    // Strip precise GPS from non-privileged view if ever queried inappropriately (Karyawan sees own location text/geofence)
    res.json({ summary });
  });

  // 7. Requests & Off Pengganti
  app.get('/api/v1/off-rights', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const empId =
      req.query.karyawanId && user.role !== 'KARYAWAN' ? Number(req.query.karyawanId) : user.karyawan_id;

    const rows = db
      .prepare(
        `SELECT hop.*, k.nama_lengkap as karyawan_nama
         FROM hak_off_pengganti hop
         JOIN karyawan k ON hop.karyawan_id = k.id
         WHERE ${user.role === 'KARYAWAN' || req.query.karyawanId ? 'hop.karyawan_id = ?' : '1=1'}
         ORDER BY hop.created_at DESC`
      )
      .all(...(user.role === 'KARYAWAN' || req.query.karyawanId ? [empId] : []));
    res.json({ items: rows });
  });

  app.get('/api/v1/requests', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const jenisFilter = typeof req.query.jenis === 'string' ? req.query.jenis : '';

    let sql = `
      SELECT p.*, k.nama_lengkap as karyawan_nama, k.nik, b.nama as bidang_nama, kt.nama as kantor_nama,
             hop.tanggal_kerja_sumber, hop.nama_project as nama_project_sumber,
             proc.username as diproses_oleh_nama
      FROM pengajuan p
      JOIN karyawan k ON p.karyawan_id = k.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      JOIN kantor kt ON k.kantor_id = kt.id
      LEFT JOIN hak_off_pengganti hop ON p.hak_off_id = hop.id
      LEFT JOIN pengguna proc ON p.diproses_oleh = proc.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    if (user.role === 'KARYAWAN') {
      sql += ` AND p.karyawan_id = ?`;
      if (user.karyawan_id === null) {
        res.status(403).json({ error: 'Akun tidak terhubung ke profil karyawan.' });
        return;
      }
      params.push(user.karyawan_id);
    } else if (req.query.karyawanId) {
      sql += ` AND p.karyawan_id = ?`;
      params.push(Number(req.query.karyawanId));
    }
    if (statusFilter) {
      sql += ` AND p.status = ?`;
      params.push(statusFilter);
    }
    if (jenisFilter) {
      sql += ` AND p.jenis = ?`;
      params.push(jenisFilter);
    }
    sql += ` ORDER BY p.created_at DESC`;

    const rawItems = db.prepare(sql).all(...params) as unknown as Pengajuan[];
    const proofStmt = db.prepare(
      `SELECT id, urutan_sesi, nama_sesi, waktu_server, status_ketepatan,
              jarak_kantor_meter, dalam_geofence, lokasi_alamat, deskripsi_aktivitas, foto_path
       FROM absensi_sesi
       WHERE karyawan_id = ? AND tanggal = ?
       ORDER BY urutan_sesi ASC`
    );
    const items = rawItems.map((item) => {
      if (item.jenis !== 'KERJA_HARI_LIBUR') return item;
      const proofs = proofStmt.all(item.karyawan_id, item.tanggal_mulai) as {
        id: number;
        urutan_sesi: number;
        nama_sesi: string;
        waktu_server: string;
        status_ketepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
        jarak_kantor_meter: number | null;
        dalam_geofence: number;
        lokasi_alamat: string | null;
        deskripsi_aktivitas: string;
        foto_path: string | null;
      }[];
      return {
        ...item,
        attendanceProofs: proofs.map((p) => ({
          id: p.id,
          urutan_sesi: p.urutan_sesi,
          nama_sesi: p.nama_sesi,
          waktu_server: p.waktu_server,
          status_ketepatan: p.status_ketepatan,
          jarak_kantor_meter: p.jarak_kantor_meter,
          dalam_geofence: p.dalam_geofence,
          lokasi_alamat: p.lokasi_alamat,
          deskripsi_aktivitas: p.deskripsi_aktivitas,
          has_foto: Boolean(p.foto_path),
        })),
      };
    });
    res.json({ items });
  });

  app.post('/api/v1/requests', requireRole('KARYAWAN', 'ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const {
      karyawanId,
      jenis,
      tanggalMulai,
      tanggalAkhir,
      alasan,
      catatan,
      lampiranNama,
      hakOffId,
    } = req.body as {
      karyawanId?: number;
      jenis?: string;
      tanggalMulai?: string;
      tanggalAkhir?: string;
      alasan?: string;
      catatan?: string;
      lampiranNama?: string | null;
      hakOffId?: number | null;
    };

    const allowedJenis = ['CUTI', 'OFF', 'OFF_PENGGANTI', 'IZIN', 'SAKIT'];
    if (!jenis || !allowedJenis.includes(jenis)) {
      res.status(400).json({ error: 'Jenis pengajuan tidak valid (tidak ada status DINAS).' });
      return;
    }
    if (!tanggalMulai || !tanggalAkhir || tanggalAkhir < tanggalMulai) {
      res.status(400).json({ error: 'Rentang tanggal pengajuan tidak valid.' });
      return;
    }
    if (!alasan || alasan.trim().length < 3) {
      res.status(400).json({ error: 'Alasan pengajuan wajib diisi minimal 3 karakter.' });
      return;
    }

    if (user.role === 'ADMIN' && !karyawanId) {
      res.status(400).json({ error: 'Admin Operasional wajib memilih karyawan tujuan pengajuan.' });
      return;
    }
    const targetEmpId = user.role === 'ADMIN' ? Number(karyawanId) : user.karyawan_id;
    if (targetEmpId === null || !isAttendanceEligibleEmployee(targetEmpId)) {
      res.status(403).json({ error: 'Pengajuan kehadiran hanya berlaku untuk akun Karyawan.' });
      return;
    }
    const nowIso = getWibIsoString();

    if (jenis === 'OFF_PENGGANTI') {
      if (tanggalMulai !== tanggalAkhir) {
        res.status(400).json({ error: 'Satu hak Off Pengganti hanya berlaku untuk 1 tanggal off.' });
        return;
      }
      if (!hakOffId) {
        res.status(400).json({ error: 'Pilih hak Off Pengganti yang tersedia.' });
        return;
      }
      const right = db
        .prepare(`SELECT * FROM hak_off_pengganti WHERE id = ? AND karyawan_id = ?`)
        .get(hakOffId, targetEmpId) as { id: number; status: string } | undefined;
      if (!right || right.status !== 'TERSEDIA') {
        res.status(400).json({ error: 'Hak Off Pengganti tidak tersedia atau sudah digunakan.' });
        return;
      }
      const existingUse = db
        .prepare(`SELECT id FROM penggunaan_off_pengganti WHERE hak_off_id = ? AND status IN ('PENDING','APPROVED')`)
        .get(hakOffId);
      if (existingUse) {
        res.status(400).json({ error: 'Hak Off Pengganti ini sedang digunakan pada pengajuan lain.' });
        return;
      }
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const info = db
        .prepare(
          `INSERT INTO pengajuan (
            karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan,
            lampiran_nama, hak_off_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
        )
        .run(
          targetEmpId,
          jenis,
          tanggalMulai,
          tanggalAkhir,
          alasan.trim(),
          (catatan || '').trim(),
          lampiranNama || null,
          jenis === 'OFF_PENGGANTI' ? hakOffId! : null,
          nowIso,
          nowIso
        );
      const newId = Number(info.lastInsertRowid);

      if (jenis === 'OFF_PENGGANTI' && hakOffId) {
        db.prepare(
          `INSERT INTO penggunaan_off_pengganti (hak_off_id, pengajuan_id, karyawan_id, tanggal_off, status, created_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?)`
        ).run(hakOffId, newId, targetEmpId, tanggalMulai, nowIso);
      }

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PENGAJUAN',
        aksi: 'CREATE_PENGAJUAN',
        targetEntity: 'pengajuan',
        targetId: newId,
        karyawanId: targetEmpId,
        tanggalTerdampak: tanggalMulai,
        after: { jenis, tanggalMulai, tanggalAkhir, alasan: alasan.trim(), hakOffId: hakOffId ?? null },
      });

      db.exec('COMMIT');
      res.status(201).json({ id: newId });
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Gagal membuat pengajuan.',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.put('/api/v1/requests/:id', requireRole('KARYAWAN', 'ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const reqId = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM pengajuan WHERE id = ?`).get(reqId) as Pengajuan | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
      return;
    }
    if (user.role === 'KARYAWAN' && existing.karyawan_id !== user.karyawan_id) {
      res.status(403).json({ error: 'Tidak berwenang mengedit pengajuan karyawan lain.' });
      return;
    }
    if (existing.status !== 'PENDING' && existing.status !== 'DRAFT') {
      res.status(400).json({ error: 'Hanya pengajuan berstatus PENDING/DRAFT yang dapat diedit.' });
      return;
    }

    const { tanggalMulai, tanggalAkhir, alasan, catatan } = req.body as {
      tanggalMulai?: string;
      tanggalAkhir?: string;
      alasan?: string;
      catatan?: string;
    };
    const nextMulai =
      existing.jenis === 'KERJA_HARI_LIBUR' ? existing.tanggal_mulai : tanggalMulai || existing.tanggal_mulai;
    const nextAkhir =
      existing.jenis === 'KERJA_HARI_LIBUR' ? existing.tanggal_akhir : tanggalAkhir || existing.tanggal_akhir;
    const nextAlasan = (alasan ?? existing.alasan).trim();
    const nextCatatan = (catatan ?? existing.catatan).trim();
    const nowIso = getWibIsoString();

    if (nextAkhir < nextMulai || nextAlasan.length < 3) {
      res.status(400).json({ error: 'Data pembaruan tidak valid.' });
      return;
    }
    if (existing.jenis === 'OFF_PENGGANTI' && nextMulai !== nextAkhir) {
      res.status(400).json({ error: 'Satu hak Off Pengganti hanya berlaku untuk 1 tanggal off.' });
      return;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE pengajuan SET tanggal_mulai = ?, tanggal_akhir = ?, alasan = ?, catatan = ?, updated_at = ? WHERE id = ?`
      ).run(nextMulai, nextAkhir, nextAlasan, nextCatatan, nowIso, reqId);

      if (existing.jenis === 'OFF_PENGGANTI') {
        db.prepare(
          `UPDATE penggunaan_off_pengganti SET tanggal_off = ? WHERE pengajuan_id = ?`
        ).run(nextMulai, reqId);
      }

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PENGAJUAN',
        aksi: 'UPDATE_PENGAJUAN',
        targetEntity: 'pengajuan',
        targetId: reqId,
        karyawanId: existing.karyawan_id,
        tanggalTerdampak: nextMulai,
        before: existing,
        after: { tanggal_mulai: nextMulai, tanggal_akhir: nextAkhir, alasan: nextAlasan, catatan: nextCatatan },
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({ ok: true });
  });

  app.post('/api/v1/requests/:id/cancel', requireRole('KARYAWAN', 'ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const reqId = Number(req.params.id);
    const { alasan } = req.body as { alasan?: string };
    const existing = db.prepare(`SELECT * FROM pengajuan WHERE id = ?`).get(reqId) as Pengajuan | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
      return;
    }
    if (user.role === 'KARYAWAN') {
      if (existing.karyawan_id !== user.karyawan_id) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      if (existing.status !== 'PENDING' && existing.status !== 'DRAFT') {
        res.status(400).json({ error: 'Pengajuan yang sudah diproses hanya dapat dibatalkan oleh Admin.' });
        return;
      }
      if (existing.jenis === 'KERJA_HARI_LIBUR') {
        const recorded = db
          .prepare(`SELECT COUNT(*) as total FROM absensi_sesi WHERE karyawan_id = ? AND tanggal = ?`)
          .get(existing.karyawan_id, existing.tanggal_mulai) as { total: number };
        if (Number(recorded?.total || 0) > 0) {
          res.status(400).json({
            error: 'Tidak dapat membatalkan mode kerja hari libur karena bukti absensi sudah tercatat. Hubungi Admin jika perlu penyesuaian.',
          });
          return;
        }
      }
    }
    if (existing.status === 'CANCELLED') {
      res.status(400).json({ error: 'Pengajuan sudah dibatalkan.' });
      return;
    }

    const cancelReason = (alasan || 'Dibatalkan oleh pengguna').trim();
    const nowIso = getWibIsoString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE pengajuan SET status = 'CANCELLED', diproses_oleh = ?, diproses_pada = ?, alasan_keputusan = ?, updated_at = ? WHERE id = ?`
      ).run(user.id, nowIso, cancelReason, nowIso, reqId);

      if (existing.hak_off_id) {
        db.prepare(`DELETE FROM penggunaan_off_pengganti WHERE pengajuan_id = ?`).run(reqId);
        db.prepare(`UPDATE hak_off_pengganti SET status = 'TERSEDIA' WHERE id = ?`).run(existing.hak_off_id);
      }

      if (existing.jenis === 'KERJA_HARI_LIBUR' && existing.status === 'APPROVED') {
        const linkedKk = db
          .prepare(
            `SELECT id FROM penugasan_kerja_khusus WHERE karyawan_id = ? AND tanggal = ? AND status != 'DIBATALKAN'`
          )
          .get(existing.karyawan_id, existing.tanggal_mulai) as { id: number } | undefined;
        if (linkedKk) {
          db.prepare(`UPDATE penugasan_kerja_khusus SET status = 'DIBATALKAN' WHERE id = ?`).run(linkedKk.id);
          db.prepare(
            `UPDATE hak_off_pengganti SET status = 'HANGUS' WHERE kerja_khusus_id = ? AND status = 'TERSEDIA'`
          ).run(linkedKk.id);
        }
      }

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PENGAJUAN',
        aksi: 'CANCEL_PENGAJUAN',
        targetEntity: 'pengajuan',
        targetId: reqId,
        karyawanId: existing.karyawan_id,
        tanggalTerdampak: existing.tanggal_mulai,
        before: { status: existing.status },
        after: { status: 'CANCELLED' },
        alasan: cancelReason,
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    broadcastWorkforceUpdate('REQUEST_CANCELLED');
    res.json({ ok: true });
  });

  app.post('/api/v1/requests/:id/decide', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const reqId = Number(req.params.id);
    const { decision, alasanKeputusan, berhakOffPengganti } = req.body as {
      decision?: 'APPROVED' | 'REJECTED';
      alasanKeputusan?: string;
      berhakOffPengganti?: boolean;
    };

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      res.status(400).json({ error: 'Keputusan harus APPROVED atau REJECTED.' });
      return;
    }
    if (!alasanKeputusan || alasanKeputusan.trim().length < 3) {
      res.status(400).json({ error: 'Alasan keputusan approval/penolakan wajib diisi.' });
      return;
    }

    const existing = db.prepare(`SELECT * FROM pengajuan WHERE id = ?`).get(reqId) as Pengajuan | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
      return;
    }
    if (existing.status !== 'PENDING') {
      res.status(400).json({ error: 'Hanya pengajuan berstatus PENDING yang dapat diproses.' });
      return;
    }

    const nowIso = getWibIsoString();
    let issuedOffRightId: number | null = null;
    let linkedSpecialWorkId: number | null = null;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE pengajuan SET status = ?, diproses_oleh = ?, diproses_pada = ?, alasan_keputusan = ?, updated_at = ? WHERE id = ?`
      ).run(decision, user.id, nowIso, alasanKeputusan.trim(), nowIso, reqId);

      if (existing.hak_off_id) {
        if (decision === 'APPROVED') {
          db.prepare(`UPDATE hak_off_pengganti SET status = 'DIPAKAI' WHERE id = ?`).run(existing.hak_off_id);
          db.prepare(`UPDATE penggunaan_off_pengganti SET status = 'APPROVED' WHERE pengajuan_id = ?`).run(reqId);
        } else {
          db.prepare(`DELETE FROM penggunaan_off_pengganti WHERE pengajuan_id = ?`).run(reqId);
          db.prepare(`UPDATE hak_off_pengganti SET status = 'TERSEDIA' WHERE id = ?`).run(existing.hak_off_id);
        }
      }

      if (existing.jenis === 'KERJA_HARI_LIBUR' && decision === 'APPROVED') {
        const sessRow = db
          .prepare(`SELECT COUNT(*) as total FROM absensi_sesi WHERE karyawan_id = ? AND tanggal = ?`)
          .get(existing.karyawan_id, existing.tanggal_mulai) as { total: number };
        const sessionCount = Number(sessRow?.total || 0);
        const grantOff = berhakOffPengganti !== false;
        const projectTitle = existing.alasan.trim().slice(0, 120) || 'Kerja Darurat Hari Libur';
        const kkKeterangan = existing.catatan
          ? `Kerja Darurat Hari Libur: ${existing.catatan}`
          : 'Kerja Darurat Hari Libur (Absen Mandiri Terverifikasi)';
        const kkStatus = sessionCount >= 1 ? 'SELESAI' : 'AKTIF';

        const existingKk = db
          .prepare(`SELECT id FROM penugasan_kerja_khusus WHERE karyawan_id = ? AND tanggal = ?`)
          .get(existing.karyawan_id, existing.tanggal_mulai) as { id: number } | undefined;

        if (existingKk) {
          db.prepare(
            `UPDATE penugasan_kerja_khusus
             SET nama_project = ?, keterangan = ?, jumlah_sesi = 2, min_sesi_hadir = 1,
                 berhak_off_pengganti = ?, status = ?
             WHERE id = ?`
          ).run(projectTitle, kkKeterangan, grantOff ? 1 : 0, kkStatus, existingKk.id);
          linkedSpecialWorkId = existingKk.id;
        } else {
          const kkInfo = db
            .prepare(
              `INSERT INTO penugasan_kerja_khusus (
                karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir,
                berhak_off_pengganti, status, created_by, created_at
              ) VALUES (?, ?, ?, ?, 2, 1, ?, ?, ?, ?)`
            )
            .run(
              existing.karyawan_id,
              existing.tanggal_mulai,
              projectTitle,
              kkKeterangan,
              grantOff ? 1 : 0,
              kkStatus,
              user.id,
              nowIso
            );
          linkedSpecialWorkId = Number(kkInfo.lastInsertRowid);
        }

        if (grantOff && sessionCount >= 1 && linkedSpecialWorkId) {
          const existingOff = db
            .prepare(
              `SELECT id FROM hak_off_pengganti WHERE kerja_khusus_id = ? AND status IN ('TERSEDIA','DIPAKAI')`
            )
            .get(linkedSpecialWorkId) as { id: number } | undefined;
          if (!existingOff) {
            const expDate = new Date(`${existing.tanggal_mulai}T00:00:00Z`);
            expDate.setUTCDate(expDate.getUTCDate() + 60);
            const kadaluarsa = expDate.toISOString().slice(0, 10);
            const offInfo = db
              .prepare(
                `INSERT INTO hak_off_pengganti (
                  karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at
                ) VALUES (?, ?, ?, ?, 'TERSEDIA', ?, ?)`
              )
              .run(existing.karyawan_id, linkedSpecialWorkId, existing.tanggal_mulai, projectTitle, kadaluarsa, nowIso);
            issuedOffRightId = Number(offInfo.lastInsertRowid);
          }
        }
      }

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PENGAJUAN',
        aksi: decision === 'APPROVED' ? 'APPROVE_PENGAJUAN' : 'REJECT_PENGAJUAN',
        targetEntity: 'pengajuan',
        targetId: reqId,
        karyawanId: existing.karyawan_id,
        tanggalTerdampak: existing.tanggal_mulai,
        before: { status: existing.status },
        after: {
          status: decision,
          ...(existing.jenis === 'KERJA_HARI_LIBUR'
            ? {
                berhakOffPengganti: decision === 'APPROVED' ? berhakOffPengganti !== false : false,
                linkedSpecialWorkId,
                issuedOffRightId,
              }
            : {}),
        },
        alasan: alasanKeputusan.trim(),
      });

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    broadcastWorkforceUpdate('REQUEST_DECIDED');
    res.json({ ok: true, linkedSpecialWorkId, issuedOffRightId });
  });

  // 8. Master Data (Kantor, Bidang, Karyawan)
  const countMasterReferences = (sql: string, id: number): number => {
    const row = db.prepare(sql).get(id) as { total: number } | undefined;
    return Number(row?.total || 0);
  };

  // kalender_kerja is a child configuration generated automatically when an
  // office is created. It is removed together with an otherwise-unused office.
  // All business/history references remain hard blockers.
  const getOfficeDeletionUsage = (id: number) => {
    const usage = {
      jumlah_karyawan: countMasterReferences('SELECT COUNT(*) AS total FROM karyawan WHERE kantor_id = ?', id),
      jumlah_pendaftaran: countMasterReferences('SELECT COUNT(*) AS total FROM pendaftaran_akun WHERE kantor_id = ?', id),
      jumlah_hari_libur: countMasterReferences('SELECT COUNT(*) AS total FROM hari_libur WHERE kantor_id = ?', id),
      jumlah_periode_payroll: countMasterReferences('SELECT COUNT(*) AS total FROM periode_payroll WHERE kantor_id = ?', id),
      jumlah_kalender: countMasterReferences('SELECT COUNT(*) AS total FROM kalender_kerja WHERE kantor_id = ?', id),
    };
    return {
      ...usage,
      can_delete:
        usage.jumlah_karyawan === 0 &&
        usage.jumlah_pendaftaran === 0 &&
        usage.jumlah_hari_libur === 0 &&
        usage.jumlah_periode_payroll === 0,
    };
  };

  const getBidangDeletionUsage = (id: number) => {
    const usage = {
      jumlah_karyawan: countMasterReferences('SELECT COUNT(*) AS total FROM karyawan WHERE bidang_id = ?', id),
      jumlah_kebijakan: countMasterReferences('SELECT COUNT(*) AS total FROM kebijakan_absensi WHERE bidang_id = ?', id),
      jumlah_pendaftaran: countMasterReferences('SELECT COUNT(*) AS total FROM pendaftaran_akun WHERE bidang_id = ?', id),
    };
    return {
      ...usage,
      can_delete:
        usage.jumlah_karyawan === 0 &&
        usage.jumlah_kebijakan === 0 &&
        usage.jumlah_pendaftaran === 0,
    };
  };

  app.get('/api/v1/master/offices', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const offices = db.prepare(`SELECT * FROM kantor ORDER BY id ASC`).all() as Array<{ id: number }>;
    // Usage counts are administrative metadata and are only returned to ADMIN.
    const items = req.authUser?.role === 'ADMIN'
      ? offices.map((office) => ({ ...office, ...getOfficeDeletionUsage(office.id) }))
      : offices;
    res.json({ items });
  });

  app.post('/api/v1/master/offices', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { kode, nama, alamat, lat, lng, radius_meter } = req.body as {
      kode?: string;
      nama?: string;
      alamat?: string;
      lat?: number;
      lng?: number;
      radius_meter?: number;
    };
    const cleanKode = (kode || '').trim().toUpperCase();
    const cleanNama = (nama || '').trim();
    const parsedLat = lat !== undefined && lat !== null && String(lat) !== '' ? Number(lat) : -6.2088;
    const parsedLng = lng !== undefined && lng !== null && String(lng) !== '' ? Number(lng) : 106.8456;
    const parsedRadius = radius_meter !== undefined && radius_meter !== null && String(radius_meter) !== '' ? Number(radius_meter) : 250;
    if (!cleanKode || !cleanNama) {
      res.status(400).json({ error: 'Kode dan nama kantor wajib diisi.' });
      return;
    }
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90 || !Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      res.status(400).json({ error: 'Koordinat latitude (-90 s.d. 90) dan longitude (-180 s.d. 180) wajib valid.' });
      return;
    }
    if (!Number.isFinite(parsedRadius) || parsedRadius < 10 || parsedRadius > 50000) {
      res.status(400).json({ error: 'Radius geofence kantor harus antara 10 hingga 50.000 meter.' });
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO kantor (kode, nama, alamat, lat, lng, radius_meter, geofence_mode) VALUES (?, ?, ?, ?, ?, ?, 'TOLAK_LUAR_RADIUS')`
        )
        .run(
          cleanKode,
          cleanNama,
          (alamat || '').trim(),
          parsedLat,
          parsedLng,
          Math.round(parsedRadius)
        );
      const officeId = Number(info.lastInsertRowid);
      for (let d = 0; d <= 6; d++) {
        db.prepare(
          `INSERT INTO kalender_kerja (kantor_id, hari_minggu, status_hari, jumlah_sesi_khusus, keterangan) VALUES (?, ?, ?, NULL, ?)`
        ).run(officeId, d, d === 0 ? 'HARI_LIBUR' : 'HARI_KERJA', d === 0 ? 'Minggu Libur' : 'Hari Kerja Reguler');
      }
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MASTER_KANTOR',
        aksi: 'CREATE_KANTOR',
        targetEntity: 'kantor',
        targetId: officeId,
        after: { kode: cleanKode, nama: cleanNama, alamat: (alamat || '').trim(), lat: parsedLat, lng: parsedLng, radius_meter: Math.round(parsedRadius) },
      });
      db.exec('COMMIT');
      res.status(201).json({ id: officeId });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      res.status(400).json({
        error: 'Gagal menambah kantor (kode kantor mungkin sudah digunakan).',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.put('/api/v1/master/offices/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kantor WHERE id = ?`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Kantor tidak ditemukan.' });
      return;
    }
    const { nama, alamat, lat, lng, radius_meter } = req.body as {
      nama?: string;
      alamat?: string;
      lat?: number;
      lng?: number;
      radius_meter?: number;
    };
    const cleanNama = (nama || '').trim();
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    const parsedRadius = Number(radius_meter);
    if (!cleanNama) {
      res.status(400).json({ error: 'Nama kantor wajib diisi.' });
      return;
    }
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90 || !Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      res.status(400).json({ error: 'Koordinat latitude (-90 s.d. 90) dan longitude (-180 s.d. 180) wajib valid.' });
      return;
    }
    if (!Number.isFinite(parsedRadius) || parsedRadius < 10 || parsedRadius > 50000) {
      res.status(400).json({ error: 'Radius geofence kantor harus antara 10 hingga 50.000 meter.' });
      return;
    }
    db.prepare(
      `UPDATE kantor SET nama = ?, alamat = ?, lat = ?, lng = ?, radius_meter = ?, geofence_mode = 'TOLAK_LUAR_RADIUS' WHERE id = ?`
    ).run(cleanNama, (alamat || '').trim(), parsedLat, parsedLng, Math.round(parsedRadius), id);
    const after = db.prepare(`SELECT * FROM kantor WHERE id = ?`).get(id);
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'MASTER_KANTOR',
      aksi: 'UPDATE_KANTOR',
      targetEntity: 'kantor',
      targetId: id,
      before,
      after,
    });
    res.json({ ok: true });
  });

  app.delete('/api/v1/master/offices/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID kantor tidak valid.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const before = db.prepare(`SELECT * FROM kantor WHERE id = ?`).get(id) as
        | { id: number; kode: string; nama: string }
        | undefined;
      if (!before) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Kantor tidak ditemukan.' });
        return;
      }

      const usage = getOfficeDeletionUsage(id);
      if (!usage.can_delete) {
        db.exec('ROLLBACK');
        res.status(409).json({
          error: 'Kantor tidak dapat dihapus karena masih memiliki data yang berelasi.',
          references: usage,
        });
        return;
      }

      const deletedCalendarRows = db
        .prepare(`DELETE FROM kalender_kerja WHERE kantor_id = ?`)
        .run(id).changes;
      db.prepare(`DELETE FROM kantor WHERE id = ?`).run(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MASTER_KANTOR',
        aksi: 'DELETE_KANTOR',
        targetEntity: 'kantor',
        targetId: id,
        before,
        after: { deleted: true, kalenderKerjaDihapus: deletedCalendarRows },
      });
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      res.status(409).json({
        error: 'Kantor tidak dapat dihapus. Periksa kembali data yang masih berelasi.',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.get('/api/v1/master/bidang', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const bidangItems = db.prepare(`SELECT * FROM bidang_kerja ORDER BY id ASC`).all() as Array<{ id: number }>;
    // Usage counts are administrative metadata and are only returned to ADMIN.
    const items = req.authUser?.role === 'ADMIN'
      ? bidangItems.map((bidang) => ({ ...bidang, ...getBidangDeletionUsage(bidang.id) }))
      : bidangItems;
    res.json({ items });
  });

  app.post('/api/v1/master/bidang', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { kode, nama, deskripsi } = req.body as { kode?: string; nama?: string; deskripsi?: string };
    const cleanKode = (kode || '').trim().toUpperCase();
    const cleanNama = (nama || '').trim();
    const cleanDesc = (deskripsi || '').trim();
    if (!cleanKode || !cleanNama) {
      res.status(400).json({ error: 'Kode dan nama bidang wajib diisi.' });
      return;
    }
    try {
      const info = db
        .prepare(`INSERT INTO bidang_kerja (kode, nama, deskripsi) VALUES (?, ?, ?)`)
        .run(cleanKode, cleanNama, cleanDesc);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MASTER_BIDANG',
        aksi: 'CREATE_BIDANG',
        targetEntity: 'bidang_kerja',
        targetId: Number(info.lastInsertRowid),
        after: { kode: cleanKode, nama: cleanNama, deskripsi: cleanDesc },
      });
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (err) {
      res.status(400).json({
        error: 'Gagal menambah bidang kerja (kode bidang mungkin sudah digunakan).',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.put('/api/v1/master/bidang/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM bidang_kerja WHERE id = ?`).get(id) as
      | { id: number; kode: string; nama: string; deskripsi: string }
      | undefined;
    if (!Number.isInteger(id) || id <= 0 || !before) {
      res.status(404).json({ error: 'Bidang kerja tidak ditemukan.' });
      return;
    }

    const body = req.body as { kode?: string; nama?: string; deskripsi?: string };
    const kode = (body.kode || '').trim().toUpperCase();
    const nama = (body.nama || '').trim();
    const deskripsi = (body.deskripsi || '').trim();
    if (!kode || kode.length > 20 || !nama || nama.length > 100 || deskripsi.length > 500) {
      res.status(400).json({ error: 'Kode (maks. 20), nama (maks. 100), dan deskripsi (maks. 500 karakter) harus valid.' });
      return;
    }

    try {
      db.prepare(
        `UPDATE bidang_kerja SET kode = ?, nama = ?, deskripsi = ? WHERE id = ?`
      ).run(kode, nama, deskripsi, id);
    } catch (err) {
      res.status(400).json({
        error: 'Kode bidang sudah digunakan atau perubahan tidak dapat disimpan.',
        detail: safeErrorDetail(err),
      });
      return;
    }

    const after = db.prepare(`SELECT * FROM bidang_kerja WHERE id = ?`).get(id);
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'MASTER_BIDANG',
      aksi: 'UPDATE_BIDANG',
      targetEntity: 'bidang_kerja',
      targetId: id,
      before,
      after,
    });
    res.json({ ok: true });
  });

  app.delete('/api/v1/master/bidang/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID bidang kerja tidak valid.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      const before = db.prepare(`SELECT * FROM bidang_kerja WHERE id = ?`).get(id) as
        | { id: number; kode: string; nama: string; deskripsi: string }
        | undefined;
      if (!before) {
        db.exec('ROLLBACK');
        res.status(404).json({ error: 'Bidang kerja tidak ditemukan.' });
        return;
      }

      const usage = getBidangDeletionUsage(id);
      if (!usage.can_delete) {
        db.exec('ROLLBACK');
        res.status(409).json({
          error: 'Bidang kerja tidak dapat dihapus karena masih digunakan atau memiliki data yang berelasi.',
          references: usage,
        });
        return;
      }

      db.prepare(`DELETE FROM bidang_kerja WHERE id = ?`).run(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MASTER_BIDANG',
        aksi: 'DELETE_BIDANG',
        targetEntity: 'bidang_kerja',
        targetId: id,
        before,
        after: { deleted: true },
      });
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      res.status(409).json({
        error: 'Bidang kerja tidak dapat dihapus. Periksa kembali data yang masih berelasi.',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.get('/api/v1/master/employees', requireRole('ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT k.*, kt.nama as kantor_nama, kt.kode as kantor_kode, b.nama as bidang_nama,
                u.role, u.username,
                CASE WHEN k.foto_profil_path IS NOT NULL THEN 1 ELSE 0 END as has_foto_profil
         FROM karyawan k
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN bidang_kerja b ON k.bidang_id = b.id
         LEFT JOIN pengguna u ON u.karyawan_id = k.id
         WHERE COALESCE(k.is_system_archive, 0) = 0
           AND ${KARYAWAN_ONLY_SQL}
         ORDER BY k.nik ASC`
      )
      .all();
    res.json({ items });
  });

  app.post('/api/v1/master/employees', requireRole('SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan, username, password, role } = req.body as {
      nik: string;
      nama_lengkap: string;
      email: string;
      no_hp: string;
      kantor_id: number;
      bidang_id: number;
      jabatan: string;
      username: string;
      password?: string;
      role?: Role;
    };
    if (!nik || !nama_lengkap || !email || !username || !password || password.length < 6) {
      res.status(400).json({
        error: 'NIK, nama lengkap, email, username, dan kata sandi (minimal 6 karakter) wajib diisi.',
      });
      return;
    }
    const nowIso = getWibIsoString();
    const today = getWibDateString();
    const empRole: Role = role === 'ADMIN' ? 'ADMIN' : 'KARYAWAN'; // Admin cannot mint SUPERADMIN

    db.exec('BEGIN IMMEDIATE');
    try {
      const empInfo = db
        .prepare(
          `INSERT INTO karyawan (nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan, tanggal_masuk, aktif)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          nik.trim().toUpperCase(),
          nama_lengkap.trim(),
          email.trim(),
          (no_hp || '').trim(),
          Number(kantor_id),
          Number(bidang_id),
          (jabatan || 'Staff').trim(),
          today
        );
      const empId = Number(empInfo.lastInsertRowid);
      db.prepare(
        `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?)`
      ).run(username.trim().toLowerCase(), email.trim(), hashPassword(password), empRole, empId, nowIso);

      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MASTER_KARYAWAN',
        aksi: 'CREATE_KARYAWAN',
        targetEntity: 'karyawan',
        targetId: empId,
        karyawanId: empId,
        after: { nik, nama_lengkap, kantor_id, bidang_id, jabatan, role: empRole },
      });
      db.exec('COMMIT');
      res.status(201).json({ id: empId });
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Gagal menambah karyawan (NIK/email/username mungkin sudah digunakan).',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.put('/api/v1/master/employees/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!isAttendanceEligibleEmployee(id)) {
      res.status(403).json({ error: 'Admin Operasional hanya dapat mengubah data Karyawan. Pengelolaan akun Admin/Superadmin dilakukan oleh Superadmin.' });
      return;
    }
    const before = db.prepare(`SELECT * FROM karyawan WHERE id = ? AND COALESCE(is_system_archive, 0) = 0`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
      return;
    }
    const { nama_lengkap, no_hp, kantor_id, bidang_id, jabatan, aktif } = req.body as {
      nama_lengkap?: string;
      no_hp?: string;
      kantor_id?: number;
      bidang_id?: number;
      jabatan?: string;
      aktif?: number;
    };
    const nextKantorId = Number(kantor_id);
    const nextBidangId = Number(bidang_id);
    if (
      !nama_lengkap?.trim() ||
      !jabatan?.trim() ||
      !Number.isInteger(nextKantorId) ||
      !Number.isInteger(nextBidangId) ||
      ![0, 1].includes(Number(aktif))
    ) {
      res.status(400).json({ error: 'Nama, jabatan, kantor, bidang kerja, dan status karyawan wajib valid.' });
      return;
    }

    const currentOfficeId = (before as { kantor_id: number }).kantor_id;
    const kantorExists = db.prepare(`SELECT id FROM kantor WHERE id = ? AND (aktif = 1 OR id = ?)`).get(nextKantorId, currentOfficeId);
    const bidangExists = db.prepare(`SELECT id FROM bidang_kerja WHERE id = ?`).get(nextBidangId);
    if (!kantorExists || !bidangExists) {
      res.status(400).json({ error: 'Kantor atau bidang kerja yang dipilih tidak ditemukan atau tidak aktif.' });
      return;
    }

    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(
        `UPDATE karyawan SET nama_lengkap = ?, no_hp = ?, kantor_id = ?, bidang_id = ?, jabatan = ?, aktif = ? WHERE id = ? AND COALESCE(is_system_archive, 0) = 0`
      ).run(nama_lengkap.trim(), (no_hp || '').trim(), nextKantorId, nextBidangId, jabatan.trim(), Number(aktif), id);
      db.prepare(
        `UPDATE pengguna SET nama_tampilan = ?, no_hp = ? WHERE karyawan_id = ?`
      ).run(nama_lengkap.trim(), (no_hp || '').trim(), id);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      res.status(400).json({
        error: 'Perubahan data karyawan tidak dapat disimpan.',
        detail: safeErrorDetail(err),
      });
      return;
    }
    const after = db.prepare(`SELECT * FROM karyawan WHERE id = ?`).get(id);
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'MASTER_KARYAWAN',
      aksi: 'UPDATE_KARYAWAN',
      targetEntity: 'karyawan',
      targetId: id,
      karyawanId: id,
      before,
      after,
    });
    res.json({ ok: true });
  });

  // 9. Policies & Sesi
  app.get('/api/v1/policies', requireRole('ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const policies = db
      .prepare(
        `SELECT p.*, b.nama as bidang_nama, k.nama_lengkap as karyawan_nama
         FROM kebijakan_absensi p
         LEFT JOIN bidang_kerja b ON p.bidang_id = b.id
         LEFT JOIN karyawan k ON p.karyawan_id = k.id
         ORDER BY CASE p.level WHEN 'DEFAULT' THEN 1 WHEN 'BIDANG' THEN 2 ELSE 3 END, p.id DESC`
      )
      .all() as unknown as KebijakanAbsensi[];

    const stmtSesi = db.prepare(`SELECT * FROM sesi_absensi WHERE kebijakan_id = ? ORDER BY urutan ASC`);
    const items = policies.map((p) => ({
      ...p,
      sesi: stmtSesi.all(p.id) as unknown as SesiConfig[],
    }));
    res.json({ items });
  });

  function validatePolicySessions(
    jumlahSesi: number,
    sesiInput: SesiConfig[] | undefined,
    wajibFotoGlobal: boolean,
    wajibAktivitasGlobal: boolean
  ): { error?: string; sessions: Array<{ urutan: number; nama: string; jam_mulai: string; jam_selesai: string; wajib_foto: number; wajib_aktivitas: number }> } {
    const hmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    const defaultTimes = [
      ['08:00', '09:30'],
      ['12:00', '14:00'],
      ['15:00', '16:30'],
      ['17:00', '19:30'],
    ];
    const list = sesiInput && sesiInput.length > 0 ? sesiInput : [];
    if (list.length > 0 && list.length !== jumlahSesi) {
      return {
        error: `Jumlah konfigurasi sesi (${list.length}) harus sama dengan jumlah sesi kebijakan (${jumlahSesi}).`,
        sessions: [],
      };
    }

    const normalized: Array<{ urutan: number; nama: string; jam_mulai: string; jam_selesai: string; wajib_foto: number; wajib_aktivitas: number }> = [];
    for (let i = 1; i <= jumlahSesi; i++) {
      const s = list[i - 1];
      const nama = (s?.nama || `Sesi ${i}`).trim();
      const jamMulai = (s?.jam_mulai || defaultTimes[i - 1]?.[0] || '08:00').trim();
      const jamSelesai = (s?.jam_selesai || defaultTimes[i - 1]?.[1] || '17:00').trim();
      if (!nama) {
        return { error: `Nama Sesi ${i} wajib diisi.`, sessions: [] };
      }
      if (!hmRegex.test(jamMulai) || !hmRegex.test(jamSelesai)) {
        return { error: `Format jam Sesi ${i} harus HH:MM (contoh 08:00).`, sessions: [] };
      }
      if (parseHmToMinutes(jamMulai) > parseHmToMinutes(jamSelesai)) {
        return { error: `Jam mulai Sesi ${i} (${jamMulai}) tidak boleh lebih akhir dari jam selesai (${jamSelesai}).`, sessions: [] };
      }
      const wajibFoto = wajibFotoGlobal ? 1 : (s?.wajib_foto ? 1 : 0);
      const wajibAktivitas = i === 1 ? 0 : (wajibAktivitasGlobal ? 1 : (s?.wajib_aktivitas ? 1 : 0));
      normalized.push({
        urutan: i,
        nama,
        jam_mulai: jamMulai,
        jam_selesai: jamSelesai,
        wajib_foto: wajibFoto,
        wajib_aktivitas: wajibAktivitas,
      });
    }
    return { sessions: normalized };
  }

  app.post('/api/v1/policies', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Partial<KebijakanAbsensi> & { sesi?: SesiConfig[] };
    const level = body.level || 'BIDANG';
    if (!['DEFAULT', 'BIDANG', 'KARYAWAN'].includes(level)) {
      res.status(400).json({ error: 'Level kebijakan harus DEFAULT, BIDANG, atau KARYAWAN.' });
      return;
    }
    const jumlahSesi = Number(body.jumlah_sesi);
    if (!body.nama || !body.nama.trim() || ![1, 2, 3, 4].includes(jumlahSesi)) {
      res.status(400).json({ error: 'Nama kebijakan dan jumlah sesi (1, 2, 3, atau 4) wajib valid.' });
      return;
    }

    let bidangId: number | null = null;
    let karyawanId: number | null = null;
    if (level === 'BIDANG') {
      bidangId = Number(body.bidang_id);
      if (!Number.isInteger(bidangId) || !db.prepare(`SELECT id FROM bidang_kerja WHERE id = ?`).get(bidangId)) {
        res.status(400).json({ error: 'Bidang kerja wajib dipilih dan valid.' });
        return;
      }
    } else if (level === 'KARYAWAN') {
      karyawanId = Number(body.karyawan_id);
      if (!Number.isInteger(karyawanId) || !isAttendanceEligibleEmployee(karyawanId)) {
        res.status(400).json({ error: 'Karyawan target (role KARYAWAN) wajib dipilih dan valid.' });
        return;
      }
    }

    const minSesi = Math.max(1, Math.min(Number(body.min_sesi_hadir) || 1, jumlahSesi));
    const toleransi = Math.max(0, Math.min(180, Number(body.toleransi_terlambat_menit ?? 15)));
    const wajibFotoGlobal = body.wajib_foto_semua_sesi !== undefined ? Boolean(body.wajib_foto_semua_sesi) : true;
    const wajibAktivitasGlobal = body.wajib_aktivitas_sesi_lanjut !== undefined ? Boolean(body.wajib_aktivitas_sesi_lanjut) : true;
    const sesiValidation = validatePolicySessions(jumlahSesi, body.sesi, wajibFotoGlobal, wajibAktivitasGlobal);
    if (sesiValidation.error) {
      res.status(400).json({ error: sesiValidation.error });
      return;
    }

    const nowIso = getWibIsoString();
    const today = getWibDateString();
    const berlakuMulai =
      typeof body.berlaku_mulai === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.berlaku_mulai)
        ? body.berlaku_mulai
        : today;

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO kebijakan_absensi (
            level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
            toleransi_terlambat_menit, aturan_lokasi, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
            libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
            sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          level,
          bidangId,
          karyawanId,
          body.nama.trim(),
          jumlahSesi,
          minSesi,
          toleransi,
          body.aturan_lokasi === 'SEMUA_SESI_KANTOR' ? 'SEMUA_SESI_KANTOR' : 'SESI_PERTAMA_KANTOR',
          wajibFotoGlobal ? 1 : 0,
          wajibAktivitasGlobal ? 1 : 0,
          body.libur_dihitung_masuk ? 1 : 0,
          body.off_pengganti_dihitung_masuk ? 1 : 0,
          body.izin_dihitung_masuk ? 1 : 0,
          body.sakit_dihitung_masuk ? 1 : 0,
          body.cuti_dihitung_masuk ? 1 : 0,
          berlakuMulai,
          nowIso
        );
      const policyId = Number(info.lastInsertRowid);
      const stmtSesi = db.prepare(
        `INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      );
      for (const s of sesiValidation.sessions) {
        stmtSesi.run(
          policyId,
          s.urutan,
          s.nama,
          s.jam_mulai,
          s.jam_selesai,
          s.wajib_foto,
          s.wajib_aktivitas
        );
      }
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'POLICY_SESI',
        aksi: 'CREATE_POLICY',
        targetEntity: 'kebijakan_absensi',
        targetId: policyId,
        karyawanId,
        after: { ...body, level, bidang_id: bidangId, karyawan_id: karyawanId, berlaku_mulai: berlakuMulai },
      });
      db.exec('COMMIT');
      broadcastWorkforceUpdate('POLICY_UPDATED');
      res.status(201).json({ id: policyId });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  app.put('/api/v1/policies/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kebijakan_absensi WHERE id = ?`).get(id) as
      | KebijakanAbsensi
      | undefined;
    if (!before) {
      res.status(404).json({ error: 'Kebijakan tidak ditemukan.' });
      return;
    }
    const body = req.body as Partial<KebijakanAbsensi> & { sesi?: SesiConfig[] };
    const nextNama = (body.nama ?? before.nama).trim();
    const jumlahSesi = body.jumlah_sesi !== undefined ? Number(body.jumlah_sesi) : before.jumlah_sesi;
    if (!nextNama || ![1, 2, 3, 4].includes(jumlahSesi)) {
      res.status(400).json({ error: 'Nama kebijakan dan jumlah sesi (1, 2, 3, atau 4) wajib valid.' });
      return;
    }
    const minSesiRaw = body.min_sesi_hadir !== undefined ? Number(body.min_sesi_hadir) : before.min_sesi_hadir;
    const minSesi = Math.max(1, Math.min(minSesiRaw || 1, jumlahSesi));
    const toleransi = Math.max(
      0,
      Math.min(
        180,
        body.toleransi_terlambat_menit !== undefined
          ? Number(body.toleransi_terlambat_menit)
          : before.toleransi_terlambat_menit
      )
    );
    const nextAktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : before.aktif;
    if (before.level === 'DEFAULT' && nextAktif === 0) {
      const otherDefault = db
        .prepare(`SELECT COUNT(*) as c FROM kebijakan_absensi WHERE level = 'DEFAULT' AND aktif = 1 AND id != ?`)
        .get(id) as { c: number };
      if (otherDefault.c === 0) {
        res.status(400).json({ error: 'Minimal harus ada satu kebijakan DEFAULT yang aktif.' });
        return;
      }
    }

    const wajibFotoGlobal =
      body.wajib_foto_semua_sesi !== undefined
        ? Boolean(body.wajib_foto_semua_sesi)
        : Boolean(before.wajib_foto_semua_sesi);
    const wajibAktivitasGlobal =
      body.wajib_aktivitas_sesi_lanjut !== undefined
        ? Boolean(body.wajib_aktivitas_sesi_lanjut)
        : Boolean(before.wajib_aktivitas_sesi_lanjut);

    const existingSesi = db
      .prepare(`SELECT * FROM sesi_absensi WHERE kebijakan_id = ? ORDER BY urutan ASC`)
      .all(id) as unknown as SesiConfig[];
    const sesiToValidate = body.sesi && body.sesi.length > 0 ? body.sesi : (existingSesi.length === jumlahSesi ? existingSesi : undefined);
    const sesiValidation = validatePolicySessions(jumlahSesi, sesiToValidate, wajibFotoGlobal, wajibAktivitasGlobal);
    if (sesiValidation.error) {
      res.status(400).json({ error: sesiValidation.error });
      return;
    }

    const berlakuMulai =
      typeof body.berlaku_mulai === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.berlaku_mulai)
        ? body.berlaku_mulai
        : before.berlaku_mulai;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE kebijakan_absensi SET
          nama = ?, jumlah_sesi = ?, min_sesi_hadir = ?, toleransi_terlambat_menit = ?,
          aturan_lokasi = ?, wajib_foto_semua_sesi = ?, wajib_aktivitas_sesi_lanjut = ?,
          libur_dihitung_masuk = ?, off_pengganti_dihitung_masuk = ?,
          izin_dihitung_masuk = ?, sakit_dihitung_masuk = ?, cuti_dihitung_masuk = ?,
          berlaku_mulai = ?, aktif = ?
         WHERE id = ?`
      ).run(
        nextNama,
        jumlahSesi,
        minSesi,
        toleransi,
        body.aturan_lokasi === 'SEMUA_SESI_KANTOR'
          ? 'SEMUA_SESI_KANTOR'
          : body.aturan_lokasi === 'SESI_PERTAMA_KANTOR'
            ? 'SESI_PERTAMA_KANTOR'
            : before.aturan_lokasi || 'SESI_PERTAMA_KANTOR',
        wajibFotoGlobal ? 1 : 0,
        wajibAktivitasGlobal ? 1 : 0,
        body.libur_dihitung_masuk !== undefined ? (body.libur_dihitung_masuk ? 1 : 0) : before.libur_dihitung_masuk,
        body.off_pengganti_dihitung_masuk !== undefined
          ? (body.off_pengganti_dihitung_masuk ? 1 : 0)
          : before.off_pengganti_dihitung_masuk,
        body.izin_dihitung_masuk !== undefined ? (body.izin_dihitung_masuk ? 1 : 0) : before.izin_dihitung_masuk,
        body.sakit_dihitung_masuk !== undefined ? (body.sakit_dihitung_masuk ? 1 : 0) : before.sakit_dihitung_masuk,
        body.cuti_dihitung_masuk !== undefined ? (body.cuti_dihitung_masuk ? 1 : 0) : before.cuti_dihitung_masuk,
        berlakuMulai,
        nextAktif,
        id
      );

      db.prepare(`DELETE FROM sesi_absensi WHERE kebijakan_id = ?`).run(id);
      const stmtSesi = db.prepare(
        `INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      );
      for (const s of sesiValidation.sessions) {
        stmtSesi.run(
          id,
          s.urutan,
          s.nama,
          s.jam_mulai,
          s.jam_selesai,
          s.wajib_foto,
          s.wajib_aktivitas
        );
      }

      const after = db.prepare(`SELECT * FROM kebijakan_absensi WHERE id = ?`).get(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'POLICY_SESI',
        aksi: 'UPDATE_POLICY',
        targetEntity: 'kebijakan_absensi',
        targetId: id,
        karyawanId: before.karyawan_id,
        before,
        after,
      });
      db.exec('COMMIT');
      broadcastWorkforceUpdate('POLICY_UPDATED');
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  app.delete('/api/v1/policies/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kebijakan_absensi WHERE id = ?`).get(id) as
      | KebijakanAbsensi
      | undefined;
    if (!before) {
      res.status(404).json({ error: 'Kebijakan tidak ditemukan.' });
      return;
    }
    if (before.level === 'DEFAULT') {
      const otherDefault = db
        .prepare(`SELECT COUNT(*) as c FROM kebijakan_absensi WHERE level = 'DEFAULT' AND aktif = 1 AND id != ?`)
        .get(id) as { c: number };
      if (otherDefault.c === 0) {
        res.status(400).json({ error: 'Kebijakan DEFAULT utama tidak dapat dihapus agar sistem selalu memiliki aturan dasar.' });
        return;
      }
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM sesi_absensi WHERE kebijakan_id = ?`).run(id);
      db.prepare(`DELETE FROM kebijakan_absensi WHERE id = ?`).run(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'POLICY_SESI',
        aksi: 'DELETE_POLICY',
        targetEntity: 'kebijakan_absensi',
        targetId: id,
        karyawanId: before.karyawan_id,
        before,
        after: null,
      });
      db.exec('COMMIT');
      broadcastWorkforceUpdate('POLICY_UPDATED');
      res.json({ ok: true });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  // 10. Calendars, Holidays, Special Work
  app.get('/api/v1/calendars', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT ck.*, kt.nama as kantor_nama
         FROM kalender_kerja ck
         JOIN kantor kt ON ck.kantor_id = kt.id
         ORDER BY ck.kantor_id ASC, ck.hari_minggu ASC`
      )
      .all();
    res.json({ items });
  });

  app.put('/api/v1/calendars/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kalender_kerja WHERE id = ?`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Kalender hari tidak ditemukan.' });
      return;
    }
    const { status_hari, jumlah_sesi_khusus, keterangan } = req.body as {
      status_hari: 'HARI_KERJA' | 'HARI_LIBUR';
      jumlah_sesi_khusus: number | null;
      keterangan: string;
    };
    const validSpecialCount =
      status_hari === 'HARI_KERJA' && jumlah_sesi_khusus && [1, 2, 3, 4].includes(Number(jumlah_sesi_khusus))
        ? Number(jumlah_sesi_khusus)
        : null;
    db.prepare(
      `UPDATE kalender_kerja SET status_hari = ?, jumlah_sesi_khusus = ?, keterangan = ? WHERE id = ?`
    ).run(status_hari, validSpecialCount, keterangan || '', id);
    const after = db.prepare(`SELECT * FROM kalender_kerja WHERE id = ?`).get(id);
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'KALENDER_KERJA',
      aksi: 'UPDATE_KALENDER_MINGGUAN',
      targetEntity: 'kalender_kerja',
      targetId: id,
      before,
      after,
    });
    res.json({ ok: true });
  });

  app.get('/api/v1/holidays', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT h.*, kt.nama as kantor_nama
         FROM hari_libur h
         LEFT JOIN kantor kt ON h.kantor_id = kt.id
         ORDER BY h.tanggal DESC`
      )
      .all();
    res.json({ items });
  });

  app.post('/api/v1/holidays', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { tanggal, nama, kantor_id, dihitung_masuk, keterangan } = req.body as {
      tanggal: string;
      nama: string;
      kantor_id: number | null;
      dihitung_masuk: boolean;
      keterangan: string;
    };
    if (!tanggal || !nama) {
      res.status(400).json({ error: 'Tanggal dan nama hari libur wajib diisi.' });
      return;
    }
    const nowIso = getWibIsoString();
    const info = db
      .prepare(
        `INSERT INTO hari_libur (tanggal, nama, kantor_id, dihitung_masuk, keterangan, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(tanggal, nama.trim(), kantor_id ? Number(kantor_id) : null, dihitung_masuk ? 1 : 0, (keterangan || '').trim(), req.authUser!.id, nowIso);

    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'KALENDER_LIBUR',
      aksi: 'CREATE_HOLIDAY',
      targetEntity: 'hari_libur',
      targetId: Number(info.lastInsertRowid),
      tanggalTerdampak: tanggal,
      after: { tanggal, nama, kantor_id, dihitung_masuk },
    });
    broadcastWorkforceUpdate('HOLIDAY_CREATED');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.delete('/api/v1/holidays/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM hari_libur WHERE id = ?`).get(id) as { tanggal: string } | undefined;
    if (!before) {
      res.status(404).json({ error: 'Hari libur tidak ditemukan.' });
      return;
    }
    db.prepare(`DELETE FROM hari_libur WHERE id = ?`).run(id);
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'KALENDER_LIBUR',
      aksi: 'DELETE_HOLIDAY',
      targetEntity: 'hari_libur',
      targetId: id,
      tanggalTerdampak: before.tanggal,
      before,
      alasan: 'Penghapusan hari libur oleh Admin',
    });
    broadcastWorkforceUpdate('HOLIDAY_DELETED');
    res.json({ ok: true });
  });

  app.get('/api/v1/special-work', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    let sql = `
      SELECT kk.*, k.nama_lengkap as karyawan_nama, k.nik, b.nama as bidang_nama, kt.nama as kantor_nama
      FROM penugasan_kerja_khusus kk
      JOIN karyawan k ON kk.karyawan_id = k.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      JOIN kantor kt ON k.kantor_id = kt.id
    `;
    const params: number[] = [];
    if (user.role === 'KARYAWAN') {
      sql += ` WHERE kk.karyawan_id = ?`;
      if (user.karyawan_id === null) {
        res.status(403).json({ error: 'Akun tidak terhubung ke profil karyawan.' });
        return;
      }
      params.push(user.karyawan_id);
    }
    sql += ` ORDER BY kk.tanggal DESC`;
    const items = db.prepare(sql).all(...params);
    res.json({ items });
  });

  app.post('/api/v1/special-work', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const {
      karyawan_id,
      tanggal,
      nama_project,
      keterangan,
      jumlah_sesi,
      min_sesi_hadir,
      berhak_off_pengganti,
    } = req.body as {
      karyawan_id: number;
      tanggal: string;
      nama_project: string;
      keterangan: string;
      jumlah_sesi: number;
      min_sesi_hadir: number;
      berhak_off_pengganti: boolean;
    };

    if (!karyawan_id || !tanggal || !nama_project) {
      res.status(400).json({ error: 'Karyawan, tanggal, dan nama project wajib diisi.' });
      return;
    }
    if (!isAttendanceEligibleEmployee(Number(karyawan_id))) {
      res.status(400).json({ error: 'Penugasan kerja khusus hanya berlaku untuk akun Karyawan.' });
      return;
    }

    const nowIso = getWibIsoString();
    const sessions = [1, 2, 3, 4].includes(Number(jumlah_sesi)) ? Number(jumlah_sesi) : 3;
    const minS = Math.max(1, Math.min(Number(min_sesi_hadir) || 1, sessions));
    const hasOffRight = berhak_off_pengganti !== false;

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO penugasan_kerja_khusus (
            karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir,
            berhak_off_pengganti, status, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?, ?)`
        )
        .run(
          Number(karyawan_id),
          tanggal,
          nama_project.trim(),
          (keterangan || '').trim(),
          sessions,
          minS,
          hasOffRight ? 1 : 0,
          req.authUser!.id,
          nowIso
        );
      const kkId = Number(info.lastInsertRowid);

      if (hasOffRight) {
        const expDate = new Date(`${tanggal}T00:00:00Z`);
        expDate.setUTCDate(expDate.getUTCDate() + 60);
        const kadaluarsa = expDate.toISOString().slice(0, 10);
        db.prepare(
          `INSERT INTO hak_off_pengganti (
            karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at
          ) VALUES (?, ?, ?, ?, 'TERSEDIA', ?, ?)`
        ).run(Number(karyawan_id), kkId, tanggal, nama_project.trim(), kadaluarsa, nowIso);
      }

      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'KERJA_KHUSUS',
        aksi: 'CREATE_KERJA_KHUSUS',
        targetEntity: 'penugasan_kerja_khusus',
        targetId: kkId,
        karyawanId: Number(karyawan_id),
        tanggalTerdampak: tanggal,
        after: { nama_project, jumlah_sesi: sessions, min_sesi_hadir: minS, berhak_off_pengganti: hasOffRight },
      });
      db.exec('COMMIT');
      broadcastWorkforceUpdate('SPECIAL_WORK_CREATED');
      res.status(201).json({ id: kkId });
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(400).json({
        error: 'Gagal menetapkan kerja khusus (kemungkinan karyawan sudah memiliki tugas khusus di tanggal tersebut).',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.post('/api/v1/special-work/:id/cancel', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM penugasan_kerja_khusus WHERE id = ?`).get(id) as
      | { karyawan_id: number; tanggal: string; status: string }
      | undefined;
    if (!before) {
      res.status(404).json({ error: 'Penugasan tidak ditemukan.' });
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE penugasan_kerja_khusus SET status = 'DIBATALKAN' WHERE id = ?`).run(id);
      db.prepare(`UPDATE hak_off_pengganti SET status = 'HANGUS' WHERE kerja_khusus_id = ? AND status = 'TERSEDIA'`).run(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'KERJA_KHUSUS',
        aksi: 'CANCEL_KERJA_KHUSUS',
        targetEntity: 'penugasan_kerja_khusus',
        targetId: id,
        karyawanId: before.karyawan_id,
        tanggalTerdampak: before.tanggal,
        before,
        after: { status: 'DIBATALKAN' },
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    broadcastWorkforceUpdate('SPECIAL_WORK_CANCELLED');
    res.json({ ok: true });
  });

  // 11. Payroll Summary, Early Report, Admin Override, Closing, Export Log
  app.get('/api/v1/payroll/summary', requireRole('ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const bulan =
      typeof req.query.bulan === 'string' && /^\d{4}-\d{2}$/.test(req.query.bulan)
        ? req.query.bulan
        : getWibDateString().slice(0, 7);
    const kantorId = req.query.kantorId ? Number(req.query.kantorId) : undefined;
    const bidangId = req.query.bidangId ? Number(req.query.bidangId) : undefined;

    let sql = `SELECT k.id FROM karyawan k WHERE k.aktif = 1 AND COALESCE(k.is_system_archive, 0) = 0 AND ${KARYAWAN_ONLY_SQL}`;
    const params: number[] = [];
    if (kantorId) {
      sql += ` AND k.kantor_id = ?`;
      params.push(kantorId);
    }
    if (bidangId) {
      sql += ` AND k.bidang_id = ?`;
      params.push(bidangId);
    }
    sql += ` ORDER BY k.nik ASC`;

    const empRows = db.prepare(sql).all(...params) as { id: number }[];
    const items = empRows.map((e) => computeMonthlySummary(db, e.id, bulan)).filter(Boolean);
    const period = db
      .prepare(`SELECT p.*, u.username as ditutup_oleh_nama FROM periode_payroll p LEFT JOIN pengguna u ON p.ditutup_oleh = u.id WHERE p.bulan = ? AND p.kantor_id IS NULL`)
      .get(bulan);

    res.json({ bulan, period: period || null, items });
  });

  app.get('/api/v1/payroll/early-report', requireRole('ADMIN', 'SUPERADMIN'), (req: Request, res: Response) => {
    const tanggal =
      typeof req.query.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.tanggal)
        ? req.query.tanggal
        : getWibDateString();

    const rows = db
      .prepare(
        `SELECT k.id as karyawan_id, k.nik, k.nama_lengkap, kt.nama as kantor_nama, b.nama as bidang_nama,
                a.waktu_server as sesi1_waktu, a.status_ketepatan, a.keterlambatan_menit, a.dalam_geofence
         FROM karyawan k
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN bidang_kerja b ON k.bidang_id = b.id
         LEFT JOIN absensi_sesi a ON a.karyawan_id = k.id AND a.tanggal = ? AND a.urutan_sesi = 1
         WHERE k.aktif = 1 AND COALESCE(k.is_system_archive, 0) = 0 AND ${KARYAWAN_ONLY_SQL}
         ORDER BY a.waktu_server ASC NULLS LAST, k.nama_lengkap ASC`
      )
      .all(tanggal);

    res.json({ tanggal, items: rows });
  });

  app.post('/api/v1/payroll/override', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const { karyawanId, tanggal, hasilOverride, alasan, koreksiSetelahClosing } = req.body as {
      karyawanId?: number;
      tanggal?: string;
      hasilOverride?: 'DIHITUNG_MASUK' | 'TIDAK_DIHITUNG_MASUK';
      alasan?: string;
      koreksiSetelahClosing?: boolean;
    };

    if (!karyawanId || !tanggal || !['DIHITUNG_MASUK', 'TIDAK_DIHITUNG_MASUK'].includes(hasilOverride || '')) {
      res.status(400).json({ error: 'Karyawan, tanggal, dan hasil override wajib valid.' });
      return;
    }
    if (!isAttendanceEligibleEmployee(Number(karyawanId))) {
      res.status(400).json({ error: 'Override kehadiran hanya berlaku untuk akun Karyawan.' });
      return;
    }
    if (!alasan || alasan.trim().length < 5) {
      res.status(400).json({ error: 'Alasan override wajib diisi minimal 5 karakter.' });
      return;
    }

    const emp = getKaryawanById(Number(karyawanId));
    if (!emp) {
      res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
      return;
    }

    const bulan = tanggal.slice(0, 7);
    const closedPeriod = db
      .prepare(`SELECT * FROM periode_payroll WHERE bulan = ? AND status = 'CLOSED' AND (kantor_id IS NULL OR kantor_id = ?)`)
      .get(bulan, emp.kantor_id);

    if (closedPeriod && !koreksiSetelahClosing) {
      res.status(409).json({
        error: `Periode ${bulan} sudah CLOSED. Gunakan konfirmasi Koreksi Pasca-Closing agar perubahan tercatat khusus.`,
        requiresPostClosingFlag: true,
      });
      return;
    }

    const currentDay = resolveDayForEmployee(db, emp, tanggal);
    const nowIso = getWibIsoString();

    db.exec('BEGIN IMMEDIATE');
    try {
      // Deactivate previous active override on this date (keep append-only history!)
      db.prepare(`UPDATE override_kehadiran SET aktif = 0 WHERE karyawan_id = ? AND tanggal = ? AND aktif = 1`).run(
        emp.id,
        tanggal
      );

      const info = db
        .prepare(
          `INSERT INTO override_kehadiran (karyawan_id, tanggal, hasil_awal, hasil_override, alasan, admin_id, created_at, aktif)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(emp.id, tanggal, currentDay.payrollStatus, hasilOverride!, alasan.trim(), user.id, nowIso);

      writeAuditLog(db, {
        actor: user,
        req,
        modul: closedPeriod ? 'CLOSING_KOREKSI' : 'OVERRIDE_KEHADIRAN',
        aksi: closedPeriod ? 'POST_CLOSING_OVERRIDE' : 'CREATE_OVERRIDE',
        targetEntity: 'override_kehadiran',
        targetId: Number(info.lastInsertRowid),
        karyawanId: emp.id,
        tanggalTerdampak: tanggal,
        before: {
          operationalStatus: currentDay.operationalStatus,
          payrollStatus: currentDay.payrollStatus,
          payrollSource: currentDay.payrollSource,
          sessionsCompleted: currentDay.sessionsCompleted,
        },
        after: {
          payrollStatus: hasilOverride,
          buktiAsliDiubah: false,
          pascaClosing: Boolean(closedPeriod),
        },
        alasan: alasan.trim(),
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    broadcastWorkforceUpdate('OVERRIDE_APPLIED');
    const updatedDay = resolveDayForEmployee(db, emp, tanggal);
    res.status(201).json({ ok: true, day: updatedDay });
  });

  app.get('/api/v1/payroll/periods', requireRole('ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT p.*, u.username as ditutup_oleh_nama
         FROM periode_payroll p
         LEFT JOIN pengguna u ON p.ditutup_oleh = u.id
         ORDER BY p.bulan DESC`
      )
      .all();
    res.json({ items });
  });

  app.post('/api/v1/payroll/close', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const { bulan, catatan } = req.body as { bulan?: string; catatan?: string };
    if (!bulan || !/^\d{4}-\d{2}$/.test(bulan)) {
      res.status(400).json({ error: 'Format bulan harus YYYY-MM.' });
      return;
    }

    const existing = db
      .prepare(`SELECT * FROM periode_payroll WHERE bulan = ? AND kantor_id IS NULL`)
      .get(bulan) as { status: string } | undefined;
    if (existing && existing.status === 'CLOSED') {
      res.status(400).json({ error: `Periode ${bulan} sudah berstatus CLOSED.` });
      return;
    }

    const empRows = db
      .prepare(`SELECT k.id FROM karyawan k WHERE k.aktif = 1 AND COALESCE(k.is_system_archive, 0) = 0 AND ${KARYAWAN_ONLY_SQL} ORDER BY k.nik ASC`)
      .all() as { id: number }[];
    const summaries = empRows.map((e) => computeMonthlySummary(db, e.id, bulan)).filter(Boolean);
    const totalHariMasuk = summaries.reduce((acc, s) => acc + (s?.hariMasuk ?? 0), 0);
    const totalTidakHadir = summaries.reduce((acc, s) => acc + (s?.tidakHadir ?? 0), 0);
    const totalOverride = summaries.reduce((acc, s) => acc + (s?.rincian.totalOverride ?? 0), 0);

    const snapshot = {
      bulan,
      totalKaryawan: summaries.length,
      totalHariMasuk,
      totalTidakHadir,
      totalOverride,
      karyawanSnapshots: summaries.map((s) => ({
        karyawanId: s!.karyawanId,
        nik: s!.nik,
        nama: s!.karyawanNama,
        hariMasuk: s!.hariMasuk,
        tidakHadir: s!.tidakHadir,
        totalOverride: s!.rincian.totalOverride,
      })),
    };

    const nowIso = getWibIsoString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO periode_payroll (bulan, kantor_id, status, ditutup_oleh, ditutup_pada, catatan_closing, snapshot_json)
           VALUES (?, NULL, 'CLOSED', ?, ?, ?, ?)`
        )
        .run(bulan, user.id, nowIso, (catatan || 'Monthly closing payroll tervalidasi').trim(), JSON.stringify(snapshot));

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'MONTHLY_CLOSING',
        aksi: 'CLOSE_PERIOD',
        targetEntity: 'periode_payroll',
        targetId: Number(info.lastInsertRowid),
        tanggalTerdampak: `${bulan}-01`,
        after: { bulan, totalHariMasuk, totalTidakHadir, totalOverride },
        alasan: (catatan || 'Penutupan periode payroll bulanan').trim(),
      });
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.status(201).json({ ok: true, snapshot });
  });

  app.post('/api/v1/payroll/export-log', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { format, bulan, deskripsi } = req.body as { format?: string; bulan?: string; deskripsi?: string };
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'EXPORT_LAPORAN',
      aksi: `EXPORT_${(format || 'EXCEL').toUpperCase()}`,
      targetEntity: 'ringkasan_bulanan',
      targetId: bulan || getWibDateString().slice(0, 7),
      alasan: deskripsi || `Export laporan rekap bulan ${bulan}`,
    });
    res.json({ ok: true });
  });

  // 12. Audit Trail (Strictly read-only; no delete/update routes)
  app.get('/api/v1/audit', requireRole('ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const modul = typeof req.query.modul === 'string' ? req.query.modul : '';
    const karyawanId = req.query.karyawanId ? Number(req.query.karyawanId) : undefined;
    const actorRole = typeof req.query.actorRole === 'string' ? req.query.actorRole : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    let sql = `
      SELECT a.*, k.nama_lengkap as karyawan_nama
      FROM audit_log a
      LEFT JOIN karyawan k ON a.karyawan_id = k.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    if (modul) {
      sql += ` AND a.modul = ?`;
      params.push(modul);
    }
    if (karyawanId) {
      sql += ` AND a.karyawan_id = ?`;
      params.push(karyawanId);
    }
    if (actorRole) {
      sql += ` AND a.actor_role = ?`;
      params.push(actorRole);
    }
    if (search) {
      sql += ` AND (LOWER(a.actor_name) LIKE ? OR LOWER(a.aksi) LIKE ? OR LOWER(COALESCE(a.alasan, '')) LIKE ? OR LOWER(COALESCE(k.nama_lengkap, '')) LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ` ORDER BY a.id DESC LIMIT 300`;

    const items = db.prepare(sql).all(...params);
    res.json({ items });
  });

  // Superadmin Overview Metrics (Strictly SUPERADMIN only, aggregating KARYAWAN attendance)
  app.get('/api/v1/superadmin/overview', requireRole('SUPERADMIN'), (req: Request, res: Response) => {
    const bulan =
      typeof req.query.bulan === 'string' && /^\d{4}-\d{2}$/.test(req.query.bulan)
        ? req.query.bulan
        : getWibDateString().slice(0, 7);

    const empRows = db
      .prepare(`SELECT k.id FROM karyawan k WHERE k.aktif = 1 AND COALESCE(k.is_system_archive, 0) = 0 AND ${KARYAWAN_ONLY_SQL}`)
      .all() as { id: number }[];
    const summaries = empRows.map((e) => computeMonthlySummary(db, e.id, bulan)).filter(Boolean);

    const totalHariMasuk = summaries.reduce((acc, s) => acc + (s?.hariMasuk ?? 0), 0);
    const totalTidakHadir = summaries.reduce((acc, s) => acc + (s?.tidakHadir ?? 0), 0);
    const totalOverrideMasuk = summaries.reduce((acc, s) => acc + (s?.rincian.overrideMasuk ?? 0), 0);
    const totalOverrideTidakMasuk = summaries.reduce((acc, s) => acc + (s?.rincian.overrideTidakMasuk ?? 0), 0);
    const totalNormalMasuk = totalHariMasuk - totalOverrideMasuk;

    const recentOverrides = db
      .prepare(
        `SELECT o.*, k.nama_lengkap as karyawan_nama, k.nik, kt.nama as kantor_nama, u.username as admin_nama
         FROM override_kehadiran o
         JOIN karyawan k ON o.karyawan_id = k.id
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN pengguna u ON o.admin_id = u.id
         WHERE o.aktif = 1
         ORDER BY o.id DESC LIMIT 50`
      )
      .all();

    const recentEvidence = db
      .prepare(
        `SELECT a.id, a.karyawan_id, k.nama_lengkap, k.nik, kt.nama as kantor_nama, b.nama as bidang_nama,
                a.tanggal, a.urutan_sesi, a.nama_sesi, a.waktu_server, a.status_ketepatan,
                a.jarak_kantor_meter, a.dalam_geofence, a.tipe_aktivitas, a.deskripsi_aktivitas, a.foto_path
         FROM absensi_sesi a
         JOIN karyawan k ON a.karyawan_id = k.id
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN bidang_kerja b ON k.bidang_id = b.id
         ORDER BY a.id DESC LIMIT 60`
      )
      .all();

    res.json({
      bulan,
      metrics: {
        totalKaryawan: summaries.length,
        totalHariMasuk,
        totalTidakHadir,
        totalNormalMasuk,
        totalOverrideMasuk,
        totalOverrideTidakMasuk,
      },
      recentOverrides,
      recentEvidence,
    });
  });

  // 12b. Superadmin Storage Stats, Backup Creation & Archive Download
  function getDirectoryStats(dirPath: string): { sizeBytes: number; fileCount: number } {
    if (!fs.existsSync(dirPath)) return { sizeBytes: 0, fileCount: 0 };
    let sizeBytes = 0;
    let fileCount = 0;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            sizeBytes += fs.statSync(full).size;
            fileCount += 1;
          } catch {
            // Skip unreadable transient files
          }
        }
      }
    };
    walk(dirPath);
    return { sizeBytes, fileCount };
  }

  function listAvailableBackups() {
    const backupRoot = getBackupDir();
    if (!fs.existsSync(backupRoot)) return [];
    const entries = fs.readdirSync(backupRoot, { withFileTypes: true });
    const items: Array<{
      name: string;
      createdAtWib: string;
      downloadFile: string;
      downloadType: 'tar.gz' | 'db';
      sizeBytes: number;
      dbSizeBytes: number;
      dbSha256: string | null;
      mediaCounts: { photos: number; avatars: number; assets: number } | null;
      tableCounts: Record<string, number> | null;
    }> = [];

    const seenNames = new Set<string>();
    for (const entry of entries) {
      if (!entry.name.startsWith('bignet_backup_')) continue;
      if (entry.isDirectory()) {
        const name = entry.name;
        seenNames.add(name);
        const dirFull = path.join(backupRoot, name);
        const tarName = `${name}.tar.gz`;
        const tarFull = path.join(backupRoot, tarName);
        const dbFull = path.join(dirFull, 'bignet_absensi.db');
        const manifestFull = path.join(dirFull, 'manifest.json');

        let manifest: BackupManifest | null = null;
        if (fs.existsSync(manifestFull)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestFull, 'utf8')) as BackupManifest;
          } catch {
            manifest = null;
          }
        }

        const hasTar = fs.existsSync(tarFull);
        const hasDb = fs.existsSync(dbFull);
        if (!hasTar && !hasDb) continue;

        const downloadFile = hasTar ? tarName : `${name}.db`;
        const stat = fs.statSync(hasTar ? tarFull : dbFull);
        items.push({
          name,
          createdAtWib: manifest?.createdAtWib || stat.mtime.toISOString(),
          downloadFile,
          downloadType: hasTar ? 'tar.gz' : 'db',
          sizeBytes: stat.size,
          dbSizeBytes: manifest?.dbSizeBytes ?? (hasDb ? fs.statSync(dbFull).size : stat.size),
          dbSha256: manifest?.dbSha256 || null,
          mediaCounts: manifest?.mediaCounts || null,
          tableCounts: manifest?.tableCounts || null,
        });
      }
    }

    // Also surface standalone .tar.gz archives if directory was cleaned up
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('bignet_backup_') || !entry.name.endsWith('.tar.gz')) continue;
      const baseName = entry.name.slice(0, -'.tar.gz'.length);
      if (seenNames.has(baseName)) continue;
      const full = path.join(backupRoot, entry.name);
      const stat = fs.statSync(full);
      items.push({
        name: baseName,
        createdAtWib: stat.mtime.toISOString(),
        downloadFile: entry.name,
        downloadType: 'tar.gz',
        sizeBytes: stat.size,
        dbSizeBytes: stat.size,
        dbSha256: null,
        mediaCounts: null,
        tableCounts: null,
      });
    }

    items.sort((a, b) => b.createdAtWib.localeCompare(a.createdAtWib));
    return items;
  }

  app.get('/api/v1/superadmin/backups', requireRole('SUPERADMIN'), (_req: Request, res: Response) => {
    const dbPath = getDbPath();
    const dbSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const photos = getDirectoryStats(getPhotosDir());
    const avatars = getDirectoryStats(getAvatarsDir());
    const assets = getDirectoryStats(getAssetsDir());
    const backups = listAvailableBackups();

    res.json({
      storage: {
        dbSizeBytes,
        photosSizeBytes: photos.sizeBytes,
        photosCount: photos.fileCount,
        avatarsSizeBytes: avatars.sizeBytes,
        avatarsCount: avatars.fileCount,
        assetsSizeBytes: assets.sizeBytes,
        assetsCount: assets.fileCount,
        totalDataBytes: dbSizeBytes + photos.sizeBytes + avatars.sizeBytes + assets.sizeBytes,
      },
      items: backups,
    });
  });

  app.post('/api/v1/superadmin/backups/create', requireRole('SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = runBackup({ compressTarGz: true });
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'BACKUP_SYSTEM',
        aksi: 'CREATE_BACKUP',
        targetEntity: 'backup',
        targetId: result.manifest.backupName,
        after: {
          backupName: result.manifest.backupName,
          dbSizeBytes: result.manifest.dbSizeBytes,
          dbSha256: result.manifest.dbSha256,
          mediaCounts: result.manifest.mediaCounts,
        },
        alasan: 'Pembuatan backup manual dari Konsol Superadmin',
      });

      const tarName = `${result.manifest.backupName}.tar.gz`;
      const hasTar = Boolean(result.manifest.archivePath && fs.existsSync(result.manifest.archivePath));
      const downloadFile = hasTar ? tarName : `${result.manifest.backupName}.db`;
      const sizeBytes = hasTar && result.manifest.archivePath
        ? fs.statSync(result.manifest.archivePath).size
        : result.manifest.dbSizeBytes;

      res.status(201).json({
        backup: {
          name: result.manifest.backupName,
          createdAtWib: result.manifest.createdAtWib,
          downloadFile,
          downloadType: hasTar ? 'tar.gz' : 'db',
          sizeBytes,
          dbSizeBytes: result.manifest.dbSizeBytes,
          dbSha256: result.manifest.dbSha256,
          mediaCounts: result.manifest.mediaCounts,
          tableCounts: result.manifest.tableCounts,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: 'Gagal membuat arsip backup sistem.',
        detail: safeErrorDetail(err),
      });
    }
  });

  app.get('/api/v1/superadmin/backups/:filename/download', requireRole('SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const filename = String(req.params.filename || '');
    if (!/^bignet_backup_[0-9T-]+_[a-f0-9]+\.(tar\.gz|db)$/.test(filename)) {
      res.status(400).json({ error: 'Nama file backup tidak valid.' });
      return;
    }

    const backupRoot = path.resolve(getBackupDir());
    let filePath: string;
    if (filename.endsWith('.tar.gz')) {
      filePath = path.resolve(backupRoot, filename);
    } else {
      const baseName = filename.slice(0, -'.db'.length);
      filePath = path.resolve(backupRoot, baseName, 'bignet_absensi.db');
    }

    if (!filePath.startsWith(backupRoot + path.sep) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File backup tidak ditemukan.' });
      return;
    }

    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'BACKUP_SYSTEM',
      aksi: 'DOWNLOAD_BACKUP',
      targetEntity: 'backup',
      targetId: filename,
      alasan: 'Unduhan arsip backup dari Konsol Superadmin',
    });

    res.setHeader('Content-Type', filename.endsWith('.tar.gz') ? 'application/gzip' : 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(filePath).pipe(res);
  });

  // 13. System Settings, Custom Logo & Website Favicon
  const DEFAULT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="84" viewBox="0 0 180 84" fill="none">
  <defs>
    <linearGradient id="bgRibbonTop" x1="16" y1="8" x2="60" y2="44" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#e74c3c"/>
      <stop offset="100%" stop-color="#c0392b"/>
    </linearGradient>
    <linearGradient id="bgRibbonBot" x1="16" y1="36" x2="68" y2="76" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="100%" stop-color="#8c1f16"/>
    </linearGradient>
  </defs>
  <path d="M18 10C18 8.89543 18.8954 8 20 8H36C48.1503 8 56 14.8 56 24.5C56 32.5 50.2 37.8 41.5 39.2L18 39.2V10Z" fill="url(#bgRibbonTop)"/>
  <path d="M18 34H44C57.5 34 66 41.8 66 53.5C66 65.8 56.5 74 42.5 74H20C18.8954 74 18 73.1046 18 72V34Z" fill="url(#bgRibbonBot)"/>
  <path d="M32 45H41.5C47.5 45 51.5 48.3 51.5 53.5C51.5 58.7 47.5 62 41.5 62H32V45Z" fill="#ffffff"/>
  <path d="M32 20H37.5C41.8 20 44.5 22.1 44.5 25.5C44.5 28.9 41.8 31 37.5 31H32V20Z" fill="#ffffff" fill-opacity="0.95"/>
  <text x="76" y="45" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="29" font-weight="800" letter-spacing="-0.5" fill="#0f172a">BIG</text>
  <text x="76" y="72" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="29" font-weight="800" letter-spacing="-0.5" fill="#c0392b">net</text>
</svg>`;

  const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#c0392b"/>
  <path d="M17 14h15a12 12 0 0 1 7.9 21 13 13 0 0 1-7.3 22H17V14Zm7 7v12h8a6 6 0 0 0 0-12h-8Zm0 19v10h8a5 5 0 0 0 0-10h-8Z" fill="#fff"/>
</svg>`;

  function mapSettingsRow(row: Record<string, unknown>) {
    return {
      id: Number(row.id),
      nama_aplikasi: String(row.nama_aplikasi || 'Absensi BIGNET'),
      subjudul_login: String(row.subjudul_login || 'Sistem Kehadiran Terpadu'),
      judul_hero_login: String(row.judul_hero_login || ''),
      deskripsi_login: String(row.deskripsi_login || ''),
      judul_form_login: String(row.judul_form_login || 'Masuk ke Akun Anda'),
      pengumuman_login: String(row.pengumuman_login || ''),
      footer_login: String(row.footer_login || ''),
      has_custom_logo: Boolean(row.logo_path),
      logo_updated_at: row.logo_updated_at ? String(row.logo_updated_at) : null,
      has_custom_favicon: Boolean(row.favicon_path),
      favicon_updated_at: row.favicon_updated_at ? String(row.favicon_updated_at) : null,
      retensi_foto_hari: Number(row.retensi_foto_hari || 365),
      wajib_gps_absensi: Number(row.wajib_gps_absensi ?? 1),
      izin_demo_login: Number(row.izin_demo_login ?? 1),
      updated_at: String(row.updated_at || ''),
    };
  }

  app.get('/api/v1/settings/public', (_req: Request, res: Response) => {
    const row = db.prepare(`SELECT * FROM pengaturan_aplikasi WHERE id = 1`).get() as
      | Record<string, unknown>
      | undefined;
    res.json({ settings: row ? mapSettingsRow(row) : null });
  });

  app.get('/api/v1/assets/logo', (req: Request, res: Response) => {
    const row =
      req.query.reset === '1'
        ? undefined
        : (db.prepare(`SELECT logo_path FROM pengaturan_aplikasi WHERE id = 1`).get() as
            | { logo_path: string | null }
            | undefined);

    if (row?.logo_path) {
      const safeFile = path.basename(row.logo_path);
      const fullPath = path.join(getAssetsDir(), safeFile);
      if (fs.existsSync(fullPath)) {
        const ext = path.extname(safeFile).toLowerCase();
        const mime =
          ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.png'
            ? 'image/png'
            : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(DEFAULT_LOGO_SVG, 'utf8'));
  });

  app.get('/api/v1/assets/favicon', (req: Request, res: Response) => {
    const row =
      req.query.reset === '1'
        ? undefined
        : (db.prepare(`SELECT favicon_path FROM pengaturan_aplikasi WHERE id = 1`).get() as
            | { favicon_path: string | null }
            | undefined);

    if (row?.favicon_path) {
      const safeFile = path.basename(row.favicon_path);
      const fullPath = path.join(getAssetsDir(), safeFile);
      if (fs.existsSync(fullPath)) {
        const ext = path.extname(safeFile).toLowerCase();
        const mime =
          ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.ico'
            ? 'image/x-icon'
            : 'image/png';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(fullPath).pipe(res);
        return;
      }
    }

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(DEFAULT_FAVICON_SVG, 'utf8'));
  });

  app.get('/api/v1/settings', requireRole('SUPERADMIN'), (_req: Request, res: Response) => {
    const row = db.prepare(`SELECT * FROM pengaturan_aplikasi WHERE id = 1`).get() as Record<
      string,
      unknown
    >;
    res.json({ settings: mapSettingsRow(row) });
  });

  app.put('/api/v1/settings', requireRole('SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const before = db.prepare(`SELECT * FROM pengaturan_aplikasi WHERE id = 1`).get() as Record<
      string,
      unknown
    >;
    const body = req.body as {
      nama_aplikasi?: string;
      subjudul_login?: string;
      judul_hero_login?: string;
      deskripsi_login?: string;
      judul_form_login?: string;
      pengumuman_login?: string;
      footer_login?: string;
      retensi_foto_hari?: number;
      wajib_gps_absensi?: boolean | number;
      izin_demo_login?: boolean | number;
      logoBase64?: string | null;
      resetLogo?: boolean;
      faviconBase64?: string | null;
      resetFavicon?: boolean;
    };

    const namaAplikasi = (body.nama_aplikasi ?? String(before.nama_aplikasi)).trim();
    if (!namaAplikasi) {
      res.status(400).json({ error: 'Nama aplikasi tidak boleh kosong.' });
      return;
    }

    let nextLogoPath = before.logo_path ? String(before.logo_path) : null;
    let nextLogoUpdatedAt = before.logo_updated_at ? String(before.logo_updated_at) : null;
    let nextFaviconPath = before.favicon_path ? String(before.favicon_path) : null;
    let nextFaviconUpdatedAt = before.favicon_updated_at ? String(before.favicon_updated_at) : null;
    const nowIso = getWibIsoString();
    const assetsDir = getAssetsDir();
    let faviconUpload: ReturnType<typeof validateAndSanitizeFaviconBase64> | null = null;
    if (body.faviconBase64 && !body.resetFavicon) {
      try {
        faviconUpload = validateAndSanitizeFaviconBase64(body.faviconBase64, 512 * 1024);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Favicon tidak valid.' });
        return;
      }
    }

    if (body.resetLogo) {
      if (nextLogoPath) {
        const oldFile = path.join(assetsDir, path.basename(nextLogoPath));
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      nextLogoPath = null;
      nextLogoUpdatedAt = nowIso;
    } else if (body.logoBase64) {
      let ext: 'png' | 'jpg' | 'webp' | 'svg';
      let buf: Buffer;
      try {
        const parsed = validateAndSanitizeLogoBase64(body.logoBase64, 2 * 1024 * 1024);
        ext = parsed.ext;
        buf = parsed.buf;
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Logo tidak valid.' });
        return;
      }
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      if (nextLogoPath) {
        const oldFile = path.join(assetsDir, path.basename(nextLogoPath));
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      const fileName = `logo_${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(assetsDir, fileName), buf);
      nextLogoPath = fileName;
      nextLogoUpdatedAt = nowIso;
    }

    if (body.resetFavicon) {
      if (nextFaviconPath) {
        const oldFile = path.join(assetsDir, path.basename(nextFaviconPath));
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      nextFaviconPath = null;
      nextFaviconUpdatedAt = nowIso;
    } else if (faviconUpload) {
      const { ext, buf } = faviconUpload;
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      if (nextFaviconPath) {
        const oldFile = path.join(assetsDir, path.basename(nextFaviconPath));
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      const fileName = `favicon_${crypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(assetsDir, fileName), buf);
      nextFaviconPath = fileName;
      nextFaviconUpdatedAt = nowIso;
    }

    db.prepare(
      `UPDATE pengaturan_aplikasi SET
        nama_aplikasi = ?,
        subjudul_login = ?,
        judul_hero_login = ?,
        deskripsi_login = ?,
        judul_form_login = ?,
        pengumuman_login = ?,
        footer_login = ?,
        logo_path = ?,
        logo_updated_at = ?,
        favicon_path = ?,
        favicon_updated_at = ?,
        retensi_foto_hari = ?,
        wajib_gps_absensi = ?,
        izin_demo_login = ?,
        updated_at = ?
       WHERE id = 1`
    ).run(
      namaAplikasi,
      (body.subjudul_login ?? String(before.subjudul_login)).trim(),
      (body.judul_hero_login ?? String(before.judul_hero_login)).trim(),
      (body.deskripsi_login ?? String(before.deskripsi_login)).trim(),
      (body.judul_form_login ?? String(before.judul_form_login || 'Masuk ke Akun Anda')).trim() ||
        'Masuk ke Akun Anda',
      (body.pengumuman_login ?? String(before.pengumuman_login || '')).trim(),
      (body.footer_login ?? String(before.footer_login)).trim(),
      nextLogoPath,
      nextLogoUpdatedAt,
      nextFaviconPath,
      nextFaviconUpdatedAt,
      Math.max(30, Number(body.retensi_foto_hari ?? before.retensi_foto_hari ?? 365)),
      body.wajib_gps_absensi !== undefined ? (body.wajib_gps_absensi ? 1 : 0) : Number(before.wajib_gps_absensi),
      body.izin_demo_login !== undefined ? (body.izin_demo_login ? 1 : 0) : Number(before.izin_demo_login),
      nowIso
    );

    const after = db.prepare(`SELECT * FROM pengaturan_aplikasi WHERE id = 1`).get() as Record<
      string,
      unknown
    >;
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'PENGATURAN_SISTEM',
      aksi: 'UPDATE_SYSTEM_SETTINGS',
      targetEntity: 'pengaturan_aplikasi',
      targetId: 1,
      before: mapSettingsRow(before),
      after: mapSettingsRow(after),
      alasan: body.logoBase64 || body.faviconBase64
        ? 'Pembaruan pengaturan sistem, logo, dan/atau favicon aplikasi oleh Superadmin'
        : body.resetLogo || body.resetFavicon
        ? 'Reset logo dan/atau favicon aplikasi ke default oleh Superadmin'
        : 'Pembaruan pengaturan sistem oleh Superadmin',
    });

    res.json({ settings: mapSettingsRow(after) });
  });

  // 14. Self-Service Profile & Password Settings (All Roles)
  app.put(
    '/api/v1/profile',
    requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const { nama_lengkap, email, no_hp } = req.body as {
        nama_lengkap?: string;
        email?: string;
        no_hp?: string;
      };

      const cleanName = (nama_lengkap ?? '').trim();
      const cleanEmail = (email ?? '').trim();
      const cleanHp = (no_hp ?? '').trim();

      if (cleanName.length < 2) {
        res.status(400).json({ error: 'Nama lengkap minimal 2 karakter.' });
        return;
      }
      if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Format email tidak valid.' });
        return;
      }

      const before = {
        nama_lengkap: user.nama_lengkap,
        email: user.email,
        no_hp: user.no_hp || '',
      };

      try {
        db.exec('BEGIN IMMEDIATE');
        if (user.karyawan_id === null) {
          db.prepare(
            `UPDATE pengguna SET nama_tampilan = ?, email = ?, no_hp = ? WHERE id = ?`
          ).run(cleanName, cleanEmail, cleanHp, user.id);
          writeAuditLog(db, {
            actor: user,
            req,
            modul: 'PROFIL_AKUN',
            aksi: 'UPDATE_SUPERADMIN_PROFILE',
            targetEntity: 'pengguna',
            targetId: user.id,
            before,
            after: { nama_lengkap: cleanName, email: cleanEmail, no_hp: cleanHp },
            alasan: 'Pembaruan identitas akun Superadmin tanpa profil karyawan',
          });
        } else {
          db.prepare(`UPDATE karyawan SET nama_lengkap = ?, email = ?, no_hp = ? WHERE id = ?`).run(
            cleanName,
            cleanEmail,
            cleanHp,
            user.karyawan_id
          );
          db.prepare(`UPDATE pengguna SET email = ?, nama_tampilan = ?, no_hp = ? WHERE id = ?`).run(
            cleanEmail, cleanName, cleanHp, user.id
          );
          writeAuditLog(db, {
            actor: user,
            req,
            modul: 'PROFIL_AKUN',
            aksi: 'UPDATE_PROFILE',
            targetEntity: 'karyawan',
            targetId: user.karyawan_id,
            karyawanId: user.karyawan_id,
            before,
            after: { nama_lengkap: cleanName, email: cleanEmail, no_hp: cleanHp },
          });
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'Gagal memperbarui profil (email mungkin sudah digunakan akun lain).',
          detail: safeErrorDetail(err),
        });
        return;
      }

      const updatedUser = loadAuthUserById(user.id);
      res.json({ user: updatedUser ? stripInternalAuthFields(updatedUser) : null });
    }
  );

  app.put(
    '/api/v1/profile/password',
    requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const pwLimit = passwordLimiter.consume(`pw:${user.id}`);
      if (!pwLimit.allowed) {
        res.setHeader('Retry-After', String(pwLimit.retryAfterSec));
        res.status(429).json({ error: `Terlalu banyak perubahan sandi. Coba lagi dalam ${pwLimit.retryAfterSec} detik.` });
        return;
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Kata sandi saat ini dan kata sandi baru wajib diisi.' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        return;
      }

      const row = db
        .prepare(`SELECT password_hash FROM pengguna WHERE id = ?`)
        .get(user.id) as { password_hash: string } | undefined;

      if (!row || !verifyPassword(currentPassword, row.password_hash)) {
        res.status(400).json({ error: 'Kata sandi saat ini tidak cocok.' });
        return;
      }

      db.prepare(`UPDATE pengguna SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`).run(
        hashPassword(newPassword),
        user.id
      );

      // Re-issue a fresh token for the caller so their active session continues seamlessly while old tokens are invalidated
      const nextToken = signToken({
        userId: user.id,
        role: user.role,
        tv: (req.authTokenPayload?.tv ?? 1) + 1,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });
      res.setHeader('Set-Cookie', buildAuthCookie(nextToken, req, 60 * 60 * 24 * 7));

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PROFIL_AKUN',
        aksi: 'CHANGE_PASSWORD',
        targetEntity: 'pengguna',
        targetId: user.id,
        karyawanId: user.karyawan_id,
        alasan: 'Pengguna mengganti kata sandi secara mandiri (seluruh sesi lama direvoke)',
      });

      res.json({ ok: true, token: nextToken });
    }
  );

  // 15. Profile Photos & Avatars (All Roles)
  app.get(
    '/api/v1/avatars/karyawan/:karyawanId',
    requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'),
    (req: Request, res: Response) => {
      const karyawanId = Number(req.params.karyawanId);
      const row = db
        .prepare(
          `SELECT k.nama_lengkap, k.foto_profil_path, u.role
           FROM karyawan k
           LEFT JOIN pengguna u ON u.karyawan_id = k.id
           WHERE k.id = ?`
        )
        .get(karyawanId) as
        | { nama_lengkap: string; foto_profil_path: string | null; role: string | null }
        | undefined;

      if (!row) {
        res.status(404).end();
        return;
      }

      if (row.foto_profil_path) {
        const safeFile = path.basename(row.foto_profil_path);
        const fullPath = path.join(getAvatarsDir(), safeFile);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(safeFile).toLowerCase();
          const mime =
            ext === '.svg'
              ? 'image/svg+xml'
              : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
          res.setHeader('Content-Type', mime);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      }

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(buildDefaultAvatarSvg(row.nama_lengkap, row.role || 'KARYAWAN'), 'utf8'));
    }
  );

  app.get(
    '/api/v1/avatars/pengguna/:userId',
    requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'),
    (req: Request, res: Response) => {
      const userId = Number(req.params.userId);
      const row = db
        .prepare(
          `SELECT COALESCE(NULLIF(nama_tampilan, ''), username) as nama_lengkap,
                  foto_profil_path, role
           FROM pengguna
           WHERE id = ?`
        )
        .get(userId) as
        | { nama_lengkap: string; foto_profil_path: string | null; role: string }
        | undefined;

      if (!row) {
        res.status(404).end();
        return;
      }

      if (row.foto_profil_path) {
        const safeFile = path.basename(row.foto_profil_path);
        const fullPath = path.join(getAvatarsDir(), safeFile);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(safeFile).toLowerCase();
          const mime =
            ext === '.png' ? 'image/png' :
            ext === '.webp' ? 'image/webp' : 'image/jpeg';
          res.setHeader('Content-Type', mime);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      }

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(buildDefaultAvatarSvg(row.nama_lengkap, row.role), 'utf8'));
    }
  );

  app.get(
    '/api/v1/avatars/registration/:regId',
    requireRole('SUPERADMIN'),
    (req: Request, res: Response) => {
      const regId = Number(req.params.regId);
      const row = db
        .prepare(
          `SELECT nama_lengkap, role_diminta, foto_profil_path FROM pendaftaran_akun WHERE id = ?`
        )
        .get(regId) as
        | { nama_lengkap: string; role_diminta: string; foto_profil_path: string | null }
        | undefined;

      if (!row) {
        res.status(404).end();
        return;
      }

      if (row.foto_profil_path) {
        const safeFile = path.basename(row.foto_profil_path);
        const fullPath = path.join(getAvatarsDir(), safeFile);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(safeFile).toLowerCase();
          const mime =
            ext === '.svg'
              ? 'image/svg+xml'
              : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
          res.setHeader('Content-Type', mime);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      }

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(Buffer.from(buildDefaultAvatarSvg(row.nama_lengkap, row.role_diminta), 'utf8'));
    }
  );

  app.put(
    '/api/v1/profile/photo',
    requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      const { fotoBase64, removePhoto } = req.body as {
        fotoBase64?: string | null;
        removePhoto?: boolean;
      };

      if (user.karyawan_id === null) {
        const existingUser = db
          .prepare(`SELECT foto_profil_path FROM pengguna WHERE id = ?`)
          .get(user.id) as { foto_profil_path: string | null } | undefined;
        if (!existingUser) {
          res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
          return;
        }

        const nowIso = getWibIsoString();
        let nextPath: string | null = existingUser.foto_profil_path;
        if (removePhoto) {
          deleteAvatarFile(existingUser.foto_profil_path);
          nextPath = null;
        } else if (fotoBase64) {
          try {
            nextPath = saveAvatarBase64(fotoBase64, `user_${user.id}`);
          } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Foto profil tidak valid.' });
            return;
          }
          deleteAvatarFile(existingUser.foto_profil_path);
        } else {
          res.status(400).json({ error: 'Pilih foto profil atau opsi hapus foto.' });
          return;
        }

        db.prepare(
          `UPDATE pengguna SET foto_profil_path = ?, foto_profil_updated_at = ? WHERE id = ?`
        ).run(nextPath, nowIso, user.id);

        writeAuditLog(db, {
          actor: user,
          req,
          modul: 'PROFIL_AKUN',
          aksi: removePhoto ? 'REMOVE_PROFILE_PHOTO' : 'UPDATE_PROFILE_PHOTO',
          targetEntity: 'pengguna',
          targetId: user.id,
          before: { has_foto_profil: Boolean(existingUser.foto_profil_path) },
          after: { has_foto_profil: Boolean(nextPath) },
          alasan: 'Pembaruan foto profil akun pemilik sistem',
        });

        const updatedOwner = loadAuthUserById(user.id);
        res.json({ user: updatedOwner ? stripInternalAuthFields(updatedOwner) : null });
        return;
      }

      const employeeId = user.karyawan_id;
      const existing = db
        .prepare(`SELECT foto_profil_path FROM karyawan WHERE id = ?`)
        .get(employeeId) as { foto_profil_path: string | null } | undefined;

      const nowIso = getWibIsoString();
      let nextPath: string | null = existing?.foto_profil_path ?? null;

      if (removePhoto) {
        deleteAvatarFile(existing?.foto_profil_path);
        nextPath = null;
      } else if (fotoBase64) {
        let saved: string;
        try {
          saved = saveAvatarBase64(fotoBase64, `emp_${employeeId}`);
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Foto profil tidak valid.',
          });
          return;
        }
        deleteAvatarFile(existing?.foto_profil_path);
        nextPath = saved;
      } else {
        res.status(400).json({ error: 'Pilih foto profil atau opsi hapus foto.' });
        return;
      }

      db.prepare(
        `UPDATE karyawan SET foto_profil_path = ?, foto_profil_updated_at = ? WHERE id = ?`
      ).run(nextPath, nowIso, employeeId);

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PROFIL_AKUN',
        aksi: removePhoto ? 'REMOVE_PROFILE_PHOTO' : 'UPDATE_PROFILE_PHOTO',
        targetEntity: 'karyawan',
        targetId: employeeId,
        karyawanId: employeeId,
        before: { has_foto_profil: Boolean(existing?.foto_profil_path) },
        after: { has_foto_profil: Boolean(nextPath) },
      });

      const updatedUser = loadAuthUserById(user.id);
      res.json({ user: updatedUser ? stripInternalAuthFields(updatedUser) : null });
    }
  );

  // 16. Superadmin Account Management & Registration Approval (ACC)
  app.get(
    '/api/v1/superadmin/registrations',
    requireRole('SUPERADMIN'),
    (req: Request, res: Response) => {
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      let sql = `
        SELECT p.id, p.nama_lengkap, p.username, p.email, p.no_hp, p.role_diminta, p.jabatan,
               p.kantor_id, kt.nama as kantor_nama, p.bidang_id, b.nama as bidang_nama,
               CASE WHEN p.foto_profil_path IS NOT NULL THEN 1 ELSE 0 END as has_foto_profil,
               p.catatan_pendaftar, p.status, p.nik_diberikan, p.alasan_keputusan,
               p.diproses_oleh, u.username as diproses_oleh_nama, p.diproses_pada, p.created_at
        FROM pendaftaran_akun p
        JOIN kantor kt ON p.kantor_id = kt.id
        JOIN bidang_kerja b ON p.bidang_id = b.id
        LEFT JOIN pengguna u ON p.diproses_oleh = u.id
      `;
      const params: string[] = [];
      if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
        sql += ` WHERE p.status = ?`;
        params.push(status);
      }
      sql += ` ORDER BY CASE p.status WHEN 'PENDING' THEN 0 ELSE 1 END, p.id DESC`;
      const items = db.prepare(sql).all(...params);
      res.json({ items });
    }
  );

  function generateNextNik(): string {
    const rows = db.prepare(`SELECT nik FROM karyawan`).all() as { nik: string }[];
    let maxNum = 100;
    for (const r of rows) {
      const m = r.nik.match(/(\d+)$/);
      if (m) {
        const n = Number(m[1]);
        if (n > maxNum) maxNum = n;
      }
    }
    return `BG-${maxNum + 1}`;
  }

  app.post(
    '/api/v1/superadmin/registrations/:id/approve',
    requireRole('SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const regId = Number(req.params.id);
      const reg = db
        .prepare(`SELECT * FROM pendaftaran_akun WHERE id = ?`)
        .get(regId) as
        | {
            id: number;
            nama_lengkap: string;
            username: string;
            email: string;
            no_hp: string;
            password_hash: string;
            role_diminta: 'KARYAWAN' | 'ADMIN';
            jabatan: string;
            kantor_id: number;
            bidang_id: number;
            foto_profil_path: string | null;
            status: string;
          }
        | undefined;

      if (!reg) {
        res.status(404).json({ error: 'Data pendaftaran tidak ditemukan.' });
        return;
      }
      if (reg.status !== 'PENDING') {
        res.status(400).json({ error: 'Pendaftaran ini sudah diproses sebelumnya.' });
        return;
      }

      const body = req.body as {
        nik?: string;
        role?: 'KARYAWAN' | 'ADMIN';
        kantor_id?: number;
        bidang_id?: number;
        jabatan?: string;
        alasan_keputusan?: string;
      };

      const finalNik = (body.nik || '').trim().toUpperCase() || generateNextNik();
      const finalRole: 'KARYAWAN' | 'ADMIN' =
        body.role === 'ADMIN' ? 'ADMIN' : body.role === 'KARYAWAN' ? 'KARYAWAN' : reg.role_diminta;
      const finalKantor = Number(body.kantor_id) || reg.kantor_id;
      const finalBidang = Number(body.bidang_id) || reg.bidang_id;
      const finalJabatan = (body.jabatan || '').trim() || reg.jabatan || 'Staff';
      const nowIso = getWibIsoString();
      const today = getWibDateString();

      const dupUser = db
        .prepare(`SELECT id FROM pengguna WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`)
        .get(reg.username, reg.email);
      const dupEmp = db
        .prepare(`SELECT id FROM karyawan WHERE UPPER(nik) = ? OR LOWER(email) = LOWER(?)`)
        .get(finalNik, reg.email);
      if (dupUser || dupEmp) {
        res.status(409).json({
          error: 'NIK, username, atau email sudah digunakan akun aktif lain.',
        });
        return;
      }

      let empFotoPath: string | null = null;
      if (reg.foto_profil_path) {
        const avatarsDir = getAvatarsDir();
        const src = path.join(avatarsDir, path.basename(reg.foto_profil_path));
        if (fs.existsSync(src)) {
          const ext = path.extname(src) || '.jpg';
          empFotoPath = `avatar_${reg.username}_${crypto.randomBytes(8).toString('hex')}${ext}`;
          fs.copyFileSync(src, path.join(avatarsDir, empFotoPath));
        }
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        const empInfo = db
          .prepare(
            `INSERT INTO karyawan (
              nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan,
              tanggal_masuk, foto_profil_path, foto_profil_updated_at, aktif
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            finalNik,
            reg.nama_lengkap,
            reg.email,
            reg.no_hp,
            finalKantor,
            finalBidang,
            finalJabatan,
            today,
            empFotoPath,
            empFotoPath ? nowIso : null
          );
        const empId = Number(empInfo.lastInsertRowid);

        const userInfo = db
          .prepare(
            `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 1, ?)`
          )
          .run(reg.username, reg.email, reg.password_hash, finalRole, empId, nowIso);
        const newUserId = Number(userInfo.lastInsertRowid);

        db.prepare(
          `UPDATE pendaftaran_akun
           SET status = 'APPROVED', nik_diberikan = ?, alasan_keputusan = ?, diproses_oleh = ?, diproses_pada = ?
           WHERE id = ?`
        ).run(
          finalNik,
          (body.alasan_keputusan || 'Disetujui oleh Superadmin').trim(),
          req.authUser!.id,
          nowIso,
          regId
        );

        writeAuditLog(db, {
          actor: req.authUser!,
          req,
          modul: 'MANAJEMEN_AKUN',
          aksi: 'APPROVE_REGISTRATION',
          targetEntity: 'pendaftaran_akun',
          targetId: regId,
          karyawanId: empId,
          before: { status: 'PENDING', username: reg.username, role_diminta: reg.role_diminta },
          after: {
            status: 'APPROVED',
            userId: newUserId,
            karyawanId: empId,
            nik: finalNik,
            role: finalRole,
          },
          alasan: (body.alasan_keputusan || 'ACC pendaftaran akun oleh Superadmin').trim(),
        });

        db.exec('COMMIT');
        broadcastWorkforceUpdate('ACCOUNT_APPROVED');
        res.json({ ok: true, userId: newUserId, karyawanId: empId, nik: finalNik });
      } catch (err) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'Gagal menyetujui pendaftaran akun.',
          detail: safeErrorDetail(err),
        });
      }
    }
  );

  app.post(
    '/api/v1/superadmin/registrations/:id/reject',
    requireRole('SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const regId = Number(req.params.id);
      const { alasan_keputusan } = req.body as { alasan_keputusan?: string };
      if (!alasan_keputusan || alasan_keputusan.trim().length < 3) {
        res.status(400).json({ error: 'Alasan penolakan wajib diisi minimal 3 karakter.' });
        return;
      }

      const reg = db
        .prepare(`SELECT id, username, role_diminta, status FROM pendaftaran_akun WHERE id = ?`)
        .get(regId) as
        | { id: number; username: string; role_diminta: string; status: string }
        | undefined;
      if (!reg) {
        res.status(404).json({ error: 'Data pendaftaran tidak ditemukan.' });
        return;
      }
      if (reg.status !== 'PENDING') {
        res.status(400).json({ error: 'Pendaftaran ini sudah diproses sebelumnya.' });
        return;
      }

      const nowIso = getWibIsoString();
      db.prepare(
        `UPDATE pendaftaran_akun
         SET status = 'REJECTED', alasan_keputusan = ?, diproses_oleh = ?, diproses_pada = ?
         WHERE id = ?`
      ).run(alasan_keputusan.trim(), req.authUser!.id, nowIso, regId);

      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MANAJEMEN_AKUN',
        aksi: 'REJECT_REGISTRATION',
        targetEntity: 'pendaftaran_akun',
        targetId: regId,
        before: { status: 'PENDING', username: reg.username },
        after: { status: 'REJECTED' },
        alasan: alasan_keputusan.trim(),
      });

      res.json({ ok: true });
    }
  );

  app.get('/api/v1/superadmin/accounts', requireRole('SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db
      .prepare(
        `SELECT u.id as user_id, k.id as karyawan_id, k.nik, u.username, u.email,
                COALESCE(NULLIF(u.nama_tampilan, ''), k.nama_lengkap, 'Superadmin') as nama_lengkap,
                COALESCE(k.no_hp, u.no_hp, '') as no_hp,
                COALESCE(k.jabatan, 'Akun Pengelola Sistem') as jabatan,
                u.role, k.kantor_id, kt.nama as kantor_nama,
                k.bidang_id, b.nama as bidang_nama, k.tanggal_masuk,
                u.aktif as user_aktif, k.aktif as karyawan_aktif,
                CASE WHEN COALESCE(k.foto_profil_path, u.foto_profil_path) IS NOT NULL THEN 1 ELSE 0 END as has_foto_profil,
                COALESCE(k.foto_profil_updated_at, u.foto_profil_updated_at) as foto_profil_updated_at,
                u.created_at
         FROM pengguna u
         LEFT JOIN karyawan k ON u.karyawan_id = k.id
         LEFT JOIN kantor kt ON k.kantor_id = kt.id
         LEFT JOIN bidang_kerja b ON k.bidang_id = b.id
         ORDER BY CASE u.role WHEN 'SUPERADMIN' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END,
                  COALESCE(k.nik, u.username) ASC`
      )
      .all();
    const offices = db.prepare(`SELECT id, kode, nama FROM kantor WHERE aktif = 1 ORDER BY id ASC`).all();
    const bidangList = db.prepare(`SELECT id, kode, nama FROM bidang_kerja ORDER BY id ASC`).all();
    res.json({ items, offices, bidangList });
  });

  app.post(
    '/api/v1/superadmin/accounts',
    requireRole('SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const {
        nik,
        nama_lengkap,
        username,
        email,
        no_hp,
        password,
        role,
        jabatan,
        kantor_id,
        bidang_id,
        fotoBase64,
      } = req.body as {
        nik?: string;
        nama_lengkap?: string;
        username?: string;
        email?: string;
        no_hp?: string;
        password?: string;
        role?: Role;
        jabatan?: string;
        kantor_id?: number;
        bidang_id?: number;
        fotoBase64?: string | null;
      };

      const cleanName = (nama_lengkap || '').trim();
      const cleanUser = (username || '').trim().toLowerCase();
      const cleanEmail = (email || '').trim().toLowerCase();
      const finalRole: Role =
        role === 'SUPERADMIN' || role === 'ADMIN' || role === 'KARYAWAN' ? role : 'KARYAWAN';
      const finalNik =
        finalRole === 'SUPERADMIN' ? '' : (nik || '').trim().toUpperCase() || generateNextNik();

      if (cleanName.length < 2 || !cleanUser || !cleanEmail.includes('@') || !password || password.length < 6) {
        res.status(400).json({
          error: 'Nama lengkap, username, email, dan kata sandi (min. 6 karakter) wajib diisi.',
        });
        return;
      }
      if (!/^[a-z0-9._-]{3,30}$/.test(cleanUser)) {
        res.status(400).json({ error: 'Username harus 3–30 karakter (huruf kecil, angka, titik, underscore, atau strip).' });
        return;
      }

      if (finalRole === 'SUPERADMIN') {
        const nowIso = getWibIsoString();
        db.exec('BEGIN IMMEDIATE');
        try {
          const userInfo = db.prepare(
            `INSERT INTO pengguna (
               username, email, password_hash, role, karyawan_id, nama_tampilan, no_hp,
               aktif, token_version, created_at
             ) VALUES (?, ?, ?, 'SUPERADMIN', NULL, ?, ?, 1, 1, ?)`
          ).run(cleanUser, cleanEmail, hashPassword(password), cleanName, (no_hp || '').trim(), nowIso);
          const userId = Number(userInfo.lastInsertRowid);
          writeAuditLog(db, {
            actor: req.authUser!,
            req,
            modul: 'MANAJEMEN_AKUN',
            aksi: 'CREATE_SUPERADMIN_ACCOUNT',
            targetEntity: 'pengguna',
            targetId: userId,
            after: { username: cleanUser, email: cleanEmail, nama_tampilan: cleanName, role: 'SUPERADMIN' },
            alasan: 'Pembuatan akun Superadmin mandiri tanpa profil karyawan oleh Superadmin',
          });
          db.exec('COMMIT');
          res.status(201).json({ ok: true, userId, role: 'SUPERADMIN' });
        } catch (err) {
          db.exec('ROLLBACK');
          res.status(400).json({
            error: 'Gagal membuat akun Superadmin (username atau email mungkin sudah digunakan).',
            detail: safeErrorDetail(err),
          });
        }
        return;
      }

      let savedFoto: string | null = null;
      if (fotoBase64) {
        try {
          savedFoto = saveAvatarBase64(fotoBase64, `emp_${cleanUser}`);
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Foto profil tidak valid.' });
          return;
        }
      }

      const nowIso = getWibIsoString();
      const today = getWibDateString();

      db.exec('BEGIN IMMEDIATE');
      try {
        const empInfo = db
          .prepare(
            `INSERT INTO karyawan (
              nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan,
              tanggal_masuk, foto_profil_path, foto_profil_updated_at, aktif
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            finalNik,
            cleanName,
            cleanEmail,
            (no_hp || '').trim(),
            Number(kantor_id) || 1,
            Number(bidang_id) || 1,
            (jabatan || 'Staff').trim(),
            today,
            savedFoto,
            savedFoto ? nowIso : null
          );
        const empId = Number(empInfo.lastInsertRowid);

        const userInfo = db
          .prepare(
            `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`
          )
          .run(cleanUser, cleanEmail, hashPassword(password), finalRole, empId, nowIso);
        const userId = Number(userInfo.lastInsertRowid);

        writeAuditLog(db, {
          actor: req.authUser!,
          req,
          modul: 'MANAJEMEN_AKUN',
          aksi: 'CREATE_ACCOUNT',
          targetEntity: 'pengguna',
          targetId: userId,
          karyawanId: empId,
          after: { nik: finalNik, username: cleanUser, email: cleanEmail, role: finalRole },
          alasan: 'Pembuatan akun langsung oleh Superadmin',
        });
        db.exec('COMMIT');
        res.status(201).json({ ok: true, userId, karyawanId: empId, nik: finalNik });
      } catch (err) {
        db.exec('ROLLBACK');
        deleteAvatarFile(savedFoto);
        res.status(400).json({
          error: 'Gagal membuat akun (NIK, username, atau email sudah digunakan).',
          detail: safeErrorDetail(err),
        });
      }
    }
  );

  app.put(
    '/api/v1/superadmin/accounts/:userId',
    requireRole('SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const targetUserId = Number(req.params.userId);
      const existing = db
        .prepare(
          `SELECT u.id as user_id, u.username, u.email, u.role, u.aktif as user_aktif,
                  u.nama_tampilan,
                  COALESCE(NULLIF(u.nama_tampilan, ''), k.nama_lengkap, 'Superadmin') as nama_lengkap,
                  COALESCE(k.no_hp, u.no_hp, '') as no_hp,
                  k.id as karyawan_id, k.nik, COALESCE(k.jabatan, 'Akun Pengelola Sistem') as jabatan,
                  k.kantor_id, k.bidang_id, k.aktif as karyawan_aktif, k.foto_profil_path
           FROM pengguna u
           LEFT JOIN karyawan k ON u.karyawan_id = k.id
           WHERE u.id = ?`
        )
        .get(targetUserId) as
        | {
            user_id: number;
            username: string;
            email: string;
            role: Role;
            user_aktif: number;
            nama_tampilan: string | null;
            karyawan_id: number | null;
            nik: string | null;
            nama_lengkap: string;
            no_hp: string;
            jabatan: string;
            kantor_id: number | null;
            bidang_id: number | null;
            karyawan_aktif: number | null;
            foto_profil_path: string | null;
          }
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
        return;
      }

      const body = req.body as {
        nama_lengkap?: string;
        username?: string;
        email?: string;
        no_hp?: string;
        jabatan?: string;
        role?: Role;
        kantor_id?: number;
        bidang_id?: number;
        aktif?: boolean | number;
        fotoBase64?: string | null;
        removePhoto?: boolean;
      };

      if (existing.karyawan_id === null) {
        if (existing.role !== 'SUPERADMIN') {
          res.status(409).json({ error: 'Akun tanpa profil karyawan hanya boleh memiliki role SUPERADMIN.' });
          return;
        }

        const cleanName = (body.nama_lengkap ?? existing.nama_lengkap).trim();
        const cleanUser = (body.username ?? existing.username).trim().toLowerCase();
        const cleanEmail = (body.email ?? existing.email).trim().toLowerCase();
        const cleanHp = (body.no_hp ?? existing.no_hp).trim();
        const nextAktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : existing.user_aktif;

        if (cleanName.length < 2 || !/^[a-z0-9._-]{3,30}$/.test(cleanUser) || !cleanEmail.includes('@')) {
          res.status(400).json({ error: 'Nama, username, atau email akun Superadmin tidak valid.' });
          return;
        }
        if (targetUserId === req.authUser!.id && nextAktif === 0) {
          res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Superadmin Anda sendiri.' });
          return;
        }

        const existingUserPhoto = db
          .prepare(`SELECT foto_profil_path FROM pengguna WHERE id = ?`)
          .get(targetUserId) as { foto_profil_path: string | null } | undefined;
        let nextUserFoto = existingUserPhoto?.foto_profil_path ?? null;
        let userFotoChanged = false;
        const nowIso = getWibIsoString();
        if (body.removePhoto) {
          deleteAvatarFile(nextUserFoto);
          nextUserFoto = null;
          userFotoChanged = true;
        } else if (body.fotoBase64) {
          try {
            const saved = saveAvatarBase64(body.fotoBase64, `user_${targetUserId}`);
            deleteAvatarFile(nextUserFoto);
            nextUserFoto = saved;
            userFotoChanged = true;
          } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Foto profil tidak valid.' });
            return;
          }
        }

        db.exec('BEGIN IMMEDIATE');
        try {
          if (nextAktif === 0 && existing.user_aktif === 1) {
            const activeSuperadmins = db.prepare(
              `SELECT COUNT(*) as c FROM pengguna WHERE role = 'SUPERADMIN' AND aktif = 1`
            ).get() as { c: number };
            if (activeSuperadmins.c <= 1) {
              db.exec('ROLLBACK');
              res.status(400).json({ error: 'Minimal harus ada satu akun Superadmin aktif.' });
              return;
            }
          }
          db.prepare(
            `UPDATE pengguna
             SET username = ?, email = ?, nama_tampilan = ?, no_hp = ?, aktif = ?,
                 foto_profil_path = ?, foto_profil_updated_at = COALESCE(?, foto_profil_updated_at),
                 token_version = CASE WHEN ? = 1 THEN COALESCE(token_version, 1) + 1 ELSE COALESCE(token_version, 1) END
             WHERE id = ?`
          ).run(
            cleanUser,
            cleanEmail,
            cleanName,
            cleanHp,
            nextAktif,
            nextUserFoto,
            userFotoChanged ? nowIso : null,
            nextAktif === 0 ? 1 : 0,
            targetUserId
          );

          writeAuditLog(db, {
            actor: req.authUser!,
            req,
            modul: 'MANAJEMEN_AKUN',
            aksi: 'UPDATE_SUPERADMIN_ACCOUNT',
            targetEntity: 'pengguna',
            targetId: targetUserId,
            before: { username: existing.username, email: existing.email, nama_tampilan: existing.nama_lengkap, aktif: existing.user_aktif, role: existing.role },
            after: { username: cleanUser, email: cleanEmail, nama_tampilan: cleanName, aktif: nextAktif, role: 'SUPERADMIN' },
            alasan: 'Pembaruan akun pemilik sistem oleh Superadmin',
          });
          db.exec('COMMIT');
          res.json({ ok: true });
        } catch (err) {
          db.exec('ROLLBACK');
          res.status(400).json({
            error: 'Gagal memperbarui akun Superadmin (username atau email mungkin sudah digunakan).',
            detail: safeErrorDetail(err),
          });
        }
        return;
      }

      if (body.role === 'SUPERADMIN') {
        res.status(400).json({ error: 'Akun Superadmin harus dibuat sebagai akun pemilik tersendiri, bukan mengubah akun pegawai.' });
        return;
      }
      const nextRole: Role =
        body.role === 'ADMIN' || body.role === 'KARYAWAN' ? body.role : existing.role;
      const nextAktif = body.aktif !== undefined ? (body.aktif ? 1 : 0) : existing.user_aktif;

      if (targetUserId === req.authUser!.id && nextAktif === 0) {
        res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Superadmin Anda sendiri.' });
        return;
      }
      if (targetUserId === req.authUser!.id && nextRole !== 'SUPERADMIN') {
        res.status(400).json({ error: 'Anda tidak dapat menurunkan peran akun Superadmin Anda sendiri.' });
        return;
      }

      const cleanName = (body.nama_lengkap ?? existing.nama_lengkap).trim();
      const cleanUser = (body.username ?? existing.username).trim().toLowerCase();
      const cleanEmail = (body.email ?? existing.email).trim().toLowerCase();
      const cleanHp = (body.no_hp ?? existing.no_hp).trim();
      const cleanJabatan = (body.jabatan ?? existing.jabatan).trim();
      const nextKantor = Number(body.kantor_id ?? existing.kantor_id);
      const nextBidang = Number(body.bidang_id ?? existing.bidang_id);
      const nowIso = getWibIsoString();

      if (cleanName.length < 2 || !/^[a-z0-9._-]{3,30}$/.test(cleanUser) || !cleanEmail.includes('@')) {
        res.status(400).json({ error: 'Nama lengkap (min. 2 karakter), username (3–30 karakter), dan email wajib valid.' });
        return;
      }

      let nextFoto = existing.foto_profil_path;
      let fotoChanged = false;
      if (body.removePhoto) {
        deleteAvatarFile(existing.foto_profil_path);
        nextFoto = null;
        fotoChanged = true;
      } else if (body.fotoBase64) {
        try {
          const saved = saveAvatarBase64(body.fotoBase64, `emp_${existing.karyawan_id}`);
          deleteAvatarFile(existing.foto_profil_path);
          nextFoto = saved;
          fotoChanged = true;
        } catch (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Foto profil tidak valid.' });
          return;
        }
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        const shouldBumpTokenVersion = nextRole !== existing.role || nextAktif === 0;
        db.prepare(
          `UPDATE pengguna
           SET username = ?, email = ?, nama_tampilan = ?, no_hp = ?, role = ?, aktif = ?,
               token_version = CASE WHEN ? = 1 THEN COALESCE(token_version, 1) + 1 ELSE COALESCE(token_version, 1) END
           WHERE id = ?`
        ).run(cleanUser, cleanEmail, cleanName, cleanHp, nextRole, nextAktif, shouldBumpTokenVersion ? 1 : 0, targetUserId);

        db.prepare(
          `UPDATE karyawan
           SET nama_lengkap = ?, email = ?, no_hp = ?, jabatan = ?, kantor_id = ?, bidang_id = ?,
               aktif = ?, foto_profil_path = ?, foto_profil_updated_at = COALESCE(?, foto_profil_updated_at)
           WHERE id = ?`
        ).run(
          cleanName,
          cleanEmail,
          cleanHp,
          cleanJabatan,
          nextKantor,
          nextBidang,
          nextAktif,
          nextFoto,
          fotoChanged ? nowIso : null,
          existing.karyawan_id
        );

        writeAuditLog(db, {
          actor: req.authUser!,
          req,
          modul: 'MANAJEMEN_AKUN',
          aksi: 'UPDATE_ACCOUNT',
          targetEntity: 'pengguna',
          targetId: targetUserId,
          karyawanId: existing.karyawan_id,
          before: {
            username: existing.username,
            email: existing.email,
            role: existing.role,
            aktif: existing.user_aktif,
            kantor_id: existing.kantor_id,
            bidang_id: existing.bidang_id,
          },
          after: {
            username: cleanUser,
            email: cleanEmail,
            role: nextRole,
            aktif: nextAktif,
            kantor_id: nextKantor,
            bidang_id: nextBidang,
          },
          alasan: 'Pembaruan data/peran/status akun oleh Superadmin',
        });
        db.exec('COMMIT');
        res.json({ ok: true });
      } catch (err) {
        db.exec('ROLLBACK');
        res.status(400).json({
          error: 'Gagal memperbarui akun (username atau email mungkin sudah dipakai akun lain).',
          detail: safeErrorDetail(err),
        });
      }
    }
  );

  app.put(
    '/api/v1/superadmin/accounts/:userId/reset-password',
    requireRole('SUPERADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      const targetUserId = Number(req.params.userId);
      const { newPassword } = req.body as { newPassword?: string };
      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        return;
      }

      const target = db
        .prepare(`SELECT id, username, karyawan_id FROM pengguna WHERE id = ?`)
        .get(targetUserId) as { id: number; username: string; karyawan_id: number | null } | undefined;
      if (!target) {
        res.status(404).json({ error: 'Akun pengguna tidak ditemukan.' });
        return;
      }

      db.prepare(
        `UPDATE pengguna SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`
      ).run(hashPassword(newPassword), targetUserId);

      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'MANAJEMEN_AKUN',
        aksi: 'RESET_PASSWORD',
        targetEntity: 'pengguna',
        targetId: targetUserId,
        karyawanId: target.karyawan_id,
        alasan: `Reset kata sandi akun @${target.username} oleh Superadmin (seluruh sesi lama direvoke)`,
      });

      res.json({ ok: true });
    }
  );

  // Catch-all 404 for unmatched /api/v1 routes so Vite SPA fallback never serves HTML for API requests
  app.use('/api/v1', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });
}
