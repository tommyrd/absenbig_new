import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { signToken } from '../src/server/auth.ts';
import { getDb } from '../src/server/db.ts';
import { registerApiRoutes } from '../src/server/routes.ts';
import {
  computeMonthlySummary,
  getEffectivePolicy,
  getWorkforceToday,
  haversineMeters,
  resolveDayForEmployee,
} from '../src/server/services/resolver.ts';
import { getWibDateString } from '../src/server/time.ts';
import type { Karyawan, Role } from '../src/shared/types.ts';
import { isGpsAccuracyAcceptable, isWithinVerifiedGeofence, MAX_GPS_ACCURACY_METERS, requiresOfficeGeofence } from '../src/shared/geofence.ts';
import { getSessionWindowState } from '../src/shared/session-window.ts';
import { shouldOpenAttendanceOnEntry } from '../src/shared/employee-entry.ts';
import { getHistoryCalendarStatus } from '../src/shared/history-calendar.ts';

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
  assert.equal(dimasPolicy.level, 'KARYAWAN');
  assert.equal(dimasPolicy.jumlah_sesi, 4);

  // Andi (id 2) is Teknisi Lapangan (BIDANG policy: 3 sesi)
  const andi = db.prepare('SELECT * FROM karyawan WHERE id = 2').get() as unknown as Karyawan;
  const andiPolicy = getEffectivePolicy(db, andi, today);
  assert.equal(andiPolicy.level, 'BIDANG');
  assert.equal(andiPolicy.jumlah_sesi, 3);

  // Use a synthetic division with no matching BIDANG policy to verify DEFAULT fallback.
  // A real employee such as Dewi may have a company-specific NOC BIDANG policy in the local DB.
  const dewi = db.prepare('SELECT * FROM karyawan WHERE id = 6').get() as unknown as Karyawan;
  const employeeWithoutMatchingPolicy = { ...dewi, id: -999999, bidang_id: -999999 };
  const defaultPolicy = getEffectivePolicy(db, employeeWithoutMatchingPolicy, today);
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

    const createOwner = await fetch(`${baseUrl}/api/v1/superadmin/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${makeToken(superadmin)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nama_lengkap: 'Owner Pengujian',
        username: 'owner_pengujian',
        email: 'owner.pengujian@bignet.id',
        no_hp: '081234567890',
        password: 'OwnerPassword123',
        role: 'SUPERADMIN',
      }),
    });
    assert.equal(createOwner.status, 201);
    const ownerAccount = db.prepare(
      `SELECT role, karyawan_id, nama_tampilan FROM pengguna WHERE username = 'owner_pengujian'`
    ).get() as { role: string; karyawan_id: number | null; nama_tampilan: string };
    assert.equal(ownerAccount.role, 'SUPERADMIN');
    assert.equal(ownerAccount.karyawan_id, null);
    assert.equal(ownerAccount.nama_tampilan, 'Owner Pengujian');
    assert.equal(
      db.prepare(`SELECT id FROM karyawan WHERE email = 'owner.pengujian@bignet.id'`).get(),
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
    const fajarUser = empRow.find((e) => e.karyawan_id === 6) || karyawan;
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
