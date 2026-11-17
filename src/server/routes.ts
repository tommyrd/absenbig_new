import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
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
import { getAssetsDir, getAvatarsDir, getPhotosDir } from './paths.ts';
import {
  attendanceLimiter,
  getClientIp,
  loginFailLimiter,
  loginIpLimiter,
  passwordLimiter,
  registerLimiter,
  safeErrorDetail,
  validateAndSanitizeLogoBase64,
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
              k.nama_lengkap, k.nik, k.jabatan, k.no_hp, k.kantor_id, k.bidang_id, k.aktif as emp_aktif,
              k.foto_profil_path, k.foto_profil_updated_at,
              kt.nama as kantor_nama, kt.lat as kantor_lat, kt.lng as kantor_lng,
              kt.radius_meter as kantor_radius, kt.geofence_mode as kantor_geofence_mode,
              b.nama as bidang_nama
       FROM pengguna u
       JOIN karyawan k ON u.karyawan_id = k.id
       JOIN kantor kt ON k.kantor_id = kt.id
       JOIN bidang_kerja b ON k.bidang_id = b.id
       WHERE u.id = ? AND u.aktif = 1 AND k.aktif = 1`
    )
    .get(userId) as
    | (AuthUser & { user_aktif: number; emp_aktif: number; foto_profil_path: string | null; token_version: number })
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    no_hp: row.no_hp,
    role: row.role,
    karyawan_id: row.karyawan_id,
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
    role === 'SUPERADMIN' ? '#0b1528' : role === 'ADMIN' ? '#1d4ed8' : '#1e3a5f';
  const ring =
    role === 'SUPERADMIN' ? '#fbbf24' : role === 'ADMIN' ? '#93c5fd' : '#34d399';
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
         JOIN karyawan k ON u.karyawan_id = k.id
         WHERE (LOWER(u.username) = LOWER(?) OR LOWER(u.email) = LOWER(?)) LIMIT 1`
      )
      .get(cleanIdentifier, cleanIdentifier) as
      | { id: number; password_hash: string; role: Role; aktif: number; token_version: number; emp_aktif: number }
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

    if (row.aktif !== 1 || row.emp_aktif !== 1) {
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
    const list = getWorkforceToday(db, kantorId, bidangId);
    res.json({
      tanggal: getWibDateString(),
      totalBekerja: list.filter((w) => w.isWorkingToday).length,
      totalHadirSelesai: list.filter((w) => w.operationalStatus === 'HADIR').length,
      items: list,
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
         WHERE k.aktif = 1`
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
      SELECT s.*, k.nik, k.nama_lengkap, k.jabatan, k.kantor_id, k.bidang_id, k.foto_profil_updated_at,
             kt.nama as kantor_nama, kt.alamat as kantor_alamat,
             b.nama as bidang_nama,
             COALESCE(u.role, 'KARYAWAN') as role
      FROM absensi_sesi s
      JOIN karyawan k ON s.karyawan_id = k.id
      JOIN kantor kt ON k.kantor_id = kt.id
      JOIN bidang_kerja b ON k.bidang_id = b.id
      LEFT JOIN pengguna u ON u.karyawan_id = k.id AND u.aktif = 1
      WHERE k.aktif = 1
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

  // 4. Employee Today Status & Session Check-in
  app.get('/api/v1/attendance/today', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const emp = getKaryawanById(req.authUser!.karyawan_id);
    if (!emp) {
      res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
      return;
    }
    const today = getWibDateString();
    const resolved = resolveDayForEmployee(db, emp, today);
    const pendingRequests = db
      .prepare(
        `SELECT * FROM pengajuan WHERE karyawan_id = ? AND status = 'PENDING' AND tanggal_mulai <= ? AND tanggal_akhir >= ?`
      )
      .all(emp.id, today, today);

    res.json({
      serverDate: today,
      serverTime: getWibTimeString(),
      serverEpochMs: Date.now(),
      karyawan: emp,
      day: resolved,
      pendingRequestsToday: pendingRequests,
    });
  });

  app.post('/api/v1/attendance/session', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const user = req.authUser!;
    const attLimit = attendanceLimiter.consume(`att:${user.id}`);
    if (!attLimit.allowed) {
      res.setHeader('Retry-After', String(attLimit.retryAfterSec));
      res.status(429).json({
        error: `Terlalu banyak percobaan pengiriman absensi. Coba lagi dalam ${attLimit.retryAfterSec} detik.`,
      });
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

    // Enforce session start time: user can only check in once jam_mulai has started
    const nowMin = parseHmToMinutes(nowTime.slice(0, 5));
    const startMin = parseHmToMinutes(targetSesiConfig.jam_mulai);
    if (nowMin < startMin) {
      res.status(400).json({
        error: `Absensi ${targetSesiConfig.nama} belum dimulai. Sesi ini baru dapat dilakukan mulai pukul ${targetSesiConfig.jam_mulai} WIB (waktu server saat ini ${nowTime.slice(0, 5)} WIB).`,
      });
      return;
    }

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
    const office = db.prepare(`SELECT * FROM kantor WHERE id = ?`).get(emp.kantor_id) as {
      lat: number;
      lng: number;
      radius_meter: number;
      geofence_mode: string;
    };

    const hasValidCoords =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180;

    let jarakMeter: number | null = null;
    let dalamGeofence = 1;
    if (hasValidCoords) {
      jarakMeter = haversineMeters(lat!, lng!, office.lat, office.lng);
      dalamGeofence = jarakMeter <= office.radius_meter ? 1 : 0;
      if (office.geofence_mode === 'TOLAK_LUAR_RADIUS' && dalamGeofence === 0) {
        res.status(400).json({
          error: `Lokasi Anda berjarak ${jarakMeter}m dari kantor (maksimal radius ${office.radius_meter}m).`,
        });
        return;
      }
    } else {
      if (office.geofence_mode === 'TOLAK_LUAR_RADIUS') {
        res.status(400).json({
          error: 'Koordinat GPS valid wajib tersedia untuk kantor dengan mode geofence ketat.',
        });
        return;
      }
      dalamGeofence = 0;
    }

    // Check lateness against session start + tolerance
    const tol = day.policySnapshot.toleransiTerlambatMenit;
    const lateDiff = nowMin - (startMin + tol);
    const isLate = expectedNext === 1 && lateDiff > 0;
    const keterlambatanMenit = isLate ? nowMin - startMin : 0;

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

    try {
      db.exec('BEGIN IMMEDIATE');
      const info = db
        .prepare(
          `INSERT INTO absensi_sesi (
            karyawan_id, tanggal, urutan_sesi, nama_sesi, waktu_server,
            status_ketepatan, keterlambatan_menit, lat, lng, accuracy_meter,
            jarak_kantor_meter, dalam_geofence, ip_address, user_agent,
            tipe_aktivitas, deskripsi_aktivitas, foto_path, foto_checksum,
            policy_snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          ip,
          ua,
          actType,
          cleanDesc || (expectedNext === 1 ? 'Absensi masuk sesi 1' : 'Melanjutkan aktivitas kerja'),
          savedPhotoName,
          fotoChecksum,
          JSON.stringify(day.policySnapshot),
          nowIso
        );

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'ABSENSI',
        aksi: 'CHECKIN_SESI',
        targetEntity: 'absensi_sesi',
        targetId: Number(info.lastInsertRowid),
        karyawanId: emp.id,
        tanggalTerdampak: today,
        after: {
          urutanSesi: expectedNext,
          namaSesi: targetSesiConfig.nama,
          waktuServer: nowIso,
          dalamGeofence: Boolean(dalamGeofence),
          jarakMeter,
          tipeAktivitas: actType,
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
    res.status(201).json({ ok: true, day: updatedDay });
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
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

    let targetEmpId = user.karyawan_id;
    if (req.query.karyawanId && (user.role === 'ADMIN' || user.role === 'SUPERADMIN')) {
      targetEmpId = Number(req.query.karyawanId);
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

    const items = db.prepare(sql).all(...params);
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

    const targetEmpId = user.role === 'ADMIN' && karyawanId ? Number(karyawanId) : user.karyawan_id;
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
    const nextMulai = tanggalMulai || existing.tanggal_mulai;
    const nextAkhir = tanggalAkhir || existing.tanggal_akhir;
    const nextAlasan = (alasan ?? existing.alasan).trim();
    const nextCatatan = (catatan ?? existing.catatan).trim();
    const nowIso = getWibIsoString();

    if (nextAkhir < nextMulai || nextAlasan.length < 3) {
      res.status(400).json({ error: 'Data pembaruan tidak valid.' });
      return;
    }

    db.prepare(
      `UPDATE pengajuan SET tanggal_mulai = ?, tanggal_akhir = ?, alasan = ?, catatan = ?, updated_at = ? WHERE id = ?`
    ).run(nextMulai, nextAkhir, nextAlasan, nextCatatan, nowIso, reqId);

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
    const { decision, alasanKeputusan } = req.body as {
      decision?: 'APPROVED' | 'REJECTED';
      alasanKeputusan?: string;
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
        after: { status: decision },
        alasan: alasanKeputusan.trim(),
      });

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    broadcastWorkforceUpdate('REQUEST_DECIDED');
    res.json({ ok: true });
  });

  // 8. Master Data (Kantor, Bidang, Karyawan)
  app.get('/api/v1/master/offices', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db.prepare(`SELECT * FROM kantor ORDER BY id ASC`).all();
    res.json({ items });
  });

  app.post('/api/v1/master/offices', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { kode, nama, alamat, lat, lng, radius_meter, geofence_mode } = req.body as {
      kode: string;
      nama: string;
      alamat: string;
      lat: number;
      lng: number;
      radius_meter: number;
      geofence_mode: string;
    };
    if (!kode || !nama) {
      res.status(400).json({ error: 'Kode dan nama kantor wajib diisi.' });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO kantor (kode, nama, alamat, lat, lng, radius_meter, geofence_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        kode.trim().toUpperCase(),
        nama.trim(),
        (alamat || '').trim(),
        Number(lat) || -6.2088,
        Number(lng) || 106.8456,
        Number(radius_meter) || 250,
        geofence_mode === 'TOLAK_LUAR_RADIUS' ? 'TOLAK_LUAR_RADIUS' : 'CATAT_DENGAN_FLAG'
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
      after: req.body,
    });
    res.status(201).json({ id: officeId });
  });

  app.put('/api/v1/master/offices/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kantor WHERE id = ?`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Kantor tidak ditemukan.' });
      return;
    }
    const { nama, alamat, lat, lng, radius_meter, geofence_mode } = req.body as {
      nama: string;
      alamat: string;
      lat: number;
      lng: number;
      radius_meter: number;
      geofence_mode: string;
    };
    db.prepare(
      `UPDATE kantor SET nama = ?, alamat = ?, lat = ?, lng = ?, radius_meter = ?, geofence_mode = ? WHERE id = ?`
    ).run(nama, alamat, Number(lat), Number(lng), Number(radius_meter), geofence_mode, id);
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

  app.get('/api/v1/master/bidang', requireRole('KARYAWAN', 'ADMIN', 'SUPERADMIN'), (_req: Request, res: Response) => {
    const items = db.prepare(`SELECT * FROM bidang_kerja ORDER BY id ASC`).all();
    res.json({ items });
  });

  app.post('/api/v1/master/bidang', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const { kode, nama, deskripsi } = req.body as { kode: string; nama: string; deskripsi: string };
    if (!kode || !nama) {
      res.status(400).json({ error: 'Kode dan nama bidang wajib diisi.' });
      return;
    }
    const info = db
      .prepare(`INSERT INTO bidang_kerja (kode, nama, deskripsi) VALUES (?, ?, ?)`)
      .run(kode.trim().toUpperCase(), nama.trim(), (deskripsi || '').trim());
    writeAuditLog(db, {
      actor: req.authUser!,
      req,
      modul: 'MASTER_BIDANG',
      aksi: 'CREATE_BIDANG',
      targetEntity: 'bidang_kerja',
      targetId: Number(info.lastInsertRowid),
      after: { kode, nama, deskripsi },
    });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
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
    const before = db.prepare(`SELECT * FROM karyawan WHERE id = ?`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
      return;
    }
    const { nama_lengkap, no_hp, kantor_id, bidang_id, jabatan, aktif } = req.body as {
      nama_lengkap: string;
      no_hp: string;
      kantor_id: number;
      bidang_id: number;
      jabatan: string;
      aktif: number;
    };
    db.prepare(
      `UPDATE karyawan SET nama_lengkap = ?, no_hp = ?, kantor_id = ?, bidang_id = ?, jabatan = ?, aktif = ? WHERE id = ?`
    ).run(nama_lengkap, no_hp, Number(kantor_id), Number(bidang_id), jabatan, aktif ? 1 : 0, id);
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

  app.post('/api/v1/policies', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Partial<KebijakanAbsensi> & { sesi?: SesiConfig[] };
    if (!body.nama || ![2, 3, 4].includes(Number(body.jumlah_sesi))) {
      res.status(400).json({ error: 'Nama kebijakan dan jumlah sesi (2, 3, atau 4) wajib valid.' });
      return;
    }
    const nowIso = getWibIsoString();
    const today = getWibDateString();

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db
        .prepare(
          `INSERT INTO kebijakan_absensi (
            level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
            toleransi_terlambat_menit, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
            libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
            sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          body.level || 'BIDANG',
          body.level === 'BIDANG' ? Number(body.bidang_id) : null,
          body.level === 'KARYAWAN' ? Number(body.karyawan_id) : null,
          body.nama.trim(),
          Number(body.jumlah_sesi),
          Math.min(Number(body.min_sesi_hadir) || 1, Number(body.jumlah_sesi)),
          Number(body.toleransi_terlambat_menit ?? 15),
          body.wajib_foto_semua_sesi ? 1 : 0,
          body.wajib_aktivitas_sesi_lanjut ? 1 : 0,
          body.libur_dihitung_masuk ? 1 : 0,
          body.off_pengganti_dihitung_masuk ? 1 : 0,
          body.izin_dihitung_masuk ? 1 : 0,
          body.sakit_dihitung_masuk ? 1 : 0,
          body.cuti_dihitung_masuk ? 1 : 0,
          body.berlaku_mulai || today,
          nowIso
        );
      const policyId = Number(info.lastInsertRowid);
      const sesiList = body.sesi && body.sesi.length === Number(body.jumlah_sesi) ? body.sesi : [];
      const stmtSesi = db.prepare(
        `INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      );
      for (let i = 1; i <= Number(body.jumlah_sesi); i++) {
        const s = sesiList[i - 1];
        stmtSesi.run(
          policyId,
          i,
          s?.nama || `Sesi ${i}`,
          s?.jam_mulai || '08:00',
          s?.jam_selesai || '17:00',
          s?.wajib_foto ?? 1,
          s?.wajib_aktivitas ?? (i >= 2 ? 1 : 0)
        );
      }
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'POLICY_SESI',
        aksi: 'CREATE_POLICY',
        targetEntity: 'kebijakan_absensi',
        targetId: policyId,
        karyawanId: body.level === 'KARYAWAN' ? Number(body.karyawan_id) : null,
        after: body,
      });
      db.exec('COMMIT');
      res.status(201).json({ id: policyId });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });

  app.put('/api/v1/policies/:id', requireRole('ADMIN'), (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    const before = db.prepare(`SELECT * FROM kebijakan_absensi WHERE id = ?`).get(id);
    if (!before) {
      res.status(404).json({ error: 'Kebijakan tidak ditemukan.' });
      return;
    }
    const body = req.body as Partial<KebijakanAbsensi> & { sesi?: SesiConfig[] };

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE kebijakan_absensi SET
          nama = ?, jumlah_sesi = ?, min_sesi_hadir = ?, toleransi_terlambat_menit = ?,
          wajib_foto_semua_sesi = ?, wajib_aktivitas_sesi_lanjut = ?,
          libur_dihitung_masuk = ?, off_pengganti_dihitung_masuk = ?,
          izin_dihitung_masuk = ?, sakit_dihitung_masuk = ?, cuti_dihitung_masuk = ?,
          aktif = ?
         WHERE id = ?`
      ).run(
        (body.nama ?? (before as { nama: string }).nama).trim(),
        Number(body.jumlah_sesi),
        Math.min(Number(body.min_sesi_hadir), Number(body.jumlah_sesi)),
        Number(body.toleransi_terlambat_menit ?? 15),
        body.wajib_foto_semua_sesi ? 1 : 0,
        body.wajib_aktivitas_sesi_lanjut ? 1 : 0,
        body.libur_dihitung_masuk ? 1 : 0,
        body.off_pengganti_dihitung_masuk ? 1 : 0,
        body.izin_dihitung_masuk ? 1 : 0,
        body.sakit_dihitung_masuk ? 1 : 0,
        body.cuti_dihitung_masuk ? 1 : 0,
        body.aktif !== undefined ? (body.aktif ? 1 : 0) : 1,
        id
      );

      if (body.sesi && body.sesi.length > 0) {
        db.prepare(`DELETE FROM sesi_absensi WHERE kebijakan_id = ?`).run(id);
        const stmtSesi = db.prepare(
          `INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        );
        for (let i = 0; i < body.sesi.length; i++) {
          const s = body.sesi[i];
          stmtSesi.run(id, i + 1, s.nama, s.jam_mulai, s.jam_selesai, s.wajib_foto ? 1 : 0, s.wajib_aktivitas ? 1 : 0);
        }
      }

      const after = db.prepare(`SELECT * FROM kebijakan_absensi WHERE id = ?`).get(id);
      writeAuditLog(db, {
        actor: req.authUser!,
        req,
        modul: 'POLICY_SESI',
        aksi: 'UPDATE_POLICY',
        targetEntity: 'kebijakan_absensi',
        targetId: id,
        before,
        after,
      });
      db.exec('COMMIT');
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
    db.prepare(
      `UPDATE kalender_kerja SET status_hari = ?, jumlah_sesi_khusus = ?, keterangan = ? WHERE id = ?`
    ).run(status_hari, status_hari === 'HARI_KERJA' && jumlah_sesi_khusus ? Number(jumlah_sesi_khusus) : null, keterangan || '', id);
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

    const nowIso = getWibIsoString();
    const sessions = [2, 3, 4].includes(Number(jumlah_sesi)) ? Number(jumlah_sesi) : 3;
    const minS = Math.min(Number(min_sesi_hadir) || 2, sessions);
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

    let sql = `SELECT id FROM karyawan WHERE aktif = 1`;
    const params: number[] = [];
    if (kantorId) {
      sql += ` AND kantor_id = ?`;
      params.push(kantorId);
    }
    if (bidangId) {
      sql += ` AND bidang_id = ?`;
      params.push(bidangId);
    }
    sql += ` ORDER BY nik ASC`;

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
         WHERE k.aktif = 1
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

    const empRows = db.prepare(`SELECT id FROM karyawan WHERE aktif = 1 ORDER BY nik ASC`).all() as { id: number }[];
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

  // Superadmin Overview Metrics
  app.get('/api/v1/superadmin/overview', requireRole('SUPERADMIN', 'ADMIN'), (req: Request, res: Response) => {
    const bulan =
      typeof req.query.bulan === 'string' && /^\d{4}-\d{2}$/.test(req.query.bulan)
        ? req.query.bulan
        : getWibDateString().slice(0, 7);

    const empRows = db.prepare(`SELECT id FROM karyawan WHERE aktif = 1`).all() as { id: number }[];
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

  // 13. System Settings & Custom Login Logo
  const DEFAULT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <rect width="128" height="128" rx="28" fill="#1D4ED8"/>
  <rect x="8" y="8" width="112" height="112" rx="22" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
  <path d="M36 38H68C79.0457 38 88 46.9543 88 58C88 64.262 85.121 69.852 80.614 73.516C86.782 76.827 91 83.334 91 90.8C91 101.404 82.404 110 71.8 110H36V38Z" fill="white" fill-opacity="0.14"/>
  <path d="M40 36H68C77.941 36 86 44.059 86 54C86 59.566 83.474 64.544 79.5 67.85C84.622 71.033 88 76.716 88 83.2C88 93.141 79.941 101.2 70 101.2H40V36Z" stroke="white" stroke-width="7" stroke-linejoin="round"/>
  <path d="M40 68H69" stroke="#93C5FD" stroke-width="7" stroke-linecap="round"/>
  <circle cx="94" cy="34" r="10" fill="#10B981" stroke="#0B1528" stroke-width="4"/>
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
    res.setHeader('Cache-Control', 'no-cache');
    res.send(DEFAULT_LOGO_SVG);
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
    };

    const namaAplikasi = (body.nama_aplikasi ?? String(before.nama_aplikasi)).trim();
    if (!namaAplikasi) {
      res.status(400).json({ error: 'Nama aplikasi tidak boleh kosong.' });
      return;
    }

    let nextLogoPath = before.logo_path ? String(before.logo_path) : null;
    let nextLogoUpdatedAt = before.logo_updated_at ? String(before.logo_updated_at) : null;
    const nowIso = getWibIsoString();
    const assetsDir = getAssetsDir();

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
      alasan: body.logoBase64
        ? 'Pembaruan pengaturan sistem dan logo aplikasi oleh Superadmin'
        : body.resetLogo
        ? 'Reset logo aplikasi ke default oleh Superadmin'
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
        db.prepare(`UPDATE karyawan SET nama_lengkap = ?, email = ?, no_hp = ? WHERE id = ?`).run(
          cleanName,
          cleanEmail,
          cleanHp,
          user.karyawan_id
        );
        db.prepare(`UPDATE pengguna SET email = ? WHERE id = ?`).run(cleanEmail, user.id);

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
      res.send(buildDefaultAvatarSvg(row.nama_lengkap, row.role || 'KARYAWAN'));
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
      res.send(buildDefaultAvatarSvg(row.nama_lengkap, row.role_diminta));
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

      const existing = db
        .prepare(`SELECT foto_profil_path FROM karyawan WHERE id = ?`)
        .get(user.karyawan_id) as { foto_profil_path: string | null } | undefined;

      const nowIso = getWibIsoString();
      let nextPath: string | null = existing?.foto_profil_path ?? null;

      if (removePhoto) {
        deleteAvatarFile(existing?.foto_profil_path);
        nextPath = null;
      } else if (fotoBase64) {
        let saved: string;
        try {
          saved = saveAvatarBase64(fotoBase64, `emp_${user.karyawan_id}`);
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
      ).run(nextPath, nowIso, user.karyawan_id);

      writeAuditLog(db, {
        actor: user,
        req,
        modul: 'PROFIL_AKUN',
        aksi: removePhoto ? 'REMOVE_PROFILE_PHOTO' : 'UPDATE_PROFILE_PHOTO',
        targetEntity: 'karyawan',
        targetId: user.karyawan_id,
        karyawanId: user.karyawan_id,
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
                k.nama_lengkap, k.no_hp, k.jabatan, u.role, k.kantor_id, kt.nama as kantor_nama,
                k.bidang_id, b.nama as bidang_nama, k.tanggal_masuk,
                u.aktif as user_aktif, k.aktif as karyawan_aktif,
                CASE WHEN k.foto_profil_path IS NOT NULL THEN 1 ELSE 0 END as has_foto_profil,
                k.foto_profil_updated_at, u.created_at
         FROM pengguna u
         JOIN karyawan k ON u.karyawan_id = k.id
         JOIN kantor kt ON k.kantor_id = kt.id
         JOIN bidang_kerja b ON k.bidang_id = b.id
         ORDER BY CASE u.role WHEN 'SUPERADMIN' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END, k.nik ASC`
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
      const finalNik = (nik || '').trim().toUpperCase() || generateNextNik();
      const finalRole: Role =
        role === 'SUPERADMIN' || role === 'ADMIN' || role === 'KARYAWAN' ? role : 'KARYAWAN';

      if (!cleanName || !cleanUser || !cleanEmail || !password || password.length < 6) {
        res.status(400).json({
          error: 'Nama lengkap, username, email, dan kata sandi (min. 6 karakter) wajib diisi.',
        });
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
                  k.id as karyawan_id, k.nik, k.nama_lengkap, k.no_hp, k.jabatan,
                  k.kantor_id, k.bidang_id, k.aktif as karyawan_aktif, k.foto_profil_path
           FROM pengguna u
           JOIN karyawan k ON u.karyawan_id = k.id
           WHERE u.id = ?`
        )
        .get(targetUserId) as
        | {
            user_id: number;
            username: string;
            email: string;
            role: Role;
            user_aktif: number;
            karyawan_id: number;
            nik: string;
            nama_lengkap: string;
            no_hp: string;
            jabatan: string;
            kantor_id: number;
            bidang_id: number;
            karyawan_aktif: number;
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

      const nextRole: Role =
        body.role === 'SUPERADMIN' || body.role === 'ADMIN' || body.role === 'KARYAWAN'
          ? body.role
          : existing.role;
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
           SET username = ?, email = ?, role = ?, aktif = ?,
               token_version = CASE WHEN ? = 1 THEN COALESCE(token_version, 1) + 1 ELSE COALESCE(token_version, 1) END
           WHERE id = ?`
        ).run(cleanUser, cleanEmail, nextRole, nextAktif, shouldBumpTokenVersion ? 1 : 0, targetUserId);

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
        .get(targetUserId) as { id: number; username: string; karyawan_id: number } | undefined;
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
