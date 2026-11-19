import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';

// Isolated temporary workspace so live ./data is never touched
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bignet_e2e_suite_'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'bignet_absensi_e2e.db');

process.env.DATA_DIR = tempDataDir;
process.env.DB_PATH = tempDbPath;
process.env.SEED_DEMO_DATA = 'false';
process.env.ALLOW_DEMO_LOGIN = 'true';
process.env.AUTH_SECRET = 'bignet_e2e_secret_key_for_complete_functional_verification_64bytes';
process.env.TZ = 'Asia/Jakarta';

const { closeDb, getDb } = await import('../src/server/db.ts');
const { seedDemoDataset } = await import('../src/server/db/seed.ts');
const { registerApiRoutes } = await import('../src/server/routes.ts');
const {
  attendanceLimiter,
  loginFailLimiter,
  loginIpLimiter,
  passwordLimiter,
  registerLimiter,
} = await import('../src/server/security.ts');
const { getWibDateString } = await import('../src/server/time.ts');

const SAMPLE_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server: http.Server;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let fajarToken = '';
let fajarKaryawanId = 0;

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
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data: data as T };
}

async function loginAs(identifier: string, password: string): Promise<{ token: string; user: Record<string, unknown> }> {
  resetLimiters();
  const res = await apiJson<{ token: string; user: Record<string, unknown> }>('/api/v1/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  assert.equal(res.status, 200, `Login gagal untuk ${identifier}: ${JSON.stringify(res.data)}`);
  assert.ok(res.data.token);
  return res.data;
}

before(async () => {
  const db = getDb();
  seedDemoDataset(db);

  // Ensure today is a working day for Kantor A & B so attendance tests are deterministic even on Sundays
  db.prepare(`UPDATE kalender_kerja SET status_hari = 'HARI_KERJA', jumlah_sesi_khusus = NULL`).run();
  const today = getWibDateString();
  db.prepare(`DELETE FROM hari_libur WHERE tanggal = ?`).run(today);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerApiRoutes(app);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      assert.ok(addr && typeof addr !== 'string');
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  superToken = (await loginAs('superadmin', 'bignet123')).token;
  adminToken = (await loginAs('admin', 'bignet123')).token;
  const fajar = await loginAs('fajar', 'bignet123');
  fajarToken = fajar.token;
  fajarKaryawanId = Number(fajar.user.karyawan_id);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('1. Server Time, Public Settings, & Health endpoints', async () => {
  const health = await apiJson<{ status: string }>('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');

  const time = await apiJson<{ timezone: string; date: string; time: string; epochMs: number }>('/api/v1/time');
  assert.equal(time.status, 200);
  assert.equal(time.data.timezone, 'Asia/Jakarta');
  assert.match(time.data.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(time.data.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(typeof time.data.epochMs, 'number');

  const pub = await apiJson<{ settings: { nama_aplikasi: string; izin_demo_login: number } }>('/api/v1/settings/public');
  assert.equal(pub.status, 200);
  assert.ok(pub.data.settings.nama_aplikasi.length > 0);
});

test('2. Location Reverse Geocoding endpoint resolves coordinates & validates input', async () => {
  const invalid = await apiJson<{ error: string }>('/api/v1/location/reverse?lat=999&lng=106.84', {
    token: fajarToken,
  });
  assert.equal(invalid.status, 400);

  const ok = await apiJson<{ lat: number; lng: number; address: string | null; provider: string }>(
    '/api/v1/location/reverse?lat=-6.2088&lng=106.8456',
    { token: fajarToken }
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.data.lat, -6.2088);
  assert.equal(ok.data.lng, 106.8456);
  // When internet is reachable, Nominatim returns a real Indonesian address
  if (ok.data.provider !== 'none') {
    assert.ok(typeof ok.data.address === 'string' && ok.data.address.length > 5);
  }
});

test('3. Kebijakan Sesi: ALL levels (DEFAULT, BIDANG, KARYAWAN), validation, toggle, delete & hierarchy', async () => {
  // List initial policies
  const list1 = await apiJson<{ items: Array<{ id: number; level: string; nama: string; aktif: number }> }>(
    '/api/v1/policies',
    { token: adminToken }
  );
  assert.equal(list1.status, 200);
  assert.ok(list1.data.items.some((p) => p.level === 'DEFAULT'));
  assert.ok(list1.data.items.some((p) => p.level === 'BIDANG'));
  assert.ok(list1.data.items.some((p) => p.level === 'KARYAWAN'));

  // Reject invalid policy payload (jam_mulai >= jam_selesai)
  const badTime = await apiJson<{ error: string }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'BIDANG',
      bidang_id: 2,
      nama: 'Policy Jam Salah',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
      sesi: [
        { urutan: 1, nama: 'Sesi 1', jam_mulai: '10:00', jam_selesai: '09:00', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2', jam_mulai: '13:00', jam_selesai: '17:00', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
      ],
    },
  });
  assert.equal(badTime.status, 400);

  // Reject invalid bidang_id
  const badBidang = await apiJson<{ error: string }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'BIDANG',
      bidang_id: 9999,
      nama: 'Policy Bidang Tidak Ada',
      jumlah_sesi: 2,
      min_sesi_hadir: 1,
    },
  });
  assert.equal(badBidang.status, 400);

  // Protect last active DEFAULT policy from deletion or deactivation
  const defaultPolicy = list1.data.items.find((p) => p.level === 'DEFAULT')!;
  const blockDeactivate = await apiJson<{ error: string }>(`/api/v1/policies/${defaultPolicy.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { aktif: 0 },
  });
  assert.equal(blockDeactivate.status, 400);

  const blockDelete = await apiJson<{ error: string }>(`/api/v1/policies/${defaultPolicy.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(blockDelete.status, 400);

  // Create BIDANG policy for Bidang 2 (NOC - Fajar's bidang) with optional photo & activity
  const createBidang = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'BIDANG',
      bidang_id: 2,
      nama: 'Kebijakan Uji NOC (2 Sesi Opsional)',
      jumlah_sesi: 2,
      min_sesi_hadir: 2,
      toleransi_terlambat_menit: 10,
      aturan_lokasi: 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: false,
      wajib_aktivitas_sesi_lanjut: false,
      berlaku_mulai: '2026-01-01',
      sesi: [
        { urutan: 1, nama: 'NOC Masuk', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 0, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'NOC Pulang', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 0, wajib_aktivitas: 0, aktif: 1 },
      ],
    },
  });
  assert.equal(createBidang.status, 201);
  const bidangPolicyId = createBidang.data.id;

  // Verify Fajar now resolves to BIDANG policy (2 sessions, photo NOT required)
  const todayBidang = await apiJson<{
    day: { policySnapshot: { level: string; policyName: string; jumlahSesi: number; wajibFotoSemuaSesi: boolean; sesiList: Array<{ wajib_foto: number; wajib_aktivitas: number }> } };
  }>('/api/v1/attendance/today', { token: fajarToken });
  assert.equal(todayBidang.status, 200);
  assert.equal(todayBidang.data.day.policySnapshot.level, 'BIDANG');
  assert.equal(todayBidang.data.day.policySnapshot.jumlahSesi, 2);
  assert.equal(todayBidang.data.day.policySnapshot.wajibFotoSemuaSesi, false);
  assert.equal(todayBidang.data.day.policySnapshot.sesiList[0].wajib_foto, 0);
  assert.equal(todayBidang.data.day.policySnapshot.sesiList[1].wajib_aktivitas, 0);

  // Create KARYAWAN policy for Fajar (3 sessions, overrides BIDANG)
  const createEmp = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'KARYAWAN',
      karyawan_id: fajarKaryawanId,
      nama: 'Kebijakan Khusus Fajar (3 Sesi)',
      jumlah_sesi: 3,
      min_sesi_hadir: 2,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: true,
      wajib_aktivitas_sesi_lanjut: true,
      berlaku_mulai: '2026-01-01',
      sesi: [
        { urutan: 1, nama: 'Sesi 1 Masuk', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
        { urutan: 2, nama: 'Sesi 2 Siang', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
        { urutan: 3, nama: 'Sesi 3 Pulang', jam_mulai: '00:00', jam_selesai: '23:59', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      ],
    },
  });
  assert.equal(createEmp.status, 201);
  const empPolicyId = createEmp.data.id;

  // Verify Fajar now resolves to KARYAWAN policy (priority KARYAWAN > BIDANG > DEFAULT)
  const todayEmp = await apiJson<{
    day: { policySnapshot: { level: string; jumlahSesi: number; aturanLokasi: string } };
  }>('/api/v1/attendance/today', { token: fajarToken });
  assert.equal(todayEmp.status, 200);
  assert.equal(todayEmp.data.day.policySnapshot.level, 'KARYAWAN');
  assert.equal(todayEmp.data.day.policySnapshot.jumlahSesi, 3);

  // Partial PUT toggle aktif = 0 on KARYAWAN policy -> Fajar falls back to BIDANG policy
  const toggleOff = await apiJson<{ ok: boolean }>(`/api/v1/policies/${empPolicyId}`, {
    method: 'PUT',
    token: adminToken,
    body: { aktif: 0 },
  });
  assert.equal(toggleOff.status, 200);

  const afterToggleOff = await apiJson<{ day: { policySnapshot: { level: string } } }>(
    '/api/v1/attendance/today',
    { token: fajarToken }
  );
  assert.equal(afterToggleOff.data.day.policySnapshot.level, 'BIDANG');

  // Re-activate KARYAWAN policy for Attendance Test #4
  const toggleOn = await apiJson<{ ok: boolean }>(`/api/v1/policies/${empPolicyId}`, {
    method: 'PUT',
    token: adminToken,
    body: { aktif: 1 },
  });
  assert.equal(toggleOn.status, 200);

  // Create & delete an extra BIDANG policy to verify DELETE works cleanly
  const tempPol = await apiJson<{ id: number }>('/api/v1/policies', {
    method: 'POST',
    token: adminToken,
    body: {
      level: 'DEFAULT',
      nama: 'Default Cadangan Uji',
      jumlah_sesi: 4,
      min_sesi_hadir: 3,
      berlaku_mulai: '2026-01-01',
    },
  });
  assert.equal(tempPol.status, 201);
  const delPol = await apiJson<{ ok: boolean }>(`/api/v1/policies/${tempPol.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(delPol.status, 200);
  assert.ok(bidangPolicyId > 0);
});

test('4. Attendance flow: geofence, accuracy, camera-only, flexible S2, strict S3, optional photo, & feed', async () => {
  // Fajar is at Kantor B (-6.9218, 107.6071, radius 250m) with active 3-session KARYAWAN policy
  resetLimiters();

  // 4a. Reject Session 1 outside geofence
  const outOfRadius = await apiJson<{ error: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 1,
      lat: -6.2088, // Jakarta (far from Bandung)
      lng: 106.8456,
      accuracyMeter: 15,
      tipeAktivitas: 'CHECK_IN',
      deskripsiAktivitas: 'Tes luar radius',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(outOfRadius.status, 400);

  // 4b. Reject Session 1 with low GPS accuracy (>100m)
  const badAcc = await apiJson<{ error: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 1,
      lat: -6.9218,
      lng: 107.6071,
      accuracyMeter: 250,
      tipeAktivitas: 'CHECK_IN',
      deskripsiAktivitas: 'Tes akurasi rendah',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(badAcc.status, 400);

  // 4c. Reject gallery upload (non BROWSER_CAMERA)
  const galleryUpload = await apiJson<{ error: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 1,
      lat: -6.9218,
      lng: 107.6071,
      accuracyMeter: 12,
      tipeAktivitas: 'CHECK_IN',
      deskripsiAktivitas: 'Tes unggah galeri',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'FILE_UPLOAD',
    },
  });
  assert.equal(galleryUpload.status, 400);

  // 4d. Valid Session 1 check-in inside Kantor B
  const s1 = await apiJson<{ sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 1,
      lat: -6.9218,
      lng: 107.6071,
      accuracyMeter: 12,
      tipeAktivitas: 'CHECK_IN',
      deskripsiAktivitas: 'Check-in pagi Bandung lancar',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s1.status, 201, `Sesi 1 gagal: ${JSON.stringify(s1.data)}`);
  assert.ok(s1.data.sessionId > 0);

  // 4e. Session 2 flexible outside office (SESI_PERTAMA_KANTOR) succeeds
  resetLimiters();
  const s2 = await apiJson<{ sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 2,
      lat: -6.9001, // >2km away from office
      lng: 107.6186,
      accuracyMeter: 20,
      tipeAktivitas: 'AKTIVITAS',
      deskripsiAktivitas: 'Maintenance fiber di area Dago',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s2.status, 201, `Sesi 2 fleksibel gagal: ${JSON.stringify(s2.data)}`);

  // 4f. Switch Fajar's policy to SEMUA_SESI_KANTOR -> Session 3 outside office MUST be rejected
  const policies = await apiJson<{ items: Array<{ id: number; level: string; karyawan_id: number | null }> }>(
    '/api/v1/policies',
    { token: adminToken }
  );
  const fajarPol = policies.data.items.find((p) => p.level === 'KARYAWAN' && p.karyawan_id === fajarKaryawanId)!;
  const tighten = await apiJson<{ ok: boolean }>(`/api/v1/policies/${fajarPol.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { aturan_lokasi: 'SEMUA_SESI_KANTOR' },
  });
  assert.equal(tighten.status, 200);

  resetLimiters();
  const s3Outside = await apiJson<{ error: string }>('/api/v1/attendance/session', {
    method: 'POST',
    token: fajarToken,
    body: {
      urutanSesi: 3,
      lat: -6.9001,
      lng: 107.6186,
      accuracyMeter: 15,
      tipeAktivitas: 'STANDBY',
      deskripsiAktivitas: 'Standby di luar kantor',
      fotoBase64: SAMPLE_PNG_BASE64,
      fotoSource: 'BROWSER_CAMERA',
    },
  });
  assert.equal(s3Outside.status, 400);

  // Inside office succeeds & marks day HADIR
  resetLimiters();
  const s3Inside = await apiJson<{ sessionId: number; day: { operationalStatus: string; payrollStatus: string } }>(
    '/api/v1/attendance/session',
    {
      method: 'POST',
      token: fajarToken,
      body: {
        urutanSesi: 3,
        lat: -6.9218,
        lng: 107.6071,
        accuracyMeter: 10,
        tipeAktivitas: 'AKTIVITAS',
        deskripsiAktivitas: 'Laporan akhir shift di kantor Bandung',
        fotoBase64: SAMPLE_PNG_BASE64,
        fotoSource: 'BROWSER_CAMERA',
      },
    }
  );
  assert.equal(s3Inside.status, 201);
  assert.equal(s3Inside.data.day.operationalStatus, 'HADIR');
  assert.equal(s3Inside.data.day.payrollStatus, 'DIHITUNG_MASUK');

  // 4g. Verify Beranda feed returns Fajar's newly created posts with photo & location
  const feed = await apiJson<{ posts: Array<{ id: number; hasFoto: boolean; lokasiAktualAlamat: string | null }> }>(
    '/api/v1/feed/today?scope=today',
    { token: fajarToken }
  );
  assert.equal(feed.status, 200);
  const posted = feed.data.posts.find((p) => p.id === s1.data.sessionId);
  assert.ok(posted, 'Postingan absensi baru harus muncul di Beranda hari ini');
  assert.equal(posted.hasFoto, true);

  // 4h. Verify optional photo & optional activity policy actually works for Dewi (Bidang 2 = NOC 2-sesi opsional)
  const dewi = await loginAs('dewi', 'bignet123');
  const db = getDb();
  const today = getWibDateString();
  // Clear Dewi's seeded session today so we test fresh check-in without photo/activity
  db.prepare(`DELETE FROM absensi_sesi WHERE karyawan_id = ? AND tanggal = ?`).run(
    Number(dewi.user.karyawan_id),
    today
  );
  resetLimiters();
  const dewiS1 = await apiJson<{ sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: dewi.token,
    body: {
      urutanSesi: 1,
      lat: -6.2088,
      lng: 106.8456,
      accuracyMeter: 15,
      tipeAktivitas: 'CHECK_IN',
      deskripsiAktivitas: '',
    },
  });
  assert.equal(dewiS1.status, 201, `Policy foto opsional gagal: ${JSON.stringify(dewiS1.data)}`);

  const dewiS2 = await apiJson<{ sessionId: number }>('/api/v1/attendance/session', {
    method: 'POST',
    token: dewi.token,
    body: {
      urutanSesi: 2,
      lat: -6.21,
      lng: 106.85,
      accuracyMeter: 20,
      tipeAktivitas: 'AKTIVITAS',
      deskripsiAktivitas: '',
    },
  });
  assert.equal(dewiS2.status, 201, `Policy aktivitas opsional gagal: ${JSON.stringify(dewiS2.data)}`);
});

test('5. Pengajuan, Approval, Holidays, Kerja Khusus, Payroll Summary, Override, & Closing', async () => {
  const today = getWibDateString();
  const ym = today.slice(0, 7);

  // Create & approve a CUTI request for Rina on a future date
  const rina = await loginAs('rina', 'bignet123');
  const reqCreate = await apiJson<{ id: number }>('/api/v1/requests', {
    method: 'POST',
    token: rina.token,
    body: {
      jenis: 'CUTI',
      tanggalMulai: '2026-12-21',
      tanggalAkhir: '2026-12-22',
      alasan: 'Cuti tahunan akhir tahun',
      catatan: 'Serah terima tugas selesai',
    },
  });
  assert.equal(reqCreate.status, 201);

  const reqApprove = await apiJson<{ ok: boolean }>(`/api/v1/requests/${reqCreate.data.id}/decide`, {
    method: 'POST',
    token: adminToken,
    body: { decision: 'APPROVED', alasanKeputusan: 'Disetujui sesuai kuota cuti' },
  });
  assert.equal(reqApprove.status, 200);

  // Create & delete a company holiday
  const holCreate = await apiJson<{ id: number }>('/api/v1/holidays', {
    method: 'POST',
    token: adminToken,
    body: {
      tanggal: '2026-12-25',
      nama: 'Libur Natal Uji',
      kantorId: null,
      dihitungMasuk: true,
      keterangan: 'Hari libur nasional',
    },
  });
  assert.equal(holCreate.status, 201);
  const holDel = await apiJson<{ ok: boolean }>(`/api/v1/holidays/${holCreate.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(holDel.status, 200);

  // Special Work creation
  const sw = await apiJson<{ id: number }>('/api/v1/special-work', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawan_id: fajarKaryawanId,
      tanggal: '2026-12-27',
      nama_project: 'Upgrade Core Router Bandung',
      keterangan: 'Maintenance akhir pekan',
      jumlah_sesi: 2,
      min_sesi_hadir: 2,
      berhak_off_pengganti: true,
    },
  });
  assert.equal(sw.status, 201);

  // Payroll summary
  const payroll = await apiJson<{ items: Array<{ karyawanId: number; hariMasuk: number }> }>(
    `/api/v1/payroll/summary?bulan=${ym}`,
    { token: adminToken }
  );
  assert.equal(payroll.status, 200);
  assert.ok(payroll.data.items.length >= 6);

  // Admin Override Kehadiran
  const ov = await apiJson<{ ok: boolean }>('/api/v1/payroll/override', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId: fajarKaryawanId,
      tanggal: today,
      hasilOverride: 'DIHITUNG_MASUK',
      alasan: 'Verifikasi manual admin untuk pengujian E2E',
    },
  });
  assert.ok(ov.status === 200 || ov.status === 201, `Override gagal: ${JSON.stringify(ov.data)}`);

  // Superadmin Audit Log & Accounts check
  const audit = await apiJson<{ items: Array<{ modul: string; aksi: string }> }>(
    '/api/v1/audit',
    { token: superToken }
  );
  assert.equal(audit.status, 200);
  assert.ok(audit.data.items.some((a) => a.modul === 'POLICY_SESI'));
  assert.ok(audit.data.items.some((a) => a.modul === 'OVERRIDE_KEHADIRAN'));

  const accounts = await apiJson<{ items: Array<{ username: string }> }>(
    '/api/v1/superadmin/accounts',
    { token: superToken }
  );
  assert.equal(accounts.status, 200);
  assert.ok(accounts.data.items.some((a) => a.username === 'superadmin'));
});

test('6. Strict Role Separation: SUPERADMIN vs ADMIN Operasional vs KARYAWAN (only KARYAWAN does attendance)', async () => {
  const superToken = (await loginAs('superadmin', 'bignet123')).token;
  const adminToken = (await loginAs('admin', 'bignet123')).token;
  const today = getWibDateString();
  const ym = today.slice(0, 7);

  // Neither ADMIN nor SUPERADMIN can access personal attendance check-in endpoints
  const adminAttToday = await apiJson('/api/v1/attendance/today', { token: adminToken });
  assert.equal(adminAttToday.status, 403);

  const superAttToday = await apiJson('/api/v1/attendance/today', { token: superToken });
  assert.equal(superAttToday.status, 403);

  const adminAttPost = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: adminToken,
    body: { urutanSesi: 1 },
  });
  assert.equal(adminAttPost.status, 403);

  const superAttPost = await apiJson('/api/v1/attendance/session', {
    method: 'POST',
    token: superToken,
    body: { urutanSesi: 1 },
  });
  assert.equal(superAttPost.status, 403);

  // ADMIN cannot access Superadmin overview
  const adminSuperOverview = await apiJson(`/api/v1/superadmin/overview?bulan=${ym}`, {
    token: adminToken,
  });
  assert.equal(adminSuperOverview.status, 403);

  // ADMIN Operasional (Siti Rahmawati / BG-002 / karyawan_id = 1) must NOT appear in employee rosters or payroll
  const workforce = await apiJson<{ items: Array<{ nik: string; namaLengkap: string }> }>(
    '/api/v1/workforce/today',
    { token: adminToken }
  );
  assert.equal(workforce.status, 200);
  assert.ok(!workforce.data.items.some((w) => w.nik === 'BG-002'));
  assert.equal(workforce.data.items.length, 6);

  const feed = await apiJson<{ roster: Array<{ nik: string }> }>(
    '/api/v1/feed/today',
    { token: adminToken }
  );
  assert.equal(feed.status, 200);
  assert.ok(!feed.data.roster.some((r) => r.nik === 'BG-002'));

  const employees = await apiJson<{ items: Array<{ nik: string; role?: string }> }>(
    '/api/v1/master/employees',
    { token: adminToken }
  );
  assert.equal(employees.status, 200);
  assert.ok(!employees.data.items.some((e) => e.nik === 'BG-002'));

  const payroll = await apiJson<{ items: Array<{ nik: string }> }>(
    `/api/v1/payroll/summary?bulan=${ym}`,
    { token: adminToken }
  );
  assert.equal(payroll.status, 200);
  assert.ok(!payroll.data.items.some((p) => p.nik === 'BG-002'));

  // ADMIN cannot submit a personal request without selecting a KARYAWAN or targeting an ADMIN
  const adminSelfReq = await apiJson('/api/v1/requests', {
    method: 'POST',
    token: adminToken,
    body: {
      jenis: 'CUTI',
      tanggalMulai: today,
      tanggalAkhir: today,
      alasan: 'Coba cuti pribadi admin',
    },
  });
  assert.equal(adminSelfReq.status, 400);

  const adminTargetSelfReq = await apiJson('/api/v1/requests', {
    method: 'POST',
    token: adminToken,
    body: {
      karyawanId: 1,
      jenis: 'CUTI',
      tanggalMulai: today,
      tanggalAkhir: today,
      alasan: 'Coba cuti untuk akun admin',
    },
  });
  assert.equal(adminTargetSelfReq.status, 403);
});

