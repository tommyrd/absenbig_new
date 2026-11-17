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
| Absensi Kamera-Only & Jam Sesi | Selesai & Dikeraskan | Hanya kamera browser langsung; validasi waktu mulai sesi WIB, magic-byte foto, geofence & GPS bounds. |
| Pendaftaran Akun + ACC Superadmin | Selesai | Calon Admin/Karyawan mendaftar dari halaman login dan harus disetujui Superadmin sebelum bisa login. |
| Model Akun Admin Operasional | Selesai | Admin adalah akun non-pegawai tanpa NIK/penempatan/absensi pribadi; hanya Karyawan terhubung ke master pegawai. Migrasi 014 mengarsipkan profil Admin lama dan menjaga riwayat. |
| Pengaturan Sistem, Branding & Profil | Selesai | Superadmin kelola teks login, pengumuman, logo (dengan sanitasi SVG); semua role kelola profil & avatar. |
| Payroll, Override & Closing Bulanan | Selesai | Resolver deterministik, riwayat override non-destruktif, validasi pasca-closing, export Excel + audit log. |
| Keamanan Production | Selesai | `scrypt`, HMAC-SHA256 + `jti` revocation + `token_version`, rate limiter brute-force, RBAC backend, headers keamanan. |
| Database Production & Migrasi | Selesai | Schema, 3 migrasi berversi, seeder production bersih, WAL + checkpoint shutdown. |
| Backup & Restore | Selesai | Hot snapshot SQLite (`VACUUM INTO`), media lengkap, `manifest.json` SHA-256, `.tar.gz`, verifikasi restore. |
| Pengujian Otomatis & Build | Terverifikasi | `npm test` (17/17 lulus), `npm run lint` (0 error), `npm run build` (sukses), standalone `node server.ts` terverifikasi. |

---

## 2. Catatan Sinkronisasi GitHub

Workspace kontainer Google AI Studio tempat pengkodean berjalan **tidak memiliki folder `.git` secara lokal**, karena koneksi ke repository `https://github.com/tommyrd/absenbig_new` (`main`) dikelola oleh mekanisme integrasi GitHub di antarmuka AI Studio.  
Seluruh source code, konfigurasi production, test suite, dan 13 dokumen di folder `docs/` sudah tersimpan langsung di workspace siap di-commit & push melalui panel GitHub sync AI Studio ke branch `main`.
