import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { signToken } from '../src/server/auth.ts';
import { closeDb, getDb } from '../src/server/db.ts';
import { registerApiRoutes } from '../src/server/routes.ts';
import { runMigrations } from '../src/server/db/migrations.ts';
import {
  computeMonthlySummary,
  getEffectivePolicy,
  getWorkforceToday,
  haversineMeters,
  resolveDayForEmployee,
} from '../src/server/services/resolver.ts';
import { getWibDateString } from '../src/server/time.ts';
import type { AttendanceFeedPost, Karyawan, Role } from '../src/shared/types.ts';
import { isGpsAccuracyAcceptable, isWithinVerifiedGeofence, MAX_GPS_ACCURACY_METERS, requiresOfficeGeofence } from '../src/shared/geofence.ts';
import { getSessionWindowState } from '../src/shared/session-window.ts';
import { createServerClockSync, getEstimatedServerEpochMs } from '../src/shared/server-clock.ts';
import { shouldOpenAttendanceOnEntry } from '../src/shared/employee-entry.ts';
import { getHistoryCalendarStatus } from '../src/shared/history-calendar.ts';
import { formatServerEpochPartsInWib } from '../src/lib/server-clock-client.ts';
import { buildAttendanceShareCaption } from '../src/lib/attendance-share.ts';
import {
  buildMonitoringCheckInCaption,
  computeMonitoringCheckInStats,
  groupMonitoringRowsByOffice,
  sortMonitoringCheckInRows,
  type MonitoringCheckInRow,
} from '../src/lib/monitoring-snapshot.ts';

// Isolate core test suite to a temporary SQLite directory so running `npm test`
// never mutates the live application database.
const CORE_TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bignet-core-test-'));
process.env.DATA_DIR = CORE_TEST_TMP_DIR;
process.env.DB_PATH = path.join(CORE_TEST_TMP_DIR, 'core_test.db');
process.env.SEED_DEMO_DATA = 'true';
process.env.ALLOW_DEMO_LOGIN = 'true';

test.after(() => {
  closeDb();
  fs.rmSync(CORE_TEST_TMP_DIR, { recursive: true, force: true });
});

test('Migration detaches legacy Superadmin from employees and archives its old profile', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE karyawan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nik TEXT NOT NULL UNIQUE,
        nama_lengkap TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        no_hp TEXT NOT NULL DEFAULT '',
        kantor_id INTEGER NOT NULL,
        bidang_id INTEGER NOT NULL,
        jabatan TEXT NOT NULL,
        tanggal_masuk TEXT NOT NULL,
        foto_profil_path TEXT,
        foto_profil_updated_at TEXT,
        aktif INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE pengguna (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('KARYAWAN','ADMIN','SUPERADMIN')),
        karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
        aktif INTEGER NOT NULL DEFAULT 1,
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    const migrationInsert = db.prepare(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`
    );
    for (const version of ['001', '002', '003', '004', '005', '006', '007', '008', '009']) {
      migrationInsert.run(version, 'legacy_test', '2026-11-17T00:00:00+07:00');
    }

    db.prepare(
      `INSERT INTO karyawan (
         id, nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan, tanggal_masuk, aktif
       ) VALUES
         (1, 'BG-001', 'Budi Hartono', 'owner@bignet.id', '08110000001', 1, 1, 'Owner / CEO', '2021-01-10', 1),
         (2, 'BG-002', 'Andi Pratama', 'andi@bignet.id', '08110000002', 1, 1, 'NOC Engineer', '2023-02-15', 1)`
    ).run();

    db.prepare(
      `INSERT INTO pengguna (
         id, username, email, password_hash, role, karyawan_id, aktif, token_version, created_at
       ) VALUES (1, 'owner', 'owner@bignet.id', 'hash', 'SUPERADMIN', 1, 1, 1, '2021-01-10')`
    ).run();

    const applied = runMigrations(db);
    assert.deepEqual(applied, [
      '010_separate_superadmin_accounts_from_employee_records',
      '011_exclude_legacy_superadmin_profiles_from_employee_master',
      '012_enforce_role_employee_link_invariant',
      '013_standalone_superadmin_profile_photos',
      '014_allow_single_session_attendance_policies',
      '015_support_holiday_emergency_work_requests',
      '016_employee_specific_holidays',
      '017_employee_offboarding_columns',
    ]);

    const ownerAccount = db.prepare(
      `SELECT role, karyawan_id, nama_tampilan, no_hp FROM pengguna WHERE username = 'owner'`
    ).get() as {
      role: string;
      karyawan_id: number | null;
      nama_tampilan: string;
      no_hp: string;
    };
    assert.equal(ownerAccount.role, 'SUPERADMIN');
    assert.equal(ownerAccount.karyawan_id, null);
    assert.equal(ownerAccount.nama_tampilan, 'Budi Hartono');
    assert.equal(ownerAccount.no_hp, '08110000001');

    const archivedOwner = db.prepare(
      `SELECT aktif, is_system_archive, jabatan FROM karyawan WHERE id = 1`
    ).get() as { aktif: number; is_system_archive: number; jabatan: string };
    assert.equal(archivedOwner.aktif, 0);
    assert.equal(archivedOwner.is_system_archive, 1);
    assert.equal(archivedOwner.jabatan, 'Akun Pemilik Sistem (Arsip)');

    const ordinaryEmployee = db.prepare(
      `SELECT aktif, is_system_archive FROM karyawan WHERE id = 2`
    ).get() as { aktif: number; is_system_archive: number };
    assert.equal(ordinaryEmployee.aktif, 1);
    assert.equal(ordinaryEmployee.is_system_archive, 0);

    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    assert.throws(
      () => db.prepare(
        `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
         VALUES ('bad_owner', 'bad_owner@bignet.id', 'hash', 'SUPERADMIN', 2, 1, 1, '2026-11-17')`
      ).run(),
      /SUPERADMIN harus tanpa profil karyawan/i
    );
    assert.throws(
      () => db.prepare(
        `UPDATE pengguna SET karyawan_id = 2 WHERE username = 'owner'`
      ).run(),
      /SUPERADMIN harus tanpa profil karyawan/i
    );
    assert.throws(
      () => db.prepare(
        `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
         VALUES ('bad_employee', 'bad_employee@bignet.id', 'hash', 'KARYAWAN', NULL, 1, 1, '2026-11-17')`
      ).run(),
      /SUPERADMIN harus tanpa profil karyawan/i
    );
  } finally {
    db.close();
  }
});

test('Geofence Haversine distance calculation', () => {
  const distSame = haversineMeters(-6.2088, 106.8456, -6.2088, 106.8456);
  assert.equal(distSame, 0);
  const distNear = haversineMeters(-6.2088, 106.8456, -6.2095, 106.8460);
  assert.ok(distNear > 50 && distNear < 150, `Expected ~90m, got ${distNear}`);
});

test('Session attendance is allowed only inside the configured inclusive time window', () => {
  assert.equal(getSessionWindowState(8 * 60 + 59, '09:00', '09:30'), 'NOT_STARTED');
  assert.equal(getSessionWindowState(9 * 60, '09:00', '09:30'), 'OPEN');
  assert.equal(getSessionWindowState(9 * 60 + 15, '09:00', '09:30'), 'OPEN');
  assert.equal(getSessionWindowState(9 * 60 + 30, '09:00', '09:30'), 'OPEN');
  assert.equal(getSessionWindowState(9 * 60 + 31, '09:00', '09:30'), 'EXPIRED');
  assert.equal(getSessionWindowState(9 * 60, '09:30', '09:00'), 'INVALID');
});

test('Attendance gate uses monotonic server time after a mobile browser resumes', () => {
  const serverEpochAtResponse = Date.UTC(2026, 10, 17, 16, 12, 47);
  const sync = createServerClockSync(serverEpochAtResponse, 1000, 1400);
  assert.ok(sync);
  assert.equal(sync.serverEpochMsAtSync, serverEpochAtResponse + 200);

  // Even if the device wall clock is wrong, only the monotonic elapsed time
  // is used to move forward from the trusted server timestamp.
  const estimated = getEstimatedServerEpochMs(sync, 2400);
  assert.equal(estimated, serverEpochAtResponse + 1200);
  assert.equal(getEstimatedServerEpochMs(sync, 900), serverEpochAtResponse + 200);
  assert.equal(createServerClockSync(Number.NaN, 1000, 1400), null);
  assert.equal(createServerClockSync(serverEpochAtResponse, 1400, 1000), null);
});

test('Attendance location policy requires office on session 1 by default and can require every session', () => {
  assert.equal(requiresOfficeGeofence('SESI_PERTAMA_KANTOR', 1), true);
  assert.equal(requiresOfficeGeofence('SESI_PERTAMA_KANTOR', 2), false);
  assert.equal(requiresOfficeGeofence('SESI_PERTAMA_KANTOR', 4), false);
  assert.equal(requiresOfficeGeofence('SEMUA_SESI_KANTOR', 1), true);
  assert.equal(requiresOfficeGeofence('SEMUA_SESI_KANTOR', 2), true);
  assert.equal(requiresOfficeGeofence('SEMUA_SESI_KANTOR', 4), true);
  assert.equal(requiresOfficeGeofence(undefined, 2), false);
  assert.equal(requiresOfficeGeofence(undefined, 1), true);
  assert.equal(requiresOfficeGeofence('SESI_PERTAMA_KANTOR', 0), true);
});

test('Employee lands on attendance only when the next session is currently open', () => {
  const day = {
    mustCheckIn: true,
    sessionsCompleted: 0,
    policySnapshot: {
      jumlahSesi: 2,
      sesiList: [
        { jam_mulai: '09:00', jam_selesai: '09:30' },
        { jam_mulai: '17:00', jam_selesai: '17:30' },
      ],
    },
  };

  assert.equal(shouldOpenAttendanceOnEntry(day, '08:59:59'), false);
  assert.equal(shouldOpenAttendanceOnEntry(day, '09:00:00'), true);
  assert.equal(shouldOpenAttendanceOnEntry(day, '09:30:00'), true);
  assert.equal(shouldOpenAttendanceOnEntry(day, '09:31:00'), false);

  const nextSessionDue = { ...day, sessionsCompleted: 1 };
  assert.equal(shouldOpenAttendanceOnEntry(nextSessionDue, '17:10:00'), true);
  assert.equal(shouldOpenAttendanceOnEntry(nextSessionDue, '16:59:00'), false);

  assert.equal(
    shouldOpenAttendanceOnEntry({ ...day, sessionsCompleted: 2 }, '09:10:00'),
    false
  );
  assert.equal(shouldOpenAttendanceOnEntry({ ...day, mustCheckIn: false }, '09:10:00'), false);
  assert.equal(shouldOpenAttendanceOnEntry(day, 'invalid'), false);

  // A valid Admin-issued one-time permit opens attendance even after the normal window.
  const adminGranted = { ...day, checkinOverride: { active: true } };
  assert.equal(shouldOpenAttendanceOnEntry(adminGranted, '09:31:00'), true);
  assert.equal(
    shouldOpenAttendanceOnEntry({ ...day, checkinOverride: { active: false } }, '09:31:00'),
    false
  );
});

test('History calendar reflects attendance status and final Admin Override', () => {
  const base = {
    operationalStatus: 'HADIR' as const,
    isOverridden: false,
    payrollStatus: 'DIHITUNG_MASUK' as const,
  };
  assert.equal(getHistoryCalendarStatus(base), 'HADIR');
  assert.equal(
    getHistoryCalendarStatus({ ...base, operationalStatus: 'TIDAK_HADIR', payrollStatus: 'TIDAK_DIHITUNG_MASUK' }),
    'TIDAK_HADIR'
  );
  assert.equal(
    getHistoryCalendarStatus({ ...base, operationalStatus: 'BELUM_SELESAI', payrollStatus: 'TIDAK_DIHITUNG_MASUK' }),
    'BELUM_SELESAI'
  );
  assert.equal(
    getHistoryCalendarStatus({ ...base, operationalStatus: 'TIDAK_HADIR', isOverridden: true, payrollStatus: 'DIHITUNG_MASUK' }),
    'OVERRIDE_MASUK'
  );
  assert.equal(
    getHistoryCalendarStatus({ ...base, operationalStatus: 'HADIR', isOverridden: true, payrollStatus: 'TIDAK_DIHITUNG_MASUK' }),
    'OVERRIDE_TIDAK_MASUK'
  );
  assert.equal(
    getHistoryCalendarStatus({ ...base, operationalStatus: 'HARI_LIBUR' }),
    'HARI_LIBUR'
  );
});

test('GPS accuracy and radius uncertainty are validated conservatively', () => {
  assert.equal(MAX_GPS_ACCURACY_METERS, 100);
  assert.equal(isGpsAccuracyAcceptable(10), true);
  assert.equal(isGpsAccuracyAcceptable(100), true);
  assert.equal(isGpsAccuracyAcceptable(100.1), false);
  assert.equal(isGpsAccuracyAcceptable(Number.NaN), false);
  assert.equal(isGpsAccuracyAcceptable(null), false);

  assert.equal(isWithinVerifiedGeofence(100, 10, 250), true);
  assert.equal(isWithinVerifiedGeofence(200, 50, 250), true);
  assert.equal(isWithinVerifiedGeofence(201, 50, 250), false);
  assert.equal(isWithinVerifiedGeofence(241, 10, 250), false);
});

test('Policy Hierarchy resolves KARYAWAN > BIDANG > DEFAULT', () => {
  const db = getDb();
  const today = getWibDateString();

  // Dimas (id 4) has KARYAWAN policy (4 sesi)
  const dimas = db.prepare('SELECT * FROM karyawan WHERE id = 4').get() as unknown as Karyawan;
  const dimasPolicy = getEffectivePolicy(db, dimas, today);
  assert.ok(dimasPolicy);
  assert.equal(dimasPolicy.level, 'KARYAWAN');
  assert.equal(dimasPolicy.jumlah_sesi, 4);

  // Andi (id 2) is Teknisi Lapangan (BIDANG policy: 3 sesi)
  const andi = db.prepare('SELECT * FROM karyawan WHERE id = 2').get() as unknown as Karyawan;
  const andiPolicy = getEffectivePolicy(db, andi, today);
  assert.ok(andiPolicy);
  assert.equal(andiPolicy.level, 'BIDANG');
  assert.equal(andiPolicy.jumlah_sesi, 3);

  // Use a synthetic division with no matching BIDANG policy to verify DEFAULT fallback.
  // A real employee such as Dewi may have a company-specific NOC BIDANG policy in the local DB.
  const dewi = db.prepare('SELECT * FROM karyawan WHERE id = 6').get() as unknown as Karyawan;
  const employeeWithoutMatchingPolicy = { ...dewi, id: -999999, bidang_id: -999999 };
  const defaultPolicy = getEffectivePolicy(db, employeeWithoutMatchingPolicy, today);
  assert.ok(defaultPolicy);
  assert.equal(defaultPolicy.level, 'DEFAULT');
  assert.equal(defaultPolicy.jumlah_sesi, 4);
});

test('Kantor A Sunday is HARI_LIBUR (not TIDAK_HADIR), Kantor B Sunday is 2 sessions', () => {
  const db = getDb();
  const ym = getWibDateString().slice(0, 7);
  // Find a Sunday in current month
  let sunday = `${ym}-01`;
  for (let d = 1; d <= 7; d++) {
    const cand = `${ym}-${String(d).padStart(2, '0')}`;
    if (new Date(`${cand}T00:00:00Z`).getUTCDay() === 0) {
      sunday = cand;
      break;
    }
  }

  // Rina (id 3, Kantor A)
  const rina = db.prepare('SELECT * FROM karyawan WHERE id = 3').get() as unknown as Karyawan;
  const rinaSun = resolveDayForEmployee(db, rina, sunday);
  assert.equal(rinaSun.dayType, 'HARI_LIBUR');
  assert.notEqual(rinaSun.operationalStatus, 'TIDAK_HADIR');

  // Fajar (id 5, Kantor B)
  const fajar = db.prepare('SELECT * FROM karyawan WHERE id = 5').get() as unknown as Karyawan;
  const fajarSun = resolveDayForEmployee(db, fajar, sunday);
  assert.equal(fajarSun.dayType, 'HARI_KERJA');
  assert.equal(fajarSun.policySnapshot.jumlahSesi, 2);
});

test('Workforce feed strips sensitive GPS, photo paths, and leave reasons', () => {
  const db = getDb();
  const list = getWorkforceToday(db);
  assert.ok(list.length > 0);
  const first = list[0] as unknown as Record<string, unknown>;
  assert.equal(first.lat, undefined);
  assert.equal(first.lng, undefined);
  assert.equal(first.foto_path, undefined);
  assert.equal(first.alasan, undefined);
});

test('Monthly summary totals HARI MASUK and TIDAK HADIR consistently', () => {
  const db = getDb();
  const ym = getWibDateString().slice(0, 7);
  const summary = computeMonthlySummary(db, 2, ym);
  assert.ok(summary !== null);
  assert.ok(summary.hariMasuk >= 1);
  assert.equal(typeof summary.tidakHadir, 'number');
});

test('Audit log is strictly append-only via SQLite triggers', () => {
  const db = getDb();
  const firstAudit = db.prepare('SELECT id FROM audit_log ORDER BY id ASC LIMIT 1').get() as { id: number };
  assert.ok(firstAudit);
  assert.throws(() => {
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(firstAudit.id);
  }, /append-only/i);
  assert.throws(() => {
    db.prepare("UPDATE audit_log SET alasan = 'tampered' WHERE id = ?").run(firstAudit.id);
  }, /append-only/i);
});

test('System settings table initializes default branding and login config', () => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM pengaturan_aplikasi WHERE id = 1').get() as Record<
    string,
    unknown
  >;
  assert.ok(settings);
  assert.equal(settings.nama_aplikasi, 'Absensi BIGNET');
  assert.equal(Number(settings.izin_demo_login), 1);
  assert.equal(settings.favicon_path, null);
  assert.equal(settings.favicon_updated_at, null);
});

test('Registration table and profile photo columns are initialized', () => {
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(karyawan)').all() as { name: string }[];
  assert.ok(cols.some((c) => c.name === 'foto_profil_path'));
  assert.ok(cols.some((c) => c.name === 'foto_profil_updated_at'));

  const regTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pendaftaran_akun'")
    .get() as { name: string } | undefined;
  assert.equal(regTable?.name, 'pendaftaran_akun');
});

test('System settings API strictly enforces SUPERADMIN access while keeping public settings open', async () => {
  const db = getDb();
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  registerApiRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const getUserByRole = (role: Role) =>
      db.prepare(`SELECT id, role, karyawan_id FROM pengguna WHERE role = ? AND aktif = 1 LIMIT 1`).get(role) as
        | { id: number; role: Role; karyawan_id: number | null }
        | undefined;

    const superadmin = getUserByRole('SUPERADMIN');
    const admin = getUserByRole('ADMIN');
    const karyawan = getUserByRole('KARYAWAN');
    assert.ok(superadmin && admin && karyawan);

    const makeToken = (u: { id: number; role: Role }) =>
      signToken({ userId: u.id, role: u.role, exp: Date.now() + 60_000 });

    // Server time endpoint returns valid finite epochMs
    const timeRes = await fetch(`${baseUrl}/api/v1/time`);
    assert.equal(timeRes.status, 200);
    const timeData = (await timeRes.json()) as { epochMs?: number };
    assert.equal(typeof timeData.epochMs, 'number');
    assert.ok(Number.isFinite(timeData.epochMs));

    // Unknown /api/v1/* endpoint returns 404 JSON instead of HTML
    const missingRes = await fetch(`${baseUrl}/api/v1/non-existent-route`);
    assert.equal(missingRes.status, 404);
    const missingData = (await missingRes.json()) as { error?: string };
    assert.ok(typeof missingData.error === 'string');

    // Public settings and default favicon are accessible without a token
    const pubRes = await fetch(`${baseUrl}/api/v1/settings/public`);
    assert.equal(pubRes.status, 200);
    const faviconRes = await fetch(`${baseUrl}/api/v1/assets/favicon`);
    assert.equal(faviconRes.status, 200);
    assert.equal(faviconRes.headers.get('content-type'), 'image/svg+xml');
    assert.equal(faviconRes.headers.get('x-content-type-options'), 'nosniff');

    // Unauthenticated /api/v1/settings returns 401
    const anonRes = await fetch(`${baseUrl}/api/v1/settings`);
    assert.equal(anonRes.status, 401);

    // ADMIN and KARYAWAN get 403 on GET & PUT /api/v1/settings
    const adminGetRes = await fetch(`${baseUrl}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${makeToken(admin)}` },
    });
    assert.equal(adminGetRes.status, 403);

    const adminPutRes = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${makeToken(admin)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nama_aplikasi: 'Unauthorized Change' }),
    });
    assert.equal(adminPutRes.status, 403);

    const empPutRes = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${makeToken(karyawan)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nama_aplikasi: 'Unauthorized Change' }),
    });
    assert.equal(empPutRes.status, 403);

    // SUPERADMIN gets 200 on GET /api/v1/settings
    const superGetRes = await fetch(`${baseUrl}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${makeToken(superadmin)}` },
    });
    assert.equal(superGetRes.status, 200);
    const superData = (await superGetRes.json()) as { settings: { nama_aplikasi: string } };
    assert.equal(superData.settings.nama_aplikasi, 'Absensi BIGNET');

    // SUPERADMIN is a standalone owner identity, not an employee with attendance.
    assert.equal(superadmin.karyawan_id, null);
    const ownerProfile = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${makeToken(superadmin)}` },
    });
    assert.equal(ownerProfile.status, 200);
    const ownerData = (await ownerProfile.json()) as { user: { karyawan_id: number | null; role: Role } };
    assert.equal(ownerData.user.role, 'SUPERADMIN');
    assert.equal(ownerData.user.karyawan_id, null);

    const ownerAttendance = await fetch(`${baseUrl}/api/v1/attendance/today`, {
      headers: { Authorization: `Bearer ${makeToken(superadmin)}` },
    });
    assert.equal(ownerAttendance.status, 403);

    const testOwnerUsername = `owner_pengujian_${Date.now()}`;
    const testOwnerEmail = `${testOwnerUsername}@bignet.id`;
    const createOwner = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${makeToken(superadmin)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nama_lengkap: 'Owner Pengujian',
        username: testOwnerUsername,
        email: testOwnerEmail,
        no_hp: '081234567890',
        password: 'OwnerPassword123',
        role: 'SUPERADMIN',
      }),
    });
    assert.equal(createOwner.status, 201);
    const ownerAccount = db.prepare(
      `SELECT role, karyawan_id, nama_tampilan FROM pengguna WHERE username = ?`
    ).get(testOwnerUsername) as { role: string; karyawan_id: number | null; nama_tampilan: string };
    assert.equal(ownerAccount.role, 'SUPERADMIN');
    assert.equal(ownerAccount.karyawan_id, null);
    assert.equal(ownerAccount.nama_tampilan, 'Owner Pengujian');
    assert.equal(
      db.prepare(`SELECT id FROM karyawan WHERE email = ?`).get(testOwnerEmail),
      undefined
    );

    // Beranda Instagram-style Feed accessible to ALL roles (KARYAWAN, ADMIN, SUPERADMIN)
    for (const roleUser of [karyawan, admin, superadmin]) {
      const feedRes = await fetch(`${baseUrl}/api/v1/feed/today`, {
        headers: { Authorization: `Bearer ${makeToken(roleUser)}` },
      });
      assert.equal(feedRes.status, 200);
      const feedData = (await feedRes.json()) as {
        posts: { id: number; namaLengkap: string; kantorNama: string; hasFoto: boolean }[];
        roster: { karyawanId: number; namaLengkap: string }[];
      };
      assert.ok(Array.isArray(feedData.posts) && feedData.posts.length > 0);
      assert.ok(Array.isArray(feedData.roster) && feedData.roster.length > 0);
      assert.ok(
        !feedData.roster.some((member) => member.namaLengkap === 'Budi Santoso'),
        'SUPERADMIN must not appear in the employee roster'
      );
      assert.ok(feedData.posts[0].namaLengkap);
      assert.ok(feedData.posts[0].kantorNama);

      // Every role can view today's attendance feed photos
      const photoPost = feedData.posts.find((p) => p.hasFoto);
      assert.ok(photoPost);
      const photoRes = await fetch(`${baseUrl}/api/v1/photos/${photoPost.id}`, {
        headers: { Authorization: `Bearer ${makeToken(roleUser)}` },
      });
      assert.equal(photoRes.status, 200);
    }

    // Attendance session enforces camera-only and session start time
    const empRow = db
      .prepare(
        `SELECT u.id, u.role, u.karyawan_id FROM pengguna u WHERE u.role = 'KARYAWAN' AND u.aktif = 1 ORDER BY u.id ASC`
      )
      .all() as { id: number; role: Role; karyawan_id: number }[];
    const fajarUser = empRow.find((e) => e.karyawan_id === 5) || karyawan;
    const fajarToken = makeToken({ id: fajarUser.id, role: fajarUser.role });

    // 1x1 transparent PNG base64 sample
    const samplePng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Read the actual employee policy so this test remains valid when the local DB
    // contains Admin-created schedules that differ from the development seed.
    const fajarEmployee = db
      .prepare('SELECT * FROM karyawan WHERE id = ?')
      .get(fajarUser.karyawan_id) as unknown as Karyawan;
    const fajarPolicy = getEffectivePolicy(db, fajarEmployee, getWibDateString());
    assert.ok(fajarPolicy);
    const firstSession = fajarPolicy.sesiList[0];
    const nowTimeRes = await fetch(`${baseUrl}/api/v1/time`);
    const nowTimeJson = (await nowTimeRes.json()) as { time: string };
    const nowHm = nowTimeJson.time.slice(0, 5);
    const nowMinutes = Number(nowHm.slice(0, 2)) * 60 + Number(nowHm.slice(3, 5));
    const firstStart = Number(firstSession.jam_mulai.slice(0, 2)) * 60 + Number(firstSession.jam_mulai.slice(3, 5));
    const firstEnd = Number(firstSession.jam_selesai.slice(0, 2)) * 60 + Number(firstSession.jam_selesai.slice(3, 5));

    if (nowMinutes < firstStart) {
      const earlyRes = await fetch(`${baseUrl}/api/v1/attendance/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fajarToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urutanSesi: 1,
          fotoBase64: samplePng,
          fotoSource: 'BROWSER_CAMERA',
        }),
      });
      assert.equal(earlyRes.status, 400);
      const earlyData = (await earlyRes.json()) as { error: string };
      assert.match(earlyData.error, /belum dimulai/i);
    } else if (nowMinutes > firstEnd) {
      const expiredRes = await fetch(`${baseUrl}/api/v1/attendance/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fajarToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urutanSesi: 1,
          fotoBase64: samplePng,
          fotoSource: 'BROWSER_CAMERA',
        }),
      });
      assert.equal(expiredRes.status, 400);
      const expiredData = (await expiredRes.json()) as { error: string };
      assert.match(expiredData.error, /sudah berakhir/i);
    } else {
      // Test the camera-only rule only while the employee's actual session is open.
      const uploadRes = await fetch(`${baseUrl}/api/v1/attendance/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fajarToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urutanSesi: 1,
          fotoBase64: samplePng,
          fotoSource: 'FILE_UPLOAD',
        }),
      });
      assert.equal(uploadRes.status, 400);
      const uploadData = (await uploadRes.json()) as { error: string };
      assert.match(uploadData.error, /kamera browser/i);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Server clock client formats authoritative server epoch strictly in Asia/Jakarta WIB regardless of host timezone', () => {
  // 2026-11-18T18:30:45Z is 2026-11-19 01:30:45 WIB (next calendar day in Jakarta)
  const utcInstant = Date.UTC(2026, 10, 18, 18, 30, 45);
  const parts = formatServerEpochPartsInWib(utcInstant);
  assert.equal(parts.dateWib, '2026-11-19');
  assert.equal(parts.yearMonthWib, '2026-11');
  assert.equal(parts.timeWib, '01:30:45');
  assert.equal(parts.hmWib, '01:30');
  assert.match(parts.dateTimeLabelWib, /01:30:45 WIB$/);
});

test('Attendance share caption includes accurate metadata, status, location, and employee caption', () => {
  const samplePost: AttendanceFeedPost = {
    id: 42,
    karyawanId: 2,
    nik: '2024002',
    namaLengkap: 'Dimas Nugroho',
    jabatan: 'Lead Network Technician',
    role: 'KARYAWAN',
    fotoProfilUpdatedAt: null,
    bidangId: 1,
    bidangNama: 'Teknisi Lapangan',
    kantorId: 2,
    kantorNama: 'Kantor Operasional B',
    kantorAlamat: 'Jl. Merdeka No. 45, Jakarta',
    lokasiAktualAlamat: 'Jl. Medan Merdeka Barat No. 12, Jakarta Pusat',
    tanggal: '2026-11-19',
    urutanSesi: 2,
    namaSesi: 'Progres Siang',
    waktuServer: '2026-11-19T11:48:22+07:00',
    jamWib: '11:48',
    statusKetepatan: 'TEPAT_WAKTU',
    keterlambatanMenit: 0,
    jarakKantorMeter: 24,
    dalamGeofence: true,
    lat: -6.175392,
    lng: 106.827153,
    tipeAktivitas: 'AKTIVITAS',
    deskripsiAktivitas: 'Pengecekan ODP pelanggan sektor timur selesai normal.',
    hasFoto: true,
    sessionsCompletedToday: 2,
    sessionsTotalToday: 4,
    operationalStatusToday: 'BELUM_SELESAI',
  };

  const caption = buildAttendanceShareCaption(samplePost);
  assert.match(caption, /BUKTI KEHADIRAN — ABSENSI BIGNET/);
  assert.match(caption, /Dimas Nugroho \(2024002\)/);
  assert.match(caption, /Lead Network Technician · Teknisi Lapangan/);
  assert.match(caption, /Sesi 2\/4 — Progres Siang/);
  assert.match(caption, /Tanggal & Jam: .*19 November 2026 · 11:48:22 WIB/);
  assert.match(caption, /Status: Tepat Waktu/);
  assert.match(caption, /Caption \(Aktivitas Pekerjaan\)/);
  assert.match(caption, /Pengecekan ODP pelanggan sektor timur selesai normal\./);
  assert.match(caption, /Jl\. Medan Merdeka Barat No\. 12, Jakarta Pusat/);
  assert.match(caption, /Kantor Operasional B \(Dalam Radius · 24 m\)/);
  assert.match(caption, /Koordinat GPS: -6\.175392, 106\.827153/);

  const lateStandbyCaption = buildAttendanceShareCaption({
    ...samplePost,
    statusKetepatan: 'TERLAMBAT',
    keterlambatanMenit: 14,
    tipeAktivitas: 'STANDBY',
    dalamGeofence: false,
    jarakKantorMeter: 1350,
    deskripsiAktivitas: 'Standby monitoring jaringan di lokasi mitra.',
  });
  assert.match(lateStandbyCaption, /Status: Terlambat 14 menit/);
  assert.match(lateStandbyCaption, /Caption \(Standby \/ Siaga\)/);
  assert.match(lateStandbyCaption, /Luar Radius · 1,4 km/);
});

test('Monitoring Hari Ini check-in snapshot groups by office location and captures checked-in, belum absen, tidak masuk, and cuti employees', () => {
  const rows: MonitoringCheckInRow[] = [
    {
      karyawanId: 1,
      nik: '2024001',
      namaLengkap: 'Fajar Hidayat',
      jabatan: 'NOC',
      kantorId: 1,
      kantorNama: 'Kantor Pusat A (Jakarta)',
      bidangNama: 'NOC',
      isWorkingToday: true,
      operationalStatus: 'BELUM_SELESAI',
      sessionsCompleted: 0,
      sessionsTotal: 3,
      sesi1Time: null,
      sesi1Terlambat: false,
      keterlambatanMenit: 0,
      dalamGeofence: null,
    },
    {
      karyawanId: 2,
      nik: '2024002',
      namaLengkap: 'Dewi Lestari',
      jabatan: 'Teknisi',
      kantorId: 2,
      kantorNama: 'Kantor Operasional B (Bandung)',
      bidangNama: 'Teknisi Lapangan',
      isWorkingToday: true,
      operationalStatus: 'BELUM_SELESAI',
      sessionsCompleted: 1,
      sessionsTotal: 4,
      sesi1Time: '08:18',
      sesi1Terlambat: true,
      keterlambatanMenit: 18,
      dalamGeofence: true,
    },
    {
      karyawanId: 3,
      nik: '2024003',
      namaLengkap: 'Andi Pratama',
      jabatan: 'Staff',
      kantorId: 1,
      kantorNama: 'Kantor Pusat A (Jakarta)',
      bidangNama: 'Administrasi',
      isWorkingToday: true,
      operationalStatus: 'BELUM_SELESAI',
      sessionsCompleted: 1,
      sessionsTotal: 3,
      sesi1Time: '07:52',
      sesi1Terlambat: false,
      keterlambatanMenit: 0,
      dalamGeofence: true,
    },
    {
      karyawanId: 4,
      nik: '2024004',
      namaLengkap: 'Hendra Wijaya',
      jabatan: 'Staff',
      kantorId: 2,
      kantorNama: 'Kantor Operasional B (Bandung)',
      bidangNama: 'Administrasi',
      isWorkingToday: false,
      operationalStatus: 'TIDAK_HADIR',
      sessionsCompleted: 0,
      sessionsTotal: 3,
      sesi1Time: null,
      sesi1Terlambat: false,
      keterlambatanMenit: 0,
      dalamGeofence: null,
    },
    {
      karyawanId: 5,
      nik: '2024005',
      namaLengkap: 'Rina Kusuma',
      jabatan: 'CS',
      kantorId: 1,
      kantorNama: 'Kantor Pusat A (Jakarta)',
      bidangNama: 'Customer Support',
      isWorkingToday: false,
      operationalStatus: 'CUTI',
      sessionsCompleted: 0,
      sessionsTotal: 3,
      sesi1Time: null,
      sesi1Terlambat: false,
      keterlambatanMenit: 0,
      dalamGeofence: null,
    },
  ];

  const sorted = sortMonitoringCheckInRows(rows);
  assert.deepEqual(
    sorted.map((r) => r.namaLengkap),
    ['Andi Pratama', 'Dewi Lestari', 'Fajar Hidayat', 'Hendra Wijaya', 'Rina Kusuma']
  );

  const groups = groupMonitoringRowsByOffice(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].officeName, 'Kantor Pusat A');
  assert.deepEqual(
    groups[0].rows.map((r) => r.namaLengkap),
    ['Andi Pratama', 'Fajar Hidayat', 'Rina Kusuma']
  );
  assert.equal(groups[1].officeName, 'Kantor Operasional B');
  assert.deepEqual(
    groups[1].rows.map((r) => r.namaLengkap),
    ['Dewi Lestari', 'Hendra Wijaya']
  );

  const stats = computeMonitoringCheckInStats(rows);
  assert.equal(stats.totalKaryawan, 5);
  assert.equal(stats.totalWajibKerja, 4);
  assert.equal(stats.sudahMasuk, 2);
  assert.equal(stats.tepatWaktu, 1);
  assert.equal(stats.terlambat, 1);
  assert.equal(stats.belumAbsen, 2); // Fajar (BELUM_ABSEN) + Hendra (TIDAK_HADIR)
  assert.equal(stats.tidakWajibKerja, 1); // Rina (CUTI)

  const caption = buildMonitoringCheckInCaption({
    tanggal: '2026-11-19',
    serverTimeWib: '08:30:00',
    filterLabel: 'Semua Karyawan · Semua Kantor',
    rows,
  });
  assert.match(caption, /LAPORAN JAM MASUK HARIAN — ABSENSI BIGNET/);
  assert.match(caption, /Tanggal: .*19 November 2026/);
  assert.match(caption, /Waktu Snapshot: 08:30:00 WIB/);
  assert.match(caption, /2\/4 Masuk · 1 Tepat Waktu · 1 Terlambat · 2 Belum\/Tidak Masuk · 1 Izin\/Libur/);
  assert.match(caption, /📍 Kantor Pusat A/);
  assert.match(caption, /01\. \*07:52 WIB\* — Andi Pratama \(Tepat Waktu\)/);
  assert.match(caption, /02\. \*Belum Absen\* — Fajar Hidayat/);
  assert.match(caption, /03\. \*CUTI\* — Rina Kusuma/);
  assert.match(caption, /📍 Kantor Operasional B/);
  assert.match(caption, /01\. \*08:18 WIB\* — Dewi Lestari \(Terlambat 18 mnt\)/);
  assert.match(caption, /02\. \*Tidak Masuk\* — Hendra Wijaya/);
});

test('Future berlaku_mulai suppresses active sessions and surfaces upcomingPolicy without marking TIDAK_HADIR', () => {
  const db = getDb();
  const dewi = db.prepare('SELECT * FROM karyawan WHERE id = 6').get() as unknown as Karyawan;
  const futureDate = '2099-12-22';

  // Temporarily move all active policies to a future effective date and verify restoration in finally
  const originalDates = db
    .prepare('SELECT id, berlaku_mulai FROM kebijakan_absensi')
    .all() as { id: number; berlaku_mulai: string }[];

  try {
    db.prepare('UPDATE kebijakan_absensi SET berlaku_mulai = ?').run(futureDate);
    const checkDate = '2026-11-20'; // Friday (normal weekday)
    const effective = getEffectivePolicy(db, dewi, checkDate);
    assert.equal(effective, null);

    const day = resolveDayForEmployee(db, dewi, checkDate);
    assert.equal(day.mustCheckIn, false);
    assert.equal(day.policySnapshot.policyId, null);
    assert.equal(day.policySnapshot.level, 'BELUM_BERLAKU');
    assert.equal(day.policySnapshot.jumlahSesi, 0);
    assert.equal(day.policySnapshot.sesiList.length, 0);
    assert.notEqual(day.operationalStatus, 'TIDAK_HADIR');
    assert.equal(day.operationalStatus, 'BELUM_SELESAI');
    assert.ok(day.upcomingPolicy);
    assert.equal(day.upcomingPolicy.berlakuMulai, futureDate);
    assert.ok(day.upcomingPolicy.sesiList.length > 0);
  } finally {
    const restoreStmt = db.prepare('UPDATE kebijakan_absensi SET berlaku_mulai = ? WHERE id = ?');
    for (const row of originalDates) {
      restoreStmt.run(row.berlaku_mulai, row.id);
    }
  }
});

test('System setting wajib_gps_absensi controls whether GPS coordinates are required on check-in', async () => {
  const db = getDb();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  registerApiRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const today = getWibDateString();

  const originalSetting = db
    .prepare('SELECT wajib_gps_absensi FROM pengaturan_aplikasi WHERE id = 1')
    .get() as { wajib_gps_absensi: number };

  // Find a KARYAWAN user and give them an open all-day KARYAWAN policy for this test
  const empUser = db
    .prepare(
      `SELECT id, role, karyawan_id, token_version FROM pengguna WHERE role = 'KARYAWAN' AND aktif = 1 LIMIT 1`
    )
    .get() as { id: number; role: Role; karyawan_id: number; token_version: number };
  const token = signToken({
    userId: empUser.id,
    role: empUser.role,
    tv: empUser.token_version,
    exp: Date.now() + 3_600_000,
  });
  const nowIso = `${today}T08:00:00+07:00`;

  const createdPolicy = db
    .prepare(
      `INSERT INTO kebijakan_absensi (
         level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
         toleransi_terlambat_menit, aturan_lokasi, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
         libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk, sakit_dihitung_masuk,
         cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
       ) VALUES ('KARYAWAN', NULL, ?, 'Test GPS Toggle Policy', 1, 1, 15, 'SESI_PERTAMA_KANTOR', 0, 0, 1, 1, 0, 1, 1, ?, 1, ?)`
    )
    .run(empUser.karyawan_id, today, nowIso);
  const testPolicyId = Number(createdPolicy.lastInsertRowid);
  db.prepare(
    `INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
     VALUES (?, 1, 'Sesi 1 · Uji GPS', '00:00', '23:59', 0, 0, 1)`
  ).run(testPolicyId);

  const existingRecords = db
    .prepare('SELECT id FROM absensi_sesi WHERE karyawan_id = ? AND tanggal = ?')
    .all(empUser.karyawan_id, today) as { id: number }[];
  const createdSessionIds: number[] = [];

  try {
    // Only test when no pre-existing session blocks urutan 1
    if (existingRecords.length === 0) {
      // 1. With wajib_gps_absensi = 1, missing GPS must be rejected (400)
      db.prepare('UPDATE pengaturan_aplikasi SET wajib_gps_absensi = 1 WHERE id = 1').run();
      const rejectRes = await fetch(`${baseUrl}/api/v1/attendance/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urutanSesi: 1,
          lat: null,
          lng: null,
          accuracyMeter: null,
          tipeAktivitas: 'CHECK_IN',
          deskripsiAktivitas: 'Uji wajib GPS aktif',
        }),
      });
      assert.equal(rejectRes.status, 400);

      // 2. With wajib_gps_absensi = 0, missing GPS must succeed (201)
      db.prepare('UPDATE pengaturan_aplikasi SET wajib_gps_absensi = 0 WHERE id = 1').run();
      const todayRes = await fetch(`${baseUrl}/api/v1/attendance/today`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const todayJson = (await todayRes.json()) as { wajibGpsAbsensi: boolean };
      assert.equal(todayJson.wajibGpsAbsensi, false);

      const allowRes = await fetch(`${baseUrl}/api/v1/attendance/session`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urutanSesi: 1,
          lat: null,
          lng: null,
          accuracyMeter: null,
          tipeAktivitas: 'CHECK_IN',
          deskripsiAktivitas: 'Uji wajib GPS nonaktif',
        }),
      });
      assert.equal(allowRes.status, 201);
      const allowJson = (await allowRes.json()) as { sessionId: number };
      createdSessionIds.push(allowJson.sessionId);
    }
  } finally {
    db.prepare('UPDATE pengaturan_aplikasi SET wajib_gps_absensi = ? WHERE id = 1').run(
      originalSetting.wajib_gps_absensi
    );
    for (const sid of createdSessionIds) {
      db.prepare('DELETE FROM absensi_sesi WHERE id = ?').run(sid);
    }
    db.prepare('DELETE FROM kebijakan_absensi WHERE id = ?').run(testPolicyId);
    server.close();
  }
});

test('Employee-specific holidays (target_scope = KARYAWAN) apply only to targeted employees and hydrate via API', async () => {
  const db = getDb();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  registerApiRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const operator = db
    .prepare(`SELECT id, role, token_version FROM pengguna WHERE role = 'ADMIN' AND aktif = 1 LIMIT 1`)
    .get() as { id: number; role: Role; token_version: number };
  const saToken = signToken({
    userId: operator.id,
    role: operator.role,
    tv: operator.token_version,
    exp: Date.now() + 3_600_000,
  });

  // Pick two distinct active KARYAWAN employees
  const empUsers = db
    .prepare(
      `SELECT k.* FROM karyawan k
       JOIN pengguna u ON u.karyawan_id = k.id
       WHERE k.aktif = 1 AND u.aktif = 1 AND u.role = 'KARYAWAN'
       ORDER BY k.id ASC LIMIT 2`
    )
    .all() as unknown as Karyawan[];
  assert.ok(empUsers.length >= 2, 'Expected at least 2 active KARYAWAN employees');
  const [empA, empB] = empUsers;

  // Use a clean Friday far from seeded holidays
  const testDate = '2026-12-25';
  let createdHolidayId: number | null = null;

  try {
    // Reject KARYAWAN scope with empty karyawan_ids
    const invalidRes = await fetch(`${baseUrl}/api/v1/holidays`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${saToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tanggal: testDate,
        nama: 'Libur Natal Khusus',
        target_scope: 'KARYAWAN',
        karyawan_ids: [],
        dihitung_masuk: 1,
      }),
    });
    assert.equal(invalidRes.status, 400);

    // Create employee-specific holiday targeting only empA
    const createRes = await fetch(`${baseUrl}/api/v1/holidays`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${saToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tanggal: testDate,
        nama: 'Libur Natal Khusus',
        target_scope: 'KARYAWAN',
        karyawan_ids: [empA.id],
        dihitung_masuk: 1,
      }),
    });
    assert.equal(createRes.status, 201);
    const createdJson = (await createRes.json()) as { id: number };
    createdHolidayId = createdJson.id;
    assert.ok(createdHolidayId > 0);

    // Verify GET /api/v1/holidays hydrates target_scope and target_karyawan
    const listRes = await fetch(`${baseUrl}/api/v1/holidays`, {
      headers: { Authorization: `Bearer ${saToken}` },
    });
    assert.equal(listRes.status, 200);
    const { items: holidays } = (await listRes.json()) as {
      items: Array<{
        id: number;
        target_scope: string;
        karyawan_ids: number[];
        target_karyawan: Array<{ id: number; nama_lengkap: string }>;
      }>;
    };
    const found = holidays.find((h) => h.id === createdHolidayId);
    assert.ok(found);
    assert.equal(found.target_scope, 'KARYAWAN');
    assert.deepEqual(found.karyawan_ids, [empA.id]);
    assert.equal(found.target_karyawan.length, 1);
    assert.equal(found.target_karyawan[0].id, empA.id);

    // Resolver: empA gets HARI_LIBUR (DIHITUNG_MASUK), empB stays HARI_KERJA
    const dayA = resolveDayForEmployee(db, empA, testDate);
    assert.equal(dayA.dayType, 'HARI_LIBUR');
    assert.equal(dayA.mustCheckIn, false);
    assert.equal(dayA.payrollStatus, 'DIHITUNG_MASUK');
    assert.equal(dayA.holidayInfo?.nama, 'Libur Natal Khusus');

    const dayB = resolveDayForEmployee(db, empB, testDate);
    assert.notEqual(dayB.dayType, 'HARI_LIBUR');
    assert.equal(dayB.holidayInfo, null);

    // Delete holiday and ensure join table is cleaned up
    const delRes = await fetch(`${baseUrl}/api/v1/holidays/${createdHolidayId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${saToken}` },
    });
    assert.equal(delRes.status, 200);
    const leftover = db
      .prepare('SELECT COUNT(*) as c FROM hari_libur_karyawan WHERE hari_libur_id = ?')
      .get(createdHolidayId) as { c: number };
    assert.equal(leftover.c, 0);
    createdHolidayId = null;
  } finally {
    if (createdHolidayId) {
      db.prepare('DELETE FROM hari_libur_karyawan WHERE hari_libur_id = ?').run(createdHolidayId);
      db.prepare('DELETE FROM hari_libur WHERE id = ?').run(createdHolidayId);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Account and employee management works without jabatan and auto-derives from bidang_kerja or Operator role', async () => {
  const db = getDb();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  registerApiRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const superadmin = db
    .prepare(`SELECT id, role, token_version FROM pengguna WHERE role = 'SUPERADMIN' AND aktif = 1 LIMIT 1`)
    .get() as { id: number; role: Role; token_version: number };
  const saToken = signToken({
    userId: superadmin.id,
    role: superadmin.role,
    tv: superadmin.token_version,
    exp: Date.now() + 3_600_000,
  });

  const bidang = db.prepare('SELECT id, nama FROM bidang_kerja ORDER BY id ASC LIMIT 1').get() as {
    id: number;
    nama: string;
  };
  const kantor = db.prepare('SELECT id FROM kantor WHERE aktif = 1 ORDER BY id ASC LIMIT 1').get() as { id: number };
  const suffix = Date.now();
  const createdUserIds: number[] = [];
  const createdEmpIds: number[] = [];

  try {
    // 1. Create KARYAWAN without jabatan
    const empRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama_lengkap: 'Uji Tanpa Jabatan',
        username: `uji_emp_${suffix}`,
        email: `uji_emp_${suffix}@bignet.id`,
        no_hp: '081234560001',
        password: 'Password123!',
        role: 'KARYAWAN',
        bidang_id: bidang.id,
        kantor_id: kantor.id,
        gaji_bulanan: 4500000,
      }),
    });
    assert.equal(empRes.status, 201);
    const empCreated = (await empRes.json()) as { userId: number; karyawanId: number };
    createdUserIds.push(empCreated.userId);
    createdEmpIds.push(empCreated.karyawanId);

    const empRow = db.prepare('SELECT jabatan, bidang_id FROM karyawan WHERE id = ?').get(empCreated.karyawanId) as {
      jabatan: string;
      bidang_id: number;
    };
    assert.equal(empRow.bidang_id, bidang.id);
    assert.equal(empRow.jabatan, bidang.nama);

    // 2. Create OPERATOR (ADMIN) without jabatan or bidang_id
    const opRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama_lengkap: 'Uji Operator Tanpa Bidang',
        username: `uji_op_${suffix}`,
        email: `uji_op_${suffix}@bignet.id`,
        no_hp: '081234560002',
        password: 'Password123!',
        role: 'ADMIN',
        kantor_id: kantor.id,
        gaji_bulanan: 5000000,
      }),
    });
    assert.equal(opRes.status, 201);
    const opCreated = (await opRes.json()) as { userId: number; karyawanId: number };
    createdUserIds.push(opCreated.userId);
    createdEmpIds.push(opCreated.karyawanId);

    const opRow = db.prepare('SELECT jabatan FROM karyawan WHERE id = ?').get(opCreated.karyawanId) as {
      jabatan: string;
    };
    assert.equal(opRow.jabatan, 'Operator');
  } finally {
    for (const uid of createdUserIds) {
      db.prepare('DELETE FROM pengguna WHERE id = ?').run(uid);
    }
    for (const eid of createdEmpIds) {
      db.prepare('DELETE FROM karyawan WHERE id = ?').run(eid);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Employee offboarding, reactivation, and audited permanent delete by Operator and Superadmin', async () => {
  const db = getDb();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  registerApiRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const superadmin = db
    .prepare(`SELECT id, role, token_version FROM pengguna WHERE role = 'SUPERADMIN' AND aktif = 1 LIMIT 1`)
    .get() as { id: number; role: Role; token_version: number };
  const operator = db
    .prepare(`SELECT id, role, token_version FROM pengguna WHERE role = 'ADMIN' AND aktif = 1 LIMIT 1`)
    .get() as { id: number; role: Role; token_version: number };

  const saToken = signToken({
    userId: superadmin.id,
    role: superadmin.role,
    tv: superadmin.token_version,
    exp: Date.now() + 3_600_000,
  });
  const opToken = signToken({
    userId: operator.id,
    role: operator.role,
    tv: operator.token_version,
    exp: Date.now() + 3_600_000,
  });

  const bidang = db.prepare('SELECT id FROM bidang_kerja ORDER BY id ASC LIMIT 1').get() as { id: number };
  const kantor = db.prepare('SELECT id FROM kantor WHERE aktif = 1 ORDER BY id ASC LIMIT 1').get() as { id: number };
  const suffix = Date.now();
  const cleanupUserIds: number[] = [];
  const cleanupEmpIds: number[] = [];

  try {
    // Create temporary KARYAWAN and temporary OPERATOR
    const empCreateRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama_lengkap: 'Uji Resign Hapus',
        username: `uji_resign_${suffix}`,
        email: `uji_resign_${suffix}@bignet.id`,
        no_hp: '081234569001',
        password: 'Password123!',
        role: 'KARYAWAN',
        bidang_id: bidang.id,
        kantor_id: kantor.id,
        gaji_bulanan: 4200000,
      }),
    });
    assert.equal(empCreateRes.status, 201);
    const empCreated = (await empCreateRes.json()) as { userId: number; karyawanId: number };
    cleanupUserIds.push(empCreated.userId);
    cleanupEmpIds.push(empCreated.karyawanId);

    const tempOpRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama_lengkap: 'Uji Operator Hapus',
        username: `uji_opdel_${suffix}`,
        email: `uji_opdel_${suffix}@bignet.id`,
        no_hp: '081234569002',
        password: 'Password123!',
        role: 'ADMIN',
        kantor_id: kantor.id,
        gaji_bulanan: 5000000,
      }),
    });
    assert.equal(tempOpRes.status, 201);
    const tempOp = (await tempOpRes.json()) as { userId: number; karyawanId: number };
    cleanupUserIds.push(tempOp.userId);
    cleanupEmpIds.push(tempOp.karyawanId);

    // Capture initial employee token_version
    const empUserBefore = db
      .prepare('SELECT token_version, aktif FROM pengguna WHERE id = ?')
      .get(empCreated.userId) as { token_version: number; aktif: number };
    const empToken = signToken({
      userId: empCreated.userId,
      role: 'KARYAWAN',
      tv: empUserBefore.token_version,
      exp: Date.now() + 3_600_000,
    });

    // 1. Offboarding without sufficient reason -> 400
    const badOffRes = await fetch(`${baseUrl}/api/v1/master/employees/${empCreated.karyawanId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktif: 0, tanggal_keluar: '2026-04-15', alasan_keluar: 'x' }),
    });
    assert.equal(badOffRes.status, 400);

    // 2. Operator marks employee as Keluar -> 200, revokes token, records audit
    const offRes = await fetch(`${baseUrl}/api/v1/master/employees/${empCreated.karyawanId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aktif: 0,
        tanggal_keluar: '2026-04-15',
        alasan_keluar: 'Mengundurkan diri secara baik-baik',
      }),
    });
    assert.equal(offRes.status, 200);

    const empAfterOff = db
      .prepare('SELECT aktif, tanggal_keluar, alasan_keluar FROM karyawan WHERE id = ?')
      .get(empCreated.karyawanId) as { aktif: number; tanggal_keluar: string | null; alasan_keluar: string };
    assert.equal(empAfterOff.aktif, 0);
    assert.equal(empAfterOff.tanggal_keluar, '2026-04-15');
    assert.equal(empAfterOff.alasan_keluar, 'Mengundurkan diri secara baik-baik');

    const userAfterOff = db
      .prepare('SELECT aktif, token_version FROM pengguna WHERE id = ?')
      .get(empCreated.userId) as { aktif: number; token_version: number };
    assert.equal(userAfterOff.aktif, 0);
    assert.ok(userAfterOff.token_version > empUserBefore.token_version);

    // Old employee token must now be rejected (401)
    const meAfterOff = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    assert.equal(meAfterOff.status, 401);

    // 3. Operator reactivates employee -> clears tanggal_keluar & alasan_keluar
    const reactRes = await fetch(`${baseUrl}/api/v1/master/employees/${empCreated.karyawanId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aktif: 1, alasan_keluar: 'Masuk kerja kembali' }),
    });
    assert.equal(reactRes.status, 200);

    const empAfterReact = db
      .prepare('SELECT aktif, tanggal_keluar, alasan_keluar FROM karyawan WHERE id = ?')
      .get(empCreated.karyawanId) as { aktif: number; tanggal_keluar: string | null; alasan_keluar: string };
    assert.equal(empAfterReact.aktif, 1);
    assert.equal(empAfterReact.tanggal_keluar, null);
    assert.equal(empAfterReact.alasan_keluar, '');

    // Add dependent pengajuan row to ensure FK cascade cleanup works cleanly
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO pengajuan (karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, status, created_at, updated_at)
       VALUES (?, 'IZIN', '2026-04-20', '2026-04-20', 'Uji hapus relasi', 'PENDING', ?, ?)`
    ).run(empCreated.karyawanId, nowIso, nowIso);

    // 4. Operator delete with short reason -> 400
    const badDelRes = await fetch(`${baseUrl}/api/v1/master/employees/${empCreated.karyawanId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alasan: 'abc' }),
    });
    assert.equal(badDelRes.status, 400);

    // 5. Operator cannot delete an ADMIN/Operator account -> 403
    const forbidOpDel = await fetch(`${baseUrl}/api/v1/master/employees/${tempOp.karyawanId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alasan: 'Percobaan hapus operator oleh operator' }),
    });
    assert.equal(forbidOpDel.status, 403);

    // 6. Operator permanently deletes KARYAWAN with dependent rows -> 200 & audited
    const delEmpRes = await fetch(`${baseUrl}/api/v1/master/employees/${empCreated.karyawanId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${opToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alasan: 'Akun duplikat uji coba dihapus permanen' }),
    });
    assert.equal(delEmpRes.status, 200);
    const delEmpPayload = (await delEmpRes.json()) as { ok: boolean; deletedCounts: { pengajuan: number } };
    assert.equal(delEmpPayload.ok, true);
    assert.equal(delEmpPayload.deletedCounts.pengajuan, 1);

    assert.equal(
      db.prepare('SELECT id FROM karyawan WHERE id = ?').get(empCreated.karyawanId),
      undefined
    );
    assert.equal(
      db.prepare('SELECT id FROM pengguna WHERE id = ?').get(empCreated.userId),
      undefined
    );
    const delAudit = db
      .prepare(`SELECT aksi, alasan FROM audit_log WHERE aksi = 'DELETE_KARYAWAN_PERMANEN' AND karyawan_id = ? ORDER BY id DESC LIMIT 1`)
      .get(empCreated.karyawanId) as { aksi: string; alasan: string } | undefined;
    assert.ok(delAudit);
    assert.equal(delAudit.alasan, 'Akun duplikat uji coba dihapus permanen');

    // 7. Superadmin cannot delete self -> 400
    const selfDelRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts/${superadmin.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alasan: 'Percobaan hapus akun sendiri' }),
    });
    assert.equal(selfDelRes.status, 400);

    // 8. Superadmin permanently deletes temporary Operator account -> 200 & audited
    const saDelOpRes = await fetch(`${baseUrl}/api/v1/superadmin/accounts/${tempOp.userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alasan: 'Hapus operator sementara setelah pengujian' }),
    });
    assert.equal(saDelOpRes.status, 200);
    assert.equal(db.prepare('SELECT id FROM pengguna WHERE id = ?').get(tempOp.userId), undefined);
    assert.equal(db.prepare('SELECT id FROM karyawan WHERE id = ?').get(tempOp.karyawanId), undefined);
  } finally {
    for (const uid of cleanupUserIds) {
      db.prepare('DELETE FROM pengguna WHERE id = ?').run(uid);
    }
    for (const eid of cleanupEmpIds) {
      db.prepare('DELETE FROM pengajuan WHERE karyawan_id = ?').run(eid);
      db.prepare('DELETE FROM karyawan WHERE id = ?').run(eid);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});



