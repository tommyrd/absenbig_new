import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.ts';
import { getMonthDays, getWibDateString, getWibIsoString } from './time.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const AVATARS_DIR = path.join(DATA_DIR, 'avatars');
const DB_PATH = path.join(DATA_DIR, 'bignet_absensi.db');

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  initSchema(db);
  seedIfEmpty(db);

  _db = db;
  return db;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kantor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      alamat TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_meter INTEGER NOT NULL DEFAULT 250,
      geofence_mode TEXT NOT NULL DEFAULT 'CATAT_DENGAN_FLAG',
      zona_waktu TEXT NOT NULL DEFAULT 'Asia/Jakarta',
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bidang_kerja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      deskripsi TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS karyawan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nik TEXT NOT NULL UNIQUE,
      nama_lengkap TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      no_hp TEXT NOT NULL DEFAULT '',
      kantor_id INTEGER NOT NULL REFERENCES kantor(id),
      bidang_id INTEGER NOT NULL REFERENCES bidang_kerja(id),
      jabatan TEXT NOT NULL,
      tanggal_masuk TEXT NOT NULL,
      foto_profil_path TEXT,
      foto_profil_updated_at TEXT,
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pengguna (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('KARYAWAN','ADMIN','SUPERADMIN')),
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      aktif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kebijakan_absensi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK(level IN ('DEFAULT','BIDANG','KARYAWAN')),
      bidang_id INTEGER REFERENCES bidang_kerja(id),
      karyawan_id INTEGER REFERENCES karyawan(id),
      nama TEXT NOT NULL,
      jumlah_sesi INTEGER NOT NULL CHECK(jumlah_sesi IN (2,3,4)),
      min_sesi_hadir INTEGER NOT NULL,
      toleransi_terlambat_menit INTEGER NOT NULL DEFAULT 15,
      wajib_foto_semua_sesi INTEGER NOT NULL DEFAULT 1,
      wajib_aktivitas_sesi_lanjut INTEGER NOT NULL DEFAULT 1,
      libur_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
      off_pengganti_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
      izin_dihitung_masuk INTEGER NOT NULL DEFAULT 0,
      sakit_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
      cuti_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
      berlaku_mulai TEXT NOT NULL,
      aktif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sesi_absensi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kebijakan_id INTEGER NOT NULL REFERENCES kebijakan_absensi(id) ON DELETE CASCADE,
      urutan INTEGER NOT NULL CHECK(urutan BETWEEN 1 AND 4),
      nama TEXT NOT NULL,
      jam_mulai TEXT NOT NULL,
      jam_selesai TEXT NOT NULL,
      wajib_foto INTEGER NOT NULL DEFAULT 1,
      wajib_aktivitas INTEGER NOT NULL DEFAULT 0,
      aktif INTEGER NOT NULL DEFAULT 1,
      UNIQUE(kebijakan_id, urutan)
    );

    CREATE TABLE IF NOT EXISTS kalender_kerja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kantor_id INTEGER NOT NULL REFERENCES kantor(id),
      hari_minggu INTEGER NOT NULL CHECK(hari_minggu BETWEEN 0 AND 6),
      status_hari TEXT NOT NULL CHECK(status_hari IN ('HARI_KERJA','HARI_LIBUR')),
      jumlah_sesi_khusus INTEGER,
      keterangan TEXT NOT NULL DEFAULT '',
      UNIQUE(kantor_id, hari_minggu)
    );

    CREATE TABLE IF NOT EXISTS hari_libur (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      nama TEXT NOT NULL,
      kantor_id INTEGER REFERENCES kantor(id),
      dihitung_masuk INTEGER NOT NULL DEFAULT 1,
      keterangan TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS penugasan_kerja_khusus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      tanggal TEXT NOT NULL,
      nama_project TEXT NOT NULL,
      keterangan TEXT NOT NULL DEFAULT '',
      jumlah_sesi INTEGER NOT NULL CHECK(jumlah_sesi IN (2,3,4)),
      min_sesi_hadir INTEGER NOT NULL,
      berhak_off_pengganti INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'AKTIF' CHECK(status IN ('AKTIF','SELESAI','DIBATALKAN')),
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(karyawan_id, tanggal)
    );

    CREATE TABLE IF NOT EXISTS hak_off_pengganti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      kerja_khusus_id INTEGER NOT NULL REFERENCES penugasan_kerja_khusus(id),
      tanggal_kerja_sumber TEXT NOT NULL,
      nama_project TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'TERSEDIA' CHECK(status IN ('TERSEDIA','DIPAKAI','HANGUS')),
      kadaluarsa_pada TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pengajuan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      jenis TEXT NOT NULL CHECK(jenis IN ('CUTI','OFF','OFF_PENGGANTI','IZIN','SAKIT')),
      tanggal_mulai TEXT NOT NULL,
      tanggal_akhir TEXT NOT NULL,
      alasan TEXT NOT NULL,
      catatan TEXT NOT NULL DEFAULT '',
      lampiran_nama TEXT,
      hak_off_id INTEGER REFERENCES hak_off_pengganti(id),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
      diproses_oleh INTEGER REFERENCES pengguna(id),
      diproses_pada TEXT,
      alasan_keputusan TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS penggunaan_off_pengganti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hak_off_id INTEGER NOT NULL UNIQUE REFERENCES hak_off_pengganti(id),
      pengajuan_id INTEGER NOT NULL REFERENCES pengajuan(id),
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      tanggal_off TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS absensi_sesi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      tanggal TEXT NOT NULL,
      urutan_sesi INTEGER NOT NULL CHECK(urutan_sesi BETWEEN 1 AND 4),
      nama_sesi TEXT NOT NULL,
      waktu_server TEXT NOT NULL,
      status_ketepatan TEXT NOT NULL CHECK(status_ketepatan IN ('TEPAT_WAKTU','TERLAMBAT')),
      keterlambatan_menit INTEGER NOT NULL DEFAULT 0,
      lat REAL,
      lng REAL,
      accuracy_meter REAL,
      jarak_kantor_meter REAL,
      dalam_geofence INTEGER NOT NULL DEFAULT 1,
      ip_address TEXT,
      user_agent TEXT,
      tipe_aktivitas TEXT NOT NULL CHECK(tipe_aktivitas IN ('CHECK_IN','AKTIVITAS','STANDBY')),
      deskripsi_aktivitas TEXT NOT NULL DEFAULT '',
      foto_path TEXT,
      foto_checksum TEXT,
      policy_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(karyawan_id, tanggal, urutan_sesi)
    );

    CREATE TABLE IF NOT EXISTS override_kehadiran (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
      tanggal TEXT NOT NULL,
      hasil_awal TEXT NOT NULL,
      hasil_override TEXT NOT NULL CHECK(hasil_override IN ('DIHITUNG_MASUK','TIDAK_DIHITUNG_MASUK')),
      alasan TEXT NOT NULL,
      admin_id INTEGER NOT NULL REFERENCES pengguna(id),
      created_at TEXT NOT NULL,
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS periode_payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bulan TEXT NOT NULL,
      kantor_id INTEGER REFERENCES kantor(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
      ditutup_oleh INTEGER REFERENCES pengguna(id),
      ditutup_pada TEXT,
      catatan_closing TEXT,
      snapshot_json TEXT,
      UNIQUE(bulan, kantor_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      waktu_server TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      modul TEXT NOT NULL,
      aksi TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      target_id TEXT NOT NULL,
      karyawan_id INTEGER,
      tanggal_terdampak TEXT,
      before_json TEXT,
      after_json TEXT,
      alasan TEXT,
      ref_audit_id INTEGER
    );

    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log bersifat append-only dan tidak dapat diubah');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log bersifat append-only dan tidak dapat dihapus');
    END;

    CREATE TABLE IF NOT EXISTS pengaturan_aplikasi (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      nama_aplikasi TEXT NOT NULL DEFAULT 'Absensi BIGNET',
      subjudul_login TEXT NOT NULL DEFAULT 'Sistem Kehadiran Terpadu',
      judul_hero_login TEXT NOT NULL DEFAULT 'Presensi sesi akurat, kalender fleksibel, rekap payroll teraudit.',
      deskripsi_login TEXT NOT NULL DEFAULT 'Akses langsung melalui browser ponsel, tablet, maupun desktop tanpa perlu memasang aplikasi tambahan.',
      judul_form_login TEXT NOT NULL DEFAULT 'Masuk ke Akun Anda',
      pengumuman_login TEXT NOT NULL DEFAULT '',
      footer_login TEXT NOT NULL DEFAULT 'Kantor Pusat Jakarta · Kantor Operasional Bandung',
      logo_path TEXT,
      logo_updated_at TEXT,
      retensi_foto_hari INTEGER NOT NULL DEFAULT 365,
      wajib_gps_absensi INTEGER NOT NULL DEFAULT 1,
      izin_demo_login INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pendaftaran_akun (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_lengkap TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT NOT NULL,
      no_hp TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role_diminta TEXT NOT NULL CHECK(role_diminta IN ('KARYAWAN','ADMIN')),
      jabatan TEXT NOT NULL DEFAULT '',
      kantor_id INTEGER NOT NULL REFERENCES kantor(id),
      bidang_id INTEGER NOT NULL REFERENCES bidang_kerja(id),
      foto_profil_path TEXT,
      catatan_pendaftar TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
      nik_diberikan TEXT,
      alasan_keputusan TEXT,
      diproses_oleh INTEGER REFERENCES pengguna(id),
      diproses_pada TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_absensi_emp_date ON absensi_sesi(karyawan_id, tanggal);
    CREATE INDEX IF NOT EXISTS idx_pengajuan_emp ON pengajuan(karyawan_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(waktu_server DESC);
    CREATE INDEX IF NOT EXISTS idx_override_emp_date ON override_kehadiran(karyawan_id, tanggal, aktif);
    CREATE INDEX IF NOT EXISTS idx_pendaftaran_status ON pendaftaran_akun(status, created_at DESC);
  `);

  const empCols = db.prepare(`PRAGMA table_info(karyawan)`).all() as { name: string }[];
  if (!empCols.some((c) => c.name === 'foto_profil_path')) {
    db.exec(`ALTER TABLE karyawan ADD COLUMN foto_profil_path TEXT;`);
  }
  if (!empCols.some((c) => c.name === 'foto_profil_updated_at')) {
    db.exec(`ALTER TABLE karyawan ADD COLUMN foto_profil_updated_at TEXT;`);
  }

  const settingsCols = db.prepare(`PRAGMA table_info(pengaturan_aplikasi)`).all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === 'judul_form_login')) {
    db.exec(
      `ALTER TABLE pengaturan_aplikasi ADD COLUMN judul_form_login TEXT NOT NULL DEFAULT 'Masuk ke Akun Anda';`
    );
  }
  if (!settingsCols.some((c) => c.name === 'pengumuman_login')) {
    db.exec(
      `ALTER TABLE pengaturan_aplikasi ADD COLUMN pengumuman_login TEXT NOT NULL DEFAULT '';`
    );
  }

  db.prepare(
    `INSERT OR IGNORE INTO pengaturan_aplikasi (id, updated_at) VALUES (1, ?)`
  ).run(getWibIsoString());
}

function createSamplePhotoSvgFile(
  fileName: string,
  name: string,
  sesiLabel: string,
  tanggal: string,
  waktu: string,
  lokasi: string
): { filePath: string; checksum: string } {
  const safePath = path.join(PHOTOS_DIR, fileName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1528"/>
      <stop offset="100%" stop-color="#1d335c"/>
    </linearGradient>
  </defs>
  <rect width="480" height="360" fill="url(#bg)"/>
  <circle cx="240" cy="135" r="46" fill="#334155" stroke="#93c5fd" stroke-width="2"/>
  <path d="M168 258 C168 208 312 208 312 258" fill="#334155" stroke="#93c5fd" stroke-width="2"/>
  <rect x="20" y="278" width="440" height="62" rx="8" fill="rgba(7,14,27,0.82)" stroke="rgba(148,163,184,0.3)"/>
  <text x="34" y="302" font-family="sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${escapeXml(name)} — ${escapeXml(sesiLabel)}</text>
  <text x="34" y="324" font-family="monospace" font-size="12" fill="#cbd5e1">${escapeXml(tanggal)} ${escapeXml(waktu)} WIB · ${escapeXml(lokasi)}</text>
</svg>`;
  fs.writeFileSync(safePath, svg, 'utf8');
  const checksum = crypto.createHash('sha256').update(svg).digest('hex');
  return { filePath: fileName, checksum };
}

function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function seedIfEmpty(db: DatabaseSync) {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM kantor').get() as { c: number };
  if (countRow.c > 0) return;

  const nowIso = getWibIsoString();
  const today = getWibDateString();
  const ym = today.slice(0, 7);
  const monthDays = getMonthDays(ym);
  const pastDays = monthDays.filter((d) => d < today);
  const passwordHash = hashPassword('bignet123');

  // 1. Offices
  db.prepare(`
    INSERT INTO kantor (kode, nama, alamat, lat, lng, radius_meter, geofence_mode, zona_waktu, aktif)
    VALUES
      ('KTR-A', 'Kantor Pusat A (Jakarta)', 'Jl. Jend. Sudirman Kav. 52, Jakarta Selatan', -6.2088, 106.8456, 250, 'CATAT_DENGAN_FLAG', 'Asia/Jakarta', 1),
      ('KTR-B', 'Kantor Operasional B (Bandung)', 'Jl. Asia Afrika No. 112, Bandung', -6.9218, 107.6071, 250, 'CATAT_DENGAN_FLAG', 'Asia/Jakarta', 1)
  `).run();

  // 2. Bidang Kerja
  db.prepare(`
    INSERT INTO bidang_kerja (kode, nama, deskripsi) VALUES
      ('TEK', 'Teknisi Lapangan', 'Instalasi fiber optik, troubleshooting BTS, dan pemeliharaan jaringan'),
      ('NOC', 'Operasional & NOC', 'Pemantauan jaringan 24/7 dan respon tiket operasional'),
      ('ADM', 'Administrasi & Keuangan', 'Operasional kantor, HR, dan administrasi keuangan')
  `).run();

  // 3. Karyawan
  const empInsert = db.prepare(`
    INSERT INTO karyawan (nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan, tanggal_masuk, aktif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  empInsert.run('BG-001', 'Budi Santoso', 'owner@bignet.id', '08111000001', 1, 3, 'Owner / CEO', '2021-01-10');
  empInsert.run('BG-002', 'Siti Rahmawati', 'admin@bignet.id', '08111000002', 1, 3, 'HR & Operations Admin', '2022-03-01');
  empInsert.run('BG-101', 'Andi Pratama', 'andi@bignet.id', '08121000101', 1, 1, 'Senior Field Technician', '2023-02-15');
  empInsert.run('BG-102', 'Rina Kusuma', 'rina@bignet.id', '08121000102', 1, 3, 'Finance & Payroll Staff', '2023-06-01');
  empInsert.run('BG-103', 'Dimas Nugroho', 'dimas@bignet.id', '08121000103', 2, 1, 'Lead Network Technician', '2022-11-10');
  empInsert.run('BG-104', 'Fajar Hidayat', 'fajar@bignet.id', '08121000104', 2, 2, 'NOC Engineer', '2024-01-15');
  empInsert.run('BG-105', 'Dewi Lestari', 'dewi@bignet.id', '08121000105', 1, 2, 'NOC Analyst', '2024-04-01');
  empInsert.run('BG-106', 'Hendra Wijaya', 'hendra@bignet.id', '08121000106', 1, 1, 'Field Technician', '2024-07-01');

  // 4. Pengguna (RBAC)
  const userInsert = db.prepare(`
    INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  userInsert.run('superadmin', 'owner@bignet.id', passwordHash, 'SUPERADMIN', 1, nowIso);
  userInsert.run('admin', 'admin@bignet.id', passwordHash, 'ADMIN', 2, nowIso);
  userInsert.run('andi', 'andi@bignet.id', passwordHash, 'KARYAWAN', 3, nowIso);
  userInsert.run('rina', 'rina@bignet.id', passwordHash, 'KARYAWAN', 4, nowIso);
  userInsert.run('dimas', 'dimas@bignet.id', passwordHash, 'KARYAWAN', 5, nowIso);
  userInsert.run('fajar', 'fajar@bignet.id', passwordHash, 'KARYAWAN', 6, nowIso);
  userInsert.run('dewi', 'dewi@bignet.id', passwordHash, 'KARYAWAN', 7, nowIso);
  userInsert.run('hendra', 'hendra@bignet.id', passwordHash, 'KARYAWAN', 8, nowIso);

  // 5. Kebijakan Absensi (Default 4 sesi, Bidang Teknisi 3 sesi, Bidang Admin 2 sesi, Individu Dimas 4 sesi)
  const polInsert = db.prepare(`
    INSERT INTO kebijakan_absensi (
      level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
      toleransi_terlambat_menit, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
      libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
      sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  // id 1: DEFAULT (4 sesi, min 3)
  polInsert.run('DEFAULT', null, null, 'Kebijakan Default Perusahaan (4 Sesi)', 4, 3, 15, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  // id 2: BIDANG Teknisi (3 sesi, min 2)
  polInsert.run('BIDANG', 1, null, 'Kebijakan Teknisi Lapangan (3 Sesi)', 3, 2, 20, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  // id 3: BIDANG Administrasi (2 sesi, min 2)
  polInsert.run('BIDANG', 3, null, 'Kebijakan Administrasi Kantor (2 Sesi)', 2, 2, 10, 1, 0, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  // id 4: KARYAWAN Dimas (4 sesi khusus lead, min 3)
  polInsert.run('KARYAWAN', null, 5, 'Kebijakan Khusus Lead Teknisi Bandung (4 Sesi)', 4, 3, 15, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);

  const sesiInsert = db.prepare(`
    INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  // Policy 1 (4 sesi)
  sesiInsert.run(1, 1, 'Sesi 1 · Masuk Pagi', '08:00', '09:30', 1, 0);
  sesiInsert.run(1, 2, 'Sesi 2 · Progres Siang', '11:30', '13:30', 1, 1);
  sesiInsert.run(1, 3, 'Sesi 3 · Progres Sore', '15:00', '16:30', 1, 1);
  sesiInsert.run(1, 4, 'Sesi 4 · Pulang Kerja', '17:00', '20:00', 1, 1);
  // Policy 2 (3 sesi)
  sesiInsert.run(2, 1, 'Sesi 1 · Briefing & Berangkat', '08:00', '09:30', 1, 0);
  sesiInsert.run(2, 2, 'Sesi 2 · Lapangan / Standby', '12:00', '14:30', 1, 1);
  sesiInsert.run(2, 3, 'Sesi 3 · Laporan Selesai', '16:30', '19:30', 1, 1);
  // Policy 3 (2 sesi)
  sesiInsert.run(3, 1, 'Sesi 1 · Masuk Kantor', '08:00', '09:30', 1, 0);
  sesiInsert.run(3, 2, 'Sesi 2 · Pulang Kantor', '17:00', '19:00', 1, 0);
  // Policy 4 (4 sesi Dimas)
  sesiInsert.run(4, 1, 'Sesi 1 · Masuk Pagi', '08:00', '09:30', 1, 0);
  sesiInsert.run(4, 2, 'Sesi 2 · Cek Infrastruktur', '11:30', '13:30', 1, 1);
  sesiInsert.run(4, 3, 'Sesi 3 · Koordinasi Tim', '15:00', '16:30', 1, 1);
  sesiInsert.run(4, 4, 'Sesi 4 · Penutupan Shift', '17:00', '20:00', 1, 1);

  // 6. Kalender Kerja per Kantor
  const calInsert = db.prepare(`
    INSERT INTO kalender_kerja (kantor_id, hari_minggu, status_hari, jumlah_sesi_khusus, keterangan)
    VALUES (?, ?, ?, ?, ?)
  `);
  // Kantor A: Senin-Sabtu kerja, Minggu libur
  for (let d = 0; d <= 6; d++) {
    if (d === 0) {
      calInsert.run(1, d, 'HARI_LIBUR', null, 'Minggu Libur Operasional Kantor A');
    } else {
      calInsert.run(1, d, 'HARI_KERJA', null, 'Hari Kerja Reguler Kantor A');
    }
  }
  // Kantor B: Senin-Minggu kerja; Minggu setengah hari 2 sesi
  for (let d = 0; d <= 6; d++) {
    if (d === 0) {
      calInsert.run(2, d, 'HARI_KERJA', 2, 'Minggu Setengah Hari (2 Sesi) Kantor B');
    } else {
      calInsert.run(2, d, 'HARI_KERJA', null, 'Hari Kerja Reguler Kantor B');
    }
  }

  // 7. Hari Libur Perusahaan (1 tanggal di bulan berjalan, misal tanggal 10 jika sudah lewat atau tanggal 5)
  const holidayDate = monthDays[9] || `${ym}-10`;
  db.prepare(`
    INSERT INTO hari_libur (tanggal, nama, kantor_id, dihitung_masuk, keterangan, created_by, created_at)
    VALUES (?, 'Hari Pahlawan & Apresiasi BIGNET', NULL, 1, 'Libur perusahaan dibayar sesuai kebijakan payroll', 2, ?)
  `).run(holidayDate, nowIso);

  // 8. Kerja Khusus + Hak Off Pengganti (find a Sunday before today in current month, or day 1)
  const firstSundayPast =
    pastDays.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0) ||
    pastDays[0] ||
    `${ym}-01`;

  const kkInfo = db.prepare(`
    INSERT INTO penugasan_kerja_khusus (
      karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir, berhak_off_pengganti, status, created_by, created_at
    ) VALUES (3, ?, 'Migrasi OLT & Fiber Cluster Timur', 'Maintenance inti jaringan pada hari libur', 3, 2, 1, 'SELESAI', 2, ?)
  `).run(firstSundayPast, nowIso);

  db.prepare(`
    INSERT INTO hak_off_pengganti (karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at)
    VALUES (3, ?, ?, 'Migrasi OLT & Fiber Cluster Timur', 'TERSEDIA', ?, ?)
  `).run(Number(kkInfo.lastInsertRowid), firstSundayPast, `${ym}-30`, nowIso);

  // Also give Hendra (karyawan_id 8) a special work right & approved off pengganti on another day if possible
  const secondDay = pastDays[3] || `${ym}-04`;
  const kkHendra = db.prepare(`
    INSERT INTO penugasan_kerja_khusus (
      karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir, berhak_off_pengganti, status, created_by, created_at
    ) VALUES (8, ?, 'Backup Power BTS Utara', 'Pemasangan UPS darurat', 3, 2, 1, 'SELESAI', 2, ?)
  `).run(firstSundayPast === secondDay ? (pastDays[1] || `${ym}-02`) : secondDay, nowIso);

  const hakHendra = db.prepare(`
    INSERT INTO hak_off_pengganti (karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at)
    VALUES (8, ?, ?, 'Backup Power BTS Utara', 'DIPAKAI', ?, ?)
  `).run(Number(kkHendra.lastInsertRowid), firstSundayPast === secondDay ? (pastDays[1] || `${ym}-02`) : secondDay, `${ym}-30`, nowIso);

  // Approved OFF_PENGGANTI for Hendra today!
  const reqHendra = db.prepare(`
    INSERT INTO pengajuan (
      karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, hak_off_id, status, diproses_oleh, diproses_pada, alasan_keputusan, created_at, updated_at
    ) VALUES (8, 'OFF_PENGGANTI', ?, ?, 'Mengambil hak off pengganti kerja hari Minggu', 'Disetujui koordinator lapangan', ?, 'APPROVED', 2, ?, 'Hak off valid dan beban kerja lapangan aman', ?, ?)
  `).run(today, today, Number(hakHendra.lastInsertRowid), nowIso, nowIso, nowIso);

  db.prepare(`
    INSERT INTO penggunaan_off_pengganti (hak_off_id, pengajuan_id, karyawan_id, tanggal_off, status, created_at)
    VALUES (?, ?, 8, ?, 'APPROVED', ?)
  `).run(Number(hakHendra.lastInsertRowid), Number(reqHendra.lastInsertRowid), today, nowIso);

  // Pending request from Rina (karyawan_id 4) for upcoming date
  const futureDay = monthDays.find((d) => d > today) || today;
  db.prepare(`
    INSERT INTO pengajuan (
      karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, status, created_at, updated_at
    ) VALUES (4, 'CUTI', ?, ?, 'Keperluan keluarga di luar kota', 'Serah terima berkas ke Siti sebelum berangkat', 'PENDING', ?, ?)
  `).run(futureDay, futureDay, nowIso, nowIso);

  // Rejected request example from Fajar
  if (pastDays.length > 5) {
    db.prepare(`
      INSERT INTO pengajuan (
        karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, status, diproses_oleh, diproses_pada, alasan_keputusan, created_at, updated_at
      ) VALUES (6, 'IZIN', ?, ?, 'Urusan pribadi setengah hari', '', 'REJECTED', 2, ?, 'Jadwal shift NOC sedang padat tanpa pengganti', ?, ?)
    `).run(pastDays[4], pastDays[4], nowIso, nowIso, nowIso);
  }

  // 9. Historical Attendance Sessions for pastDays (and partial today sessions!)
  const absInsert = db.prepare(`
    INSERT INTO absensi_sesi (
      karyawan_id, tanggal, urutan_sesi, nama_sesi, waktu_server, status_ketepatan, keterlambatan_menit,
      lat, lng, accuracy_meter, jarak_kantor_meter, dalam_geofence, ip_address, user_agent,
      tipe_aktivitas, deskripsi_aktivitas, foto_path, foto_checksum, policy_snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const employeesForSeed = [
    { id: 3, nama: 'Andi Pratama', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 3, policyName: 'Kebijakan Teknisi Lapangan (3 Sesi)' },
    { id: 4, nama: 'Rina Kusuma', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 2, policyName: 'Kebijakan Administrasi Kantor (2 Sesi)' },
    { id: 5, nama: 'Dimas Nugroho', kantorLat: -6.9218, kantorLng: 107.6071, kantorNama: 'Kantor B', sesi: 4, policyName: 'Kebijakan Khusus Lead Teknisi Bandung (4 Sesi)' },
    { id: 6, nama: 'Fajar Hidayat', kantorLat: -6.9218, kantorLng: 107.6071, kantorNama: 'Kantor B', sesi: 4, policyName: 'Kebijakan Default Perusahaan (4 Sesi)' },
    { id: 7, nama: 'Dewi Lestari', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 4, policyName: 'Kebijakan Default Perusahaan (4 Sesi)' },
    { id: 8, nama: 'Hendra Wijaya', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 3, policyName: 'Kebijakan Teknisi Lapangan (3 Sesi)' },
  ];

  let missedDayForAndi: string | null = null;
  for (const d of pastDays) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const isHoliday = d === holidayDate;
    for (const emp of employeesForSeed) {
      const isKantorA = emp.kantorNama === 'Kantor A';
      const isKerjaKhususAndi = emp.id === 3 && d === firstSundayPast;
      if (isHoliday && !isKerjaKhususAndi) continue;
      if (isKantorA && dow === 0 && !isKerjaKhususAndi) continue;

      // Leave 1 workday missed for Andi so we have a clear TIDAK_HADIR + Admin Override demo
      if (emp.id === 3 && !missedDayForAndi && dow >= 1 && dow <= 5 && d !== firstSundayPast) {
        missedDayForAndi = d;
        continue;
      }
      // Leave 1 workday missed for Fajar (without override) so TIDAK HADIR count shows realistically
      if (emp.id === 6 && dow === 3 && d === pastDays[2]) {
        continue;
      }

      const sessionCount = !isKantorA && dow === 0 ? 2 : emp.sesi;
      const times = sessionCount === 2 ? ['08:05:12', '17:04:33'] : sessionCount === 3 ? ['08:12:40', '12:25:10', '17:05:45'] : ['08:07:19', '11:45:02', '15:14:22', '17:10:08'];
      const late = emp.id === 6 && dow === 1;
      for (let s = 1; s <= sessionCount; s++) {
        const t = s === 1 && late ? '09:32:10' : times[s - 1];
        const fileName = `seed_${emp.id}_${d}_s${s}.svg`;
        const { filePath, checksum } = createSamplePhotoSvgFile(
          fileName,
          emp.nama,
          `Sesi ${s}`,
          d,
          t,
          emp.kantorNama
        );
        absInsert.run(
          emp.id,
          d,
          s,
          `Sesi ${s}`,
          `${d}T${t}+07:00`,
          s === 1 && late ? 'TERLAMBAT' : 'TEPAT_WAKTU',
          s === 1 && late ? 17 : 0,
          emp.kantorLat + 0.0002,
          emp.kantorLng - 0.0001,
          14,
          38,
          1,
          '10.10.1.24',
          'Mozilla/5.0 (Mobile; BIGNET Web)',
          s === 1 ? 'CHECK_IN' : s === 2 && emp.id === 3 ? 'STANDBY' : 'AKTIVITAS',
          s === 1
            ? 'Absensi masuk di area kerja'
            : isKerjaKhususAndi
            ? 'Migrasi OLT & terminasi fiber cluster timur'
            : 'Melaksanakan tugas operasional dan pelaporan rutin',
          filePath,
          checksum,
          JSON.stringify({ policyName: emp.policyName, jumlahSesi: sessionCount }),
          `${d}T${t}+07:00`
        );
      }
    }
  }

  // Seed Today's active check-ins for Workforce Dashboard (Andi 1 session, Rina 1 session, Dimas 2 sessions, Dewi 1 session; Hendra is OFF_PENGGANTI)
  const todaySeed = [
    { emp: employeesForSeed[0], sessions: 1, times: ['08:09:14'], desc: ['Briefing pagi tim teknisi Jakarta'] },
    { emp: employeesForSeed[1], sessions: 1, times: ['08:03:51'], desc: ['Masuk kantor pusat, verifikasi berkas payroll'] },
    { emp: employeesForSeed[2], sessions: 2, times: ['08:04:10', '11:48:22'], desc: ['Cek perangkat OLT Bandung', 'Standby maintenance node Dago'] },
    { emp: employeesForSeed[4], sessions: 1, times: ['08:19:45'], desc: ['Shift pagi NOC monitoring traffic'] },
  ];

  for (const item of todaySeed) {
    for (let s = 1; s <= item.sessions; s++) {
      const fileName = `seed_${item.emp.id}_${today}_s${s}.svg`;
      const { filePath, checksum } = createSamplePhotoSvgFile(
        fileName,
        item.emp.nama,
        `Sesi ${s}`,
        today,
        item.times[s - 1],
        item.emp.kantorNama
      );
      absInsert.run(
        item.emp.id,
        today,
        s,
        `Sesi ${s}`,
        `${today}T${item.times[s - 1]}+07:00`,
        'TEPAT_WAKTU',
        0,
        item.emp.kantorLat + 0.0001,
        item.emp.kantorLng + 0.0001,
        12,
        24,
        1,
        '10.10.2.15',
        'Mozilla/5.0 (Mobile; BIGNET Web)',
        s === 1 ? 'CHECK_IN' : 'STANDBY',
        item.desc[s - 1],
        filePath,
        checksum,
        JSON.stringify({ policyName: item.emp.policyName, jumlahSesi: item.emp.sesi }),
        `${today}T${item.times[s - 1]}+07:00`
      );
    }
  }

  // 10. Seed Admin Override + Append-only Audit Trail examples
  if (missedDayForAndi) {
    const ovInfo = db.prepare(`
      INSERT INTO override_kehadiran (karyawan_id, tanggal, hasil_awal, hasil_override, alasan, admin_id, created_at, aktif)
      VALUES (3, ?, 'TIDAK_HADIR', 'DIHITUNG_MASUK', 'Penugasan darurat lapangan luar jaringan dengan surat tugas koordinator (HP kehabisan baterai)', 2, ?, 1)
    `).run(missedDayForAndi, nowIso);

    db.prepare(`
      INSERT INTO audit_log (
        actor_id, actor_name, actor_role, waktu_server, ip_address, user_agent,
        modul, aksi, target_entity, target_id, karyawan_id, tanggal_terdampak,
        before_json, after_json, alasan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      2,
      'Siti Rahmawati',
      'ADMIN',
      nowIso,
      '10.10.1.5',
      'Mozilla/5.0 (Desktop; Admin Console)',
      'OVERRIDE_KEHADIRAN',
      'CREATE_OVERRIDE',
      'override_kehadiran',
      String(ovInfo.lastInsertRowid),
      3,
      missedDayForAndi,
      JSON.stringify({ operationalStatus: 'TIDAK_HADIR', payrollStatus: 'TIDAK_DIHITUNG_MASUK', sessionsCompleted: 0 }),
      JSON.stringify({ payrollStatus: 'DIHITUNG_MASUK', buktiAsliDiubah: false }),
      'Penugasan darurat lapangan luar jaringan dengan surat tugas koordinator (HP kehabisan baterai)'
    );
  }

  db.prepare(`
    INSERT INTO audit_log (
      actor_id, actor_name, actor_role, waktu_server, ip_address, user_agent,
      modul, aksi, target_entity, target_id, karyawan_id, tanggal_terdampak,
      before_json, after_json, alasan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    2,
    'Siti Rahmawati',
    'ADMIN',
    nowIso,
    '10.10.1.5',
    'Mozilla/5.0 (Desktop; Admin Console)',
    'KALENDER_LIBUR',
    'CREATE_HOLIDAY',
    'hari_libur',
    '1',
    null,
    holidayDate,
    null,
    JSON.stringify({ nama: 'Hari Pahlawan & Apresiasi BIGNET', dihitung_masuk: true, kantor: 'Semua Kantor' }),
    'Penetapan hari libur perusahaan dibayar bulan berjalan'
  );

  // 11. Seed 1 pending account registration awaiting Superadmin approval
  db.prepare(`
    INSERT INTO pendaftaran_akun (
      nama_lengkap, username, email, no_hp, password_hash, role_diminta, jabatan,
      kantor_id, bidang_id, catatan_pendaftar, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(
    'Rizal Mahendra',
    'rizal',
    'rizal@bignet.id',
    '08139000201',
    passwordHash,
    'KARYAWAN',
    'Teknisi Fiber Optik Baru',
    1,
    1,
    'Pendaftaran teknisi lapangan cabang Jakarta Selatan',
    nowIso
  );
}
