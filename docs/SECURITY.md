# Standar Keamanan Production — Absensi BIGNET

Dokumen ini menjelaskan kontrol yang benar-benar tersedia pada branch hardening keamanan. Review ini merupakan pemeriksaan source code dan pengujian otomatis; bukan pengganti penetration test independen atau pemeriksaan konfigurasi VPS setelah deployment.

---

## 1. Autentikasi, Password, dan MFA

### Password
- Password baru minimal **15 karakter** dan maksimal **128 karakter** pada endpoint pendaftaran, pembuatan akun, reset password, dan ubah password.
- Password disimpan dengan format hash scrypt berversi: `$scrypt$N$r$p$salt$hash`, salt acak 16-byte dan perbandingan hash menggunakan `crypto.timingSafeEqual`.
- Format hash lama `salt:hash` tetap dapat diverifikasi agar akun lama tidak terkunci setelah migrasi. Hash baru menggunakan parameter scrypt eksplisit `N=32768, r=8, p=1`.
- Password tidak pernah dikembalikan ke frontend.
- Password lama di bawah panjang minimum tetap dapat digunakan untuk login. Pengguna diminta menggantinya dengan password minimal 15 karakter saat melakukan perubahan password berikutnya.
- Jangan menggunakan password demo `bignet123` di production. Demo login harus tetap nonaktif.

### MFA untuk Admin dan Superadmin
- Login Admin/Superadmin selalu membutuhkan faktor kedua TOTP.
- Saat login pertama setelah MFA belum aktif, pengguna harus menambahkan secret ke aplikasi Authenticator dan mengonfirmasi kode 6 digit.
- Saat login berikutnya, pengguna harus memasukkan kode TOTP atau recovery code satu kali pakai.
- Secret TOTP disimpan terenkripsi AES-256-GCM; kunci enkripsi diturunkan dari `AUTH_SECRET` dengan HKDF-SHA256.
- Sepuluh recovery code dibuat saat enrollment. Database hanya menyimpan hash-nya; kode asli hanya ditampilkan satu kali.
- Kode TOTP yang sama tidak dapat digunakan ulang pada time-step yang sudah diterima. Challenge MFA berlaku 5 menit dan dibatasi percobaan.
- Superadmin dapat mereset MFA akun Admin melalui Manajemen Akun. Reset menghapus secret/recovery code lama, membatalkan semua sesi, dan mewajibkan enrollment ulang.
- MFA Superadmin tidak dapat direset dari panel akun biasa. Simpan recovery codes Superadmin di tempat aman; prosedur pemulihan pemilik harus dilakukan secara terkontrol dengan akses server/database dan dicatat sebagai tindakan operasional.

Aplikasi Authenticator yang kompatibel dengan TOTP RFC 6238 (misalnya Google Authenticator atau Microsoft Authenticator) dapat digunakan. Parameter: SHA-1, 6 digit, interval 30 detik.

---

## 2. Cookie, CSRF, dan Sesi

### Cookie-only authentication
- Token autentikasi hanya diterima melalui cookie `bignet_token`.
- Cookie akses memakai `HttpOnly`, `SameSite=Lax`, `Path=/`, dan atribut `Secure` saat request HTTPS terdeteksi melalui reverse proxy terpercaya.
- Token tidak disimpan di `localStorage`, tidak diterima dari header `Authorization: Bearer`, dan tidak diterima melalui query URL.
- Cookie `bignet_csrf` tidak HttpOnly agar frontend dapat membacanya untuk mengirim header `X-CSRF-Token`. Nilainya di-hash dan diikat ke record sesi di database.

### CSRF dan Origin
- Semua metode mutasi selain GET/HEAD/OPTIONS wajib memiliki header `Origin` yang cocok persis dengan origin aplikasi atau origin yang dikonfigurasi pada `ALLOWED_ORIGINS` / `APP_URL`.
- Permintaan mutasi yang sudah terautentikasi juga wajib mengirim pasangan cookie CSRF dan header `X-CSRF-Token` yang cocok dan terikat dengan sesi.
- CORS hanya mengizinkan origin yang dikonfigurasi, credentials, serta header `Content-Type` dan `X-CSRF-Token`.
- Frontend dan API production direkomendasikan berjalan pada origin yang sama melalui Nginx.

### Timeout dan inventaris sesi
Timeout diperiksa backend pada setiap request; heartbeat hanya memperpanjang idle timeout saat halaman terlihat dan ada aktivitas pengguna baru-baru ini.

| Role | Idle timeout | Absolute timeout |
|---|---:|---:|
| Karyawan | 60 menit | 12 jam |
| Admin Operasional | 30 menit | 8 jam |
| Superadmin | 15 menit | 4 jam |

- Sesi disimpan dalam tabel `auth_sessions`, dengan waktu login, aktivitas terakhir, batas idle/absolute, IP, user-agent, hash CSRF, dan status revokasi.
- Logout, perubahan password, reset password, reset MFA, perubahan role, atau penonaktifan akun mencabut sesi terkait di server.
- Pengguna dapat melihat sesi dan mencabut satu sesi atau seluruh sesi perangkat lain dari Pengaturan Profil.
- Koneksi EventSource workforce memeriksa validitas sesi berkala dan ditutup setelah sesi dicabut, kedaluwarsa, atau akun dinonaktifkan.
- Cookie browser memiliki Max-Age idle timeout dan diperbarui oleh endpoint heartbeat.

---

## 3. RBAC dan Proteksi Endpoint

- Seluruh endpoint privat menerapkan pemeriksaan role di backend melalui `requireRole(...)`; pembatasan tampilan frontend bukan batas keamanan.
- Admin dan Superadmin merupakan akun non-pegawai dan tidak mempunyai absensi pribadi.
- Pengguna tidak dapat mengganti identitas `karyawan_id` melalui payload untuk mengambil alih data karyawan lain.
- Reset password dan MFA Admin dilakukan melalui endpoint Superadmin dan dicatat ke audit log.
- Mengubah role atau menonaktifkan akun menaikkan `token_version`, mencabut sesi database, dan menghapus tantangan MFA tertunda.
- Token yang dikirim lewat query URL, termasuk ke endpoint foto, avatar, dan EventSource, ditolak.

---

## 4. Rate Limiting dan IP Client

- Login: maksimum 40 percobaan per 15 menit per IP dan maksimum 8 kegagalan per 15 menit untuk kombinasi IP/username.
- Verifikasi MFA: maksimum 5 percobaan per 5 menit per IP/akun.
- Setup/konfirmasi MFA: maksimum 5 percobaan per 15 menit per IP.
- Registrasi, perubahan password, dan absensi memiliki limiter tersendiri.
- IP dibaca melalui `req.ip` Express, bukan dengan mengambil header `X-Forwarded-For` mentah di kode aplikasi. Nginx harus menimpa header forwarded IP dan port Node tidak boleh terbuka langsung ke internet.
- **Batasan yang diketahui:** limiter saat ini tersimpan dalam memori proses. Counter kembali kosong setelah proses restart dan tidak dibagikan lintas beberapa instance. Deploy yang didukung saat ini adalah satu proses Node/SQLite. Untuk skala multi-instance, pindahkan limiter ke Redis atau storage terpusat sebelum menambah instance.

---

## 5. Security Headers dan Server

`server.ts` menerapkan:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `X-Permitted-Cross-Domain-Policies: none`
- `Content-Security-Policy-Report-Only` sebagai tahap observasi sebelum CSP enforcement.
- HSTS pada production HTTPS.

Default bind production adalah `127.0.0.1` agar akses publik hanya melalui Nginx. Port Node (3000) jangan dibuka pada firewall publik. Pastikan `HOST=127.0.0.1`, `APP_URL`, `ALLOWED_ORIGINS`, sertifikat TLS, dan trusted proxy sesuai konfigurasi hosting.

---

## 6. Data Absensi, Media, dan Batas Kepercayaan Browser

- Backend memvalidasi format koordinat, akurasi GPS, jarak geofence, jam sesi dari server, urutan sesi, serta bukti foto raster berdasarkan magic bytes.
- Browser mengirim koordinat dan sumber foto sebagai data klien. Karena itu, web-only GPS dan kamera browser **tidak dapat membuktikan secara kriptografis** bahwa lokasi atau kamera tidak dimanipulasi pada perangkat yang dikuasai pengguna.
- Sistem dapat mendeteksi anomali dan menyimpan bukti/audit, tetapi tidak boleh mengklaim anti-fake-GPS mutlak tanpa device attestation dari aplikasi native yang sesuai.
- Foto, avatar, dan aset disimpan di luar folder static web. Nama file acak, pemeriksaan path, magic bytes, batas ukuran, dan header `nosniff` digunakan untuk mengurangi risiko upload/path traversal.
- Respons API memakai `Cache-Control: no-store` agar data sensitif tidak disimpan di cache browser/proxy.

---

## 7. Database, Audit, dan Backup

- Migrasi 015 menambahkan tabel `auth_sessions`, `auth_challenges`, `mfa_recovery_codes` serta kolom MFA pengguna.
- Audit log memiliki trigger append-only untuk menolak UPDATE/DELETE melalui koneksi aplikasi. Akses langsung ke file SQLite oleh administrator OS tetap dapat melewati batas ini; lindungi akses file dan simpan salinan audit penting di luar host.
- Backup harus disimpan di luar web root, dibatasi permission-nya, dienkripsi sebelum dikirim ke penyimpanan eksternal, dan diuji restore secara berkala.
- File `.env`, `DATA_DIR`, database, `.auth_secret`, foto, dan backup tidak boleh dikomit ke Git.
- `AUTH_SECRET` wajib berupa secret acak minimal 32 karakter dan harus stabil. Mengubahnya akan membatalkan sesi dan membuat secret MFA terenkripsi lama tidak dapat dibaca. Simpan secret tersebut dengan backup aman terpisah dari repository.

---

## 8. Pengujian Keamanan Otomatis dan Batas Audit

GitHub Actions menjalankan tes, TypeScript check, dan production build. Test suite keamanan mencakup:
- cookie-only authentication dan penolakan Bearer/query token;
- pemeriksaan Origin/CSRF;
- login dan enrollment/verifikasi TOTP;
- penolakan replay TOTP dan penggunaan recovery code satu kali;
- masa berlaku sesi, pencabutan sesi, serta reset MFA;
- password hash berversi dan kompatibilitas hash lama.

Pengujian otomatis dan static review bukan penetration test. Sebelum go-live, lakukan pemeriksaan konfigurasi TLS/Nginx/firewall, uji akses dari jaringan eksternal, scan dependency, SAST, dan penetration test terkontrol pada staging.
