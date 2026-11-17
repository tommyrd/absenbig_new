# Checklist Go-Live Production — Absensi BIGNET

Centang seluruh item sebelum membuka akses kepada karyawan PT Borneo Inovasi Gemilang:

## A. Infrastruktur & Domain
- [ ] Server Linux/VPS memenuhi spesifikasi minimum (`Node.js >= 22`, Nginx, ruang disk memadai untuk foto).
- [ ] Domain perusahaan (mis. `absensi.bignet.co.id`) mengarah ke IP server (DNS `A`/`AAAA` record aktif).
- [ ] Sertifikat HTTPS/TLS aktif (`certbot --nginx`) dan redirect HTTP -> HTTPS berjalan (wajib untuk kamera & GPS browser).
- [ ] Timezone sistem OS & `.env` diset ke `TZ=Asia/Jakarta`.

## B. Konfigurasi Keamanan & Database
- [ ] File `.env` dibuat dari `.env.example` dengan izin `chmod 600 .env` (tidak masuk Git).
- [ ] `NODE_ENV=production`, `SEED_DEMO_DATA=false`, dan `ALLOW_DEMO_LOGIN=false`.
- [ ] `AUTH_SECRET` diisi string acak minimal 32 karakter (`crypto.randomBytes(48).toString('hex')`).
- [ ] `ALLOWED_ORIGINS` dan `APP_URL` sesuai domain HTTPS resmi perusahaan.
- [ ] `DATA_DIR` / `DB_PATH` dan `BACKUP_DIR` mengarah ke direktori persisten dengan permission tulis untuk user service (`www-data`/node user).
- [ ] `npm run build` sukses membangun folder `dist/`.
- [ ] `npm run db:migrate` & `npm run db:seed:prod` sukses membuat database bersih dan 1 akun `SUPERADMIN`.
- [ ] Variabel `BOOTSTRAP_SUPERADMIN_PASSWORD` di `.env` dihapus/dikosongkan setelah instalasi awal selesai.

## C. Operasional Aplikasi & Backup
- [ ] Aplikasi berjalan stabil di bawah PM2 (`ecosystem.config.js`, `instances: 1`, `fork`) atau `systemd`.
- [ ] Uji `curl -fsS https://domain-anda/api/v1/health` mengembalikan `status: "ok"` dengan waktu WIB yang akurat.
- [ ] Superadmin sudah login, mengganti logo perusahaan, mengatur teks branding login, serta mengganti kata sandi default jika perlu.
- [ ] Akun Admin operasional dan seluruh karyawan telah dibuat/di-ACC sesuai kantor & bidang masing-masing.
- [ ] Uji check-in kamera + GPS dari HP Android & iPhone berhasil, serta muncul pada Beranda Feed.
- [ ] Cron backup harian (`scripts/backup/backup.sh`) aktif dan uji restore ke lingkungan staging/sementara telah diverifikasi sukses.
