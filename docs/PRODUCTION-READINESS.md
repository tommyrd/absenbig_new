# Laporan Kesiapan Production — Absensi BIGNET

**Status Keseluruhan:** **PERLU VERIFIKASI ULANG SEBELUM GO-LIVE**. Perubahan aturan sesi dan GPS telah masuk ke `main`, tetapi build, test otomatis, serta UAT browser harus dijalankan ulang pada checkout terbaru.

---

## 1. Ringkasan Kesiapan Per Komponen

| Komponen | Status | Bukti Verifikasi Terukur |
|---|---|---|
| Build Frontend (`npm run build`) | Perlu verifikasi ulang | Jalankan pada checkout terbaru setelah perubahan sesi dan GPS. |
| Type Check (`npm run lint`) | Perlu verifikasi ulang | Jalankan pada checkout terbaru untuk memastikan import helper dan UI TypeScript. |
| Automated Tests (`npm test`) | Perlu verifikasi ulang | Cakupan saat ini 20 test (`12` test inti + `8` test production); hasil lulus belum diklaim sebelum dijalankan ulang. |
| Standalone Production Boot | Perlu verifikasi ulang | Jalankan server production dan cek healthcheck setelah build terbaru. |
| Session Time Window & GPS Quality | Diperbarui | Frontend dan backend memakai waktu WIB server; batas `jam_selesai` dikunci; GPS wajib akurasi maksimum ±100m dan margin akurasi tetap di dalam radius pada sesi yang diwajibkan kantor. |
| Attendance Location Policy | Diperbarui | Admin dapat memilih Sesi 1 wajib kantor (default, sesi 2+ fleksibel) atau semua sesi wajib kantor; diterapkan di API dan UI. |
| Database Schema, Migrasi & Seed | Lulus | `schema_migrations` mencatat versi `001`–`005`, termasuk migrasi aturan lokasi per kebijakan; `seedProductionBaseline` memisahkan data demo dari production. |
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
