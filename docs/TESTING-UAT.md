# Pengujian Otomatis & Panduan UAT — Absensi BIGNET

---

## 1. Cakupan Pengujian Otomatis (`npm test`)

Suite berisi 22 test (14 inti + 8 production) dan dijalankan menggunakan `tsx --test tests/*.test.ts`. Perubahan terbaru menambah cakupan batas akhir sesi dan kualitas GPS. Jalankan ulang secara lokal setelah menarik commit terbaru; angka kelulusan harus berasal dari hasil perintah aktual.

### A. Suite Inti Bisnis (`tests/core.test.ts` — 14 Test)
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
| Automated Tests | `npm.cmd test` | Perlu dijalankan ulang; cakupan saat ini 22 test |
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

8. **Attendance Capture, Caption & Submission UX (Android/PC):**
   - Tombol LANGKAH 1 Perbarui Lokasi harus ditekan sebelum kamera dan kirim absensi dapat digunakan; lokasi dapat diperbarui ulang.
   - Foto hasil kamera tampil sebagai draft sebelum submit; uji Ganti Foto, ganti kamera depan/belakang, dan pastikan foto lama tidak tersimpan ketika pengguna membatalkannya.
   - Caption Sesi 1 dapat diedit dan opsional; caption sesi lanjutan dapat diedit dan tetap mengikuti kewajiban deskripsi dari kebijakan.
   - Ketika mengirim, tampilkan status loading pemeriksaan GPS dan pengunggahan/penyimpanan. Tombol kirim tidak boleh dapat ditekan dua kali.
   - Setelah API mengonfirmasi penyimpanan berhasil, kembali ke Beranda, scroll ke paling atas, tampilkan notifikasi sukses, dan pastikan posting/foto terbaru muncul di feed.

9. **Browser Location Address & History Calendar (Employee):**
   - Tekan Perbarui Lokasi; verifikasi koordinat latitude/longitude, akurasi ±meter, jarak kantor, dan tautan titik di Google Maps tampil dari posisi browser.
   - Perbarui Lokasi hanya membaca koordinat dan akurasi dari browser; alamat belum dicari pada tahap ini.
   - Setelah submit, alamat perkiraan Geoapify disimpan dalam `absensi_sesi.lokasi_alamat`; tanpa API key atau ketika layanan gagal, absensi tetap tersimpan dengan koordinat GPS sebagai bukti lokasi.
   - Kalender History memakai status resolver: hijau HADIR, merah TIDAK HADIR, amber BELUM SELESAI, dan warna khusus untuk libur/off/cuti/izin/sakit/off pengganti.
   - Hari mendatang yang belum dievaluasi tetap netral, tanggal dapat dipilih untuk memfilter timeline, dan Admin Override diberi penanda O serta memakai hasil payroll final untuk warna.

10. **Employee Attendance Feed Card UI (Mobile & Desktop):**
   - Setiap kartu menampilkan identitas sekali saja: nama, jabatan/bidang, kantor, jam WIB, dan tanggal.
   - Foto memakai tinggi maksimum yang konsisten dan tidak terpotong; klik foto membuka lightbox.
   - Badge sesi/progres, tepat waktu/terlambat, dan dalam/di luar radius dibedakan secara visual.
   - Caption aktivitas tampil pada blok tersendiri; alamat aktual, koordinat GPS, jarak dan tombol Bagikan tersedia. Card tidak menampilkan alamat kantor penempatan.
   - Jarak di atas 1 km ditampilkan dalam kilometer dengan satu desimal; uji layar HP sempit dan desktop serta mode gelap.

11. **Actual Check-in Address vs Assigned Office (Feed):**
   - Buat absensi dengan koordinat GPS Pontianak untuk karyawan yang kantor penempatannya Jakarta. Feed harus menampilkan alamat GPS Pontianak sebagai Lokasi saat absen, tanpa menampilkan alamat kantor penempatan.
   - Pastikan kolom `lokasi_alamat` tersimpan pada record sesi dan tetap muncul setelah restart server.
   - Untuk record lama yang `lokasi_alamat` null dan tidak memiliki cache alamat lama, card menampilkan keterangan alamat tidak tersimpan serta koordinat GPS; Beranda tidak melakukan reverse geocoding.
   - Jika Geoapify tidak terkonfigurasi atau gagal, absensi tetap tersimpan; feed menampilkan koordinat dan penjelasan bahwa alamat aktual tidak tersedia.
   - Geofence tetap dihitung dari lat/lng dan koordinat kantor; alamat hasil geocoding tidak boleh memengaruhi kelulusan radius.
   - Pastikan atribusi Powered by Geoapify dan © OpenStreetMap contributors terlihat saat alamat hasil provider ditampilkan.

12. **Submit-Time GPS Address Snapshot (No Geoapify Request from Beranda):**
   - Memperbarui lokasi pada halaman Absensi hanya membaca Geolocation browser; tidak ada request Geoapify.
   - Saat submit, backend melakukan paling banyak satu reverse-geocoding untuk koordinat sesi, lalu menyimpan hasil ke `absensi_sesi.lokasi_alamat`.
   - Kegagalan/timeout Geoapify tidak menggagalkan penyimpanan absensi; koordinat mentah tetap tersimpan dan digunakan geofence.
   - Membuka, memuat ulang, atau melakukan filter Beranda tidak memanggil endpoint Geoapify. Feed hanya membaca snapshot database.
   - Catatan lama dengan alamat yang pernah tersimpan tetap dapat dibaca; catatan lama tanpa snapshot/cache hanya menampilkan koordinat dan keterangan alamat tidak tersimpan.

13. **Share Card & Redirect to Newly Published Attendance:**
   - Setelah submit berhasil, response mengembalikan `sessionId`; pengguna kembali ke Beranda dan card sesi yang baru dibuat otomatis di-scroll ke tengah serta di-highlight.
   - Setiap post memiliki tombol Bagikan; PNG portrait berisi foto, identitas, sesi/waktu, aktivitas, alamat GPS, koordinat, dan jarak aktual.
   - Pada Android/ browser yang mendukung Web Share file, tombol Bagikan membuka system share sheet dan WhatsApp/Telegram dapat dipilih.
   - Pada browser yang tidak mendukung file sharing, PNG diunduh dengan instruksi melampirkannya secara manual.
   - Verifikasi foto bukti dapat diambil menggunakan token otorisasi; jika foto gagal dimuat, kartu tetap dibuat dengan placeholder.

14. **Centered History Preview (Mobile):**
   - Modal foto History tampil di tengah layar dengan jarak dari tepi, bukan bottom sheet yang menempel ke bawah.