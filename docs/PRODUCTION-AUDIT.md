# Laporan Audit Teknis Production — Absensi BIGNET

**Perusahaan:** PT Borneo Inovasi Gemilang  
**Aplikasi:** Absensi BIGNET (`absensi-bignet` v1.0.0)  
**Repository:** `https://github.com/tommyrd/absenbig_new` (Branch: `main`)  
**Cakupan Audit:** Frontend React 19, Backend Express 4 (`server.ts`, `src/server/*`), Database `node:sqlite`, Autentikasi/Otorisasi, Attendance Feed & Resolver, Payroll, Audit Log, Media Storage, Konfigurasi Deploy, dan Script Backup/Restore.

---

## 1. Ringkasan Eksekutif

Audit dilakukan menyeluruh pada seluruh source code sebelum dan sesudah proses hardening production. Seluruh desain UI/UX, warna, layout, komponen, dan aturan bisnis absensi dipertahankan utuh, sementara celah keamanan, ketergantungan konfigurasi development, dan manajemen siklus hidup database & backup diperbaiki langsung pada source code.

---

## 2. Inventaris Modul yang Diaudit

| Area | File Utama | Status Setelah Hardening |
|---|---|---|
| Entry Server & Middleware | `server.ts`, `vite.config.ts` | Siap production (`NODE_ENV=production` menonaktifkan Vite dev middleware, menyajikan `dist/`, `TZ=Asia/Jakarta`, security headers, graceful shutdown). |
| Autentikasi & Sesi | `src/server/auth.ts`, `src/server/security.ts` | Password salted `scrypt` + `timingSafeEqual`, HMAC-SHA256 token dengan `jti` & `token_version` (`tv`), revokasi logout/ganti sandi/reset sandi, brute-force limiter. |
| API & RBAC | `src/server/routes.ts` | Seluruh endpoint privat terproteksi `requireRole(...)`, validasi payload/koordinat/magic-byte foto, `GET /api/v1/health`, safe error detail. |
| Database & Migrasi | `src/server/db.ts`, `src/server/db/*`, `src/server/paths.ts` | Schema, migrasi berversi (`schema_migrations`), dan seeder (`seedProductionBaseline` vs `seedDemoDataset`) dipisah tegas; WAL + foreign keys aktif. |
| Business Resolver | `src/server/services/resolver.ts`, `src/server/time.ts` | Waktu server WIB (`Asia/Jakarta`), hierarki kebijakan `KARYAWAN > BIDANG > DEFAULT`, hari libur & kerja khusus konsisten, override tidak merusak bukti absensi asli. |
| Penyimpanan Foto & Aset | `src/server/routes.ts`, `src/server/paths.ts` | Tersimpan persisten di `DATA_DIR/{photos,avatars,assets}` dengan nama file acak kriptografis + checksum SHA-256 + validasi magic bytes & sanitasi SVG. |
| Payroll & Audit Log | `src/server/routes.ts`, `src/server/services/audit.ts` | Ringkasan bulanan tunggal (`computeMonthlySummary`), periode closing, koreksi pasca-closing berflag, trigger `prevent_audit_update` & `prevent_audit_delete`. |
| Frontend & Branding | `src/App.tsx`, `src/lib/api.ts`, `src/components/*` | Support `VITE_API_BASE_URL`, form login bersih tanpa credential hardcode, demo login dikendalikan `izin_demo_login` (default `0` di production), UI/UX tidak berubah. |
| Deploy & Backup | `deploy/*`, `ecosystem.config.js`, `scripts/backup/*`, `scripts/restore/*` | Nginx HTTPS + SSE, systemd unit, PM2 fork config, hot snapshot `VACUUM INTO`, SHA-256 manifest, `.tar.gz`, restore terverifikasi. |

---

## 3. Temuan Audit Awal & Tindakan Perbaikan Langsung

### 3.1 Keamanan & Autentikasi (Tinggi -> Selesai Diperbaiki)
1. **Temuan:** Logout sebelumnya hanya menghapus cookie di klien tanpa merevokasi token JWT/HMAC di server (`Bearer` token yang sudah diterbitkan tetap berlaku hingga expired).
   - **Perbaikan:** Menambahkan `jti` pada `TokenPayload` (`src/server/auth.ts`), tabel `revoked_tokens` pada migrasi `003`, pembersihan token kedaluwarsa, serta pengecekan `revoked_tokens` + `token_version` pada middleware `attachUser` (`src/server/routes.ts`).
2. **Temuan:** Perubahan kata sandi (`PUT /api/v1/profile/password`), reset sandi (`PUT /api/v1/superadmin/accounts/:userId/reset-password`), perubahan role, atau penonaktifan akun belum membatalkan sesi token lama.
   - **Perbaikan:** Penambahan kolom `pengguna.token_version` yang dinaikkan otomatis (`+1`) pada setiap perubahan sensitif tersebut.
3. **Temuan:** Belum ada pembatasan laju (*rate limiting*) pada endpoint login, registrasi, ganti sandi, dan submit absensi.
   - **Perbaikan:** Penambahan `RateLimiter` (`src/server/security.ts`) dengan respons HTTP `429` dan header `Retry-After` pada `/api/v1/auth/login` (per IP & per akun gagal), `/api/v1/auth/register`, `/api/v1/profile/password`, dan `/api/v1/attendance/session`.
4. **Temuan:** Parameter `?token=` pada URL sebelumnya diterima oleh semua endpoint oleh `extractToken()`.
   - **Perbaikan:** Dibatasi ketat melalui `allowsQueryToken(req)` hanya untuk `GET /photos/*`, `GET /avatars/*`, dan `GET /workforce/stream` (EventSource).
5. **Temuan:** `LoginView.tsx` masih mengisi state awal input login dengan akun demo `'andi'` / `'bignet123'` dan fallback demo terlihat bila setting gagal dimuat.
   - **Perbaikan:** Input login dimulai kosong (`useState('')`) dan panel cepat demo hanya muncul jika `settings?.izin_demo_login === 1`.
6. **Temuan:** `POST /api/v1/master/employees` memiliki fallback password default `'bignet123'` jika field password dikosongkan.
   - **Perbaikan:** Menghapus fallback password; password eksplisit minimal 6 karakter wajib diisi.

### 3.2 Validasi File Media & Header HTTP (Tinggi -> Selesai Diperbaiki)
1. **Temuan:** Validasi gambar hanya memeriksa awalan data-URI regex tanpa memverifikasi magic bytes isi berkas maupun sanitasi SVG logo.
   - **Perbaikan:** Penambahan `validateRasterImageBase64` (memeriksa magic bytes PNG, JPG, WEBP dan batas ukuran) serta `validateAndSanitizeLogoBase64` (memblokir `<script>`, `<foreignObject>`, `<iframe>`, `object`, `embed`, event handler `on*=`, dan URI `javascript:`/`vbscript:`/`data:text/html`).
2. **Temuan:** Nama file foto absensi dan logo masih memakai timestamp deterministik (`Date.now()`).
   - **Perbaikan:** Diganti menjadi token acak kriptografis (`crypto.randomBytes(8/10)`).
3. **Temuan:** Penyajian file gambar dari backend belum menyertakan `X-Content-Type-Options: nosniff` dan CSP sandbox.
   - **Perbaikan:** Ditambahkan `X-Content-Type-Options: nosniff` dan `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` pada `/api/v1/photos/*`, `/api/v1/avatars/*`, dan `/api/v1/assets/logo`, serta security headers global pada `server.ts`.

### 3.3 Konfigurasi Server & Database Production (Tinggi -> Selesai Diperbaiki)
1. **Temuan:** `src/server/db.ts` mencampur DDL, alter schema ad-hoc, dan demo seeder dalam satu file, serta lokasi folder `data/` hardcoded ke `process.cwd()`.
   - **Perbaikan:** Dipisah menjadi `src/server/paths.ts`, `src/server/db/schema.ts`, `src/server/db/migrations.ts`, `src/server/db/seed.ts`, dan `src/server/db/cli.ts`. Mode production tidak pernah menyemai data demo dan memastikan `izin_demo_login = 0`.
2. **Temuan:** `server.ts` mengimpor `vite` secara statis di top-level, tidak memiliki `trust proxy`, global error handler, maupun shutdown checkpoint SQLite WAL.
   - **Perbaikan:** `vite` hanya dimuat via dynamic `await import('vite')` saat `NODE_ENV !== 'production'`; `app.disable('x-powered-by')`; `app.set('trust proxy', 1)`; handler `SIGINT`/`SIGTERM` menjalankan `closeDb()` (`PRAGMA wal_checkpoint(TRUNCATE)`).
3. **Temuan:** `vite.config.ts` memakai `__dirname` yang memunculkan peringatan Vite 8 loader.
   - **Perbaikan:** Diganti menjadi `import.meta.dirname`.

### 3.4 Catatan Dependency & Kebersihan Repository
- `package.json` memiliki dependency `@google/genai` (`^2.4.0`) dan `motion` (`^12.23.24`) bawaan template awal yang tidak diimpor pada kode aktif. Keduanya tidak menyebabkan error kompilasi maupun runtime (`vite build` tidak menyertakannya ke bundle karena tidak diimpor), dan dicatat sebagai kandidat pembersihan opsional di rilis mendatang agar tidak mengubah lockfile saat persiapan deploy.
- `.gitignore` diperketat untuk memastikan `.env` (kecuali `.env.example`), `data/`, `backups/`, `*.db*`, `*.sqlite*`, `.auth_secret`, `dist/`, dan `logs/` tidak pernah masuk ke GitHub.

---

## 4. Kesesuaian Aturan Bisnis yang Diverifikasi

- **Absensi Kamera Browser & Jam Sesi:** Diuji dan terverifikasi bahwa `fotoSource !== 'BROWSER_CAMERA'` ditolak (400), serta check-in sebelum `jam_mulai` sesi ditolak berdasarkan waktu server WIB.
- **Beranda Feed Instagram-Style:** Endpoint `GET /api/v1/feed/today` dan komponen `AttendanceFeedView` berjalan lintas peran (`KARYAWAN`, `ADMIN`, `SUPERADMIN`) tanpa kebocoran data sensitif karyawan lain (alasan cuti/izin tidak terekspos).
- **Payroll & Override:** Override oleh Admin hanya memengaruhi status payroll; bukti foto, checksum, waktu server, dan koordinat asli di `absensi_sesi` tetap utuh. Perubahan pasca-closing bulan membutuhkan konfirmasi `koreksiSetelahClosing` (modul audit `CLOSING_KOREKSI`).
