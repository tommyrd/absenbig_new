# Laporan Kesiapan Production — Absensi BIGNET

**Status Keseluruhan:** **SIAP PRODUCTION (Hosting Pribadi)** dengan pemenuhan konfigurasi `.env` & SSL pada server target.

---

## 1. Ringkasan Kesiapan Per Komponen

| Komponen | Status | Bukti Verifikasi Terukur |
|---|---|---|
| Build Frontend (`npm run build`) | Lulus | `vite build` menghasilkan `dist/index.html` dan aset hash immutable tanpa warning `__dirname`. |
| Type Check (`npm run lint`) | Lulus | `tsc --noEmit` keluar dengan kode `0` (0 error TypeScript). |
| Automated Tests (`npm test`) | Lulus | 17/17 test lulus (`9` test inti `tests/core.test.ts` + `8` test production `tests/production.test.ts`). |
| Standalone Production Boot | Lulus | `NODE_ENV=production node server.ts` berjalan mulus di Node v22 tanpa Vite, healthcheck `200 OK`, SPA `/` `200 OK`, `izin_demo_login=0`. |
| Session Time Window & GPS Quality | Diperbarui | Frontend dan backend memakai waktu WIB server; batas `jam_selesai` dikunci; GPS wajib akurasi maksimum ±100m dan margin akurasi tetap di dalam radius. |
| Database Schema, Migrasi & Seed | Lulus | `schema_migrations` mencatat versi `001`–`004`, termasuk migrasi seluruh kantor ke geofence ketat; `seedProductionBaseline` memisahkan data demo dari production. |
| Keamanan Autentikasi & API | Lulus | `scrypt`, HMAC-SHA256 + `jti` revocation + `token_version`, brute-force `429`, RBAC backend, validasi magic-bytes & sanitasi SVG. |
| Penyimpanan Foto & Aset Persisten | Lulus | `DATA_DIR` configurable di luar rilis kode; nama file acak kriptografis + SHA-256 checksum. |
| Backup & Restore Otomatis | Lulus | Snapshot `VACUUM INTO`, integrity check, SHA-256 manifest, `.tar.gz`, verifikasi link foto & safety snapshot pra-restore teruji end-to-end. |
| Reverse Proxy, TLS & Daemon | Tersedia | `deploy/nginx/absensi-bignet.conf`, `deploy/systemd/absensi-bignet.service`, `ecosystem.config.js`. |
| Sinkronisasi GitHub | Catatan | Workspace kontainer AI Studio tidak menyimpan direktori `.git`; perubahan disinkronkan lewat integrasi GitHub AI Studio pada branch `main`. |

---

## 2. Pengendalian Lingkungan Production

1. **Tidak Ada Data Demo Otomatis:** Saat `NODE_ENV=production`, `getDb()` dan CLI tidak akan mengisi data demo karyawan ataupun mengaktifkan tombol demo login (`izin_demo_login` dipaksa `0` kecuali `ALLOW_DEMO_LOGIN=true`).
2. **Waktu Server Resmi WIB:** `server.ts` memaksa `process.env.TZ = process.env.TZ || 'Asia/Jakarta'` dan seluruh stempel waktu di backend memakai `Asia/Jakarta` (`+07:00`).
3. **Zero Vite Dependency di Production:** Pada mode production, backend menyajikan aset statis `dist/` secara mandiri dengan cache header terpisah antara `index.html` dan `/assets/*`.
4. **Penanganan Error Aman:** Detail stack trace dan pesan error SQL internal tidak dikirim ke klien saat `NODE_ENV=production`.

---

## 3. Prasyarat Wajib Saat Deploy Pertama Kali

Sebelum membuka akses untuk seluruh karyawan PT Borneo Inovasi Gemilang, operator server harus:
1. Menyalin `.env.example` menjadi `.env` dan mengisi `AUTH_SECRET` acak minimal 32 karakter serta `APP_URL` / `ALLOWED_ORIGINS` sesuai domain HTTPS perusahaan.
2. Menjalankan `npm run db:migrate` dan `npm run db:seed:prod` untuk membuat akun awal `SUPERADMIN` dengan kata sandi kuat.
3. Mengaktifkan HTTPS melalui Nginx + Certbot (atau sertifikat internal perusahaan) karena API kamera browser (`getUserMedia`) dan Geolocation pada browser modern **wajib HTTPS** di luar `localhost`.
4. Menjadwalkan cron backup harian (`scripts/backup/backup.sh`) dan memverifikasi uji restore minimal satu kali sebelum Go-Live.
