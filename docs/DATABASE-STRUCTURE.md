# Struktur Database — Absensi BIGNET

Dokumentasi lengkap 19 tabel, relasi kunci asing (*foreign key*), constraint, trigger, dan index pada skema database (`src/server/db/schema.ts`).

---

## 1. Daftar Tabel & Relasi Utama

### 1.1 `schema_migrations`
Mencatat versi migrasi skema yang telah diterapkan.
- `version` (`TEXT PK`), `name` (`TEXT NOT NULL`), `applied_at` (`TEXT NOT NULL`).

### 1.2 `kantor`
Master lokasi kantor beserta koordinat dan kebijakan geofence.
- `id` (`INTEGER PK`), `kode` (`TEXT UNIQUE`), `nama`, `alamat`, `lat` (`REAL`), `lng` (`REAL`), `radius_meter` (`DEFAULT 250`), `geofence_mode` (`CATAT_DENGAN_FLAG` | `TOLAK_LUAR_RADIUS`), `zona_waktu` (`Asia/Jakarta`), `aktif` (`INTEGER`).

### 1.3 `bidang_kerja`
Master divisi/bidang kerja (Teknisi Lapangan, NOC, Administrasi, dll.).
- `id` (`INTEGER PK`), `kode` (`TEXT UNIQUE`), `nama`, `deskripsi`.

### 1.4 `karyawan`
Master data kepegawaian dan foto profil.
- `id` (`INTEGER PK`), `nik` (`TEXT UNIQUE`), `nama_lengkap`, `email` (`TEXT UNIQUE`), `no_hp`, `kantor_id` (`FK -> kantor.id`), `bidang_id` (`FK -> bidang_kerja.id`), `jabatan`, `tanggal_masuk`, `foto_profil_path`, `foto_profil_updated_at`, `aktif`.

### 1.5 `pengguna`
Akun autentikasi dan hak akses role.
- `id` (`INTEGER PK`), `username` (`TEXT UNIQUE`), `email` (`TEXT UNIQUE`), `password_hash`, `role` (`CHECK IN ('KARYAWAN','ADMIN','SUPERADMIN')`), `karyawan_id` (`FK -> karyawan.id`), `aktif`, `token_version` (`DEFAULT 1`), `created_at`.

### 1.6 `revoked_tokens`
Daftar `jti` token sesi yang telah direvoke sebelum kedaluwarsa (mis. setelah logout).
- `jti` (`TEXT PK`), `expires_at` (`INTEGER`), `revoked_at` (`TEXT`).
- **Index:** `idx_revoked_tokens_exp(expires_at)`.

### 1.7 `kebijakan_absensi` & `sesi_absensi`
Aturan sesi bertingkat (`KARYAWAN > BIDANG > DEFAULT`).
- `kebijakan_absensi`: `id` (`PK`), `level` (`DEFAULT` | `BIDANG` | `KARYAWAN`), `bidang_id` (`FK -> bidang_kerja.id`), `karyawan_id` (`FK -> karyawan.id`), `nama`, `jumlah_sesi` (`2|3|4`), `min_sesi_hadir`, `toleransi_terlambat_menit`, `aturan_lokasi` (`SESI_PERTAMA_KANTOR` | `SEMUA_SESI_KANTOR`, default `SESI_PERTAMA_KANTOR`), `wajib_foto_semua_sesi`, `wajib_aktivitas_sesi_lanjut`, flag hitung payroll (`libur_dihitung_masuk`, `off_pengganti_dihitung_masuk`, `izin_dihitung_masuk`, `sakit_dihitung_masuk`, `cuti_dihitung_masuk`), `berlaku_mulai`, `aktif`, `created_at`.
- `sesi_absensi`: `id` (`PK`), `kebijakan_id` (`FK -> kebijakan_absensi.id ON DELETE CASCADE`), `urutan` (`1..4`), `nama`, `jam_mulai`, `jam_selesai`, `wajib_foto`, `wajib_aktivitas`, `aktif`. `UNIQUE(kebijakan_id, urutan)`.

### 1.8 `kalender_kerja` & `hari_libur`
Kalender mingguan per kantor dan hari libur khusus perusahaan.
- `kalender_kerja`: `id` (`PK`), `kantor_id` (`FK -> kantor.id`), `hari_minggu` (`0..6`), `status_hari` (`HARI_KERJA` | `HARI_LIBUR`), `jumlah_sesi_khusus`, `keterangan`. `UNIQUE(kantor_id, hari_minggu)`.
- `hari_libur`: `id` (`PK`), `tanggal`, `nama`, `kantor_id` (`FK -> kantor.id`, NULL = semua kantor), `dihitung_masuk`, `keterangan`, `created_by`, `created_at`.

### 1.9 `penugasan_kerja_khusus`, `hak_off_pengganti` & `penggunaan_off_pengganti`
Penugasan hari libur dan manajemen kuota off pengganti.
- `penugasan_kerja_khusus`: `id` (`PK`), `karyawan_id` (`FK -> karyawan.id`), `tanggal`, `nama_project`, `keterangan`, `jumlah_sesi`, `min_sesi_hadir`, `berhak_off_pengganti`, `status` (`AKTIF` | `SELESAI` | `DIBATALKAN`), `created_by`, `created_at`. `UNIQUE(karyawan_id, tanggal)`.
- `hak_off_pengganti`: `id` (`PK`), `karyawan_id` (`FK -> karyawan.id`), `kerja_khusus_id` (`FK -> penugasan_kerja_khusus.id`), `tanggal_kerja_sumber`, `nama_project`, `status` (`TERSEDIA` | `DIPAKAI` | `HANGUS`), `kadaluarsa_pada`, `created_at`.
- `penggunaan_off_pengganti`: `id` (`PK`), `hak_off_id` (`UNIQUE FK -> hak_off_pengganti.id`), `pengajuan_id` (`FK -> pengajuan.id`), `karyawan_id` (`FK -> karyawan.id`), `tanggal_off`, `status` (`PENDING` | `APPROVED` | `REJECTED` | `CANCELLED`), `created_at`.

### 1.10 `pengajuan`
Pengajuan cuti, off, off pengganti, izin, dan sakit.
- `id` (`PK`), `karyawan_id` (`FK -> karyawan.id`), `jenis` (`CUTI` | `OFF` | `OFF_PENGGANTI` | `IZIN` | `SAKIT`), `tanggal_mulai`, `tanggal_akhir`, `alasan`, `catatan`, `lampiran_nama`, `hak_off_id` (`FK -> hak_off_pengganti.id`), `status` (`DRAFT` | `PENDING` | `APPROVED` | `REJECTED` | `CANCELLED` | `EXPIRED`), `diproses_oleh` (`FK -> pengguna.id`), `diproses_pada`, `alasan_keputusan`, `created_at`, `updated_at`.
- **Indexes:** `idx_pengajuan_emp(karyawan_id, status)`, `idx_pengajuan_dates(karyawan_id, status, tanggal_mulai, tanggal_akhir)`.

### 1.11 `absensi_sesi`
Bukti absensi per sesi berbasis waktu server WIB & foto kamera browser.
- `id` (`PK`), `karyawan_id` (`FK -> karyawan.id`), `tanggal`, `urutan_sesi` (`1..4`), `nama_sesi`, `waktu_server`, `status_ketepatan` (`TEPAT_WAKTU` | `TERLAMBAT`), `keterlambatan_menit`, `lat`, `lng`, `accuracy_meter`, `jarak_kantor_meter`, `dalam_geofence`, `lokasi_alamat` (snapshot alamat perkiraan Geoapify dari koordinat GPS saat absensi; nullable), `ip_address`, `user_agent`, `tipe_aktivitas` (`CHECK_IN` | `AKTIVITAS` | `STANDBY`), `deskripsi_aktivitas`, `foto_path`, `foto_checksum`, `policy_snapshot_json`, `created_at`. `UNIQUE(karyawan_id, tanggal, urutan_sesi)`. Ditambahkan oleh migrasi `006_persist_actual_attendance_location_address`.
- **Indexes:** `idx_absensi_emp_date(karyawan_id, tanggal)`, `idx_absensi_tanggal(tanggal, waktu_server DESC)`.

### 1.12 `override_kehadiran` & `periode_payroll`
Override status payroll tanpa mengubah data bukti absensi, serta closing periode bulanan.
- `override_kehadiran`: `id` (`PK`), `karyawan_id` (`FK -> karyawan.id`), `tanggal`, `hasil_awal`, `hasil_override` (`DIHITUNG_MASUK` | `TIDAK_DIHITUNG_MASUK`), `alasan`, `admin_id` (`FK -> pengguna.id`), `created_at`, `aktif`. **Index:** `idx_override_emp_date(karyawan_id, tanggal, aktif)`.
- `periode_payroll`: `id` (`PK`), `bulan`, `kantor_id` (`FK -> kantor.id`), `status` (`OPEN` | `CLOSED`), `ditutup_oleh` (`FK -> pengguna.id`), `ditutup_pada`, `catatan_closing`, `snapshot_json`. `UNIQUE(bulan, kantor_id)`.

### 1.13 `audit_log` (Strictly Append-Only)
Jejak audit permanen seluruh perubahan penting.
- `id` (`PK`), `actor_id`, `actor_name`, `actor_role`, `waktu_server`, `ip_address`, `user_agent`, `modul`, `aksi`, `target_entity`, `target_id`, `karyawan_id`, `tanggal_terdampak`, `before_json`, `after_json`, `alasan`, `ref_audit_id`.
- **Triggers:** `prevent_audit_update` dan `prevent_audit_delete` membatalkan (`RAISE(ABORT, ...)`) setiap operasi `UPDATE`/`DELETE`.
- **Index:** `idx_audit_waktu(waktu_server DESC)`.

### 1.14 `pengaturan_aplikasi` & `pendaftaran_akun`
Pengaturan branding/sistem (singleton `id = 1`) dan antrean pendaftaran akun menunggu ACC Superadmin.
- `pengaturan_aplikasi`: `id` (`CHECK(id = 1)`), `nama_aplikasi`, `subjudul_login`, `judul_hero_login`, `deskripsi_login`, `judul_form_login`, `pengumuman_login`, `footer_login`, `logo_path`, `logo_updated_at`, `favicon_path`, `favicon_updated_at`, `retensi_foto_hari`, `wajib_gps_absensi`, `izin_demo_login`, `updated_at`. Logo dan favicon adalah aset persisten di direktori `data/assets`; favicon dapat berupa PNG, SVG, atau ICO dan dikelola oleh SUPERADMIN. Kolom favicon ditambahkan oleh migrasi `009_custom_website_favicon_settings`.
- `pendaftaran_akun`: `id` (`PK`), `nama_lengkap`, `username`, `email`, `no_hp`, `password_hash`, `role_diminta` (`KARYAWAN` | `ADMIN`), `jabatan`, `kantor_id` (`FK -> kantor.id`), `bidang_id` (`FK -> bidang_kerja.id`), `foto_profil_path`, `catatan_pendaftar`, `status` (`PENDING` | `APPROVED` | `REJECTED`), `nik_diberikan`, `alasan_keputusan`, `diproses_oleh` (`FK -> pengguna.id`), `diproses_pada`, `created_at`. **Index:** `idx_pendaftaran_status(status, created_at DESC)`.

### 1.15 `absensi_lokasi_cache`
Cache hasil reverse geocoding untuk record absensi lama yang belum memiliki `absensi_sesi.lokasi_alamat`.
- Kolom: `absensi_sesi_id` (PK/FK -> `absensi_sesi.id`), `lat`, `lng`, `alamat` (nullable untuk hasil kosong/gagal), `provider`, dan `resolved_at`.
- Cache positif maupun negatif dianggap valid selama enam jam agar kunjungan ulang Beranda tidak mengulang request Geoapify.
- Dibuat oleh migrasi `007_cache_legacy_attendance_location_addresses`.

### 1.16 `override_akses_absensi`
Izin sementara yang diberikan Admin agar karyawan dapat mengirim satu kali check-in pada sesi berikutnya yang sudah kedaluwarsa.
- Kolom: `id` (PK), `karyawan_id` (FK -> `karyawan.id`), `tanggal`, `urutan_sesi` (1–4), `nama_sesi`, `alasan`, `admin_id` (FK -> `pengguna.id`), `status` (`AKTIF` | `DIGUNAKAN` | `KEDALUWARSA` | `DICABUT`), `berlaku_sampai`, `used_at`, `used_session_id` (FK -> `absensi_sesi.id`), dan `created_at`.
- Izin hanya berlaku untuk tanggal dan sesi berikutnya yang dikunci, memiliki masa aktif terbatas, dan hanya bisa dipakai satu kali.
- Status berubah menjadi `DIGUNAKAN` bersama penyimpanan record absensi; bukti waktu, selfie, GPS, serta status keterlambatan tetap berasal dari check-in asli karyawan.
- Semua pemberian dan penggunaan dicatat pada `audit_log` dengan modul `OVERRIDE_ABSENSI`.
- Dibuat oleh migrasi `008_admin_one_time_expired_attendance_checkin_access`.
