import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';

// Isolated temporary workspace BEFORE loading server modules so live ./data and ./backups remain untouched
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bignet_placement_suite_'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'bignet_placement_test.db');

process.env.DATA_DIR = tempDataDir;
process.env.DB_PATH = tempDbPath;
process.env.SEED_DEMO_DATA = 'false';
process.env.ALLOW_DEMO_LOGIN = 'false';
process.env.AUTH_SECRET = 'bignet_test_secret_key_for_placement_location_suite_64bytes_abc';
process.env.TZ = 'Asia/Jakarta';

const { closeDb, getDb } = await import('../src/server/db.ts');
const { seedProductionBaseline } = await import('../src/server/db/seed.ts');
const { registerApiRoutes } = await import('../src/server/routes.ts');
const {
  attendanceLimiter,
  loginFailLimiter,
  loginIpLimiter,
  passwordLimiter,
  registerLimiter,
} = await import('../src/server/security.ts');
const { getWibDateString } = await import('../src/server/time.ts');
const {
  isPointInRegionGeoJson,
  validateRegionPolygonGeoJson,
} = await import('../src/shared/region-geometry.ts');

const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Synthetic test-only bounding boxes (isolated exclusively inside automated tests)
const TEST_POLY_PONTIANAK = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [109.25, -0.10],
      [109.45, -0.10],
      [109.45, 0.05],
      [109.25, 0.05],
      [109.25, -0.10],
    ],
  ],
});

const TEST_POLY_SINTANG = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [111.40, 0.00],
      [111.60, 0.00],
      [111.60, 0.15],
      [111.40, 0.15],
      [111.40, 0.00],
    ],
  ],
});

// Test coordinates
const COORD_PTK_KANTOR_A = { lat: -0.025, lng: 109.33 };
const COORD_PTK_KANTOR_B = { lat: -0.055, lng: 109.36 };
const COORD_PTK_NON_OFFICE = { lat: 0.02, lng: 109.40 }; // Inside Pontianak polygon, >5km from both offices
const COORD_SINTANG_POINT = { lat: 0.075, lng: 111.50 }; // Inside Sintang polygon, outside Pontianak (~240km away)
const COORD_REMOTE_POINT = { lat: -1.83, lng: 109.98 }; // Outside all polygons

let server: http.Server;
let baseUrl = '';

let superToken = '';
let adminToken = '';

let regionPontianakId = 0;
let regionSintangId = 0;
let regionIncompleteId = 0;

let kantorPtkAId = 0;
let kantorPtkBId = 0;
let kantorSintangAId = 0;

function resetLimiters() {
  loginIpLimiter.clear();
  loginFailLimiter.clear();
  registerLimiter.clear();
  passwordLimiter.clear();
  attendanceLimiter.clear();
}

async function apiJson<T = Record<string, unknown>>(
  pathname: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; headers: Headers; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
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
  return { status: res.status, headers: res.headers, data: data as T };
}

async function loginAs(identifier: string, password: string): Promise<string> {
  resetLimiters();
  const res = await apiJson<{ token: string }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  assert.equal(res.status, 200, `Login failed for ${identifier}: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

async function createAndLoginEmployee(opts: {
  nik: string;
  username: string;
  nama: string;
  kantorId: number;
  wilayahId: number | null;
  cakupan: 'SEMUA_KANTOR_DALAM_WILAYAH' | 'KANTOR_TERTENTU' | null;
  kantorIzinIds?: number[];
  bypassApiForLegacyNull?: boolean;
}): Promise<{ userId: number; karyawanId: number; token: string }> {
  const password = 'EmpPassword!123';
  const email = `${opts.username}@bignet.co.id`;

  if (opts.bypassApiForLegacyNull) {
    // Simulate a pre-migration legacy KARYAWAN account without wilayah_penempatan_id
    const db = getDb();
    const { hashPassword } = await import('../src/server/auth.ts');
    const today = getWibDateString();
    const empInfo = db
      .prepare(
        `INSERT INTO karyawan (
           nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan,
           wilayah_penempatan_id, cakupan_lokasi_absensi, tanggal_masuk, aktif
         ) VALUES (?, ?, ?, '08120000999', ?, 1, 'Teknisi', NULL, NULL, ?, 1)`
      )
      .run(opts.nik, opts.nama, email, opts.kantorId, today);
    const karyawanId = Number(empInfo.lastInsertRowid);
    const userInfo = db
      .prepare(
        `INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
         VALUES (?, ?, ?, 'KARYAWAN', ?, 1, 1, ?)`
      )
      .run(opts.username, email, hashPassword(password), karyawanId, `${today}T08:00:00+07:00`);
    const userId = Number(userInfo.lastInsertRowid);
    const token = await loginAs(opts.username, password);
    return { userId, karyawanId, token };
  }

  const res = await apiJson<{ ok: boolean; userId: number; karyawanId: number }>(
    '/api/v1/superadmin/accounts',
    {
      method: 'POST',
      token: superToken,
      body: {
        nik: opts.nik,
        nama_lengkap: opts.nama,
        username: opts.username,
        email,
        no_hp: '08120000123',
        password,
        role: 'KARYAWAN',
        kantor_id: opts.kantorId,
        bidang_id: 1,
        wilayah_penempatan_id: opts.wilayahId,
        cakupan_lokasi_absensi: opts.cakupan,
        kantor_izin_ids: opts.kantorIzinIds ?? [],
      },
    }
  );
  assert.equal(res.status, 201, `Create employee ${opts.username} failed: ${JSON.stringify(res.data)}`);
  const token = await loginAs(opts.username, password);
  return { userId: res.data.userId, karyawanId: res.data.karyawanId, token };
}

async function ensureAlwaysOpenWorkdayPolicyFor(karyawanId: number) {
  const db = getDb();
  const today = getWibDateString();
  // Ensure every day of week is a working day across all offices in test DB
  db.prepare(`UPDATE kalender_kerja SET status_hari = 'HARI_KERJA'`).run();
  db.prepare(`DELETE FROM hari_libur WHERE tanggal = ?`).run(today);

  // Assign a 2-session policy with wide window 00:00-23:59 and SEMUA_SESI_KANTOR via official API
  const polRes = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'KARYAWAN',
      karyawan_id: karyawanId,
      nama: `Policy Uji Penempatan #${karyawanId}`,
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      toleransi_terlambat_menit: 15,
      wajib_foto_semua_sesi: 1,
      wajib_aktivitas_sesi_lanjut: 1,
      aturan_lokasi: 'SEMUA_SESI_KANTOR',
      berlaku_mulai: today,
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Pagi', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2 Siang', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });
  assert.equal(polRes.status, 201, `Create policy failed: ${JSON.stringify(polRes.data)}`);
}

before(async () => {
  const db = getDb();
  seedProductionBaseline(db, {
    superadminUsername: 'owner_place',
    superadminEmail: 'owner.place@bignet.co.id',
    superadminName: 'Owner Uji Penempatan',
    superadminPassword: 'SuperPassword!2026',
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  registerApiRoutes(app);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  superToken = await loginAs('owner_place', 'SuperPassword!2026');

  // Create operational Admin (Operator)
  const adminRes = await apiJson<{ ok: boolean; userId: number }>('/api/v1/superadmin/accounts', {
    method: 'POST',
    token: superToken,
    body: {
      nama_lengkap: 'Operator Uji Wilayah',
      username: 'operator_place',
      email: 'operator.place@bignet.co.id',
      password: 'AdminPassword!2026',
      role: 'ADMIN',
      kantor_id: 1,
    },
  });
  assert.equal(adminRes.status, 201);
  adminToken = await loginAs('operator_place', 'AdminPassword!2026');

  // Create 3 operational regions: Pontianak (valid polygon), Sintang (valid polygon), Ketapang (NO polygon)
  const regPtk = await apiJson<{ id: number; polygon_valid: boolean }>('/api/v1/master/regions', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'WIL-PTK',
      nama: 'Pontianak',
      kota_kabupaten: 'Kota Pontianak & Kubu Raya',
      provinsi: 'Kalimantan Barat',
      aktif: 1,
      polygon_geojson: TEST_POLY_PONTIANAK,
      keterangan: 'Wilayah operasional uji Pontianak',
    },
  });
  assert.equal(regPtk.status, 201);
  assert.equal(regPtk.data.polygon_valid, true);
  regionPontianakId = regPtk.data.id;

  const regStg = await apiJson<{ id: number; polygon_valid: boolean }>('/api/v1/master/regions', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'WIL-STG',
      nama: 'Sintang',
      kota_kabupaten: 'Kabupaten Sintang',
      provinsi: 'Kalimantan Barat',
      aktif: 1,
      polygon_geojson: TEST_POLY_SINTANG,
      keterangan: 'Wilayah operasional uji Sintang',
    },
  });
  assert.equal(regStg.status, 201);
  assert.equal(regStg.data.polygon_valid, true);
  regionSintangId = regStg.data.id;

  const regInc = await apiJson<{ id: number; polygon_valid: boolean }>('/api/v1/master/regions', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'WIL-KTP',
      nama: 'Ketapang',
      kota_kabupaten: 'Kabupaten Ketapang',
      provinsi: 'Kalimantan Barat',
      aktif: 1,
      polygon_geojson: null,
      keterangan: 'Polygon sengaja belum diisi untuk uji guardrail',
    },
  });
  assert.equal(regInc.status, 201);
  assert.equal(regInc.data.polygon_valid, false);
  regionIncompleteId = regInc.data.id;

  // Create offices linked to Pontianak & Sintang
  const offA = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'PTK-A',
      nama: 'Kantor Pontianak A',
      alamat: 'Jl. Ahmad Yani Pontianak',
      lat: COORD_PTK_KANTOR_A.lat,
      lng: COORD_PTK_KANTOR_A.lng,
      radius_meter: 200,
      wilayah_id: regionPontianakId,
      aktif: 1,
    },
  });
  assert.equal(offA.status, 201);
  kantorPtkAId = offA.data.id;

  const offB = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'PTK-B',
      nama: 'Kantor Pontianak B',
      alamat: 'Jl. Gajah Mada Pontianak',
      lat: COORD_PTK_KANTOR_B.lat,
      lng: COORD_PTK_KANTOR_B.lng,
      radius_meter: 200,
      wilayah_id: regionPontianakId,
      aktif: 1,
    },
  });
  assert.equal(offB.status, 201);
  kantorPtkBId = offB.data.id;

  const offStg = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: adminToken,
    body: {
      kode: 'STG-A',
      nama: 'Kantor Sintang A',
      alamat: 'Jl. Lintas Melawi Sintang',
      lat: COORD_SINTANG_POINT.lat,
      lng: COORD_SINTANG_POINT.lng,
      radius_meter: 200,
      wilayah_id: regionSintangId,
      aktif: 1,
    },
  });
  assert.equal(offStg.status, 201);
  kantorSintangAId = offStg.data.id;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('0. Geometry helper validates polygons and point-in-polygon accurately', () => {
  const valid = validateRegionPolygonGeoJson(TEST_POLY_PONTIANAK);
  assert.equal(valid.valid, true);
  assert.equal(valid.polygonCount, 1);
  assert.equal(valid.vertexCount, 4);

  assert.equal(isPointInRegionGeoJson(COORD_PTK_KANTOR_A.lat, COORD_PTK_KANTOR_A.lng, TEST_POLY_PONTIANAK), true);
  assert.equal(isPointInRegionGeoJson(COORD_PTK_NON_OFFICE.lat, COORD_PTK_NON_OFFICE.lng, TEST_POLY_PONTIANAK), true);
  assert.equal(isPointInRegionGeoJson(COORD_SINTANG_POINT.lat, COORD_SINTANG_POINT.lng, TEST_POLY_PONTIANAK), false);

  const invalid = validateRegionPolygonGeoJson('{"type":"Point","coordinates":[109,0]}');
  assert.equal(invalid.valid, false);
});

test('1 & 2. Karyawan Pontianak (SEMUA_KANTOR_DALAM_WILAYAH) can check in at Kantor A and Kantor B', async () => {
  const emp = await createAndLoginEmployee({
    nik: 'BG-P01',
    username: 'emp_ptk_all',
    nama: 'Karyawan Pontianak Semua Kantor',
    kantorId: kantorPtkAId,
    wilayahId: regionPontianakId,
    cakupan: 'SEMUA_KANTOR_DALAM_WILAYAH',
  });
  await ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  // Scenario 1: Sesi 1 at Kantor Pontianak A
  resetLimiters();
  const s1 = await apiJson<{ ok: boolean; sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_PTK_KANTOR_A.lat,
      lng: COORD_PTK_KANTOR_A.lng,
      accuracyMeter: 15,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s1.status, 201, `Expected 201 at Kantor A, got: ${JSON.stringify(s1.data)}`);

  const row1 = getDb()
    .prepare(`SELECT status_wilayah_absensi, kantor_validasi_id, kantor_validasi_nama, dalam_geofence FROM absensi_sesi WHERE id = ?`)
    .get(s1.data.sessionId) as {
    status_wilayah_absensi: string;
    kantor_validasi_id: number;
    kantor_validasi_nama: string;
    dalam_geofence: number;
  };
  assert.equal(row1.status_wilayah_absensi, 'DI_DALAM_WILAYAH');
  assert.equal(row1.kantor_validasi_id, kantorPtkAId);
  assert.equal(row1.kantor_validasi_nama, 'Kantor Pontianak A');
  assert.equal(row1.dalam_geofence, 1);

  // Scenario 2: Sesi 2 at Kantor Pontianak B (still allowed under SEMUA_KANTOR_DALAM_WILAYAH)
  resetLimiters();
  const s2 = await apiJson<{ ok: boolean; sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 2,
      lat: COORD_PTK_KANTOR_B.lat,
      lng: COORD_PTK_KANTOR_B.lng,
      accuracyMeter: 15,
      tipeAktivitas: 'AKTIVITAS',
      deskripsiAktivitas: 'Kunjungan operasional di Kantor Pontianak B',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s2.status, 201, `Expected 201 at Kantor B, got: ${JSON.stringify(s2.data)}`);

  const row2 = getDb()
    .prepare(`SELECT status_wilayah_absensi, kantor_validasi_id, kantor_validasi_nama, dalam_geofence FROM absensi_sesi WHERE id = ?`)
    .get(s2.data.sessionId) as {
    status_wilayah_absensi: string;
    kantor_validasi_id: number;
    kantor_validasi_nama: string;
    dalam_geofence: number;
  };
  assert.equal(row2.status_wilayah_absensi, 'DI_DALAM_WILAYAH');
  assert.equal(row2.kantor_validasi_id, kantorPtkBId);
  assert.equal(row2.kantor_validasi_nama, 'Kantor Pontianak B');
  assert.equal(row2.dalam_geofence, 1);
});

test('3. Karyawan Pontianak (KANTOR_TERTENTU = Kantor A only) is REJECTED at Kantor B, and cross-region office assignment is rejected', async () => {
  // Reject creating KANTOR_TERTENTU with an office from another region (Sintang)
  const crossRegionRes = await apiJson('/api/v1/superadmin/accounts', {
    method: 'POST',
    token: superToken,
    body: {
      nik: 'BG-CROSS',
      nama_lengkap: 'Uji Lintas Wilayah',
      username: 'emp_cross_reject',
      email: 'cross@bignet.co.id',
      password: 'EmpPassword!123',
      role: 'KARYAWAN',
      kantor_id: kantorPtkAId,
      bidang_id: 1,
      wilayah_penempatan_id: regionPontianakId,
      cakupan_lokasi_absensi: 'KANTOR_TERTENTU',
      kantor_izin_ids: [kantorSintangAId],
    },
  });
  assert.equal(crossRegionRes.status, 400);
  assert.match(String(crossRegionRes.data.error), /wilayah lain|tidak berada dalam wilayah/i);

  // Create valid KANTOR_TERTENTU with Kantor A only
  const emp = await createAndLoginEmployee({
    nik: 'BG-P02',
    username: 'emp_ptk_only_a',
    nama: 'Karyawan Pontianak Khusus A',
    kantorId: kantorPtkAId,
    wilayahId: regionPontianakId,
    cakupan: 'KANTOR_TERTENTU',
    kantorIzinIds: [kantorPtkAId],
  });
  ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  // Preview check-location at Kantor B -> denied
  const previewB = await apiJson<{ allowed: boolean; statusWilayah: string }>(
    '/api/v1/attendance/check-location',
    {
      method: 'POST',
      token: emp.token,
      body: { lat: COORD_PTK_KANTOR_B.lat, lng: COORD_PTK_KANTOR_B.lng, accuracyMeter: 15 },
    }
  );
  assert.equal(previewB.status, 200);
  assert.equal(previewB.data.allowed, false);
  assert.equal(previewB.data.statusWilayah, 'DI_DALAM_WILAYAH');

  // Actual check-in at Kantor B -> 400 rejected
  resetLimiters();
  const rejectB = await apiJson<{ error: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_PTK_KANTOR_B.lat,
      lng: COORD_PTK_KANTOR_B.lng,
      accuracyMeter: 15,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(rejectB.status, 400);
  assert.match(String(rejectB.data.error), /Kantor Pontianak A/i);
});

test('4, 5 & 12. Karyawan Pontianak in Sintang (outside placement polygon) gets automatic geofence exemption while keeping GPS, selfie, activity, server time, and normal status', async () => {
  const emp = await createAndLoginEmployee({
    nik: 'BG-P03',
    username: 'emp_ptk_out',
    nama: 'Karyawan Pontianak Tugas Sintang',
    kantorId: kantorPtkAId,
    wilayahId: regionPontianakId,
    cakupan: 'KANTOR_TERTENTU',
    kantorIzinIds: [kantorPtkAId],
  });
  ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  // Check-location preview confirms DI_LUAR_WILAYAH + geofenceExempted
  const preview = await apiJson<{
    allowed: boolean;
    statusWilayah: string;
    geofenceExempted: boolean;
    wilayahTerdeteksiNama: string | null;
  }>('/api/v1/attendance/check-location', {
    method: 'POST',
    token: emp.token,
    body: { lat: COORD_SINTANG_POINT.lat, lng: COORD_SINTANG_POINT.lng, accuracyMeter: 30 },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.allowed, true);
  assert.equal(preview.data.statusWilayah, 'DI_LUAR_WILAYAH');
  assert.equal(preview.data.geofenceExempted, true);
  assert.equal(preview.data.wilayahTerdeteksiNama, 'Sintang');

  // Scenario 12a: Out-of-region check-in STILL enforces browser camera selfie (reject missing photo / gallery upload)
  resetLimiters();
  const noSelfie = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_SINTANG_POINT.lat,
      lng: COORD_SINTANG_POINT.lng,
      accuracyMeter: 30,
    },
  });
  assert.equal(noSelfie.status, 400);
  assert.match(String(noSelfie.data.error), /foto selfie/i);

  resetLimiters();
  const galleryUpload = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_SINTANG_POINT.lat,
      lng: COORD_SINTANG_POINT.lng,
      accuracyMeter: 30,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'FILE_UPLOAD',
    },
  });
  assert.equal(galleryUpload.status, 400);
  assert.match(String(galleryUpload.data.error), /kamera browser/i);

  // Scenario 4 & 5: Valid out-of-region Sesi 1 succeeds without office geofence and records full evidence
  resetLimiters();
  const s1 = await apiJson<{ ok: boolean; sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_SINTANG_POINT.lat,
      lng: COORD_SINTANG_POINT.lng,
      accuracyMeter: 30,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s1.status, 201, `Expected 201 outside region, got: ${JSON.stringify(s1.data)}`);

  const row = getDb()
    .prepare(
      `SELECT lat, lng, accuracy_meter, foto_path, foto_checksum, waktu_server,
              status_wilayah_absensi, wilayah_penempatan_id_snapshot, wilayah_penempatan_nama_snapshot,
              wilayah_terdeteksi_nama, alasan_pengecualian_geofence
       FROM absensi_sesi WHERE id = ?`
    )
    .get(s1.data.sessionId) as {
    lat: number;
    lng: number;
    accuracy_meter: number;
    foto_path: string | null;
    foto_checksum: string | null;
    waktu_server: string;
    status_wilayah_absensi: string;
    wilayah_penempatan_id_snapshot: number;
    wilayah_penempatan_nama_snapshot: string;
    wilayah_terdeteksi_nama: string | null;
    alasan_pengecualian_geofence: string | null;
  };
  assert.equal(row.lat, COORD_SINTANG_POINT.lat);
  assert.equal(row.lng, COORD_SINTANG_POINT.lng);
  assert.equal(row.accuracy_meter, 30);
  assert.ok(row.foto_path);
  assert.ok(row.foto_checksum);
  assert.ok(row.waktu_server.includes('+07:00'));
  assert.equal(row.status_wilayah_absensi, 'DI_LUAR_WILAYAH');
  assert.equal(row.wilayah_penempatan_id_snapshot, regionPontianakId);
  assert.equal(row.wilayah_penempatan_nama_snapshot, 'Pontianak');
  assert.equal(row.wilayah_terdeteksi_nama, 'Sintang');
  assert.ok(row.alasan_pengecualian_geofence && row.alasan_pengecualian_geofence.length > 10);

  // Verify operational status remains normal (NOT DINAS)
  const todayRes = await apiJson<{ day: { operationalStatus: string; payrollStatus: string } }>(
    '/api/v1/attendance/today',
    { token: emp.token }
  );
  assert.equal(todayRes.status, 200);
  assert.notEqual(todayRes.data.day.operationalStatus, 'DINAS');
  assert.equal(todayRes.data.day.operationalStatus, 'HADIR');

  // Scenario 12b: Out-of-region Sesi 2 STILL enforces mandatory activity description
  resetLimiters();
  const s2NoDesc = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 2,
      lat: COORD_SINTANG_POINT.lat,
      lng: COORD_SINTANG_POINT.lng,
      accuracyMeter: 30,
      tipeAktivitas: 'AKTIVITAS',
      deskripsiAktivitas: '   ',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s2NoDesc.status, 400);
  assert.match(String(s2NoDesc.data.error), /deskripsi aktivitas/i);

  // Audit log recorded the out-of-region attendance
  const auditRow = getDb()
    .prepare(
      `SELECT after_json FROM audit_log WHERE modul = 'ABSENSI' AND target_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(String(s1.data.sessionId)) as { after_json: string } | undefined;
  assert.ok(auditRow);
  const auditAfter = JSON.parse(auditRow.after_json) as {
    statusWilayahAbsensi: string;
    geofenceExempted: boolean;
  };
  assert.equal(auditAfter.statusWilayahAbsensi, 'DI_LUAR_WILAYAH');
  assert.equal(auditAfter.geofenceExempted, true);
});

test('6. Karyawan Pontianak at non-office location still INSIDE Pontianak polygon is REJECTED', async () => {
  const emp = await createAndLoginEmployee({
    nik: 'BG-P04',
    username: 'emp_ptk_nonoffice',
    nama: 'Karyawan Pontianak Luar Radius Dalam Kota',
    kantorId: kantorPtkAId,
    wilayahId: regionPontianakId,
    cakupan: 'SEMUA_KANTOR_DALAM_WILAYAH',
  });
  ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  resetLimiters();
  const res = await apiJson<{ error: string; statusWilayah: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_PTK_NON_OFFICE.lat,
      lng: COORD_PTK_NON_OFFICE.lng,
      accuracyMeter: 15,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.statusWilayah, 'DI_DALAM_WILAYAH');
  assert.match(String(res.data.error), /di dalam wilayah Pontianak/i);
});

test('7. Legacy employee WITHOUT wilayah_penempatan_id at far coordinates gets NO exemption (REJECTED)', async () => {
  const legacyEmp = await createAndLoginEmployee({
    nik: 'BG-LEG01',
    username: 'emp_legacy_null',
    nama: 'Karyawan Lama Belum Diisi Wilayah',
    kantorId: kantorPtkAId,
    wilayahId: null,
    cakupan: null,
    bypassApiForLegacyNull: true,
  });
  ensureAlwaysOpenWorkdayPolicyFor(legacyEmp.karyawanId);

  // Preview reports BELUM_TERKONFIGURASI and allowed = false at far coordinates
  const preview = await apiJson<{ allowed: boolean; statusWilayah: string; geofenceExempted: boolean }>(
    '/api/v1/attendance/check-location',
    {
      method: 'POST',
      token: legacyEmp.token,
      body: { lat: COORD_REMOTE_POINT.lat, lng: COORD_REMOTE_POINT.lng, accuracyMeter: 20 },
    }
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.data.allowed, false);
  assert.equal(preview.data.statusWilayah, 'BELUM_TERKONFIGURASI');
  assert.equal(preview.data.geofenceExempted, false);

  // Check-in far away is rejected
  resetLimiters();
  const res = await apiJson<{ error: string; statusWilayah: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: legacyEmp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_REMOTE_POINT.lat,
      lng: COORD_REMOTE_POINT.lng,
      accuracyMeter: 20,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.statusWilayah, 'BELUM_TERKONFIGURASI');

  // Bulk placement endpoint configures legacy employee safely and logs audit
  const bulkRes = await apiJson<{ ok: boolean; updatedCount: number; wilayahNama: string }>(
    '/api/v1/master/employees/bulk-placement',
    {
      method: 'POST',
      token: adminToken,
      body: {
        karyawan_ids: [legacyEmp.karyawanId],
        wilayah_penempatan_id: regionPontianakId,
        cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
        kantor_izin_ids: [],
      },
    }
  );
  assert.equal(bulkRes.status, 200);
  assert.equal(bulkRes.data.updatedCount, 1);
  assert.equal(bulkRes.data.wilayahNama, 'Pontianak');

  const updatedEmp = getDb()
    .prepare(`SELECT wilayah_penempatan_id, cakupan_lokasi_absensi FROM karyawan WHERE id = ?`)
    .get(legacyEmp.karyawanId) as { wilayah_penempatan_id: number; cakupan_lokasi_absensi: string };
  assert.equal(updatedEmp.wilayah_penempatan_id, regionPontianakId);
  assert.equal(updatedEmp.cakupan_lokasi_absensi, 'SEMUA_KANTOR_DALAM_WILAYAH');
});

test('8. Employee whose placement region has NO valid polygon gets NO exemption at far coordinates (REJECTED)', async () => {
  const emp = await createAndLoginEmployee({
    nik: 'BG-P05',
    username: 'emp_ketapang_nopoly',
    nama: 'Karyawan Ketapang Polygon Kosong',
    kantorId: kantorPtkAId,
    wilayahId: regionIncompleteId,
    cakupan: 'SEMUA_KANTOR_DALAM_WILAYAH',
  });
  ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  const preview = await apiJson<{ allowed: boolean; statusWilayah: string; geofenceExempted: boolean }>(
    '/api/v1/attendance/check-location',
    {
      method: 'POST',
      token: emp.token,
      body: { lat: COORD_REMOTE_POINT.lat, lng: COORD_REMOTE_POINT.lng, accuracyMeter: 20 },
    }
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.data.allowed, false);
  assert.equal(preview.data.statusWilayah, 'POLYGON_BELUM_LENGKAP');
  assert.equal(preview.data.geofenceExempted, false);

  resetLimiters();
  const res = await apiJson<{ error: string; statusWilayah: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_REMOTE_POINT.lat,
      lng: COORD_REMOTE_POINT.lng,
      accuracyMeter: 20,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.statusWilayah, 'POLYGON_BELUM_LENGKAP');
});

test('9 & 10. ADMIN (Operator) and SUPERADMIN accounts create & edit cleanly WITHOUT placement fields even when active regions exist', async () => {
  // Create ADMIN without any placement fields (even though active regions exist)
  const createAdmin = await apiJson<{ ok: boolean; userId: number; karyawanId: number }>(
    '/api/v1/superadmin/accounts',
    {
      method: 'POST',
      token: superToken,
      body: {
        nama_lengkap: 'Operator Tanpa Penempatan',
        username: 'op_no_place',
        email: 'op.noplace@bignet.co.id',
        password: 'OpPassword!123',
        role: 'ADMIN',
        kantor_id: kantorPtkAId,
      },
    }
  );
  assert.equal(createAdmin.status, 201);

  const adminEmpRow = getDb()
    .prepare(`SELECT wilayah_penempatan_id, cakupan_lokasi_absensi FROM karyawan WHERE id = ?`)
    .get(createAdmin.data.karyawanId) as {
    wilayah_penempatan_id: number | null;
    cakupan_lokasi_absensi: string | null;
  };
  assert.equal(adminEmpRow.wilayah_penempatan_id, null);
  assert.equal(adminEmpRow.cakupan_lokasi_absensi, null);

  // Edit ADMIN without placement fields -> succeeds and keeps placement NULL
  const editAdmin = await apiJson('/api/v1/superadmin/accounts/' + createAdmin.data.userId, {
    method: 'PUT',
    token: superToken,
    body: {
      nama_lengkap: 'Operator Updated',
      role: 'ADMIN',
      kantor_id: kantorPtkAId,
      aktif: 1,
    },
  });
  assert.equal(editAdmin.status, 200);

  // Create SUPERADMIN without placement fields -> succeeds with karyawan_id = NULL
  const createSuper = await apiJson<{ ok: boolean; userId: number; role: string }>(
    '/api/v1/superadmin/accounts',
    {
      method: 'POST',
      token: superToken,
      body: {
        nama_lengkap: 'Superadmin Kedua',
        username: 'super_two',
        email: 'super.two@bignet.co.id',
        password: 'SuperPassword!999',
        role: 'SUPERADMIN',
      },
    }
  );
  assert.equal(createSuper.status, 201);
  assert.equal(createSuper.data.role, 'SUPERADMIN');

  const superRow = getDb()
    .prepare(`SELECT role, karyawan_id FROM pengguna WHERE id = ?`)
    .get(createSuper.data.userId) as { role: string; karyawan_id: number | null };
  assert.equal(superRow.role, 'SUPERADMIN');
  assert.equal(superRow.karyawan_id, null);

  // Edit SUPERADMIN without placement fields -> succeeds
  const editSuper = await apiJson('/api/v1/superadmin/accounts/' + createSuper.data.userId, {
    method: 'PUT',
    token: superToken,
    body: {
      nama_lengkap: 'Superadmin Kedua Updated',
      role: 'SUPERADMIN',
      aktif: 1,
    },
  });
  assert.equal(editSuper.status, 200);
});

test('11. Changing employee placement region cleans old allowed offices, writes audit log, and preserves historical attendance snapshot', async () => {
  const emp = await createAndLoginEmployee({
    nik: 'BG-P06',
    username: 'emp_relocate',
    nama: 'Karyawan Mutasi Wilayah',
    kantorId: kantorPtkAId,
    wilayahId: regionPontianakId,
    cakupan: 'KANTOR_TERTENTU',
    kantorIzinIds: [kantorPtkAId],
  });
  ensureAlwaysOpenWorkdayPolicyFor(emp.karyawanId);

  // Perform attendance in Pontianak Kantor A first
  resetLimiters();
  const s1 = await apiJson<{ ok: boolean; sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: emp.token,
    body: {
      urutanSesi: 1,
      lat: COORD_PTK_KANTOR_A.lat,
      lng: COORD_PTK_KANTOR_A.lng,
      accuracyMeter: 15,
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s1.status, 201);

  // Attempting to switch region to Sintang while keeping KANTOR_TERTENTU with old Pontianak office must fail
  const badRelocate = await apiJson(`/api/v1/master/employees/${emp.karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama_lengkap: 'Karyawan Mutasi Wilayah',
      no_hp: '08120000123',
      kantor_id: kantorSintangAId,
      bidang_id: 1,
      aktif: 1,
      wilayah_penempatan_id: regionSintangId,
      cakupan_lokasi_absensi: 'KANTOR_TERTENTU',
      kantor_izin_ids: [kantorPtkAId],
    },
  });
  assert.equal(badRelocate.status, 400);

  // Relocate cleanly to Sintang (SEMUA_KANTOR_DALAM_WILAYAH)
  const goodRelocate = await apiJson(`/api/v1/master/employees/${emp.karyawanId}`, {
    method: 'PUT',
    token: adminToken,
    body: {
      nama_lengkap: 'Karyawan Mutasi Wilayah',
      no_hp: '08120000123',
      kantor_id: kantorSintangAId,
      bidang_id: 1,
      aktif: 1,
      wilayah_penempatan_id: regionSintangId,
      cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
      kantor_izin_ids: [],
    },
  });
  assert.equal(goodRelocate.status, 200);

  // Old kantor_izin from Pontianak must be cleared
  const remainingOffices = getDb()
    .prepare(`SELECT kantor_id FROM karyawan_kantor_izin WHERE karyawan_id = ?`)
    .all(emp.karyawanId);
  assert.equal(remainingOffices.length, 0);

  // Audit log entry in PENEMPATAN_KARYAWAN must exist
  const auditEntry = getDb()
    .prepare(
      `SELECT modul, aksi, before_json, after_json FROM audit_log
       WHERE modul = 'PENEMPATAN_KARYAWAN' AND karyawan_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(emp.karyawanId) as { modul: string; aksi: string; before_json: string; after_json: string } | undefined;
  assert.ok(auditEntry);
  assert.equal(auditEntry.aksi, 'UPDATE_PENEMPATAN_KARYAWAN');
  assert.equal(JSON.parse(auditEntry.before_json).wilayah_penempatan_id, regionPontianakId);
  assert.equal(JSON.parse(auditEntry.after_json).wilayah_penempatan_id, regionSintangId);

  // Historical attendance snapshot MUST remain Pontianak / Kantor Pontianak A untouched
  const historicalRow = getDb()
    .prepare(
      `SELECT wilayah_penempatan_id_snapshot, wilayah_penempatan_nama_snapshot,
              cakupan_lokasi_snapshot, kantor_validasi_id, kantor_validasi_nama, status_wilayah_absensi
       FROM absensi_sesi WHERE id = ?`
    )
    .get(s1.data.sessionId) as {
    wilayah_penempatan_id_snapshot: number;
    wilayah_penempatan_nama_snapshot: string;
    cakupan_lokasi_snapshot: string;
    kantor_validasi_id: number;
    kantor_validasi_nama: string;
    status_wilayah_absensi: string;
  };
  assert.equal(historicalRow.wilayah_penempatan_id_snapshot, regionPontianakId);
  assert.equal(historicalRow.wilayah_penempatan_nama_snapshot, 'Pontianak');
  assert.equal(historicalRow.cakupan_lokasi_snapshot, 'KANTOR_TERTENTU');
  assert.equal(historicalRow.kantor_validasi_id, kantorPtkAId);
  assert.equal(historicalRow.kantor_validasi_nama, 'Kantor Pontianak A');
  assert.equal(historicalRow.status_wilayah_absensi, 'DI_DALAM_WILAYAH');
});

test('12. SUPERADMIN has consistent access to Master Kantor/Bidang & /auth/me returns tab token while KARYAWAN/ADMIN boundaries stay enforced', async () => {
  // /api/v1/auth/me returns active token for per-tab session pinning
  const superMe = await apiJson<{ user: { role: string }; token?: string }>('/api/v1/auth/me', {
    token: superToken,
  });
  assert.equal(superMe.status, 200);
  assert.equal(superMe.data.user.role, 'SUPERADMIN');
  assert.equal(superMe.data.token, superToken);

  // SUPERADMIN can create, read deletion metadata, update, and delete Master Kantor
  const createOffice = await apiJson<{ id: number }>('/api/v1/master/offices', {
    method: 'POST',
    token: superToken,
    body: {
      kode: 'KTR-SA1',
      nama: 'Kantor Cabang Superadmin Test',
      alamat: 'Jl. Uji RBAC No. 1',
      lat: -0.025,
      lng: 109.34,
      radius_meter: 250,
      wilayah_id: regionPontianakId,
      aktif: 1,
    },
  });
  assert.equal(createOffice.status, 201);
  assert.ok(createOffice.data.id > 0);

  const listOffices = await apiJson<{ items: Array<{ id: number; can_delete?: boolean }> }>(
    '/api/v1/master/offices',
    { token: superToken }
  );
  assert.equal(listOffices.status, 200);
  const createdOffice = listOffices.data.items.find((o) => o.id === createOffice.data.id);
  assert.ok(createdOffice);
  assert.equal(createdOffice.can_delete, true);

  const updateOffice = await apiJson(`/api/v1/master/offices/${createOffice.data.id}`, {
    method: 'PUT',
    token: superToken,
    body: {
      nama: 'Kantor Cabang Superadmin Updated',
      alamat: 'Jl. Uji RBAC No. 2',
      lat: -0.025,
      lng: 109.34,
      radius_meter: 300,
      wilayah_id: regionPontianakId,
      aktif: 1,
    },
  });
  assert.equal(updateOffice.status, 200);

  const deleteOffice = await apiJson(`/api/v1/master/offices/${createOffice.data.id}`, {
    method: 'DELETE',
    token: superToken,
  });
  assert.equal(deleteOffice.status, 200);

  // SUPERADMIN can create, read deletion metadata, update, and delete Master Bidang
  const createBidang = await apiJson<{ id: number }>('/api/v1/master/bidang', {
    method: 'POST',
    token: superToken,
    body: { kode: 'BDG-SA1', nama: 'Bidang Superadmin Test', deskripsi: 'Uji RBAC' },
  });
  assert.equal(createBidang.status, 201);

  const listBidang = await apiJson<{ items: Array<{ id: number; can_delete?: boolean }> }>(
    '/api/v1/master/bidang',
    { token: superToken }
  );
  assert.equal(listBidang.status, 200);
  const createdBidang = listBidang.data.items.find((b) => b.id === createBidang.data.id);
  assert.ok(createdBidang);
  assert.equal(createdBidang.can_delete, true);

  const updateBidang = await apiJson(`/api/v1/master/bidang/${createBidang.data.id}`, {
    method: 'PUT',
    token: superToken,
    body: { kode: 'BDG-SA1', nama: 'Bidang Superadmin Updated', deskripsi: 'Updated' },
  });
  assert.equal(updateBidang.status, 200);

  const deleteBidang = await apiJson(`/api/v1/master/bidang/${createBidang.data.id}`, {
    method: 'DELETE',
    token: superToken,
  });
  assert.equal(deleteBidang.status, 200);

  // Boundaries remain strictly enforced:
  // KARYAWAN still cannot mutate Master Kantor or Master Bidang
  const empToken = await loginAs('emp_relocate', 'EmpPassword!123');
  const empCreateOffice = await apiJson('/api/v1/master/offices', {
    method: 'POST',
    token: empToken,
    body: { kode: 'NOPE', nama: 'Forbidden', lat: -0.025, lng: 109.34, radius_meter: 200 },
  });
  assert.equal(empCreateOffice.status, 403);

  const empCreateBidang = await apiJson('/api/v1/master/bidang', {
    method: 'POST',
    token: empToken,
    body: { kode: 'NOPE', nama: 'Forbidden' },
  });
  assert.equal(empCreateBidang.status, 403);

  // ADMIN still cannot access SUPERADMIN-only endpoints
  assert.equal((await apiJson('/api/v1/settings', { token: adminToken })).status, 403);
  assert.equal((await apiJson('/api/v1/superadmin/accounts', { token: adminToken })).status, 403);
});

test('13. SUPERADMIN can delete a testing attendance session with audit trail while ADMIN and KARYAWAN get 403', async () => {
  const empToken = await loginAs('emp_relocate', 'EmpPassword!123');
  const existingSession = getDb()
    .prepare(`SELECT id, foto_path FROM absensi_sesi ORDER BY id DESC LIMIT 1`)
    .get() as { id: number; foto_path: string | null } | undefined;
  assert.ok(existingSession);

  // KARYAWAN and ADMIN cannot delete attendance sessions
  const empDel = await apiJson(`/api/v1/attendance/sessions/${existingSession.id}`, {
    method: 'DELETE',
    token: empToken,
    body: { alasan: 'Coba hapus sendiri' },
  });
  assert.equal(empDel.status, 403);

  const adminDel = await apiJson(`/api/v1/attendance/sessions/${existingSession.id}`, {
    method: 'DELETE',
    token: adminToken,
    body: { alasan: 'Coba hapus oleh operator' },
  });
  assert.equal(adminDel.status, 403);

  // SUPERADMIN without valid reason gets 400
  const badReasonDel = await apiJson(`/api/v1/attendance/sessions/${existingSession.id}`, {
    method: 'DELETE',
    token: superToken,
    body: { alasan: 'x' },
  });
  assert.equal(badReasonDel.status, 400);

  // SUPERADMIN with valid reason deletes session cleanly & records audit log
  const superDel = await apiJson<{ ok: boolean; deletedId: number }>(
    `/api/v1/attendance/sessions/${existingSession.id}`,
    {
      method: 'DELETE',
      token: superToken,
      body: { alasan: 'Data uji coba / testing' },
    }
  );
  assert.equal(superDel.status, 200);
  assert.equal(superDel.data.ok, true);
  assert.equal(superDel.data.deletedId, existingSession.id);

  // Verify row is gone from absensi_sesi and logged in audit_log
  const stillExists = getDb()
    .prepare(`SELECT id FROM absensi_sesi WHERE id = ?`)
    .get(existingSession.id);
  assert.equal(stillExists, undefined);

  const delAudit = getDb()
    .prepare(
      `SELECT modul, aksi, target_id, alasan FROM audit_log
       WHERE modul = 'ABSENSI' AND aksi = 'DELETE_ABSENSI_SESI' AND target_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(String(existingSession.id)) as { modul: string; aksi: string; target_id: string; alasan: string } | undefined;
  assert.ok(delAudit);
  assert.equal(delAudit.alasan, 'Data uji coba / testing');
});


