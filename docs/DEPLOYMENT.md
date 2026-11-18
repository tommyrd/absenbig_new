# Panduan Deployment Production — Absensi BIGNET

**Target:** Server Hosting Pribadi / VPS Linux (Ubuntu 22.04/24.04 atau Debian 12)  
**Domain Contoh:** `absensi.bignet.co.id`  
**Direktori Aplikasi Contoh:** `/var/www/absensi-bignet`

---

## 1. Persiapan Server & Runtime

Pastikan Node.js versi **22.x LTS** (teruji pada `v22.23.2` yang mendukung eksekusi native TypeScript dan modul built-in `node:sqlite`) telah terpasang beserta Nginx dan `tar`/`sqlite3` (opsional untuk utilitas admin):

```bash
node -v   # Pastikan >= v22.14.0 (disarankan v22 LTS)
npm -v
nginx -v
```

Siapkan direktori aplikasi dan folder penyimpanan persisten:

```bash
sudo mkdir -p /var/www/absensi-bignet /var/lib/absensi-bignet/data /var/lib/absensi-bignet/backups
sudo chown -R $USER:$USER /var/www/absensi-bignet /var/lib/absensi-bignet
```

> **Praktik Terbaik Hosting Pribadi:** Simpan `DATA_DIR` (`/var/lib/absensi-bignet/data`) dan `BACKUP_DIR` (`/var/lib/absensi-bignet/backups`) di luar folder rilis source code agar tidak pernah tertimpa saat `git pull` atau deploy ulang.

---

## 2. Clone Source Code & Instalasi Dependency

```bash
cd /var/www/absensi-bignet
git clone -b main https://github.com/tommyrd/absenbig_new.git .
npm ci
```

---

## 3. Konfigurasi `.env` Production

Salin template `.env.example` dan sesuaikan nilainya:

```bash
cp .env.example .env
```

Generate `AUTH_SECRET` kriptografis:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Isi `.env` minimal sebagai berikut:

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TZ=Asia/Jakarta
APP_URL="https://absensi.bignet.co.id"
ALLOWED_ORIGINS="https://absensi.bignet.co.id"
AUTH_SECRET="<hasil_generate_96_karakter_hex>"

DATA_DIR="/var/lib/absensi-bignet/data"
DB_PATH="/var/lib/absensi-bignet/data/bignet_absensi.db"
BACKUP_DIR="/var/lib/absensi-bignet/backups"
BACKUP_RETENTION_DAYS=30

SEED_DEMO_DATA=false
ALLOW_DEMO_LOGIN=false
BOOTSTRAP_SUPERADMIN_USERNAME="superadmin"
BOOTSTRAP_SUPERADMIN_EMAIL="owner@bignet.co.id"
BOOTSTRAP_SUPERADMIN_NAME="Superadmin PT BIGNET"
BOOTSTRAP_SUPERADMIN_PASSWORD="<kata_sandi_kuat_minimal_15_karakter>"
```

Amankan izin akses file `.env`:

```bash
chmod 600 .env
```

---

## 4. Build Frontend, Migrasi & Inisialisasi Database Production

```bash
# 1. Bangun bundle frontend ke folder dist/
npm run build

# 2. Jalankan migrasi skema database
npm run db:migrate

# 3. Isi data dasar production + 1 akun Superadmin awal (tanpa data demo)
npm run db:seed:prod

# 4. Verifikasi status migrasi
npm run db:status
```

> Setelah akun Superadmin berhasil dibuat, kosongkan `BOOTSTRAP_SUPERADMIN_PASSWORD` di `.env` dan login menggunakan akun Superadmin tersebut untuk mengelola profil, logo, serta ACC akun Admin & Teknisi.

---

## 5. Menjalankan Server Backend

### Opsi A: Menggunakan PM2 (Disarankan untuk manajemen log & restart cepat)

```bash
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

> **Catatan Penting SQLite WAL:** Gunakan `instances: 1` dan `exec_mode: 'fork'` (sudah dikonfigurasi pada `ecosystem.config.js`). Jangan menjalankan mode `cluster` multi-proses terhadap satu file SQLite tanpa lock terpusat.

### Opsi B: Menggunakan `systemd`

1. Sesuaikan `User`, `WorkingDirectory`, `EnvironmentFile`, dan `ExecStart` pada `deploy/systemd/absensi-bignet.service`.
2. Salin unit service:
```bash
sudo cp deploy/systemd/absensi-bignet.service /etc/systemd/system/absensi-bignet.service
sudo systemctl daemon-reload
sudo systemctl enable --now absensi-bignet
sudo systemctl status absensi-bignet
```

---

## 6. Reverse Proxy Nginx & HTTPS (SSL/TLS)

Kamera browser dan Geolocation HTML5 **mewajibkan HTTPS** pada domain non-localhost.

1. Salin konfigurasi Nginx:
```bash
sudo cp deploy/nginx/absensi-bignet.conf /etc/nginx/sites-available/absensi-bignet.conf
sudo ln -s /etc/nginx/sites-available/absensi-bignet.conf /etc/nginx/sites-enabled/absensi-bignet.conf
```
2. Sesuaikan `server_name` pada file konfigurasi dengan domain perusahaan, uji sintaks Nginx, dan terbitkan sertifikat Let's Encrypt:
```bash
sudo nginx -t
sudo certbot --nginx -d absensi.bignet.co.id
sudo systemctl reload nginx
```

Konfigurasi `deploy/nginx/absensi-bignet.conf` sudah menyertakan:
- Redirect paksa HTTP (80) ke HTTPS (443)
- `client_max_body_size 12M` untuk upload foto kamera base64 & logo
- `proxy_buffering off` dan timeout 3600 detik khusus pada `/api/v1/workforce/stream` agar real-time SSE feed tidak tersendat

---

## 7. Penjadwalan Backup Otomatis (Cron)

Tambahkan cron harian pukul 01:30 WIB agar backup snapshot konsisten berjalan di luar jam sibuk:

```bash
crontab -e
```

```cron
30 1 * * * cd /var/www/absensi-bignet && /bin/bash scripts/backup/backup.sh >> /var/www/absensi-bignet/logs/backup.log 2>&1
```

---

## 8. Prosedur Update Rilis Baru (Zero Data Loss)

```bash
cd /var/www/absensi-bignet
npm run backup
git pull origin main
npm ci
npm run build
npm run db:migrate
pm2 reload absensi-bignet --env production   # atau: sudo systemctl restart absensi-bignet
curl -fsS https://absensi.bignet.co.id/api/v1/health
```


## 9. Hardening Akun dan Sesi

- Password bootstrap Superadmin dan password baru minimal 15 karakter.
- Pada login pertama, Admin dan Superadmin wajib mendaftarkan TOTP Authenticator dan menyimpan recovery codes yang hanya ditampilkan satu kali.
- Token sesi berada pada cookie HttpOnly; frontend dan API harus satu origin. Jangan mengaktifkan kembali Bearer token di localStorage atau token pada query URL.
- Pastikan reverse proxy menimpa `X-Forwarded-For` dengan alamat remote client dan port Node hanya listen pada `127.0.0.1`.
- Kebijakan idle/absolute timeout, CSRF, dan reset MFA dijelaskan pada [SECURITY.md](./SECURITY.md).
