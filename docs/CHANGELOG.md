# Changelog — Absensi BIGNET

## [1.0.0] — Production Preparation Hardening

### Ditambahkan
- **Pemisahan Layer Database (`src/server/paths.ts`, `src/server/db/schema.ts`, `migrations.ts`, `seed.ts`, `cli.ts`):**
  - Manajemen migrasi skema berversi via `schema_migrations` (`001`–`003`).
  - Seeder production bersih (`seedProductionBaseline`) terpisah dari data demo (`seedDemoDataset`).
  - CLI `npm run db:migrate`, `npm run db:status`, `npm run db:seed:prod`, `npm run db:seed:demo`.
- **Modul Keamanan (`src/server/security.ts`):**
  - Rate limiter in-memory (`loginIpLimiter`, `loginFailLimiter`, `registerLimiter`, `passwordLimiter`, `attendanceLimiter`) dengan respons `429` dan header `Retry-After`.
  - Validasi magic bytes biner untuk unggahan gambar raster (`PNG`, `JPG`, `WEBP`) serta sanitasi logo SVG terhadap elemen aktif/XSS (`<script>`, `<foreignObject>`, `on*=`, `javascript:`).
- **Revokasi Token & Versi Sesi (`src/server/auth.ts`, `routes.ts`):**
  - Tabel `revoked_tokens` (`jti`) untuk memblokir token segera setelah `logout`.
  - Kolom `pengguna.token_version` (`tv`) untuk mencabut seluruh sesi lama saat ganti sandi, reset sandi, ubah role, atau penonaktifan akun.
- **Health Check & Infrastruktur Deploy:**
  - Endpoint publik `GET /api/v1/health`.
  - Konfigurasi reverse proxy HTTPS + SSE Nginx (`deploy/nginx/absensi-bignet.conf`), unit `deploy/systemd/absensi-bignet.service`, dan konfigurasi PM2 `ecosystem.config.js`.
  - Dukungan opsional `VITE_API_BASE_URL` di frontend (`src/lib/api.ts`, `AttendanceFeedView.tsx`).
- **Otomasi Backup & Restore (`scripts/backup/*`, `scripts/restore/*`):**
  - Hot backup SQLite `VACUUM INTO`, salinan media persisten (`photos`, `avatars`, `assets`), `manifest.json`, `checksums.sha256`, kompresi `.tar.gz`, rotasi retensi, safety snapshot pra-restore, dan verifikasi tautan foto.
- **Suite Test Production & Dokumentasi Lengkap:**
  - `tests/production.test.ts` (8 skenario end-to-end production) melengkapi `tests/core.test.ts` (total 17 test lulus).
  - 13 file dokumentasi operasional & teknis pada direktori `docs/`.

### Diubah / Diperketat
- `server.ts`: Memuat `dotenv/config`, memaksa `TZ=Asia/Jakarta`, memuat Vite hanya via dynamic import non-production, menambahkan `trust proxy`, security headers, CORS berbasis `ALLOWED_ORIGINS`, safe global error handler, dan graceful shutdown checkpoint SQLite.
- `src/server/routes.ts`: Menghapus fallback sandi default pada pembuatan karyawan, membatasi `?token=` hanya untuk rute media/SSE, menambahkan validasi koordinat GPS & mode ketat geofence, menggunakan nama file kriptografis `crypto.randomBytes`, serta menambahkan header `nosniff` + CSP sandbox pada endpoint foto/avatar/logo.
- `src/components/LoginView.tsx`: Mengosongkan state awal input login (menghapus kredensial demo pre-fill) dan menampilkan panel cepat demo hanya ketika `izin_demo_login === 1` tanpa mengubah tampilan UI.
- `vite.config.ts`: Mengganti `__dirname` dengan `import.meta.dirname`.
- `.env.example` & `.gitignore`: Templat lengkap konfigurasi production tanpa rahasia dan pengecualian ketat terhadap `.env`, database aktif, media pengguna, log, serta arsip backup.


## 2026-11-17 — Session window, GPS accuracy, and Admin Override

- Absensi mandiri kini hanya dibuka pada rentang `jam_mulai` hingga `jam_selesai` berdasarkan waktu server WIB; setelahnya API menolak permintaan.
- Halaman Karyawan/teknisi menampilkan sesi kedaluwarsa, mengunci kamera dan tombol kirim, serta menutup kamera saat sesi berakhir.
- GPS menggunakan nilai `accuracy` dari browser; akurasi di atas ±100m ditolak dan jarak ditambah margin akurasi harus tetap berada dalam radius kantor.
- Admin Override tetap tersedia untuk menetapkan hasil payroll `DIHITUNG MASUK` saat ada kendala perangkat, dengan alasan dan audit trail; override tidak membuat sesi/foto/GPS palsu.
- Pengujian unit ditambahkan untuk batas sesi dan akurasi GPS.

## 2026-11-17 — Configurable attendance location policy

- Admin Operasional dapat mengatur aturan lokasi pada kebijakan DEFAULT, BIDANG, dan KARYAWAN mengikuti hierarki kebijakan yang sudah ada.
- Default: Sesi 1 wajib berada dalam radius kantor; Sesi 2 dan seterusnya boleh dilakukan di lokasi lain.
- Opsi ketat: seluruh sesi wajib berada dalam radius kantor.
- Untuk sesi fleksibel, koordinat dan akurasi GPS tetap disimpan; akurasi rendah ditampilkan sebagai perkiraan dan tidak dipakai untuk meloloskan atau menolak geofence karena geofence tidak diwajibkan pada sesi tersebut.
- Backend API dan frontend memakai aturan yang sama. Migrasi database versi 005 menambahkan kolom aturan_lokasi dan memberi kebijakan lama nilai default SESI_PERTAMA_KANTOR.
- Test unit dan integration mencakup kedua mode kebijakan.