export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kantor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT NOT NULL UNIQUE,
    nama TEXT NOT NULL,
    alamat TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    radius_meter INTEGER NOT NULL DEFAULT 250,
    geofence_mode TEXT NOT NULL DEFAULT 'TOLAK_LUAR_RADIUS',
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
    aktif INTEGER NOT NULL DEFAULT 1,
    is_system_archive INTEGER NOT NULL DEFAULT 0 CHECK(is_system_archive IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS pengguna (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('KARYAWAN','ADMIN','SUPERADMIN')),
    karyawan_id INTEGER REFERENCES karyawan(id),
    nama_tampilan TEXT NOT NULL DEFAULT '',
    no_hp TEXT NOT NULL DEFAULT '',
    foto_profil_path TEXT,
    foto_profil_updated_at TEXT,
    aktif INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TRIGGER IF NOT EXISTS trg_pengguna_role_link_insert
  BEFORE INSERT ON pengguna
  FOR EACH ROW
  WHEN (NEW.role = 'KARYAWAN' AND NEW.karyawan_id IS NULL)
    OR (NEW.role IN ('ADMIN','SUPERADMIN') AND NEW.karyawan_id IS NOT NULL)
  BEGIN
    SELECT RAISE(ABORT, 'KARYAWAN wajib memiliki profil pegawai; ADMIN OPERASIONAL dan SUPERADMIN adalah akun non-pegawai.');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_pengguna_role_link_update
  BEFORE UPDATE OF role, karyawan_id ON pengguna
  FOR EACH ROW
  WHEN (NEW.role = 'KARYAWAN' AND NEW.karyawan_id IS NULL)
    OR (NEW.role IN ('ADMIN','SUPERADMIN') AND NEW.karyawan_id IS NOT NULL)
  BEGIN
    SELECT RAISE(ABORT, 'KARYAWAN wajib memiliki profil pegawai; ADMIN OPERASIONAL dan SUPERADMIN adalah akun non-pegawai.');
  END;

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    revoked_at TEXT NOT NULL
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
    aturan_lokasi TEXT NOT NULL DEFAULT 'SESI_PERTAMA_KANTOR',
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

  CREATE TABLE IF NOT EXISTS override_akses_absensi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
    tanggal TEXT NOT NULL,
    urutan_sesi INTEGER NOT NULL CHECK(urutan_sesi BETWEEN 1 AND 4),
    nama_sesi TEXT NOT NULL,
    alasan TEXT NOT NULL,
    admin_id INTEGER NOT NULL REFERENCES pengguna(id),
    status TEXT NOT NULL DEFAULT 'AKTIF' CHECK(status IN ('AKTIF','DIGUNAKAN','KEDALUWARSA','DICABUT')),
    berlaku_sampai TEXT NOT NULL,
    used_at TEXT,
    used_session_id INTEGER REFERENCES absensi_sesi(id),
    created_at TEXT NOT NULL
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
    favicon_path TEXT,
    favicon_updated_at TEXT,
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
  CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi_sesi(tanggal, waktu_server DESC);
  CREATE INDEX IF NOT EXISTS idx_pengajuan_emp ON pengajuan(karyawan_id, status);
  CREATE INDEX IF NOT EXISTS idx_pengajuan_dates ON pengajuan(karyawan_id, status, tanggal_mulai, tanggal_akhir);
  CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(waktu_server DESC);
  CREATE INDEX IF NOT EXISTS idx_override_emp_date ON override_kehadiran(karyawan_id, tanggal, aktif);
  CREATE INDEX IF NOT EXISTS idx_override_akses_emp_date
    ON override_akses_absensi(karyawan_id, tanggal, urutan_sesi, status, berlaku_sampai);
  CREATE INDEX IF NOT EXISTS idx_pendaftaran_status ON pendaftaran_akun(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);
`;
