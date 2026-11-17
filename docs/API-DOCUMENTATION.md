# Dokumentasi REST & SSE API — Absensi BIGNET (`/api/v1`)

Seluruh endpoint berada di bawah prefix `/api/v1`. Autentikasi menggunakan header `Authorization: Bearer <token>` atau cookie `HttpOnly` `bignet_token`. Query parameter `?token=` **hanya** diterima pada `GET /photos/:sessionId`, `GET /avatars/*`, dan `GET /workforce/stream`.

---

## 1. Kesehatan Sistem & Waktu Server (Publik)

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/health` | Publik | Health check server & konektivitas SQLite (`status: "ok"`, `timezone: "Asia/Jakarta"`, `serverTimeIso`, `uptimeSeconds`). |
| `GET` | `/api/v1/time` | Publik | Sinkronisasi waktu server WIB (`serverTimeIso`, `date`, `time`, `timezone`, `epochMs`). |
| `GET` | `/api/v1/settings/public` | Publik | Konfigurasi branding halaman login (`nama_aplikasi`, teks hero/form, `pengumuman_login`, `has_custom_logo`, `izin_demo_login`). |
| `GET` | `/api/v1/assets/logo` | Publik | Mengambil gambar logo kustom perusahaan (atau SVG default jika belum dikustomisasi), disertai `nosniff` & sandbox CSP. |

---

## 2. Autentikasi & Pendaftaran Akun

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | Publik (Rate-limited) | Login via `identifier` (username/email) + `password`. Mengembalikan `{ token, user }` & cookie `HttpOnly`. Mengunci sementara (`429`) setelah 8 kali gagal per IP:username. |
| `POST` | `/api/v1/auth/logout` | Semua / Opsional | Merevoke `jti` token ke tabel `revoked_tokens`, menghapus cookie, mencatat audit `AUTH/LOGOUT`. |
| `GET` | `/api/v1/auth/me` | `KARYAWAN`, `ADMIN`, `SUPERADMIN` | Mengembalikan data profil pengguna aktif dari token terverifikasi. |
| `GET` | `/api/v1/auth/register-options` | Publik | Daftar kantor aktif & bidang kerja untuk form pendaftaran akun baru. |
| `POST` | `/api/v1/auth/register` | Publik (Rate-limited) | Pengajuan akun baru (`KARYAWAN` atau `ADMIN`) berstatus `PENDING` hingga di-ACC Superadmin. Foto avatar divalidasi magic bytes raster. |

---

## 3. Profil Mandiri & Avatar

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `PUT` | `/api/v1/profile` | Semua Role Terautentikasi | Memperbarui `nama_lengkap`, `email`, dan `no_hp` sendiri + audit `PROFIL_AKUN`. |
| `PUT` | `/api/v1/profile/password` | Semua Role Terautentikasi (Rate-limited) | Mengganti sandi sendiri, menaikkan `token_version` (merevoke sesi lama), dan mengembalikan token baru. |
| `PUT` | `/api/v1/profile/photo` | Semua Role Terautentikasi | Mengunggah/mengganti foto profil raster (`PNG/JPG/WEBP <= 2MB`) atau menghapus ke avatar default. |
| `GET` | `/api/v1/avatars/karyawan/:karyawanId` | Semua Role Terautentikasi | Mengambil foto profil karyawan (atau SVG inisial default). |
| `GET` | `/api/v1/avatars/registration/:regId` | `SUPERADMIN` | Mengambil foto calon pendaftar saat proses verifikasi ACC. |

---

## 4. Beranda Feed, Workforce Live & Absensi Sesi

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/feed/today` | Semua Role Terautentikasi | Data Beranda Instagram-style (`roster` & `posts` absensi hari ini/terbaru lengkap dengan lokasi kantor, jarak geofence, status ketepatan, tanpa membocorkan alasan cuti/izin pribadi). |
| `GET` | `/api/v1/workforce/today` | Semua Role Terautentikasi | Status tenaga kerja hari ini (sudah disanitasi tanpa GPS mentah). |
| `GET` | `/api/v1/workforce/stream` | Semua Role Terautentikasi | Stream SSE real-time (`event: connected`, `event: workforce`) untuk pembaruan feed & dashboard otomatis. |
| `GET` | `/api/v1/attendance/today` | Semua Role Terautentikasi | Resolusi jadwal, kebijakan aktif (`policySnapshot`), sesi terselesaikan, dan hak check-in hari ini milik pengguna. |
| `GET` | `/api/v1/location/reverse?lat=...&lng=...` | Semua Role Terautentikasi | Mengubah koordinat GPS menjadi alamat perkiraan melalui Geoapify Reverse Geocoding. Key `GEOAPIFY_API_KEY` hanya di server; cache 6 jam dan deduplikasi lookup koordinat yang sama. Alamat hanya untuk informasi; koordinat GPS tetap sumber geofence. |
| `POST` | `/api/v1/attendance/session` | Semua Role Terautentikasi (Rate-limited) | Mengirim absensi sesi berikutnya. GPS wajib tersedia dan dicatat. Aturan radius mengikuti snapshot kebijakan efektif: default hanya Sesi 1 wajib `accuracyMeter` maksimum ±100m dan `jarakMeter + accuracyMeter` berada dalam `radius_meter`; Sesi 2+ fleksibel boleh dari lokasi lain dan akurasi GPS disimpan sebagai metadata; mode `SEMUA_SESI_KANTOR` mewajibkan semua sesi berada dalam radius. Wajib `fotoSource === 'BROWSER_CAMERA'`, dan waktu server WIB harus berada dalam rentang `jam_mulai` sampai `jam_selesai` (inklusif). Validasi magic-byte PNG/JPG/WEBP, lalu tulis `absensi_sesi` + `audit_log` secara atomik. |
| `GET` | `/api/v1/photos/:sessionId` | Semua Role Terautentikasi | Mengambil foto sesi absensi. Karyawan dibatasi pada foto miliknya & feed <= 30 hari terakhir; Admin/Superadmin akses penuh. |

---

## 5. Riwayat Bulanan, Pengajuan & Off Pengganti

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/history/monthly` | Semua Role (`karyawanId` lain hanya `ADMIN`/`SUPERADMIN`) | Ringkasan kehadiran bulanan dari resolver tunggal (`hariMasuk`, `tidakHadir`, `rincian`, `days`). |
| `GET` | `/api/v1/off-rights` | Semua Role | Daftar hak `OFF_PENGGANTI` milik karyawan (atau seluruh karyawan untuk Admin/Superadmin). |
| `GET` | `/api/v1/requests` | Semua Role | Daftar pengajuan `CUTI`, `OFF`, `OFF_PENGGANTI`, `IZIN`, `SAKIT` (Karyawan hanya miliknya sendiri). |
| `POST` | `/api/v1/requests` | `KARYAWAN`, `ADMIN` | Membuat pengajuan baru; jika `OFF_PENGGANTI`, mengunci `hak_off_pengganti` dalam transaksi. |
| `PUT` | `/api/v1/requests/:id` | `KARYAWAN` (milik sendiri) / `ADMIN` | Mengubah pengajuan yang masih berstatus `PENDING`/`DRAFT`. |
| `POST` | `/api/v1/requests/:id/cancel` | `KARYAWAN` (PENDING milik sendiri) / `ADMIN` | Membatalkan pengajuan dan melepaskan kembali kuota `hak_off_pengganti`. |
| `POST` | `/api/v1/requests/:id/decide` | `ADMIN` | Menyetujui (`APPROVED`) atau menolak (`REJECTED`) pengajuan dengan alasan wajib. |

---

## 6. Master Data, Kebijakan Sesi, Kalender, Libur & Kerja Khusus

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/master/offices` | Semua Role | Daftar kantor & konfigurasi geofence. |
| `POST` / `PUT` | `/api/v1/master/offices`, `/offices/:id` | `ADMIN` | Tambah / ubah kantor (otomatis inisialisasi 7 hari `kalender_kerja` saat tambah kantor). |
| `GET` / `POST` | `/api/v1/master/bidang` | `GET`: Semua / `POST`: `ADMIN` | Master bidang kerja. |
| `GET` | `/api/v1/master/employees` | `ADMIN`, `SUPERADMIN` | Daftar karyawan aktif & nonaktif. |
| `POST` | `/api/v1/master/employees` | `SUPERADMIN` | Membuat karyawan + akun pengguna (password >= 6 karakter wajib eksplisit). |
| `PUT` | `/api/v1/master/employees/:id` | `ADMIN` | Memperbarui data operasional karyawan. |
| `GET` | `/api/v1/policies` | `ADMIN`, `SUPERADMIN` | Daftar kebijakan absensi & konfigurasi sesi. |
| `POST` / `PUT` | `/api/v1/policies`, `/policies/:id` | `ADMIN` | Membuat/mengubah kebijakan & jadwal sesi (2, 3, atau 4 sesi). |
| `GET` / `PUT` | `/api/v1/calendars`, `/calendars/:id` | `GET`: Semua / `PUT`: `ADMIN` | Pengaturan hari kerja/libur mingguan per kantor. |
| `GET` | `/api/v1/holidays` | Semua Role | Daftar hari libur khusus perusahaan. |
| `POST` / `DELETE` | `/api/v1/holidays`, `/holidays/:id` | `ADMIN` | Menambah / menghapus hari libur. |
| `GET` | `/api/v1/special-work` | Semua Role (Karyawan hanya miliknya) | Daftar penugasan kerja khusus pada hari libur. |
| `POST` | `/api/v1/special-work` | `ADMIN` | Menetapkan kerja khusus + menerbitkan kuota `hak_off_pengganti`. |
| `POST` | `/api/v1/special-work/:id/cancel` | `ADMIN` | Membatalkan penugasan & menghanguskan hak off yang belum dipakai. |

---

## 7. Payroll, Override, Audit Trail & Administrasi Superadmin

| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| `GET` | `/api/v1/payroll/summary` | `ADMIN`, `SUPERADMIN` | Rekapitulasi `HARI MASUK`, `TIDAK HADIR`, dan detail harian seluruh karyawan per bulan. |
| `GET` | `/api/v1/payroll/early-report` | `ADMIN`, `SUPERADMIN` | Laporan kedatangan paling awal sesi 1. |
| `POST` | `/api/v1/payroll/override` | `ADMIN` | Override status payroll harian tanpa mengubah bukti foto asli. Periode `CLOSED` mewajibkan `koreksiSetelahClosing: true` (`409` jika belum). |
| `GET` | `/api/v1/payroll/periods` | `ADMIN`, `SUPERADMIN` | Status periode closing bulanan (`OPEN` / `CLOSED`). |
| `POST` | `/api/v1/payroll/close` | `ADMIN` | Menutup periode bulan `YYYY-MM` dan menyimpan `snapshot_json`. |
| `POST` | `/api/v1/payroll/export-log` | Semua Role Terautentikasi | Mencatat aktivitas unduhan laporan Excel/CSV ke `audit_log`. |
| `GET` | `/api/v1/audit` | `ADMIN`, `SUPERADMIN` | Membaca jejak audit append-only (filter modul, karyawan, role, pencarian). |
| `GET` | `/api/v1/superadmin/overview` | `SUPERADMIN`, `ADMIN` | Metrik pengawasan absensi, override terbaru, dan bukti foto terbaru. |
| `GET` / `PUT` | `/api/v1/settings` | `SUPERADMIN` | Membaca & mengubah pengaturan aplikasi + upload/reset logo (sanitasi SVG & magic bytes). |
| `GET` | `/api/v1/superadmin/registrations` | `SUPERADMIN` | Daftar pendaftaran akun baru (`PENDING`, `APPROVED`, `REJECTED`). |
| `POST` | `/api/v1/superadmin/registrations/:id/approve` | `SUPERADMIN` | Menyetujui (ACC) pendaftaran dan mengaktifkan akun karyawan/admin. |
| `POST` | `/api/v1/superadmin/registrations/:id/reject` | `SUPERADMIN` | Menolak pendaftaran akun baru beserta alasan keputusan. |
| `GET` / `POST` / `PUT` | `/api/v1/superadmin/accounts`, `/:userId` | `SUPERADMIN` | Manajemen seluruh akun, ubah role, aktif/nonaktif (token lama otomatis direvoke). |
| `PUT` | `/api/v1/superadmin/accounts/:userId/reset-password` | `SUPERADMIN` | Reset sandi pengguna dan mencabut seluruh sesi lama (`token_version + 1`). |
