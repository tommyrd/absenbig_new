import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';

// Isolated temporary workspace BEFORE loading server modules so live ./data and ./backups remain untouched
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bignet_prod_suite_'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'bignet_absensi_prod_test.db');
const tempBackupDir = path.join(tempRoot, 'backups');

process.env.DATA_DIR = tempDataDir;
process.env.DB_PATH = tempDbPath;
process.env.BACKUP_DIR = tempBackupDir;
process.env.SEED_DEMO_DATA = 'false';
process.env.ALLOW_DEMO_LOGIN = 'false';
process.env.AUTH_SECRET = 'bignet_test_secret_key_for_production_hardening_suite_64bytes';
process.env.TZ = 'Asia/Jakarta';

const { closeDb, getDb } = await import('../src/server/db.ts');
const { getAppliedMigrations, runMigrations } = await import('../src/server/db/migrations.ts');
const { seedProductionBaseline } = await import('../src/server/db/seed.ts');
const { signToken, verifyPassword, encryptMfaSecret, generateTotpSecret, generateTotpCode } = await import('../src/server/auth.ts');
const { registerApiRoutes } = await import('../src/server/routes.ts');
const {
  attendanceLimiter,
  loginFailLimiter,
  loginIpLimiter,
  passwordLimiter,
  registerLimiter,
} = await import('../src/server/security.ts');
const { getWibDateString } = await import('../src/server/time.ts');
const { getSessionWindowState } = await import('../src/shared/session-window.ts');
const { runBackup } = await import('../scripts/backup/backup.ts');
const { runRestore } = await import('../scripts/restore/restore.ts');

const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_PNG_BASE64 = 'data:image/png;base64,Tm90QVJlYWxQTkdGaWxl';
const XSS_SVG_BASE64 = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
).toString('base64')}`;
const CLEAN_SVG_BASE64 = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1d4ed8"/></svg>'
).toString('base64')}`;

let server: http.Server;
let baseUrl = '';
const superPassword = 'SuperAdmin#Prod2026!';
let superToken = '';
let adminToken = '';
let adminMfaSecret = '';
let adminMfaRecoveryCode = '';
let superadminUsedTotpCode = '';
let karyawanToken = '';
let adminUserId = 0;
let karyawanUserId = 0;
let karyawanId = 0;
let strictOfficeId = 0;
let savedAttendanceSessionId = 0;

function resetLimiters() {
  loginIpLimiter.clear();
  loginFailLimiter.clear();
  registerLimiter.clear();
  passwordLimiter.clear();
  attendanceLimiter.clear();
}

function cookieHeaderFromResponse(headers: Headers): string {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie') || ''];
  return setCookies.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
}

function csrfFromCookieHeader(cookieHeader: string): string {
  const match = cookieHeader.match(/(?:^|;\s*)bignet_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function apiJson<T = Record<string, unknown>>(
  pathname: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; headers: Headers; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Cookie = options.token;
    const csrf = csrfFromCookieHeader(options.token);
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.Origin = baseUrl;

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  // A synthetic test-only handle keeps the existing test cases readable.
  // The production API never returns an access token to JavaScript.
  const cookieHeader = cookieHeaderFromResponse(res.headers);
  if (cookieHeader && data && typeof data === 'object') {
    (data as Record<string, unknown>).token = cookieHeader;
  }
  return { status: res.status, headers: res.headers, data: data as T };
}

before(async () => {
  const db = getDb();
  const seedResult = seedProductionBaseline(db, {
    superadminUsername: 'owner_prod',
    superadminEmail: 'owner@bignet.co.id',
    superadminName: 'Owner PT BIGNET',
    superadminPassword: superPassword,
  });
  assert.equal(seedResult.seeded, true);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  registerApiRoutes(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('1. Migrations are idempotent and production baseline enforces zero demo accounts', () => {
  const db = getDb();
  const applied = getAppliedMigrations(db);
  assert.equal(applied.length, 15);
  assert.deepEqual(
    applied.map((m) => m.version),
    ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015']
  );

  const attendanceColumns = db
    .prepare('PRAGMA table_info(absensi_sesi)')
    .all() as { name: string }[];
  assert.ok(attendanceColumns.some((column) => column.name === 'lokasi_alamat'));

  const locationCache = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'absensi_lokasi_cache'")
    .get() as { name: string } | undefined;
  assert.equal(locationCache?.name, 'absensi_lokasi_cache');

  const checkinOverrideTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'override_akses_absensi'")
    .get() as { name: string } | undefined;
  assert.equal(checkinOverrideTable?.name, 'override_akses_absensi');

  const settingsColumns = db
    .prepare('PRAGMA table_info(pengaturan_aplikasi)')
    .all() as { name: string }[];
  assert.ok(settingsColumns.some((column) => column.name === 'favicon_path'));
  assert.ok(settingsColumns.some((column) => column.name === 'favicon_updated_at'));
  const employeeColumns = db.prepare('PRAGMA table_info(karyawan)').all() as { name: string }[];
  const userColumns = db.prepare('PRAGMA table_info(pengguna)').all() as { name: string }[];
  assert.ok(userColumns.some((column) => column.name === 'foto_profil_path'));
  assert.ok(userColumns.some((column) => column.name === 'foto_profil_updated_at'));
  assert.ok(userColumns.some((column) => column.name === 'mfa_secret_enc'));
  assert.ok(userColumns.some((column) => column.name === 'mfa_enabled'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_challenges'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mfa_recovery_codes'").get());
  assert.ok(employeeColumns.some((column) => column.name === 'is_system_archive'));
  const roleLinkTriggers = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (
      'trg_pengguna_role_link_insert', 'trg_pengguna_role_link_update'
    )`
  ).all() as { name: string }[];
  assert.equal(roleLinkTriggers.length, 2);

  // Re-running migrations should apply 0 new steps
  const rerun = runMigrations(db);
  assert.deepEqual(rerun, []);

  // Only 1 superadmin account exists and demo login is disabled
  const users = db.prepare('SELECT username, password_hash, role, karyawan_id FROM pengguna').all() as {
    username: string;
    password_hash: string;
    role: string;
    karyawan_id: number | null;
  }[];
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'owner_prod');
  assert.equal(users[0].role, 'SUPERADMIN');
  assert.equal(users[0].karyawan_id, null);
  assert.equal(
    (db.prepare('SELECT COUNT(*) as c FROM karyawan').get() as { c: number }).c,
    0,
    'A production Superadmin must not have an employee profile'
  );

  const productionOfficeModes = db
    .prepare(`SELECT geofence_mode FROM kantor`)
    .all() as { geofence_mode: string }[];
  assert.ok(productionOfficeModes.length > 0);
  assert.ok(productionOfficeModes.every((office) => office.geofence_mode === 'TOLAK_LUAR_RADIUS'));

  assert.ok(users[0].password_hash.startsWith('scrypt-v1:'));
  assert.ok(!users[0].password_hash.includes(superPassword));

  const settings = db.prepare('SELECT izin_demo_login FROM pengaturan_aplikasi WHERE id = 1').get() as {
    izin_demo_login: number;
  };
  assert.equal(settings.izin_demo_login, 0);
});

test('2. Health check and initial Superadmin authentication work with HttpOnly cookies', async () => {
  resetLimiters();
  const health = await apiJson<{ status: string; timezone: string }>('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');
  assert.equal(health.data.timezone, 'Asia/Jakarta');

  const wrongLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: 'WrongPassword123' },
  });
  assert.equal(wrongLogin.status, 401);

  const ownerIdForMfa = (getDb().prepare(`SELECT id FROM pengguna WHERE username = 'owner_prod'`).get() as { id: number }).id;
  const ownerMfaSecret = generateTotpSecret();
  getDb().prepare(`
    UPDATE pengguna SET mfa_secret_enc = ?, mfa_enabled = 1, mfa_enrolled_at = ?
    WHERE id = ?
  `).run(encryptMfaSecret(ownerMfaSecret), new Date().toISOString(), ownerIdForMfa);

  const okLogin = await apiJson<{ challengeId: string; mfaRequired: boolean; mfaSetupRequired: boolean }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: superPassword },
  });
  assert.equal(okLogin.status, 200);
  assert.equal(okLogin.data.mfaRequired, true);
  assert.equal(okLogin.data.mfaSetupRequired, false);
  superadminUsedTotpCode = generateTotpCode(ownerMfaSecret);
  const mfaLogin = await apiJson<{ token: string; user: { role: string } }>('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challengeId: okLogin.data.challengeId, code: superadminUsedTotpCode },
  });
  assert.equal(mfaLogin.status, 200);
  assert.equal(mfaLogin.data.user.role, 'SUPERADMIN');
  assert.ok(mfaLogin.data.token.includes('bignet_token='));
  const setCookie = mfaLogin.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /bignet_csrf=/i);
  superToken = mfaLogin.data.token;

  // Cookie-only authentication: Bearer headers and URL query tokens are not accepted.
  const accessToken = decodeURIComponent(superToken.split(';').map((part) => part.trim()).find((part) => part.startsWith('bignet_token='))?.slice('bignet_token='.length) || '');
  const bearerOnly = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(bearerOnly.status, 401);

  // State-changing requests require the CSRF cookie/header pair.
  const csrfMissing = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { Cookie: superToken, Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(csrfMissing.status, 403);

  // A TOTP time-step may only be consumed once, even across a new login challenge.
  const replayCode = superadminUsedTotpCode;
  const replayChallenge = await apiJson<{ challengeId: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: superPassword },
  });
  assert.equal(replayChallenge.status, 200);
  const replayAttempt = await apiJson('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challengeId: replayChallenge.data.challengeId, code: replayCode },
  });
  assert.equal(replayAttempt.status, 401);

  // The standalone owner account can upload, display, and reset its own profile photo without an employee profile.
  const owner = getDb()
    .prepare(`SELECT id, karyawan_id FROM pengguna WHERE username = 'owner_prod'`)
    .get() as { id: number; karyawan_id: number | null };
  assert.equal(owner.karyawan_id, null);
  const ownerPhoto = await apiJson<{ user: { karyawan_id: number | null; has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: superToken, body: { fotoBase64: SAMPLE_PNG_BASE64 } }
  );
  assert.equal(ownerPhoto.status, 200);
  assert.equal(ownerPhoto.data.user.karyawan_id, null);
  assert.equal(ownerPhoto.data.user.has_foto_profil, true);

  const avatarFetch = await fetch(`${baseUrl}/api/v1/avatars/pengguna/${owner.id}`, {
    headers: { Cookie: superToken },
  });
  assert.equal(avatarFetch.status, 200);
  assert.equal(avatarFetch.headers.get('content-type'), 'image/png');

  const resetOwnerPhoto = await apiJson<{ user: { has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: superToken, body: { removePhoto: true } }
  );
  assert.equal(resetOwnerPhoto.status, 200);
  assert.equal(resetOwnerPhoto.data.user.has_foto_profil, false);
});

test('3. Brute-force protection locks repeated failed login attempts with 429 and Retry-After', async () => {
  resetLimiters();
  for (let i = 0; i < 8; i++) {
    const r = await apiJson('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: 'owner_prod', password: `wrong_${i}` },
    });
    assert.equal(r.status, 401);
  }
  const locked = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: superPassword },
  });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) >= 1);
  resetLimiters();
});

test('4. Superadmin can create Admin & Karyawan accounts (explicit password enforced), registration ACC works', async () => {
  resetLimiters();

  // Superadmin creating employee without >= 6 char password fails
  const badCreate = await apiJson('/api/v1/master/employees', {
    method: 'POST',
    token: superToken,
    body: {
      nik: 'BG-101',
      nama_lengkap: 'No Pass',
      email: 'nopass@bignet.co.id',
      username: 'nopass',
      kantor_id: 1,
      bidang_id: 1,
    },
  });
  assert.equal(badCreate.status, 400);

  // Create Admin account directly via superadmin accounts API
  const adminCreate = await apiJson<{ ok: boolean; userId: number; karyawanId: number | null; nik: string | null }>(
    '/api/v1/superadmin/accounts',
    {
      method: 'POST',
      token: superToken,
      body: {
        nik: 'BG-010',
        nama_lengkap: 'Admin Operasional Test',
        username: 'admin_prod',
        email: 'admin.prod@bignet.co.id',
        password: 'AdminPassword!1',
        role: 'ADMIN',
        kantor_id: 1,
        bidang_id: 3,
        jabatan: 'HR Admin',
      },
    }
  );
  assert.equal(adminCreate.status, 201);
  adminUserId = adminCreate.data.userId;
  assert.equal(adminCreate.data.karyawanId, null);
  assert.equal(adminCreate.data.nik, null);
  const standaloneAdmin = getDb()
    .prepare(`SELECT role, karyawan_id, nama_tampilan FROM pengguna WHERE id = ?`)
    .get(adminUserId) as { role: string; karyawan_id: number | null; nama_tampilan: string };
  assert.equal(standaloneAdmin.role, 'ADMIN');
  assert.equal(standaloneAdmin.karyawan_id, null);
  assert.equal(standaloneAdmin.nama_tampilan, 'Admin Operasional Test');

  const adminLogin = await apiJson<{ challengeId: string; mfaRequired: boolean; mfaSetupRequired: boolean }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.data.mfaSetupRequired, true);
  const adminMfaSetup = await apiJson<{ secret: string }>('/api/v1/auth/mfa/setup', {
    method: 'POST',
    body: { challengeId: adminLogin.data.challengeId },
  });
  assert.equal(adminMfaSetup.status, 200);
  adminMfaSecret = adminMfaSetup.data.secret;
  const adminMfaConfirm = await apiJson<{ token: string; user: { role: string }; recoveryCodes: string[] }>(
    '/api/v1/auth/mfa/setup/confirm',
    {
      method: 'POST',
      body: { challengeId: adminLogin.data.challengeId, code: generateTotpCode(adminMfaSetup.data.secret) },
    }
  );
  assert.equal(adminMfaConfirm.status, 200);
  assert.equal(adminMfaConfirm.data.user.role, 'ADMIN');
  assert.equal(adminMfaConfirm.data.recoveryCodes.length, 10);
  adminMfaRecoveryCode = adminMfaConfirm.data.recoveryCodes[0];
  adminToken = adminMfaConfirm.data.token;

  // Admin profile and avatar are stored on the standalone pengguna record.
  const adminPhoto = await apiJson<{ user: { karyawan_id: number | null; has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: adminToken, body: { fotoBase64: SAMPLE_PNG_BASE64 } }
  );
  assert.equal(adminPhoto.status, 200);
  assert.equal(adminPhoto.data.user.karyawan_id, null);
  assert.equal(adminPhoto.data.user.has_foto_profil, true);
  const adminAvatar = await fetch(`${baseUrl}/api/v1/avatars/pengguna/${adminUserId}`, {
    headers: { Cookie: adminToken },
  });
  assert.equal(adminAvatar.status, 200);
  assert.equal(adminAvatar.headers.get('content-type'), 'image/png');

  // Registration with spoofed magic-byte PNG must fail
  const fakeReg = await apiJson('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Spoof User',
      username: 'spoofuser',
      email: 'spoof@bignet.co.id',
      password: 'Password123456!',
      role_diminta: 'KARYAWAN',
      kantor_id: 1,
      bidang_id: 1,
      fotoBase64: FAKE_PNG_BASE64,
    },
  });
  assert.equal(fakeReg.status, 400);

  // Valid technician registration -> PENDING -> login blocked until ACC Superadmin
  const validReg = await apiJson<{ ok: boolean; id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Teknisi Lapangan Satu',
      username: 'teknisi_1',
      email: 'teknisi1@bignet.co.id',
      no_hp: '08120000111',
      password: 'TeknisiPassword!1',
      role_diminta: 'KARYAWAN',
      kantor_id: 1,
      bidang_id: 1,
      fotoBase64: SAMPLE_PNG_BASE64,
    },
  });
  assert.equal(validReg.status, 201);

  const pendingLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!1' },
  });
  assert.equal(pendingLogin.status, 403);

  // Admin cannot approve registrations
  const adminAccTry = await apiJson(`/api/v1/superadmin/registrations/${validReg.data.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(adminAccTry.status, 403);

  // Superadmin approves registration
  const accOk = await apiJson<{ ok: boolean; userId: number; karyawanId: number }>(
    `/api/v1/superadmin/registrations/${validReg.data.id}/approve`,
    {
      method: 'POST',
      token: superToken,
      body: { alasan_keputusan: 'ACC validasi data teknisi' },
    }
  );
  assert.equal(accOk.status, 200);
  karyawanUserId = accOk.data.userId;
  karyawanId = accOk.data.karyawanId;

  const techLogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!1' },
  });
  assert.equal(techLogin.status, 200);
  karyawanToken = techLogin.data.token;

  // Reject path blocks login with rejection reason
  const rejectCandidate = await apiJson<{ id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Calon Ditolak',
      username: 'ditolak1',
      email: 'ditolak1@bignet.co.id',
      password: 'Password123456!',
      role_diminta: 'ADMIN',
      kantor_id: 1,
      bidang_id: 3,
    },
  });
  assert.equal(rejectCandidate.status, 201);
  const rejectRes = await apiJson(
    `/api/v1/superadmin/registrations/${rejectCandidate.data.id}/reject`,
    {
      method: 'POST',
      token: superToken,
      body: { alasan_keputusan: 'Bukan karyawan internal PT BIGNET' },
    }
  );
  assert.equal(rejectRes.status, 200);
  const rejectedLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'ditolak1', password: 'Password123456!' },
  });
  assert.equal(rejectedLogin.status, 403);

  // Admin registration does not require employee placement fields and approval creates no NIK/profile.
  const standaloneAdminReg = await apiJson<{ id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Admin Kedua',
      username: 'admin_kedua',
      email: 'admin.kedua@bignet.co.id',
      no_hp: '08120000222',
      password: 'AdminKeduaPassword!1',
      role_diminta: 'ADMIN',
    },
  });
  assert.equal(standaloneAdminReg.status, 201);
  const approvedAdmin = await apiJson<{
    ok: boolean; userId: number; karyawanId: number | null; nik: string | null; role: string;
  }>(`/api/v1/superadmin/registrations/${standaloneAdminReg.data.id}/approve`, {
    method: 'POST',
    token: superToken,
    body: {},
  });
  assert.equal(approvedAdmin.status, 200);
  assert.equal(approvedAdmin.data.role, 'ADMIN');
  assert.equal(approvedAdmin.data.karyawanId, null);
  assert.equal(approvedAdmin.data.nik, null);
  const approvedAdminDb = getDb()
    .prepare(`SELECT role, karyawan_id FROM pengguna WHERE id = ?`)
    .get(approvedAdmin.data.userId) as { role: string; karyawan_id: number | null };
  assert.equal(approvedAdminDb.role, 'ADMIN');
  assert.equal(approvedAdminDb.karyawan_id, null);
});

test('5. Authorization boundaries, query-token restriction, logout jti & token_version revocation', async () => {
  // Query token rejected on JSON API endpoints, accepted only on media/SSE endpoints
  const qMe = await apiJson(`/api/v1/auth/me?token=${encodeURIComponent(karyawanToken)}`);
  assert.equal(qMe.status, 401);

  const qAvatar = await fetch(`${baseUrl}/api/v1/avatars/karyawan/${karyawanId}?token=${encodeURIComponent(karyawanToken)}`);
  assert.equal(qAvatar.status, 401);
  assert.equal(qAvatar.headers.get('x-content-type-options'), 'nosniff');

  // Role isolation checks
  assert.equal((await apiJson('/api/v1/settings', { token: karyawanToken })).status, 403);
  assert.equal((await apiJson('/api/v1/settings', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/superadmin/accounts', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/attendance/today', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/requests', {
    method: 'POST',
    token: adminToken,
    body: { jenis: 'IZIN', tanggalMulai: '2026-04-10', tanggalAkhir: '2026-04-10', alasan: 'Uji batas role' },
  })).status, 403);
  assert.equal(
    (
      await apiJson('/api/v1/payroll/override', {
        method: 'POST',
        token: karyawanToken,
        body: { karyawanId, tanggal: getWibDateString(), hasilOverride: 'DIHITUNG_MASUK', alasan: 'Test' },
      })
    ).status,
    403
  );

  // Operational Admin can manage the work-field master and reassign a technician.
  const beforeFieldEdit = getDb().prepare(
    `SELECT nama_lengkap, no_hp, kantor_id, bidang_id, jabatan, aktif
     FROM karyawan WHERE id = ?`
  ).get(karyawanId) as {
    nama_lengkap: string;
    no_hp: string;
    kantor_id: number;
    bidang_id: number;
    jabatan: string;
    aktif: number;
  };
  const createField = await apiJson<{ id: number }>('/api/v1/master/bidang', {
    method: 'POST',
    token: adminToken,
    body: { kode: 'QA_TMP', nama: 'Bidang QA Sementara', deskripsi: 'Bidang untuk uji perubahan Admin' },
  });
  assert.equal(createField.status, 201);
  const fieldListBeforeUse = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number; jumlah_kebijakan: number; jumlah_pendaftaran: number }>;
  }>('/api/v1/master/bidang', { token: adminToken });
  const newFieldBeforeUse = fieldListBeforeUse.data.items.find((field) => field.id === createField.data.id);
  assert.ok(newFieldBeforeUse);
  assert.equal(newFieldBeforeUse.can_delete, true);
  const editField = await apiJson(`/api/v1/master/bidang/${createField.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { kode: 'QA_OPS', nama: 'Operasional QA', deskripsi: 'Diperbarui oleh Admin operasional' },
  });
  assert.equal(editField.status, 200);
  const savedField = getDb().prepare(
    `SELECT kode, nama, deskripsi FROM bidang_kerja WHERE id = ?`
  ).get(createField.data.id) as { kode: string; nama: string; deskripsi: string };
  assert.equal(savedField.kode, 'QA_OPS');
  assert.equal(savedField.nama, 'Operasional QA');
  assert.equal(savedField.deskripsi, 'Diperbarui oleh Admin operasional');

  const assignField = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...beforeFieldEdit, bidang_id: createField.data.id },
  });
  assert.equal(assignField.status, 200);
  const reassigned = getDb().prepare(
    `SELECT bidang_id FROM karyawan WHERE id = ?`
  ).get(karyawanId) as { bidang_id: number };
  assert.equal(reassigned.bidang_id, createField.data.id);
  const fieldListWhileUsed = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number }>;
  }>('/api/v1/master/bidang', { token: adminToken });
  const usedField = fieldListWhileUsed.data.items.find((field) => field.id === createField.data.id);
  assert.ok(usedField);
  assert.equal(usedField.can_delete, false);
  assert.equal(usedField.jumlah_karyawan, 1);

  // A field assigned to an employee must be protected from deletion.
  const fieldDeleteBlocked = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(fieldDeleteBlocked.status, 409);

  const restoreField = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: beforeFieldEdit,
  });
  assert.equal(restoreField.status, 200);

  const employeeCannotEditField = await apiJson(`/api/v1/master/bidang/${createField.data.id}`, {
    method: 'PUT',
    token: karyawanToken,
    body: { kode: 'NO_ACCESS', nama: 'Tidak boleh', deskripsi: '' },
  });
  assert.equal(employeeCannotEditField.status, 403);

  // Once every reference is gone, the unused field can be deleted.
  const employeeCannotDeleteField = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: karyawanToken }
  );
  assert.equal(employeeCannotDeleteField.status, 403);

  const fieldDeleteAllowed = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(fieldDeleteAllowed.status, 200);
  assert.equal(
    getDb().prepare(`SELECT id FROM bidang_kerja WHERE id = ?`).get(createField.data.id),
    undefined
  );

  // New offices contain only their generated weekly-calendar child rows and
  // should be deletable until employees, registrations, holidays or payroll use them.
  const createOffice = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'QA-DEL',
      nama: 'Kantor Uji Hapus',
      alamat: 'Alamat Uji',
      lat: -0.0263,
      lng: 109.3425,
      radius_meter: 250,
    },
  });
  assert.equal(createOffice.status, 201);

  const officeList = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_kalender: number }>;
  }>('/api/v1/master/offices', { token: adminToken });
  const newOffice = officeList.data.items.find((office) => office.id === createOffice.data.id);
  assert.ok(newOffice);
  assert.equal(newOffice.can_delete, true);
  assert.equal(newOffice.jumlah_kalender, 7);

  const assignOffice = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...beforeFieldEdit, kantor_id: createOffice.data.id },
  });
  assert.equal(assignOffice.status, 200);
  const officeListWhileUsed = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number }>;
  }>('/api/v1/master/offices', { token: adminToken });
  const usedOffice = officeListWhileUsed.data.items.find((office) => office.id === createOffice.data.id);
  assert.ok(usedOffice);
  assert.equal(usedOffice.can_delete, false);
  assert.equal(usedOffice.jumlah_karyawan, 1);

  const officeDeleteBlocked = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(officeDeleteBlocked.status, 409);

  const restoreOffice = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: beforeFieldEdit,
  });
  assert.equal(restoreOffice.status, 200);

  const employeeCannotDeleteOffice = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: karyawanToken }
  );
  assert.equal(employeeCannotDeleteOffice.status, 403);

  // Employee-facing master lists must not expose Admin-only usage counters.
  const employeeOfficeList = await apiJson<{ items: Array<Record<string, unknown>> }>(
    '/api/v1/master/offices',
    { token: karyawanToken }
  );
  const employeeFieldList = await apiJson<{ items: Array<Record<string, unknown>> }>(
    '/api/v1/master/bidang',
    { token: karyawanToken }
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(employeeOfficeList.data.items[0] || {}, 'can_delete'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(employeeFieldList.data.items[0] || {}, 'can_delete'),
    false
  );

  const officeDeleteAllowed = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(officeDeleteAllowed.status, 200);
  assert.equal(
    getDb().prepare(`SELECT id FROM kantor WHERE id = ?`).get(createOffice.data.id),
    undefined
  );
  assert.equal(
    (getDb().prepare(`SELECT COUNT(*) AS total FROM kalender_kerja WHERE kantor_id = ?`).get(createOffice.data.id) as { total: number }).total,
    0
  );

  // Expired token rejected
  const expiredToken = signToken({ userId: karyawanUserId, role: 'KARYAWAN', exp: Date.now() - 5000 });
  assert.equal((await apiJson('/api/v1/auth/me', { token: expiredToken })).status, 401);

  // Password change rotates token_version & invalidates old token while new token works
  const oldTechToken = karyawanToken;
  const pwChange = await apiJson<{ ok: boolean; token: string }>('/api/v1/profile/password', {
    method: 'PUT',
    token: oldTechToken,
    body: { currentPassword: 'TeknisiPassword!1', newPassword: 'TeknisiPassword!2' },
  });
  assert.equal(pwChange.status, 200);
  assert.ok(pwChange.data.token);
  karyawanToken = pwChange.data.token;

  // Old token is now rejected immediately
  assert.equal((await apiJson('/api/v1/auth/me', { token: oldTechToken })).status, 401);
  assert.equal((await apiJson('/api/v1/auth/me', { token: karyawanToken })).status, 200);

  // Logout revokes current JTI immediately
  const logoutRes = await apiJson('/api/v1/auth/logout', { method: 'POST', token: karyawanToken });
  assert.equal(logoutRes.status, 200);
  assert.equal((await apiJson('/api/v1/auth/me', { token: karyawanToken })).status, 401);

  // Re-login cleanly for subsequent tests
  const relogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!2' },
  });
  assert.equal(relogin.status, 200);
  karyawanToken = relogin.data.token;

  // Inactive account cannot access /auth/me or login
  const disableAdmin = await apiJson(`/api/v1/superadmin/accounts/${adminUserId}`, {
    method: 'PUT',
    token: superToken,
    body: { aktif: false },
  });
  assert.equal(disableAdmin.status, 200);
  assert.equal((await apiJson('/api/v1/auth/me', { token: adminToken })).status, 401);
  const blockedLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  assert.equal(blockedLogin.status, 403);

  // Re-enable admin and get fresh token
  await apiJson(`/api/v1/superadmin/accounts/${adminUserId}`, {
    method: 'PUT',
    token: superToken,
    body: { aktif: true },
  });
  const adminRelogin = await apiJson<{ challengeId: string; mfaSetupRequired: boolean }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  assert.equal(adminRelogin.status, 200);
  assert.equal(adminRelogin.data.mfaSetupRequired, false);
  const adminReloginVerified = await apiJson<{ token: string }>('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challengeId: adminRelogin.data.challengeId, code: adminMfaRecoveryCode },
  });
  assert.equal(adminReloginVerified.status, 200);
  adminToken = adminReloginVerified.data.token;
});

test('6. SVG logo/favicon XSS sanitization, attendance camera-only, jam_mulai gate, geofence, and photo headers', async () => {
  resetLimiters();
  const db = getDb();
  const today = getWibDateString();

  // Superadmin settings reject dangerous SVG with <script>
  const xssRes = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { nama_aplikasi: 'Absensi BIGNET', logoBase64: XSS_SVG_BASE64 },
  });
  assert.equal(xssRes.status, 400);

  // Clean SVG logo and favicon accepted and served with nosniff + sandbox CSP
  const cleanRes = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { nama_aplikasi: 'Absensi BIGNET Prod', logoBase64: CLEAN_SVG_BASE64 },
  });
  assert.equal(cleanRes.status, 200);
  const logoFetch = await fetch(`${baseUrl}/api/v1/assets/logo`);
  assert.equal(logoFetch.status, 200);
  assert.equal(logoFetch.headers.get('x-content-type-options'), 'nosniff');
  assert.match(logoFetch.headers.get('content-security-policy') || '', /default-src 'none'/i);

  const unsafeFavicon = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { faviconBase64: XSS_SVG_BASE64 },
  });
  assert.equal(unsafeFavicon.status, 400);

  const cleanFavicon = await apiJson<{ settings: { has_custom_favicon: boolean } }>('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { faviconBase64: CLEAN_SVG_BASE64 },
  });
  assert.equal(cleanFavicon.status, 200);
  assert.equal(cleanFavicon.data.settings.has_custom_favicon, true);

  const faviconFetch = await fetch(`${baseUrl}/api/v1/assets/favicon`);
  assert.equal(faviconFetch.status, 200);
  assert.equal(faviconFetch.headers.get('content-type'), 'image/svg+xml');
  assert.equal(faviconFetch.headers.get('x-content-type-options'), 'nosniff');
  assert.match(faviconFetch.headers.get('content-security-policy') || '', /default-src 'none'/i);

  const resetFavicon = await apiJson<{ settings: { has_custom_favicon: boolean } }>('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { resetFavicon: true },
  });
  assert.equal(resetFavicon.status, 200);
  assert.equal(resetFavicon.data.settings.has_custom_favicon, false);

  // Create a legacy CATAT_DENGAN_FLAG office; strict server enforcement must still reject outside-radius attendance.
  const officeRes = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'KTR-STRICT',
      nama: 'Kantor Uji Ketat',
      alamat: 'Jl. Uji Produksi No. 1',
      lat: -6.2,
      lng: 106.8,
      radius_meter: 100,
      geofence_mode: 'CATAT_DENGAN_FLAG',
    },
  });
  assert.equal(officeRes.status, 201);
  strictOfficeId = officeRes.data.id;
  const persistedGeofence = db
    .prepare(`SELECT geofence_mode FROM kantor WHERE id = ?`)
    .get(strictOfficeId) as { geofence_mode: string };
  assert.equal(persistedGeofence.geofence_mode, 'TOLAK_LUAR_RADIUS');

  // Simulate a legacy office row that still contains the old permissive mode.
  // Attendance must nevertheless be rejected by the backend's strict geofence rule.
  db.prepare(`UPDATE kantor SET geofence_mode = 'CATAT_DENGAN_FLAG' WHERE id = ?`).run(strictOfficeId);
  db.prepare(`UPDATE kalender_kerja SET status_hari = 'HARI_KERJA' WHERE kantor_id = ?`).run(strictOfficeId);
  db.prepare(`UPDATE karyawan SET kantor_id = ? WHERE id = ?`).run(strictOfficeId, karyawanId);

  // Create temporary policy with Sesi 1 starting in future (23:59) -> must be rejected as not started yet
  const futurePol = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'KARYAWAN',
      karyawan_id: karyawanId,
      nama: 'Kebijakan Uji Jam Mulai',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      berlaku_mulai: today,
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Future', jam_mulai: '23:59', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2', jam_mulai: '23:59', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });
  assert.equal(futurePol.status, 201);
  const storedLocationRule = db
    .prepare(`SELECT aturan_lokasi FROM kebijakan_absensi WHERE id = ?`)
    .get(futurePol.data.id) as { aturan_lokasi: string };
  assert.equal(storedLocationRule.aturan_lokasi, 'SESI_PERTAMA_KANTOR');

  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).slice(0, 5);
  if (nowHm < '23:59') {
    const earlyCheckin = await apiJson('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(earlyCheckin.status, 400);
    assert.match(String(earlyCheckin.data.error), /belum dimulai/i);
  }

  // Once the configured session end has passed, the API must reject self check-in.
  const currentMinuteOfDay =
    Number(nowHm.slice(0, 2)) * 60 + Number(nowHm.slice(3, 5));
  if (currentMinuteOfDay > 0) {
    const closedEndMinute = currentMinuteOfDay - 1;
    const closedEndHm = `${String(Math.floor(closedEndMinute / 60)).padStart(2, '0')}:${String(closedEndMinute % 60).padStart(2, '0')}`;
    await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        nama: 'Kebijakan Uji Sesi Kedaluwarsa',
        jumlah_sesi: 2,
        min_sesi_hadir: 1,
        toleransi_terlambat_menit: 15,
        wajib_foto_semua_sesi: 1,
        wajib_aktivitas_sesi_lanjut: 1,
        sesi: [
          { urutan: 1, nama: 'Sesi 1 Expired', jam_mulai: '00:00', jam_selesai: closedEndHm, wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
          { urutan: 2, nama: 'Sesi 2', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
        ],
      },
    });
    const expiredCheckin = await apiJson('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(expiredCheckin.status, 400);
    assert.match(String(expiredCheckin.data.error), /sudah berakhir/i);
  }

  // Update policy so Sesi 1 is open from 00:00..23:59
  await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama: 'Kebijakan Uji Open',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SEMUA_SESI_KANTOR',
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });

  // 1) Reject file upload source
  const fileUploadTry = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'FILE_UPLOAD',
    },
  });
  assert.equal(fileUploadTry.status, 400);
  assert.match(String(fileUploadTry.data.error), /kamera browser/i);

  // 2) Reject out-of-radius GPS even though this legacy office row is CATAT_DENGAN_FLAG
  const outsideGeo = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 10,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(outsideGeo.status, 400);
  assert.match(String(outsideGeo.data.error), /radius/i);

  // 3) Reject a low-quality GPS fix before checking the geofence radius.
  const poorAccuracy = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      accuracyMeter: 150,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(poorAccuracy.status, 400);
  assert.match(String(poorAccuracy.data.error), /akurasi GPS/i);

  // 4) Reject missing GPS even though this legacy office row is CATAT_DENGAN_FLAG
  const missingGeo = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(missingGeo.status, 400);

  // 5) Reject fake magic bytes PNG even with BROWSER_CAMERA
  const fakeMagicTry = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      accuracyMeter: 10,
      fotoBase64: FAKE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(fakeMagicTry.status, 400);

  // 6) Valid check-in inside radius with valid PNG camera capture succeeds
  const validCheckin = await apiJson<{ ok: boolean; day: { sessionsCompleted: number; sessionRecords: { id: number; foto_path: string; foto_checksum: string }[] } }>(
    '/api/v1/attendance/session',
    {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    }
  );
  assert.equal(validCheckin.status, 201);
  assert.equal(validCheckin.data.day.sessionsCompleted, 1);
  const rec = validCheckin.data.day.sessionRecords[0];
  savedAttendanceSessionId = rec.id;
  assert.ok(rec.foto_checksum && rec.foto_checksum.length === 64);

  // Strict setting: every session must be inside the office, including session 2.
  const strictOffsiteAttempt = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 2,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 10,
      tipeAktivitas: 'STANDBY',
      deskripsiAktivitas: 'Uji kebijakan semua sesi wajib di kantor',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(strictOffsiteAttempt.status, 400);
  assert.match(String(strictOffsiteAttempt.data.error), /wajib berada di kantor/i);

  // Switch back to the default rule: session 1 in office; later sessions are flexible.
  const setFlexiblePolicy = await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama: 'Kebijakan Uji Open',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      libur_dihitung_masuk: 1,
      off_pengganti_dihitung_masuk: 1,
      izin_dihitung_masuk: 0,
      sakit_dihitung_masuk: 1,
      cuti_dihitung_masuk: 1,
      aktif: 1,
    },
  });
  assert.equal(setFlexiblePolicy.status, 200);

  // Default location rule: session 2 may be taken off-site; retain approximate GPS evidence.
  const flexibleOffsite = await apiJson<{
    ok: boolean;
    day: { sessionsCompleted: number; sessionRecords: { id: number; dalam_geofence: number; accuracy_meter: number }[] };
  }>('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 2,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 50000,
      tipeAktivitas: 'STANDBY',
      deskripsiAktivitas: 'Uji sesi fleksibel dari lokasi kerja luar kantor',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(flexibleOffsite.status, 201);
  assert.equal(flexibleOffsite.data.day.sessionsCompleted, 2);
  assert.equal(flexibleOffsite.data.day.sessionRecords[1].accuracy_meter, 50000);
  assert.equal(flexibleOffsite.data.day.sessionRecords[1].dalam_geofence, 0);

  // Admin may reopen an expired next session once, for a short, auditable period.
  if (currentMinuteOfDay > 0) {
    const closedEndMinute = currentMinuteOfDay - 1;
    const closedEndHm = `${String(Math.floor(closedEndMinute / 60)).padStart(2, '0')}:${String(closedEndMinute % 60).padStart(2, '0')}`;
    const thirdSessionPolicy = await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        nama: 'Kebijakan Uji Override Check-in',
        jumlah_sesi: 3,
        min_sesi_hadir: 1,
        toleransi_terlambat_menit: 15,
        aturan_lokasi: 'SESI_PERTAMA_KANTOR',
        wajib_foto_semua_sesi: 1,
        wajib_aktivitas_sesi_lanjut: 1,
        sesi: [
          { urutan: 1, nama: 'Sesi 1 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
          { urutan: 2, nama: 'Sesi 2 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
          { urutan: 3, nama: 'Sesi 3 Expired', jam_mulai: '00:00', jam_selesai: closedEndHm, wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
        ],
      },
    });
    assert.equal(thirdSessionPolicy.status, 200);

    const employeeCannotGrant = await apiJson('/api/v1/admin/attendance/override-checkins', {
      token: karyawanToken,
    });
    assert.equal(employeeCannotGrant.status, 403);

    const expiredCandidates = await apiJson<{ items: { karyawanId: number; activeGrant: unknown }[] }>(
      '/api/v1/admin/attendance/override-checkins',
      { token: adminToken }
    );
    assert.equal(expiredCandidates.status, 200);
    assert.ok(expiredCandidates.data.items.some((item) => item.karyawanId === karyawanId));

    const grant = await apiJson<{ id: number; status: string; berlakuSampai: string }>(
      '/api/v1/admin/attendance/override-checkins',
      {
        method: 'POST',
        token: adminToken,
        body: {
          karyawanId,
          alasan: 'Teknisi mengalami kendala kendaraan saat menuju kantor',
          durasiMenit: 15,
        },
      }
    );
    assert.equal(grant.status, 201);
    assert.equal(grant.data.status, 'AKTIF');

    const duplicateGrant = await apiJson('/api/v1/admin/attendance/override-checkins', {
      method: 'POST',
      token: adminToken,
      body: {
        karyawanId,
        alasan: 'Mencoba membuat izin kedua',
        durasiMenit: 15,
      },
    });
    assert.equal(duplicateGrant.status, 409);

    const todayWithGrant = await apiJson<{
      serverTime: string;
      serverEpochMs: number;
      serverWindowCheckedAt: string;
      serverWindowState: 'NOT_STARTED' | 'OPEN' | 'EXPIRED' | 'INVALID' | null;
      serverSessionWindowStates: ('NOT_STARTED' | 'OPEN' | 'EXPIRED' | 'INVALID')[];
      day: {
        sessionsCompleted: number;
        checkinOverride: { active: boolean; id: number } | null;
        policySnapshot: { sesiList: { jam_mulai: string; jam_selesai: string }[] };
      };
    }>('/api/v1/attendance/today', { token: karyawanToken });
    assert.equal(todayWithGrant.status, 200);
    assert.equal(todayWithGrant.data.day.checkinOverride?.active, true);
    assert.equal(todayWithGrant.data.day.checkinOverride?.id, grant.data.id);

    // The attendance gate is calculated by the server using the same instant
    // returned as serverTime/serverEpochMs, never by the browser wall clock.
    assert.equal(todayWithGrant.data.serverWindowCheckedAt, todayWithGrant.data.serverTime);
    assert.ok(Number.isFinite(todayWithGrant.data.serverEpochMs));
    const [serverHours, serverMinutes] = todayWithGrant.data.serverTime.split(':').map(Number);
    const serverMinuteOfDay = serverHours * 60 + serverMinutes;
    const expectedWindowStates = todayWithGrant.data.day.policySnapshot.sesiList.map((session) =>
      getSessionWindowState(serverMinuteOfDay, session.jam_mulai, session.jam_selesai)
    );
    assert.deepEqual(todayWithGrant.data.serverSessionWindowStates, expectedWindowStates);
    assert.equal(
      todayWithGrant.data.serverWindowState,
      expectedWindowStates[todayWithGrant.data.day.sessionsCompleted] ?? null
    );
    assert.ok(
      todayWithGrant.data.serverWindowState === null ||
      ['NOT_STARTED', 'OPEN', 'EXPIRED', 'INVALID'].includes(todayWithGrant.data.serverWindowState)
    );

    const lateSessionCheckin = await apiJson<{
      ok: boolean;
      sessionId: number;
      day: { sessionsCompleted: number };
    }>('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 3,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        tipeAktivitas: 'STANDBY',
        deskripsiAktivitas: 'Melanjutkan pekerjaan setelah izin check-in khusus Admin',
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(lateSessionCheckin.status, 201);
    assert.equal(lateSessionCheckin.data.day.sessionsCompleted, 3);

    const usedGrant = db
      .prepare(`SELECT status, used_session_id FROM override_akses_absensi WHERE id = ?`)
      .get(grant.data.id) as { status: string; used_session_id: number | null };
    assert.equal(usedGrant.status, 'DIGUNAKAN');
    assert.equal(usedGrant.used_session_id, lateSessionCheckin.data.sessionId);

    const overrideAudit = await apiJson<{ items: { aksi: string }[] }>(
      '/api/v1/audit?modul=OVERRIDE_ABSENSI',
      { token: superToken }
    );
    assert.equal(overrideAudit.status, 200);
    assert.ok(overrideAudit.data.items.some((item) => item.aksi === 'BUKA_AKSES_CHECKIN'));
    assert.ok(overrideAudit.data.items.some((item) => item.aksi === 'GUNAKAN_AKSES_CHECKIN'));
  }

  // Feed lists the post and photo endpoint returns PNG with security headers
  const feed = await apiJson<{ posts: { id: number; namaLengkap: string; hasFoto: boolean }[] }>(
    '/api/v1/feed/today',
    { token: karyawanToken }
  );
  assert.equal(feed.status, 200);
  assert.ok(feed.data.posts.some((p) => p.id === savedAttendanceSessionId && p.hasFoto));

  const photoRes = await fetch(`${baseUrl}/api/v1/photos/${savedAttendanceSessionId}`, {
    headers: { Cookie: karyawanToken },
  });
  assert.equal(photoRes.status, 200);
  assert.equal(photoRes.headers.get('content-type'), 'image/png');
  assert.equal(photoRes.headers.get('x-content-type-options'), 'nosniff');
});

test('7. Payroll override preserves original proof, monthly closing enforces post-closing flag, audit log records actions', async () => {
  const ym = '2026-04';
  const targetDate = '2026-04-15';

  // Special work + off pengganti grant & use lifecycle
  const sw = await apiJson<{ id: number }>('/api/v1/special-work', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawan_id: karyawanId,
      tanggal: '2026-04-19',
      nama_project: 'Maint Core Router',
      keterangan: 'Hari libur',
      jumlah_sesi: 3,
      min_sesi_hadir: 2,
      berhak_off_pengganti: true,
    },
  });
  assert.equal(sw.status, 201);

  const offRights = await apiJson<{ items: { id: number; status: string }[] }>('/api/v1/off-rights', {
    token: karyawanToken,
  });
  assert.equal(offRights.status, 200);
  assert.equal(offRights.data.items.length, 1);
  const offId = offRights.data.items[0].id;

  const reqOff = await apiJson<{ id: number }>('/api/v1/requests', {
    method: 'POST',
    token: karyawanToken,
    body: {
      jenis: 'OFF_PENGGANTI',
      tanggalMulai: '2026-04-21',
      tanggalAkhir: '2026-04-21',
      alasan: 'Tukar libur kerja khusus',
      hakOffId: offId,
    },
  });
  assert.equal(reqOff.status, 201);

  const approveOff = await apiJson(`/api/v1/requests/${reqOff.data.id}/decide`, {
    method: 'POST',
    token: adminToken,
    body: { decision: 'APPROVED', alasanKeputusan: 'Hak off valid dan jadwal aman' },
  });
  assert.equal(approveOff.status, 200);

  // Close monthly period
  const closeRes = await apiJson('/api/v1/payroll/close', {
    method: 'POST',
    token: adminToken,
    body: { bulan: ym, catatan: 'Closing payroll April' },
  });
  assert.equal(closeRes.status, 201);

  // Override on closed month without post-closing flag returns 409
  const blockedOv = await apiJson('/api/v1/payroll/override', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId,
      tanggal: targetDate,
      hasilOverride: 'DIHITUNG_MASUK',
      alasan: 'Penugasan luar kota',
    },
  });
  assert.equal(blockedOv.status, 409);

  // Override WITH post-closing flag succeeds & writes CLOSING_KOREKSI audit log
  const postClosingOv = await apiJson('/api/v1/payroll/override', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId,
      tanggal: targetDate,
      hasilOverride: 'DIHITUNG_MASUK',
      alasan: 'Koreksi resmi pasca closing dengan surat tugas',
      koreksiSetelahClosing: true,
    },
  });
  assert.equal(postClosingOv.status, 201);

  const auditRes = await apiJson<{ items: { modul: string; aksi: string }[] }>(
    '/api/v1/audit?modul=CLOSING_KOREKSI',
    { token: adminToken }
  );
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.data.items.some((a) => a.aksi === 'POST_CLOSING_OVERRIDE'));
});

test('8. Backup and Restore verify SHA-256 checksums, integrity, and preserve DB + photo links after disaster', async () => {
  const backupRes = runBackup({
    dataDir: tempDataDir,
    dbPath: tempDbPath,
    backupRootDir: tempBackupDir,
    compressTarGz: true,
  });

  assert.ok(fs.existsSync(backupRes.backupDir));
  assert.ok(backupRes.manifest.archivePath && fs.existsSync(backupRes.manifest.archivePath));
  assert.ok(backupRes.manifest.mediaCounts.photos >= 1);
  assert.ok(fs.existsSync(path.join(backupRes.backupDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(backupRes.backupDir, 'checksums.sha256')));

  // Simulate disaster: delete live DB and photos directory
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${tempDbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.rmSync(path.join(tempDataDir, 'photos'), { recursive: true, force: true });
  assert.equal(fs.existsSync(tempDbPath), false);

  // Restore from compressed .tar.gz archive
  const restoreRes = runRestore({
    fromPath: backupRes.manifest.archivePath!,
    dataDir: tempDataDir,
    dbPath: tempDbPath,
    backupRootDir: tempBackupDir,
    skipSafetySnapshot: true,
  });
  assert.equal(restoreRes.missingPhotosCount, 0);
  assert.ok(restoreRes.photoLinksChecked >= 1);
  assert.equal(restoreRes.verifiedFilesCount, backupRes.manifest.files.length);

  // Verify restored DB returns attendance & password hash intact
  const restoredDb = getDb();
  const restoredSession = restoredDb
    .prepare('SELECT id, foto_path FROM absensi_sesi WHERE id = ?')
    .get(savedAttendanceSessionId) as { id: number; foto_path: string } | undefined;
  assert.ok(restoredSession);
  assert.ok(fs.existsSync(path.join(tempDataDir, 'photos', path.basename(restoredSession.foto_path))));
  const superRow = restoredDb
    .prepare(`SELECT password_hash FROM pengguna WHERE username = 'owner_prod'`)
    .get() as { password_hash: string };
  assert.equal(verifyPassword(superPassword, superRow.password_hash), true);

  // Tampering a backup file causes restore to abort before modifying DB
  const tamperedPhoto = path.join(backupRes.backupDir, 'bignet_absensi.db');
  fs.appendFileSync(tamperedPhoto, Buffer.from('corrupt'));
  assert.throws(() => {
    runRestore({
      fromPath: backupRes.backupDir,
      dataDir: tempDataDir,
      dbPath: tempDbPath,
      backupRootDir: tempBackupDir,
      skipSafetySnapshot: true,
    });
  }, /Checksum tidak cocok/i);
});
test('2. Health check and initial Superadmin authentication work with HttpOnly cookies', async () => {
  resetLimiters();
  const health = await apiJson<{ status: string; timezone: string }>('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');
  assert.equal(health.data.timezone, 'Asia/Jakarta');

  const wrongLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: 'WrongPassword123' },
  });
  assert.equal(wrongLogin.status, 401);

  const ownerIdForMfa = (getDb().prepare(`SELECT id FROM pengguna WHERE username = 'owner_prod'`).get() as { id: number }).id;
  const ownerMfaSecret = generateTotpSecret();
  getDb().prepare(`
    UPDATE pengguna SET mfa_secret_enc = ?, mfa_enabled = 1, mfa_enrolled_at = ?
    WHERE id = ?
  `).run(encryptMfaSecret(ownerMfaSecret), new Date().toISOString(), ownerIdForMfa);

  const okLogin = await apiJson<{ challengeId: string; mfaRequired: boolean; mfaSetupRequired: boolean }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: superPassword },
  });
  assert.equal(okLogin.status, 200);
  assert.equal(okLogin.data.mfaRequired, true);
  assert.equal(okLogin.data.mfaSetupRequired, false);
  const mfaLogin = await apiJson<{ token: string; user: { role: string } }>('/api/v1/auth/mfa/verify', {
    method: 'POST',
    body: { challengeId: okLogin.data.challengeId, code: generateTotpCode(ownerMfaSecret) },
  });
  assert.equal(mfaLogin.status, 200);
  assert.equal(mfaLogin.data.user.role, 'SUPERADMIN');
  assert.ok(mfaLogin.data.token.includes('bignet_token='));
  const setCookie = mfaLogin.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /bignet_csrf=/i);
  superToken = mfaLogin.data.token;

  // The standalone owner account can upload, display, and reset its own profile photo without an employee profile.
  const owner = getDb()
    .prepare(`SELECT id, karyawan_id FROM pengguna WHERE username = 'owner_prod'`)
    .get() as { id: number; karyawan_id: number | null };
  assert.equal(owner.karyawan_id, null);
  const ownerPhoto = await apiJson<{ user: { karyawan_id: number | null; has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: superToken, body: { fotoBase64: SAMPLE_PNG_BASE64 } }
  );
  assert.equal(ownerPhoto.status, 200);
  assert.equal(ownerPhoto.data.user.karyawan_id, null);
  assert.equal(ownerPhoto.data.user.has_foto_profil, true);

  const avatarFetch = await fetch(`${baseUrl}/api/v1/avatars/pengguna/${owner.id}`, {
    headers: { Cookie: superToken },
  });
  assert.equal(avatarFetch.status, 200);
  assert.equal(avatarFetch.headers.get('content-type'), 'image/png');

  const resetOwnerPhoto = await apiJson<{ user: { has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: superToken, body: { removePhoto: true } }
  );
  assert.equal(resetOwnerPhoto.status, 200);
  assert.equal(resetOwnerPhoto.data.user.has_foto_profil, false);
});

test('3. Brute-force protection locks repeated failed login attempts with 429 and Retry-After', async () => {
  resetLimiters();
  for (let i = 0; i < 8; i++) {
    const r = await apiJson('/api/v1/auth/login', {
      method: 'POST',
      body: { identifier: 'owner_prod', password: `wrong_${i}` },
    });
    assert.equal(r.status, 401);
  }
  const locked = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'owner_prod', password: superPassword },
  });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) >= 1);
  resetLimiters();
});

test('4. Superadmin can create Admin & Karyawan accounts (explicit password enforced), registration ACC works', async () => {
  resetLimiters();

  // Superadmin creating employee without >= 6 char password fails
  const badCreate = await apiJson('/api/v1/master/employees', {
    method: 'POST',
    token: superToken,
    body: {
      nik: 'BG-101',
      nama_lengkap: 'No Pass',
      email: 'nopass@bignet.co.id',
      username: 'nopass',
      kantor_id: 1,
      bidang_id: 1,
    },
  });
  assert.equal(badCreate.status, 400);

  // Create Admin account directly via superadmin accounts API
  const adminCreate = await apiJson<{ ok: boolean; userId: number; karyawanId: number | null; nik: string | null }>(
    '/api/v1/superadmin/accounts',
    {
      method: 'POST',
      token: superToken,
      body: {
        nik: 'BG-010',
        nama_lengkap: 'Admin Operasional Test',
        username: 'admin_prod',
        email: 'admin.prod@bignet.co.id',
        password: 'AdminPassword!1',
        role: 'ADMIN',
        kantor_id: 1,
        bidang_id: 3,
        jabatan: 'HR Admin',
      },
    }
  );
  assert.equal(adminCreate.status, 201);
  adminUserId = adminCreate.data.userId;
  assert.equal(adminCreate.data.karyawanId, null);
  assert.equal(adminCreate.data.nik, null);
  const standaloneAdmin = getDb()
    .prepare(`SELECT role, karyawan_id, nama_tampilan FROM pengguna WHERE id = ?`)
    .get(adminUserId) as { role: string; karyawan_id: number | null; nama_tampilan: string };
  assert.equal(standaloneAdmin.role, 'ADMIN');
  assert.equal(standaloneAdmin.karyawan_id, null);
  assert.equal(standaloneAdmin.nama_tampilan, 'Admin Operasional Test');

  const adminLogin = await apiJson<{ challengeId: string; mfaRequired: boolean; mfaSetupRequired: boolean }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.data.mfaSetupRequired, true);
  const adminMfaSetup = await apiJson<{ secret: string }>('/api/v1/auth/mfa/setup', {
    method: 'POST',
    body: { challengeId: adminLogin.data.challengeId },
  });
  assert.equal(adminMfaSetup.status, 200);
  const adminMfaConfirm = await apiJson<{ token: string; user: { role: string }; recoveryCodes: string[] }>(
    '/api/v1/auth/mfa/setup/confirm',
    {
      method: 'POST',
      body: { challengeId: adminLogin.data.challengeId, code: generateTotpCode(adminMfaSetup.data.secret) },
    }
  );
  assert.equal(adminMfaConfirm.status, 200);
  assert.equal(adminMfaConfirm.data.user.role, 'ADMIN');
  assert.equal(adminMfaConfirm.data.recoveryCodes.length, 10);
  adminToken = adminMfaConfirm.data.token;

  // Admin profile and avatar are stored on the standalone pengguna record.
  const adminPhoto = await apiJson<{ user: { karyawan_id: number | null; has_foto_profil: boolean } }>(
    '/api/v1/profile/photo',
    { method: 'PUT', token: adminToken, body: { fotoBase64: SAMPLE_PNG_BASE64 } }
  );
  assert.equal(adminPhoto.status, 200);
  assert.equal(adminPhoto.data.user.karyawan_id, null);
  assert.equal(adminPhoto.data.user.has_foto_profil, true);
  const adminAvatar = await fetch(`${baseUrl}/api/v1/avatars/pengguna/${adminUserId}`, {
    headers: { Cookie: adminToken },
  });
  assert.equal(adminAvatar.status, 200);
  assert.equal(adminAvatar.headers.get('content-type'), 'image/png');

  // Registration with spoofed magic-byte PNG must fail
  const fakeReg = await apiJson('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Spoof User',
      username: 'spoofuser',
      email: 'spoof@bignet.co.id',
      password: 'Password123456!',
      role_diminta: 'KARYAWAN',
      kantor_id: 1,
      bidang_id: 1,
      fotoBase64: FAKE_PNG_BASE64,
    },
  });
  assert.equal(fakeReg.status, 400);

  // Valid technician registration -> PENDING -> login blocked until ACC Superadmin
  const validReg = await apiJson<{ ok: boolean; id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Teknisi Lapangan Satu',
      username: 'teknisi_1',
      email: 'teknisi1@bignet.co.id',
      no_hp: '08120000111',
      password: 'TeknisiPassword!1',
      role_diminta: 'KARYAWAN',
      kantor_id: 1,
      bidang_id: 1,
      fotoBase64: SAMPLE_PNG_BASE64,
    },
  });
  assert.equal(validReg.status, 201);

  const pendingLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!1' },
  });
  assert.equal(pendingLogin.status, 403);

  // Admin cannot approve registrations
  const adminAccTry = await apiJson(`/api/v1/superadmin/registrations/${validReg.data.id}/approve`, {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(adminAccTry.status, 403);

  // Superadmin approves registration
  const accOk = await apiJson<{ ok: boolean; userId: number; karyawanId: number }>(
    `/api/v1/superadmin/registrations/${validReg.data.id}/approve`,
    {
      method: 'POST',
      token: superToken,
      body: { alasan_keputusan: 'ACC validasi data teknisi' },
    }
  );
  assert.equal(accOk.status, 200);
  karyawanUserId = accOk.data.userId;
  karyawanId = accOk.data.karyawanId;

  const techLogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!1' },
  });
  assert.equal(techLogin.status, 200);
  karyawanToken = techLogin.data.token;

  // Reject path blocks login with rejection reason
  const rejectCandidate = await apiJson<{ id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Calon Ditolak',
      username: 'ditolak1',
      email: 'ditolak1@bignet.co.id',
      password: 'Password123456!',
      role_diminta: 'ADMIN',
      kantor_id: 1,
      bidang_id: 3,
    },
  });
  assert.equal(rejectCandidate.status, 201);
  const rejectRes = await apiJson(
    `/api/v1/superadmin/registrations/${rejectCandidate.data.id}/reject`,
    {
      method: 'POST',
      token: superToken,
      body: { alasan_keputusan: 'Bukan karyawan internal PT BIGNET' },
    }
  );
  assert.equal(rejectRes.status, 200);
  const rejectedLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'ditolak1', password: 'Password123456!' },
  });
  assert.equal(rejectedLogin.status, 403);

  // Admin registration does not require employee placement fields and approval creates no NIK/profile.
  const standaloneAdminReg = await apiJson<{ id: number }>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      nama_lengkap: 'Admin Kedua',
      username: 'admin_kedua',
      email: 'admin.kedua@bignet.co.id',
      no_hp: '08120000222',
      password: 'AdminKeduaPassword!1',
      role_diminta: 'ADMIN',
    },
  });
  assert.equal(standaloneAdminReg.status, 201);
  const approvedAdmin = await apiJson<{
    ok: boolean; userId: number; karyawanId: number | null; nik: string | null; role: string;
  }>(`/api/v1/superadmin/registrations/${standaloneAdminReg.data.id}/approve`, {
    method: 'POST',
    token: superToken,
    body: {},
  });
  assert.equal(approvedAdmin.status, 200);
  assert.equal(approvedAdmin.data.role, 'ADMIN');
  assert.equal(approvedAdmin.data.karyawanId, null);
  assert.equal(approvedAdmin.data.nik, null);
  const approvedAdminDb = getDb()
    .prepare(`SELECT role, karyawan_id FROM pengguna WHERE id = ?`)
    .get(approvedAdmin.data.userId) as { role: string; karyawan_id: number | null };
  assert.equal(approvedAdminDb.role, 'ADMIN');
  assert.equal(approvedAdminDb.karyawan_id, null);
});

test('5. Authorization boundaries, query-token restriction, logout jti & token_version revocation', async () => {
  // Query token rejected on JSON API endpoints, accepted only on media/SSE endpoints
  const qMe = await apiJson(`/api/v1/auth/me?token=${encodeURIComponent(karyawanToken)}`);
  assert.equal(qMe.status, 401);

  const qAvatar = await fetch(`${baseUrl}/api/v1/avatars/karyawan/${karyawanId}?token=${encodeURIComponent(karyawanToken)}`);
  assert.equal(qAvatar.status, 401);
  assert.equal(qAvatar.headers.get('x-content-type-options'), 'nosniff');

  // Role isolation checks
  assert.equal((await apiJson('/api/v1/settings', { token: karyawanToken })).status, 403);
  assert.equal((await apiJson('/api/v1/settings', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/superadmin/accounts', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/attendance/today', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/requests', {
    method: 'POST',
    token: adminToken,
    body: { jenis: 'IZIN', tanggalMulai: '2026-04-10', tanggalAkhir: '2026-04-10', alasan: 'Uji batas role' },
  })).status, 403);
  assert.equal(
    (
      await apiJson('/api/v1/payroll/override', {
        method: 'POST',
        token: karyawanToken,
        body: { karyawanId, tanggal: getWibDateString(), hasilOverride: 'DIHITUNG_MASUK', alasan: 'Test' },
      })
    ).status,
    403
  );

  // Operational Admin can manage the work-field master and reassign a technician.
  const beforeFieldEdit = getDb().prepare(
    `SELECT nama_lengkap, no_hp, kantor_id, bidang_id, jabatan, aktif
     FROM karyawan WHERE id = ?`
  ).get(karyawanId) as {
    nama_lengkap: string;
    no_hp: string;
    kantor_id: number;
    bidang_id: number;
    jabatan: string;
    aktif: number;
  };
  const createField = await apiJson<{ id: number }>('/api/v1/master/bidang', {
    method: 'POST',
    token: adminToken,
    body: { kode: 'QA_TMP', nama: 'Bidang QA Sementara', deskripsi: 'Bidang untuk uji perubahan Admin' },
  });
  assert.equal(createField.status, 201);
  const fieldListBeforeUse = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number; jumlah_kebijakan: number; jumlah_pendaftaran: number }>;
  }>('/api/v1/master/bidang', { token: adminToken });
  const newFieldBeforeUse = fieldListBeforeUse.data.items.find((field) => field.id === createField.data.id);
  assert.ok(newFieldBeforeUse);
  assert.equal(newFieldBeforeUse.can_delete, true);
  const editField = await apiJson(`/api/v1/master/bidang/${createField.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { kode: 'QA_OPS', nama: 'Operasional QA', deskripsi: 'Diperbarui oleh Admin operasional' },
  });
  assert.equal(editField.status, 200);
  const savedField = getDb().prepare(
    `SELECT kode, nama, deskripsi FROM bidang_kerja WHERE id = ?`
  ).get(createField.data.id) as { kode: string; nama: string; deskripsi: string };
  assert.equal(savedField.kode, 'QA_OPS');
  assert.equal(savedField.nama, 'Operasional QA');
  assert.equal(savedField.deskripsi, 'Diperbarui oleh Admin operasional');

  const assignField = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...beforeFieldEdit, bidang_id: createField.data.id },
  });
  assert.equal(assignField.status, 200);
  const reassigned = getDb().prepare(
    `SELECT bidang_id FROM karyawan WHERE id = ?`
  ).get(karyawanId) as { bidang_id: number };
  assert.equal(reassigned.bidang_id, createField.data.id);
  const fieldListWhileUsed = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number }>;
  }>('/api/v1/master/bidang', { token: adminToken });
  const usedField = fieldListWhileUsed.data.items.find((field) => field.id === createField.data.id);
  assert.ok(usedField);
  assert.equal(usedField.can_delete, false);
  assert.equal(usedField.jumlah_karyawan, 1);

  // A field assigned to an employee must be protected from deletion.
  const fieldDeleteBlocked = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(fieldDeleteBlocked.status, 409);

  const restoreField = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: beforeFieldEdit,
  });
  assert.equal(restoreField.status, 200);

  const employeeCannotEditField = await apiJson(`/api/v1/master/bidang/${createField.data.id}`, {
    method: 'PUT',
    token: karyawanToken,
    body: { kode: 'NO_ACCESS', nama: 'Tidak boleh', deskripsi: '' },
  });
  assert.equal(employeeCannotEditField.status, 403);

  // Once every reference is gone, the unused field can be deleted.
  const employeeCannotDeleteField = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: karyawanToken }
  );
  assert.equal(employeeCannotDeleteField.status, 403);

  const fieldDeleteAllowed = await apiJson(
    `/api/v1/master/bidang/${createField.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(fieldDeleteAllowed.status, 200);
  assert.equal(
    getDb().prepare(`SELECT id FROM bidang_kerja WHERE id = ?`).get(createField.data.id),
    undefined
  );

  // New offices contain only their generated weekly-calendar child rows and
  // should be deletable until employees, registrations, holidays or payroll use them.
  const createOffice = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'QA-DEL',
      nama: 'Kantor Uji Hapus',
      alamat: 'Alamat Uji',
      lat: -0.0263,
      lng: 109.3425,
      radius_meter: 250,
    },
  });
  assert.equal(createOffice.status, 201);

  const officeList = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_kalender: number }>;
  }>('/api/v1/master/offices', { token: adminToken });
  const newOffice = officeList.data.items.find((office) => office.id === createOffice.data.id);
  assert.ok(newOffice);
  assert.equal(newOffice.can_delete, true);
  assert.equal(newOffice.jumlah_kalender, 7);

  const assignOffice = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: { ...beforeFieldEdit, kantor_id: createOffice.data.id },
  });
  assert.equal(assignOffice.status, 200);
  const officeListWhileUsed = await apiJson<{
    items: Array<{ id: number; can_delete: boolean; jumlah_karyawan: number }>;
  }>('/api/v1/master/offices', { token: adminToken });
  const usedOffice = officeListWhileUsed.data.items.find((office) => office.id === createOffice.data.id);
  assert.ok(usedOffice);
  assert.equal(usedOffice.can_delete, false);
  assert.equal(usedOffice.jumlah_karyawan, 1);

  const officeDeleteBlocked = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(officeDeleteBlocked.status, 409);

  const restoreOffice = await apiJson(`/api/v1/master/employees/${karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: beforeFieldEdit,
  });
  assert.equal(restoreOffice.status, 200);

  const employeeCannotDeleteOffice = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: karyawanToken }
  );
  assert.equal(employeeCannotDeleteOffice.status, 403);

  // Employee-facing master lists must not expose Admin-only usage counters.
  const employeeOfficeList = await apiJson<{ items: Array<Record<string, unknown>> }>(
    '/api/v1/master/offices',
    { token: karyawanToken }
  );
  const employeeFieldList = await apiJson<{ items: Array<Record<string, unknown>> }>(
    '/api/v1/master/bidang',
    { token: karyawanToken }
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(employeeOfficeList.data.items[0] || {}, 'can_delete'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(employeeFieldList.data.items[0] || {}, 'can_delete'),
    false
  );

  const officeDeleteAllowed = await apiJson(
    `/api/v1/master/offices/${createOffice.data.id}`,
    { method: 'DELETE', token: adminToken }
  );
  assert.equal(officeDeleteAllowed.status, 200);
  assert.equal(
    getDb().prepare(`SELECT id FROM kantor WHERE id = ?`).get(createOffice.data.id),
    undefined
  );
  assert.equal(
    (getDb().prepare(`SELECT COUNT(*) AS total FROM kalender_kerja WHERE kantor_id = ?`).get(createOffice.data.id) as { total: number }).total,
    0
  );

  // Expired token rejected
  const expiredToken = signToken({ userId: karyawanUserId, role: 'KARYAWAN', exp: Date.now() - 5000 });
  assert.equal((await apiJson('/api/v1/auth/me', { token: expiredToken })).status, 401);

  // Password change rotates token_version & invalidates old token while new token works
  const oldTechToken = karyawanToken;
  const pwChange = await apiJson<{ ok: boolean; token: string }>('/api/v1/profile/password', {
    method: 'PUT',
    token: oldTechToken,
    body: { currentPassword: 'TeknisiPassword!1', newPassword: 'TeknisiPassword!2' },
  });
  assert.equal(pwChange.status, 200);
  assert.ok(pwChange.data.token);
  karyawanToken = pwChange.data.token;

  // Old token is now rejected immediately
  assert.equal((await apiJson('/api/v1/auth/me', { token: oldTechToken })).status, 401);
  assert.equal((await apiJson('/api/v1/auth/me', { token: karyawanToken })).status, 200);

  // Logout revokes current JTI immediately
  const logoutRes = await apiJson('/api/v1/auth/logout', { method: 'POST', token: karyawanToken });
  assert.equal(logoutRes.status, 200);
  assert.equal((await apiJson('/api/v1/auth/me', { token: karyawanToken })).status, 401);

  // Re-login cleanly for subsequent tests
  const relogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'teknisi_1', password: 'TeknisiPassword!2' },
  });
  assert.equal(relogin.status, 200);
  karyawanToken = relogin.data.token;

  // Inactive account cannot access /auth/me or login
  const disableAdmin = await apiJson(`/api/v1/superadmin/accounts/${adminUserId}`, {
    method: 'PUT',
    token: superToken,
    body: { aktif: false },
  });
  assert.equal(disableAdmin.status, 200);
  assert.equal((await apiJson('/api/v1/auth/me', { token: adminToken })).status, 401);
  const blockedLogin = await apiJson('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  assert.equal(blockedLogin.status, 403);

  // Re-enable admin and get fresh token
  await apiJson(`/api/v1/superadmin/accounts/${adminUserId}`, {
    method: 'PUT',
    token: superToken,
    body: { aktif: true },
  });
  const adminRelogin = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier: 'admin_prod', password: 'AdminPassword!1' },
  });
  adminToken = adminRelogin.data.token;
});

test('6. SVG logo/favicon XSS sanitization, attendance camera-only, jam_mulai gate, geofence, and photo headers', async () => {
  resetLimiters();
  const db = getDb();
  const today = getWibDateString();

  // Superadmin settings reject dangerous SVG with <script>
  const xssRes = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { nama_aplikasi: 'Absensi BIGNET', logoBase64: XSS_SVG_BASE64 },
  });
  assert.equal(xssRes.status, 400);

  // Clean SVG logo and favicon accepted and served with nosniff + sandbox CSP
  const cleanRes = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { nama_aplikasi: 'Absensi BIGNET Prod', logoBase64: CLEAN_SVG_BASE64 },
  });
  assert.equal(cleanRes.status, 200);
  const logoFetch = await fetch(`${baseUrl}/api/v1/assets/logo`);
  assert.equal(logoFetch.status, 200);
  assert.equal(logoFetch.headers.get('x-content-type-options'), 'nosniff');
  assert.match(logoFetch.headers.get('content-security-policy') || '', /default-src 'none'/i);

  const unsafeFavicon = await apiJson('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { faviconBase64: XSS_SVG_BASE64 },
  });
  assert.equal(unsafeFavicon.status, 400);

  const cleanFavicon = await apiJson<{ settings: { has_custom_favicon: boolean } }>('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { faviconBase64: CLEAN_SVG_BASE64 },
  });
  assert.equal(cleanFavicon.status, 200);
  assert.equal(cleanFavicon.data.settings.has_custom_favicon, true);

  const faviconFetch = await fetch(`${baseUrl}/api/v1/assets/favicon`);
  assert.equal(faviconFetch.status, 200);
  assert.equal(faviconFetch.headers.get('content-type'), 'image/svg+xml');
  assert.equal(faviconFetch.headers.get('x-content-type-options'), 'nosniff');
  assert.match(faviconFetch.headers.get('content-security-policy') || '', /default-src 'none'/i);

  const resetFavicon = await apiJson<{ settings: { has_custom_favicon: boolean } }>('/api/v1/settings', {
    method: 'PUT',
    token: superToken,
    body: { resetFavicon: true },
  });
  assert.equal(resetFavicon.status, 200);
  assert.equal(resetFavicon.data.settings.has_custom_favicon, false);

  // Create a legacy CATAT_DENGAN_FLAG office; strict server enforcement must still reject outside-radius attendance.
  const officeRes = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'KTR-STRICT',
      nama: 'Kantor Uji Ketat',
      alamat: 'Jl. Uji Produksi No. 1',
      lat: -6.2,
      lng: 106.8,
      radius_meter: 100,
      geofence_mode: 'CATAT_DENGAN_FLAG',
    },
  });
  assert.equal(officeRes.status, 201);
  strictOfficeId = officeRes.data.id;
  const persistedGeofence = db
    .prepare(`SELECT geofence_mode FROM kantor WHERE id = ?`)
    .get(strictOfficeId) as { geofence_mode: string };
  assert.equal(persistedGeofence.geofence_mode, 'TOLAK_LUAR_RADIUS');

  // Simulate a legacy office row that still contains the old permissive mode.
  // Attendance must nevertheless be rejected by the backend's strict geofence rule.
  db.prepare(`UPDATE kantor SET geofence_mode = 'CATAT_DENGAN_FLAG' WHERE id = ?`).run(strictOfficeId);
  db.prepare(`UPDATE kalender_kerja SET status_hari = 'HARI_KERJA' WHERE kantor_id = ?`).run(strictOfficeId);
  db.prepare(`UPDATE karyawan SET kantor_id = ? WHERE id = ?`).run(strictOfficeId, karyawanId);

  // Create temporary policy with Sesi 1 starting in future (23:59) -> must be rejected as not started yet
  const futurePol = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'KARYAWAN',
      karyawan_id: karyawanId,
      nama: 'Kebijakan Uji Jam Mulai',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      berlaku_mulai: today,
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Future', jam_mulai: '23:59', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2', jam_mulai: '23:59', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });
  assert.equal(futurePol.status, 201);
  const storedLocationRule = db
    .prepare(`SELECT aturan_lokasi FROM kebijakan_absensi WHERE id = ?`)
    .get(futurePol.data.id) as { aturan_lokasi: string };
  assert.equal(storedLocationRule.aturan_lokasi, 'SESI_PERTAMA_KANTOR');

  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).slice(0, 5);
  if (nowHm < '23:59') {
    const earlyCheckin = await apiJson('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(earlyCheckin.status, 400);
    assert.match(String(earlyCheckin.data.error), /belum dimulai/i);
  }

  // Once the configured session end has passed, the API must reject self check-in.
  const currentMinuteOfDay =
    Number(nowHm.slice(0, 2)) * 60 + Number(nowHm.slice(3, 5));
  if (currentMinuteOfDay > 0) {
    const closedEndMinute = currentMinuteOfDay - 1;
    const closedEndHm = `${String(Math.floor(closedEndMinute / 60)).padStart(2, '0')}:${String(closedEndMinute % 60).padStart(2, '0')}`;
    await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        nama: 'Kebijakan Uji Sesi Kedaluwarsa',
        jumlah_sesi: 2,
        min_sesi_hadir: 1,
        toleransi_terlambat_menit: 15,
        wajib_foto_semua_sesi: 1,
        wajib_aktivitas_sesi_lanjut: 1,
        sesi: [
          { urutan: 1, nama: 'Sesi 1 Expired', jam_mulai: '00:00', jam_selesai: closedEndHm, wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
          { urutan: 2, nama: 'Sesi 2', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
        ],
      },
    });
    const expiredCheckin = await apiJson('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(expiredCheckin.status, 400);
    assert.match(String(expiredCheckin.data.error), /sudah berakhir/i);
  }

  // Update policy so Sesi 1 is open from 00:00..23:59
  await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama: 'Kebijakan Uji Open',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SEMUA_SESI_KANTOR',
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });

  // 1) Reject file upload source
  const fileUploadTry = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'FILE_UPLOAD',
    },
  });
  assert.equal(fileUploadTry.status, 400);
  assert.match(String(fileUploadTry.data.error), /kamera browser/i);

  // 2) Reject out-of-radius GPS even though this legacy office row is CATAT_DENGAN_FLAG
  const outsideGeo = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 10,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(outsideGeo.status, 400);
  assert.match(String(outsideGeo.data.error), /radius/i);

  // 3) Reject a low-quality GPS fix before checking the geofence radius.
  const poorAccuracy = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      accuracyMeter: 150,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(poorAccuracy.status, 400);
  assert.match(String(poorAccuracy.data.error), /akurasi GPS/i);

  // 4) Reject missing GPS even though this legacy office row is CATAT_DENGAN_FLAG
  const missingGeo = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(missingGeo.status, 400);

  // 5) Reject fake magic bytes PNG even with BROWSER_CAMERA
  const fakeMagicTry = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 1,
      lat: -6.2,
      lng: 106.8,
      accuracyMeter: 10,
      fotoBase64: FAKE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(fakeMagicTry.status, 400);

  // 6) Valid check-in inside radius with valid PNG camera capture succeeds
  const validCheckin = await apiJson<{ ok: boolean; day: { sessionsCompleted: number; sessionRecords: { id: number; foto_path: string; foto_checksum: string }[] } }>(
    '/api/v1/attendance/session',
    {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 1,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    }
  );
  assert.equal(validCheckin.status, 201);
  assert.equal(validCheckin.data.day.sessionsCompleted, 1);
  const rec = validCheckin.data.day.sessionRecords[0];
  savedAttendanceSessionId = rec.id;
  assert.ok(rec.foto_checksum && rec.foto_checksum.length === 64);

  // Strict setting: every session must be inside the office, including session 2.
  const strictOffsiteAttempt = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 2,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 10,
      tipeAktivitas: 'STANDBY',
      deskripsiAktivitas: 'Uji kebijakan semua sesi wajib di kantor',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(strictOffsiteAttempt.status, 400);
  assert.match(String(strictOffsiteAttempt.data.error), /wajib berada di kantor/i);

  // Switch back to the default rule: session 1 in office; later sessions are flexible.
  const setFlexiblePolicy = await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama: 'Kebijakan Uji Open',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      libur_dihitung_masuk: 1,
      off_pengganti_dihitung_masuk: 1,
      izin_dihitung_masuk: 0,
      sakit_dihitung_masuk: 1,
      cuti_dihitung_masuk: 1,
      aktif: 1,
    },
  });
  assert.equal(setFlexiblePolicy.status, 200);

  // Default location rule: session 2 may be taken off-site; retain approximate GPS evidence.
  const flexibleOffsite = await apiJson<{
    ok: boolean;
    day: { sessionsCompleted: number; sessionRecords: { id: number; dalam_geofence: number; accuracy_meter: number }[] };
  }>('/api/v1/attendance/session', {
    method: 'POST',
    token: karyawanToken,
    body: {
      urutanSesi: 2,
      lat: -6.25,
      lng: 106.85,
      accuracyMeter: 50000,
      tipeAktivitas: 'STANDBY',
      deskripsiAktivitas: 'Uji sesi fleksibel dari lokasi kerja luar kantor',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(flexibleOffsite.status, 201);
  assert.equal(flexibleOffsite.data.day.sessionsCompleted, 2);
  assert.equal(flexibleOffsite.data.day.sessionRecords[1].accuracy_meter, 50000);
  assert.equal(flexibleOffsite.data.day.sessionRecords[1].dalam_geofence, 0);

  // Admin may reopen an expired next session once, for a short, auditable period.
  if (currentMinuteOfDay > 0) {
    const closedEndMinute = currentMinuteOfDay - 1;
    const closedEndHm = `${String(Math.floor(closedEndMinute / 60)).padStart(2, '0')}:${String(closedEndMinute % 60).padStart(2, '0')}`;
    const thirdSessionPolicy = await apiJson(`/api/v1/policies/${futurePol.data.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        nama: 'Kebijakan Uji Override Check-in',
        jumlah_sesi: 3,
        min_sesi_hadir: 1,
        toleransi_terlambat_menit: 15,
        aturan_lokasi: 'SESI_PERTAMA_KANTOR',
        wajib_foto_semua_sesi: 1,
        wajib_aktivitas_sesi_lanjut: 1,
        sesi: [
          { urutan: 1, nama: 'Sesi 1 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
          { urutan: 2, nama: 'Sesi 2 Open', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
          { urutan: 3, nama: 'Sesi 3 Expired', jam_mulai: '00:00', jam_selesai: closedEndHm, wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
        ],
      },
    });
    assert.equal(thirdSessionPolicy.status, 200);

    const employeeCannotGrant = await apiJson('/api/v1/admin/attendance/override-checkins', {
      token: karyawanToken,
    });
    assert.equal(employeeCannotGrant.status, 403);

    const expiredCandidates = await apiJson<{ items: { karyawanId: number; activeGrant: unknown }[] }>(
      '/api/v1/admin/attendance/override-checkins',
      { token: adminToken }
    );
    assert.equal(expiredCandidates.status, 200);
    assert.ok(expiredCandidates.data.items.some((item) => item.karyawanId === karyawanId));

    const grant = await apiJson<{ id: number; status: string; berlakuSampai: string }>(
      '/api/v1/admin/attendance/override-checkins',
      {
        method: 'POST',
        token: adminToken,
        body: {
          karyawanId,
          alasan: 'Teknisi mengalami kendala kendaraan saat menuju kantor',
          durasiMenit: 15,
        },
      }
    );
    assert.equal(grant.status, 201);
    assert.equal(grant.data.status, 'AKTIF');

    const duplicateGrant = await apiJson('/api/v1/admin/attendance/override-checkins', {
      method: 'POST',
      token: adminToken,
      body: {
        karyawanId,
        alasan: 'Mencoba membuat izin kedua',
        durasiMenit: 15,
      },
    });
    assert.equal(duplicateGrant.status, 409);

    const todayWithGrant = await apiJson<{
      serverTime: string;
      serverEpochMs: number;
      serverWindowCheckedAt: string;
      serverWindowState: 'NOT_STARTED' | 'OPEN' | 'EXPIRED' | 'INVALID' | null;
      serverSessionWindowStates: ('NOT_STARTED' | 'OPEN' | 'EXPIRED' | 'INVALID')[];
      day: {
        sessionsCompleted: number;
        checkinOverride: { active: boolean; id: number } | null;
        policySnapshot: { sesiList: { jam_mulai: string; jam_selesai: string }[] };
      };
    }>('/api/v1/attendance/today', { token: karyawanToken });
    assert.equal(todayWithGrant.status, 200);
    assert.equal(todayWithGrant.data.day.checkinOverride?.active, true);
    assert.equal(todayWithGrant.data.day.checkinOverride?.id, grant.data.id);

    // The attendance gate is calculated by the server using the same instant
    // returned as serverTime/serverEpochMs, never by the browser wall clock.
    assert.equal(todayWithGrant.data.serverWindowCheckedAt, todayWithGrant.data.serverTime);
    assert.ok(Number.isFinite(todayWithGrant.data.serverEpochMs));
    const [serverHours, serverMinutes] = todayWithGrant.data.serverTime.split(':').map(Number);
    const serverMinuteOfDay = serverHours * 60 + serverMinutes;
    const expectedWindowStates = todayWithGrant.data.day.policySnapshot.sesiList.map((session) =>
      getSessionWindowState(serverMinuteOfDay, session.jam_mulai, session.jam_selesai)
    );
    assert.deepEqual(todayWithGrant.data.serverSessionWindowStates, expectedWindowStates);
    assert.equal(
      todayWithGrant.data.serverWindowState,
      expectedWindowStates[todayWithGrant.data.day.sessionsCompleted] ?? null
    );
    assert.ok(
      todayWithGrant.data.serverWindowState === null ||
      ['NOT_STARTED', 'OPEN', 'EXPIRED', 'INVALID'].includes(todayWithGrant.data.serverWindowState)
    );

    const lateSessionCheckin = await apiJson<{
      ok: boolean;
      sessionId: number;
      day: { sessionsCompleted: number };
    }>('/api/v1/attendance/session', {
      method: 'POST',
      token: karyawanToken,
      body: {
        urutanSesi: 3,
        lat: -6.2,
        lng: 106.8,
        accuracyMeter: 10,
        tipeAktivitas: 'STANDBY',
        deskripsiAktivitas: 'Melanjutkan pekerjaan setelah izin check-in khusus Admin',
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    });
    assert.equal(lateSessionCheckin.status, 201);
    assert.equal(lateSessionCheckin.data.day.sessionsCompleted, 3);

    const usedGrant = db
      .prepare(`SELECT status, used_session_id FROM override_akses_absensi WHERE id = ?`)
      .get(grant.data.id) as { status: string; used_session_id: number | null };
    assert.equal(usedGrant.status, 'DIGUNAKAN');
    assert.equal(usedGrant.used_session_id, lateSessionCheckin.data.sessionId);

    const overrideAudit = await apiJson<{ items: { aksi: string }[] }>(
      '/api/v1/audit?modul=OVERRIDE_ABSENSI',
      { token: superToken }
    );
    assert.equal(overrideAudit.status, 200);
    assert.ok(overrideAudit.data.items.some((item) => item.aksi === 'BUKA_AKSES_CHECKIN'));
    assert.ok(overrideAudit.data.items.some((item) => item.aksi === 'GUNAKAN_AKSES_CHECKIN'));
  }

  // Feed lists the post and photo endpoint returns PNG with security headers
  const feed = await apiJson<{ posts: { id: number; namaLengkap: string; hasFoto: boolean }[] }>(
    '/api/v1/feed/today',
    { token: karyawanToken }
  );
  assert.equal(feed.status, 200);
  assert.ok(feed.data.posts.some((p) => p.id === savedAttendanceSessionId && p.hasFoto));

  const photoRes = await fetch(`${baseUrl}/api/v1/photos/${savedAttendanceSessionId}`, {
    headers: { Cookie: karyawanToken },
  });
  assert.equal(photoRes.status, 200);
  assert.equal(photoRes.headers.get('content-type'), 'image/png');
  assert.equal(photoRes.headers.get('x-content-type-options'), 'nosniff');
});

test('7. Payroll override preserves original proof, monthly closing enforces post-closing flag, audit log records actions', async () => {
  const ym = '2026-04';
  const targetDate = '2026-04-15';

  // Special work + off pengganti grant & use lifecycle
  const sw = await apiJson<{ id: number }>('/api/v1/special-work', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawan_id: karyawanId,
      tanggal: '2026-04-19',
      nama_project: 'Maint Core Router',
      keterangan: 'Hari libur',
      jumlah_sesi: 3,
      min_sesi_hadir: 2,
      berhak_off_pengganti: true,
    },
  });
  assert.equal(sw.status, 201);

  const offRights = await apiJson<{ items: { id: number; status: string }[] }>('/api/v1/off-rights', {
    token: karyawanToken,
  });
  assert.equal(offRights.status, 200);
  assert.equal(offRights.data.items.length, 1);
  const offId = offRights.data.items[0].id;

  const reqOff = await apiJson<{ id: number }>('/api/v1/requests', {
    method: 'POST',
    token: karyawanToken,
    body: {
      jenis: 'OFF_PENGGANTI',
      tanggalMulai: '2026-04-21',
      tanggalAkhir: '2026-04-21',
      alasan: 'Tukar libur kerja khusus',
      hakOffId: offId,
    },
  });
  assert.equal(reqOff.status, 201);

  const approveOff = await apiJson(`/api/v1/requests/${reqOff.data.id}/decide`, {
    method: 'POST',
    token: adminToken,
    body: { decision: 'APPROVED', alasanKeputusan: 'Hak off valid dan jadwal aman' },
  });
  assert.equal(approveOff.status, 200);

  // Close monthly period
  const closeRes = await apiJson('/api/v1/payroll/close', {
    method: 'POST',
    token: adminToken,
    body: { bulan: ym, catatan: 'Closing payroll April' },
  });
  assert.equal(closeRes.status, 201);

  // Override on closed month without post-closing flag returns 409
  const blockedOv = await apiJson('/api/v1/payroll/override', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId,
      tanggal: targetDate,
      hasilOverride: 'DIHITUNG_MASUK',
      alasan: 'Penugasan luar kota',
    },
  });
  assert.equal(blockedOv.status, 409);

  // Override WITH post-closing flag succeeds & writes CLOSING_KOREKSI audit log
  const postClosingOv = await apiJson('/api/v1/payroll/override', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId,
      tanggal: targetDate,
      hasilOverride: 'DIHITUNG_MASUK',
      alasan: 'Koreksi resmi pasca closing dengan surat tugas',
      koreksiSetelahClosing: true,
    },
  });
  assert.equal(postClosingOv.status, 201);

  const auditRes = await apiJson<{ items: { modul: string; aksi: string }[] }>(
    '/api/v1/audit?modul=CLOSING_KOREKSI',
    { token: adminToken }
  );
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.data.items.some((a) => a.aksi === 'POST_CLOSING_OVERRIDE'));
});

test('8. Backup and Restore verify SHA-256 checksums, integrity, and preserve DB + photo links after disaster', async () => {
  const backupRes = runBackup({
    dataDir: tempDataDir,
    dbPath: tempDbPath,
    backupRootDir: tempBackupDir,
    compressTarGz: true,
  });

  assert.ok(fs.existsSync(backupRes.backupDir));
  assert.ok(backupRes.manifest.archivePath && fs.existsSync(backupRes.manifest.archivePath));
  assert.ok(backupRes.manifest.mediaCounts.photos >= 1);
  assert.ok(fs.existsSync(path.join(backupRes.backupDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(backupRes.backupDir, 'checksums.sha256')));

  // Simulate disaster: delete live DB and photos directory
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${tempDbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.rmSync(path.join(tempDataDir, 'photos'), { recursive: true, force: true });
  assert.equal(fs.existsSync(tempDbPath), false);

  // Restore from compressed .tar.gz archive
  const restoreRes = runRestore({
    fromPath: backupRes.manifest.archivePath!,
    dataDir: tempDataDir,
    dbPath: tempDbPath,
    backupRootDir: tempBackupDir,
    skipSafetySnapshot: true,
  });
  assert.equal(restoreRes.missingPhotosCount, 0);
  assert.ok(restoreRes.photoLinksChecked >= 1);
  assert.equal(restoreRes.verifiedFilesCount, backupRes.manifest.files.length);

  // Verify restored DB returns attendance & password hash intact
  const restoredDb = getDb();
  const restoredSession = restoredDb
    .prepare('SELECT id, foto_path FROM absensi_sesi WHERE id = ?')
    .get(savedAttendanceSessionId) as { id: number; foto_path: string } | undefined;
  assert.ok(restoredSession);
  assert.ok(fs.existsSync(path.join(tempDataDir, 'photos', path.basename(restoredSession.foto_path))));
  const superRow = restoredDb
    .prepare(`SELECT password_hash FROM pengguna WHERE username = 'owner_prod'`)
    .get() as { password_hash: string };
  assert.equal(verifyPassword(superPassword, superRow.password_hash), true);

  // Tampering a backup file causes restore to abort before modifying DB
  const tamperedPhoto = path.join(backupRes.backupDir, 'bignet_absensi.db');
  fs.appendFileSync(tamperedPhoto, Buffer.from('corrupt'));
  assert.throws(() => {
    runRestore({
      fromPath: backupRes.backupDir,
      dataDir: tempDataDir,
      dbPath: tempDbPath,
      backupRootDir: tempBackupDir,
      skipSafetySnapshot: true,
    });
  }, /Checksum tidak cocok/i);
});


test('9. Session inventory, Superadmin MFA reset, idle expiration and stale-cookie re-login', async () => {
  const ownerSecurity = await apiJson<{
    mfaEnabled: boolean;
    mfaRequired: boolean;
    idleTimeoutMinutes: number;
    absoluteTimeoutHours: number;
    currentSessionId: string;
    sessions: Array<{ sessionId: string; current: boolean; idleExpiresAt: number; absoluteExpiresAt: number }>;
  }>('/api/v1/auth/security', { token: superToken });
  assert.equal(ownerSecurity.status, 200);
  assert.equal(ownerSecurity.data.mfaEnabled, true);
  assert.equal(ownerSecurity.data.mfaRequired, true);
  assert.equal(ownerSecurity.data.idleTimeoutMinutes, 15);
  assert.equal(ownerSecurity.data.absoluteTimeoutHours, 4);
  assert.ok(ownerSecurity.data.sessions.some((session) => session.current));
  assert.ok(ownerSecurity.data.currentSessionId);

  // Superadmin may reset only an Admin account; all of that account's sessions
  // and outstanding login/setup challenges must be revoked.
  const adminMfaBefore = getDb()
    .prepare('SELECT mfa_enabled FROM pengguna WHERE id = ?')
    .get(adminUserId) as { mfa_enabled: number };
  assert.equal(adminMfaBefore.mfa_enabled, 1);
  const mfaReset = await apiJson<{ ok: boolean; message: string }>(
    `/api/v1/superadmin/accounts/${adminUserId}/mfa/reset`,
    { method: 'POST', token: superToken, body: {} }
  );
  assert.equal(mfaReset.status, 200);
  assert.equal(
    (getDb().prepare('SELECT mfa_enabled FROM pengguna WHERE id = ?').get(adminUserId) as { mfa_enabled: number }).mfa_enabled,
    0
  );
  assert.equal(
    (getDb().prepare('SELECT COUNT(*) AS c FROM mfa_recovery_codes WHERE user_id = ?').get(adminUserId) as { c: number }).c,
    0
  );
  assert.equal(
    (getDb().prepare('SELECT COUNT(*) AS c FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL').get(adminUserId) as { c: number }).c,
    0
  );
  assert.equal((await apiJson('/api/v1/auth/me', { token: adminToken })).status, 401);

  // An expired idle session must be denied, but its stale cookie must not block
  // a fresh password login and the required MFA challenge.
  const ownerSession = getDb().prepare(`
    SELECT jti FROM auth_sessions WHERE user_id = (
      SELECT id FROM pengguna WHERE username = 'owner_prod'
    ) AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1
  `).get() as { jti: string };
  getDb().prepare('UPDATE auth_sessions SET idle_expires_at = ? WHERE jti = ?')
    .run(Date.now() - 1, ownerSession.jti);
  assert.equal((await apiJson('/api/v1/auth/me', { token: superToken })).status, 401);

  const staleCookieLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: superToken,
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ identifier: 'owner_prod', password: superPassword }),
  });
  assert.equal(staleCookieLogin.status, 200);
  const staleCookieLoginBody = await staleCookieLogin.json() as { mfaRequired?: boolean; challengeId?: string };
  assert.equal(staleCookieLoginBody.mfaRequired, true);
  assert.ok(staleCookieLoginBody.challengeId);
});
