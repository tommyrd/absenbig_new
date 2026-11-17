# Pengujian Otomatis & Panduan UAT — Absensi BIGNET

---

## 1. Cakupan Pengujian Otomatis (`npm test`)

Suite berisi 21 test (13 inti + 8 production) dan dijalankan menggunakan `tsx --test tests/*.test.ts`. Perubahan terbaru menambah cakupan batas akhir sesi dan kualitas GPS. Jalankan ulang secara lokal setelah menarik commit terbaru; angka kelulusan harus berasal dari hasil perintah aktual.

### A. Suite Inti Bisnis (`tests/core.test.ts` — 13 Test)
1. **Geofence Haversine distance calculation** — Perhitungan jarak meter antara koordinat GPS karyawan dan kantor.
2. **Session time window** — Absensi hanya diizinkan sejak `jam_mulai` hingga `jam_selesai` (inklusif); setelah `jam_selesai` menjadi `EXPIRED`.
3. **GPS accuracy margin** — Akurasi browser maksimum ±100m dan jarak + nilai akurasi harus tetap berada dalam radius kantor saat sesi wajib kantor.
4. **Attendance location policy** — Default mewajibkan Sesi 1 di kantor dan mengizinkan Sesi 2+ di lokasi lain; mode `SEMUA_SESI_KANTOR` mewajibkan seluruh sesi berada di kantor.
5. **Policy Hierarchy resolves `KARYAWAN > BIDANG > DEFAULT`** — Prioritas kebijakan sesi (2, 3, atau 4 sesi) berjalan akurat.
6. **Kantor A Sunday is `HARI_LIBUR`, Kantor B Sunday is 2 sessions** — Kalender kantor berbeda tidak salah menghitung `TIDAK_HADIR`.
7. **Workforce feed strips sensitive data** — GPS mentah, path foto internal, dan alasan pengajuan pribadi tidak bocor.
8. **Monthly summary totals `HARI MASUK` and `TIDAK HADIR` consistently** — Sinkronisasi hasil kalkulasi bulanan.
9. **Audit log strictly append-only via SQLite triggers** — Trigger SQLite memblokir `UPDATE` dan `DELETE` pada tabel `audit_log`.
10. **System settings default initialization** — Pengaturan branding dan login terinisialisasi konsisten.
11. **Registration table and profile photo columns** — Kolom profil dan tabel `pendaftaran_akun` tersedia.
12. **Employee entry routing** — Saat login, karyawan diarahkan ke Absensi hanya jika sesi berikutnya sedang berada dalam jendela waktu server; jika belum waktunya, sesi berakhir, atau semua sesi selesai, mulai dari Beranda.
13. **System settings RBAC & Feed access across all roles** — Endpoint settings terproteksi khusus `SUPERADMIN`, Beranda Feed dan foto dapat diakses lintas role, validasi sumber kamera & jam mulai sesi berjalan.

### B. Suite Hardening Production (`tests/production.test.ts` — 8 Test)
Berjalan terisolasi penuh pada direktori temporer (tanpa menyentuh data aktif):
1. **Idempotent migrations & clean production seeding** — 5 versi migrasi aman dijalankan ulang; `seedProductionBaseline` membuat hanya 1 Superadmin awal dengan `izin_demo_login = 0` dan kata sandi ter-hash `scrypt`.
2. **Health check & HttpOnly cookie login** — `/api/v1/health` (200 OK WIB), sandi salah ditolak (401), login benar menerbitkan cookie `HttpOnly; SameSite=Lax`.
3. **Brute-force rate limiting** — Percobaan gagal ke-9 pada login memicu HTTP `429` dengan header `Retry-After`.
4. **Account lifecycle & Registration ACC workflow** — Pembuatan akun karyawan/admin mewajibkan sandi >= 6 karakter, avatar dengan magic bytes palsu ditolak (`400`), akun `PENDING` & `REJECTED` diblokir saat login (`403`), dan `ACC` oleh Superadmin langsung mengaktifkan login.
5. **RBAC isolation, query-token guard & token revocation** — `?token=` ditolak pada `/api/v1/auth/me` (`401`), diizinkan pada `/api/v1/avatars/*`; Karyawan & Admin ditolak (`403`) pada endpoint Superadmin; token kedaluwarsa ditolak; ganti kata sandi & logout langsung merevoke token lama; penonaktifan akun memutus sesi aktif.
6. **SVG XSS protection, browser-camera-only, `jam_mulai` gate & strict geofence** — SVG mengandung `<script>` ditolak (`400`); logo SVG bersih disajikan dengan `X-Content-Type-Options: nosniff` + CSP; absensi sebelum `jam_mulai` dan setelah `jam_selesai` ditolak (`400`); `FILE_UPLOAD` ditolak (`400`); GPS wajib tersedia dengan akurasi maksimum ±100m; lokasi di luar radius atau area yang tidak bisa dipastikan berada dalam radius ditolak meskipun request mengirim mode legacy `CATAT_DENGAN_FLAG`; seluruh kantor lama dinormalisasi oleh migrasi `004` ke `TOLAK_LUAR_RADIUS`; migrasi `005` menambahkan aturan lokasi per kebijakan; PNG kamera valid tersimpan dengan SHA-256 checksum.
7. **Special work, Off Pengganti, Payroll closing & post-closing override** — Kuota off pengganti terkunci saat pengajuan dan berstatus `DIPAKAI` setelah approval Admin; override pada bulan `CLOSED` membutuhkan flag `koreksiSetelahClosing` (`409` vs `201`) dan tercatat pada modul `CLOSING_KOREKSI`.
8. **Disaster recovery Backup & Restore end-to-end** — `runBackup()` membuat snapshot database + foto + `manifest.json` + `.tar.gz`; setelah simulasi kehilangan DB & folder `photos/`, `runRestore()` memulihkan DB & seluruh tautan foto (`missingPhotosCount === 0`); modifikasi 1 byte pada arsip backup langsung terdeteksi dan membatalkan restore sebelum menyentuh data aktif.

---

## 2. Pengujian Build, Typecheck & Live Server Production

| Verifikasi | Perintah | Hasil |
|---|---|---|
| TypeScript Check | `npm run lint` (`tsc --noEmit`) | Perlu dijalankan ulang setelah commit terbaru |
| Frontend Bundle | `npm run build` (`vite build`) | Perlu dijalankan ulang setelah commit terbaru |
| Automated Tests | `npm.cmd test` | Perlu dijalankan ulang; cakupan saat ini 20 test |
| Production Server Boot | `NODE_ENV=production node server.ts` | Perlu UAT ulang setelah commit terbaru |

---

## 3. Skenario UAT Manual Sebelum Go-Live

1. **UAT Pendaftaran & ACC (HP Browser + Desktop Superadmin):**
   - Karyawan & Admin mendaftar via halaman login (unggah foto profil PNG/JPG).
   - Verifikasi login gagal sebelum di-ACC, lalu Superadmin melakukan ACC dan akun berhasil login.
2. **UAT Absensi Kamera Browser & Beranda Feed (iOS Safari / Android Chrome HTTPS):**
   - Uji akses kamera depan/belakang browser, pastikan izin GPS aktif.
   - Uji mode default: Sesi 1 di luar radius ditolak, Sesi 2+ di luar radius diizinkan dengan GPS tetap direkam; uji mode `SEMUA_SESI_KANTOR`: semua sesi di luar radius ditolak. Untuk sesi yang wajib kantor, uji GPS di dalam radius (absen dapat dikirim), akurasi GPS buruk (kamera/kirim terkunci dan API menolak); setelah `jam_selesai` kamera ditutup dan API menolak, serta izin GPS ditolak/tidak tersedia (absensi ditolak). Uji sebelum `jam_mulai` (tombol/submit ditolak), lalu setelah `jam_mulai` berhasil absen dan posting muncul real-time di Beranda Feed akun lain.
3. **UAT Dark Mode & Mobile Responsive:**
   - Cek navigasi tab bawah mobile dan toggle dark/light mode di seluruh peran (`KARYAWAN`, `ADMIN`, `SUPERADMIN`).
4. **UAT Payroll, Export Excel & Audit Log:**
   - Lakukan pengajuan cuti/off pengganti -> approve Admin -> cek rekap bulanan -> unduh Excel -> pastikan riwayat tercatat pada Audit Log.


5. **UAT GPS Prompt, Photo Lightbox & Landing Page (Android Chrome):**
   - Halaman Absensi tidak meminta izin GPS secara otomatis; status awal menampilkan instruksi netral sampai tombol Aktifkan Lokasi ditekan.
   - Akses melalui IP lokal HTTP menampilkan penjelasan bahwa GPS/kamera membutuhkan HTTPS; uji GPS dan kamera melalui HTTPS.
   - Foto Beranda dibuka sebagai modal di tengah viewport, dapat ditutup dan kontennya dapat discroll tanpa menempatkan modal di bawah layar.
   - Login saat sesi berikutnya sedang terbuka langsung menuju Absensi; login ketika belum waktunya, sesi sudah berakhir, atau semua sesi selesai menuju Beranda.

6. **Employee Session Navigation (after login and check-in):**
   - Login saat sesi berikutnya sedang aktif langsung menampilkan Absensi tanpa menampilkan Beranda terlebih dahulu.
   - Jika sesi berikutnya belum dimulai, sudah berakhir, atau seluruh sesi selesai, tampilkan Beranda.
   - Setelah submit sesi berhasil, kembali ke Beranda jika belum ada sesi berikutnya yang sedang terbuka.
   - Saat karyawan tetap berada di Beranda, sistem mengecek jadwal server secara berkala (15 detik) dan otomatis membuka Absensi ketika sesi berikutnya mulai.

7. **Browser Camera Front/Back UAT (Android Chrome/Brave):**
   - Uji izin kamera pertama kali; izin ditolak; kamera tidak tersedia; kamera sedang dipakai aplikasi lain.
   - Uji buka kamera depan, tunggu frame siap, ambil foto, pratinjau, hapus/ulang, dan pengiriman foto.
   - Uji pergantian kamera depan ke belakang dan kembali ke depan. Pastikan pratinjau benar-benar berubah dan tombol ambil foto baru aktif setelah frame tersedia.
   - Uji Batal, navigasi keluar halaman, GPS refresh, sesi kedaluwarsa, dan pergantian kamera ketika permintaan izin masih berjalan. Pastikan indikator kamera perangkat mati setelah stream dihentikan.