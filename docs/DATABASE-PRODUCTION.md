# Arsitektur Database Production — Absensi BIGNET

**Engine:** SQLite via `node:sqlite` (`DatabaseSync` bawaan Node.js 22)  
**Mode Jurnal:** `WAL` (Write-Ahead Logging)  
**Sinkronisasi:** `PRAGMA synchronous = NORMAL` | `PRAGMA foreign_keys = ON` | `PRAGMA busy_timeout = 5000`

---

## 1. Pemisahan Komponen Database (5 Lapis)

Agar perubahan struktur terkontrol dan data operasional aman saat deploy maupun restart:

| Lapis | Lokasi | Peran | Masuk GitHub? |
|---|---|---|---|
| **1. Schema Dasar** | `src/server/db/schema.ts` | Definisi lengkap 17 tabel, constraint, trigger audit append-only, dan index performa. | Ya |
| **2. Migration Runner** | `src/server/db/migrations.ts` | Pelacakan versi skema lewat tabel `schema_migrations` (`001`, `002`, `003`, dst.) dalam transaksi `BEGIN IMMEDIATE ... COMMIT`. | Ya |
| **3. Seeder** | `src/server/db/seed.ts` + `src/server/db/cli.ts` | Memisahkan `seedProductionBaseline` (bersih untuk live hosting) dan `seedDemoDataset` (hanya development/staging, diblokir di `NODE_ENV=production`). | Ya |
| **4. Database Aktif** | `${DB_PATH}` (default `./data/bignet_absensi.db`) + folder `photos/`, `avatars/`, `assets/` | Menyimpan seluruh transaksi absensi, akun, payroll, audit, dan media live perusahaan. | **TIDAK** (di-ignore `.gitignore`) |
| **5. Backup Database** | `${BACKUP_DIR}` (default `./backups/bignet_backup_*`) | Snapshot konsisten via `VACUUM INTO` + media + `manifest.json` + `checksums.sha256` + `.tar.gz`. | **TIDAK** (di-ignore `.gitignore`) |

---

## 2. Daftar Migrasi Tercatat (`schema_migrations`)

1. **`001_initial_schema_and_audit_triggers`**: Membuat seluruh tabel inti (`kantor`, `bidang_kerja`, `karyawan`, `pengguna`, `kebijakan_absensi`, `sesi_absensi`, `kalender_kerja`, `hari_libur`, `penugasan_kerja_khusus`, `hak_off_pengganti`, `pengajuan`, `penggunaan_off_pengganti`, `override_kehadiran`, `periode_payroll`, `audit_log`, `pengaturan_aplikasi`, `pendaftaran_akun`), trigger `prevent_audit_update` & `prevent_audit_delete`, dan inisialisasi baris default `pengaturan_aplikasi`.
2. **`002`–`017`**: Evolusi skema bertahap (foto profil, revokasi token, mode geofence ketat, kebijakan lokasi per sesi, alamat aktual absensi, izin check-in sekali pakai, favicon kustom, pemisahan akun mandiri `SUPERADMIN` + trigger invariant role, kebijakan 1 sesi, kerja darurat hari libur, libur spesifik karyawan, dan offboarding karyawan keluar).
3. **`018_operational_regions_and_employee_placement`**: Menambahkan tabel `wilayah_operasional` dan `karyawan_kantor_izin`, kolom `kantor.wilayah_id`, kolom `karyawan.wilayah_penempatan_id` & `karyawan.cakupan_lokasi_absensi`, 10 kolom snapshot lokasi pada `absensi_sesi`, serta index terkait. Migrasi ini **tidak mengarang polygon kota** dan **tidak menebak penempatan akun lama**; seluruh akun `KARYAWAN` lama berawal `wilayah_penempatan_id = NULL` (`BELUM_TERKONFIGURASI`, tanpa pengecualian geofence) sampai dilengkapi Admin/Superadmin melalui fitur **Atur Penempatan Massal** atau edit per akun.

---

## 3. Perintah CLI Manajemen Database

| Perintah | Fungsi | Catatan Keamanan |
|---|---|---|
| `npm run db:migrate` | Menerapkan migrasi tertunda dan mencetak versi terpasang. | Aman dijalankan berulang (idempoten). |
| `npm run db:status` | Menampilkan lokasi `DB_PATH`, `DATA_DIR`, jumlah karyawan, dan riwayat migrasi. | Read-only. |
| `npm run db:seed:prod` | Mengisi master kantor/bidang/kebijakan/kalender default dan 1 Superadmin awal. | Hanya bekerja pada database baru; `izin_demo_login` dipaksa `0`. |
| `npm run db:seed:demo` | Mengisi dataset demo dan foto contoh untuk testing lokal. | **Otomatis ditolak** jika `NODE_ENV=production`. |

---

## 4. Integritas Transaksi, Restart & Anti-Duplikasi

- **Transaksi Atomik (`BEGIN IMMEDIATE`):** Operasi absensi sesi, pembuatan akun & ACC pendaftaran, pengajuan & lock `hak_off_pengganti`, override kehadiran, dan closing payroll dibungkus transaksi atomik dengan `ROLLBACK` otomatis bila gagal.
- **Anti-Duplikasi Constraint:**
  - `absensi_sesi`: `UNIQUE(karyawan_id, tanggal, urutan_sesi)` mencegah check-in ganda untuk sesi yang sama.
  - `penugasan_kerja_khusus`: `UNIQUE(karyawan_id, tanggal)`.
  - `penggunaan_off_pengganti`: `hak_off_id UNIQUE` mencegah 1 hak off dipakai dua kali.
  - `kalender_kerja`: `UNIQUE(kantor_id, hari_minggu)`.
  - `periode_payroll`: `UNIQUE(bulan, kantor_id)`.
- **Graceful Shutdown Checkpoint:** Saat `SIGINT`/`SIGTERM`, `server.ts` memanggil `closeDb()` yang mengeksekusi `PRAGMA wal_checkpoint(TRUNCATE)` sebelum menutup handle database sehingga tidak ada data tertinggal di file WAL.
