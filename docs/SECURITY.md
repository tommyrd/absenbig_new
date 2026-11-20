# Dokumentasi Keamanan Production — Absensi BIGNET

---

## 1. Autentikasi & Manajemen Sesi

1. **Hashing Kata Sandi (`src/server/auth.ts`):**
   - Menggunakan `crypto.scryptSync(password, salt, 64)` dengan salt acak 16-byte per akun (`salt:hash`).
   - Verifikasi menggunakan `crypto.timingSafeEqual` untuk mencegah *timing attack*.
   - Kata sandi tidak pernah disimpan maupun dikembalikan ke frontend dalam bentuk plaintext.
2. **Token Sesi & Cookie:**
   - Token ditandatangani HMAC-SHA256 menggunakan `AUTH_SECRET` dari `.env` (disarankan acak minimal 32 karakter; fallback file `.auth_secret` di `DATA_DIR` memiliki permission `0o600`).
   - Setiap token memiliki `jti` (UUID v4), `tv` (`token_version`), dan `exp` (7 hari).
   - Cookie `bignet_token` dikirim dengan atribut `HttpOnly`, `SameSite=Lax`, dan otomatis menyertakan `Secure` ketika koneksi melalui HTTPS / reverse proxy `X-Forwarded-Proto: https`.
3. **Revokasi Token Instan:**
   - **Logout (`POST /api/v1/auth/logout`):** Memasukkan `jti` ke tabel `revoked_tokens`, sehingga token langsung ditolak pada request berikutnya walaupun belum expired.
   - **Ganti Kata Sandi / Reset Kata Sandi / Ubah Role / Nonaktif Akun:** Menaikkan `pengguna.token_version` (+1), sehingga seluruh sesi lama pengguna tersebut di perangkat lain otomatis gugur.
4. **Perlindungan Brute Force (`src/server/security.ts`):**
   - `loginIpLimiter`: Maksimal 40 percobaan per 15 menit per IP.
   - `loginFailLimiter`: Maksimal 8 percobaan gagal per 15 menit per kombinasi `IP:username` -> mengembalikan HTTP `429` + header `Retry-After`, dan direset saat login sukses.
   - Rate limiter juga diterapkan pada pendaftaran akun (`registerLimiter`), perubahan kata sandi (`passwordLimiter`), dan pengiriman sesi absensi (`attendanceLimiter`).

---

## 2. Otorisasi & Kontrol Akses (RBAC Backend)

Seluruh pembatasan hak akses diberlakukan pada middleware `requireRole(...)` di backend (`src/server/routes.ts`):

- **`KARYAWAN`:** Hanya dapat melihat jadwal & riwayat dirinya, melakukan check-in kamera miliknya sendiri, mengajukan/edit/batal pengajuan miliknya (ketika PENDING), melihat feed Beranda (`GET /api/v1/feed/today` dan foto sesi aktif tanpa data pengajuan pribadi orang lain), serta memperbarui profil & kata sandinya sendiri.
- **`ADMIN`:** Mengelola master kantor/bidang, menyetujui/menolak pengajuan karyawan, menetapkan kerja khusus & hari libur, menerapkan kebijakan absensi, melakukan override payroll, dan closing periode bulanan. Tidak dapat mengakses pengaturan branding/sistem maupun ACC pendaftaran akun.
- **`SUPERADMIN`:** Mengelola seluruh akun pengguna (termasuk ACC/tolak pendaftaran akun baru, reset sandi, aktif/nonaktif akun, membuat akun karyawan/admin/superadmin), mengubah pengaturan aplikasi/branding/logo login, dan memonitor laporan & audit trail.
- **Anti-Privilege Escalation & Anti-Self-Lockout:**
  - `POST /api/v1/master/employees` dan akun pendaftaran publik hanya mengizinkan role `KARYAWAN` atau `ADMIN` (tidak bisa membuat `SUPERADMIN`).
  - Superadmin dicegah menonaktifkan atau menurunkan role akun miliknya sendiri melalui API.
  - Identitas `karyawan_id` pada aksi karyawan diambil langsung dari `req.authUser.karyawan_id` (token terverifikasi), bukan dari payload body klien.

---

## 3. Keamanan Endpoint API & Query Token

- **Pembatasan Query Token (`allowsQueryToken`):** `?token=...` pada query string **ditolak** pada seluruh endpoint JSON mutasi/profil, dan hanya diizinkan pada `GET /api/v1/photos/*`, `GET /api/v1/avatars/*`, dan `GET /api/v1/workforce/stream` (kebutuhan `<img src>` & `EventSource` browser).
- **Security Headers (`server.ts`):**
  - `app.disable('x-powered-by')`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`
  - `Strict-Transport-Security` (aktif otomatis pada production HTTPS)
- **CORS Terkontrol:** Dibatasi ke origin yang terdaftar pada `ALLOWED_ORIGINS` / `APP_URL`.
- **Safe Error Handling:** Pada `NODE_ENV=production`, stack trace maupun detail error database SQL tidak dikirim dalam respons JSON (`safeErrorDetail`).

---

## 4. Keamanan Upload Foto, Avatar & Logo

1. **Validasi Magic Bytes Gambar Raster (`validateRasterImageBase64`):** Memeriksa signature biner aktual PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), dan WEBP (`RIFF....WEBP`) serta batas ukuran (5 MB untuk foto absensi, 2 MB untuk avatar/logo) guna mencegah unggahan payload palsu/berbahaya.
2. **Sanitasi Logo SVG (`validateAndSanitizeLogoBase64`):** Hanya berlaku untuk upload logo oleh Superadmin; menolak tegas tag `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, atribut event `on*=`, serta skema `javascript:` / `vbscript:` / `data:text/html`.
3. **Kamera-Only Absensi:** `POST /api/v1/attendance/session` menolak permintaan yang tidak menyertakan `fotoSource: 'BROWSER_CAMERA'`.
4. **Penyimpanan & Pengiriman Aman:**
   - File disimpan menggunakan `crypto.randomBytes` di luar folder `public/` atau `dist/`.
   - Setiap akses media memakai `path.basename(...)` untuk mencegah *path traversal*.
   - Header respons media menyertakan `X-Content-Type-Options: nosniff` dan `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.

---

## 5. Keamanan Validasi Wilayah Operasional & Cakupan Lokasi Absensi

1. **Otoritas Penuh di Backend (`src/server/services/location-policy.ts`):**
   - Evaluasi apakah koordinat GPS berada di dalam atau di luar wilayah penempatan dilakukan sepenuhnya di backend menggunakan geometri GeoJSON `Polygon`/`MultiPolygon` dari tabel `wilayah_operasional`.
   - Sistem **tidak pernah** mempercayai klaim status wilayah dari frontend maupun nama kota hasil reverse geocoding Geoapify untuk menentukan pengecualian geofence.
2. **Fail-Closed untuk Konfigurasi Belum Lengkap:**
   - Akun `KARYAWAN` lama yang belum memiliki `wilayah_penempatan_id` (`BELUM_TERKONFIGURASI`) **tidak pernah** dianggap berada di luar kota dan tidak mendapat pengecualian geofence otomatis.
   - Wilayah operasional yang polygon-nya kosong atau tidak valid (`POLYGON_BELUM_LENGKAP`) **tidak pernah** memberikan pengecualian geofence otomatis.
   - Mode `KANTOR_TERTENTU` memvalidasi secara ketat bahwa setiap `kantor_id` berada dalam `wilayah_penempatan_id` karyawan dan berstatus aktif; kantor dari wilayah lain selalu ditolak (`400`).
3. **Bukti & Aturan Tetap Wajib Saat Pengecualian Luar Wilayah:**
   - Pengecualian di luar wilayah penempatan (`DI_LUAR_WILAYAH`) hanya membebaskan geofence kantor. Koordinat GPS, akurasi, selfie kamera browser (`BROWSER_CAMERA`), waktu server WIB, jendela sesi, deskripsi aktivitas sesi lanjutan, dan audit trail tetap ditegakkan dan direkam lengkap.
   - Catatan anomali GPS (mis. koordinat `(0,0)` atau akurasi `> 500m`) direkam di `lokasi_validasi_json` dan audit log sebagai bahan pengawasan Admin/Superadmin tanpa mengklaim proteksi mutlak terhadap fake GPS tingkat OS.
4. **Audit Trail & Imutabilitas Historis:**
   - Setiap pembuatan/perubahan/penghapusan `wilayah_operasional` tercatat pada modul `WILAYAH_OPERASIONAL`, dan setiap perubahan penempatan individu maupun massal tercatat pada modul `PENEMPATAN_KARYAWAN`.
   - Perubahan penempatan karyawan tidak pernah mengubah snapshot lokasi pada `absensi_sesi` historis.
