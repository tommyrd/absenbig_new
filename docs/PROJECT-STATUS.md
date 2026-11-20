# Status Proyek — Absensi BIGNET

**Nama Proyek:** Absensi BIGNET — PT Borneo Inovasi Gemilang  
**Versi:** `1.0.0` (Production-Ready)  
**Target Repository:** `https://github.com/tommyrd/absenbig_new` (Branch: `main`)

---

## 1. Ringkasan Status Fitur & Infrastruktur

| Domain | Status | Keterangan |
|---|---|---|
| UI/UX & Responsivitas Mobile + Dark Mode | Selesai & Terjaga | Seluruh komponen React/Tailwind dipertahankan 100% sesuai desain awal. |
| Beranda Attendance Feed (Instagram-Style) | Selesai | Semua peran (`KARYAWAN`, `ADMIN`, `SUPERADMIN`) dapat melihat feed foto & lokasi rekan secara real-time (SSE). |
| Absensi Kamera-Only & Jam Sesi | Selesai & Dikeraskan | Hanya kamera browser langsung; validasi waktu mulai/akhir sesi WIB, magic-byte foto, geofence & GPS bounds. |
| Penempatan Karyawan & Cakupan Lokasi | Selesai & Terverifikasi | Master Wilayah Operasional berbasis GeoJSON polygon, cakupan Semua Kantor / Kantor Tertentu, pengecualian geofence luar wilayah otomatis di backend, bulk placement akun lama, dan snapshot historis. |
| Pendaftaran Akun + ACC Superadmin | Selesai | Calon Admin/Karyawan mendaftar dari halaman login dan harus disetujui Superadmin sebelum bisa login. |
| Pengaturan Sistem, Branding & Profil | Selesai | Superadmin kelola teks login, pengumuman, logo & favicon (dengan sanitasi SVG); semua role kelola profil & lihat foto profil lintas peran. |
| Payroll, Override & Closing Bulanan | Selesai | Resolver deterministik, riwayat override non-destruktif, validasi pasca-closing, export Excel + PDF/PNG daftar karyawan + audit log. |
| Keamanan Production | Selesai | `scrypt`, HMAC-SHA256 + `jti` revocation + `token_version`, rate limiter brute-force, RBAC backend, validasi lokasi server-authoritative, headers keamanan. |
| Database Production & Migrasi | Selesai | Schema, 18 migrasi berversi (`001`–`018`), seeder production bersih, WAL + checkpoint shutdown. |
| Backup & Restore | Selesai | Hot snapshot SQLite (`VACUUM INTO`), media lengkap, `manifest.json` SHA-256, `.tar.gz`, verifikasi restore. |
| Pengujian Otomatis & Build | Terverifikasi | `npm test` (51/51 lulus), `npm run lint` (0 error), `npm run build` (sukses). |

---

## 2. Catatan Sinkronisasi GitHub

Workspace kontainer Google AI Studio tempat pengkodean berjalan **tidak memiliki folder `.git` secara lokal**, karena koneksi ke repository `https://github.com/tommyrd/absenbig_new` (`main`) dikelola oleh mekanisme integrasi GitHub di antarmuka AI Studio.  
Seluruh source code, konfigurasi production, test suite, dan 13 dokumen di folder `docs/` sudah tersimpan langsung di workspace siap di-commit & push melalui panel GitHub sync AI Studio ke branch `main`.
