# Changelog — Absensi BIGNET

## 2026-11-17 — Hapus master Kantor & Bidang Kerja dengan pemeriksaan relasi

- Menu **Kantor & Geofence** dan **Bidang Kerja** menampilkan tombol **Hapus** pada setiap kartu. Tombol aktif hanya jika server memastikan belum ada relasi bisnis; jika masih digunakan, tombol dinonaktifkan dan alasan relasinya ditampilkan.
- ADMIN dapat menghapus kantor hanya jika tidak ada pegawai (termasuk arsip), pendaftaran akun, hari libur, atau periode payroll yang merujuk kantor tersebut. Tujuh baris kalender mingguan bawaan dihapus bersama kantor dalam satu transaksi.
- ADMIN dapat menghapus bidang kerja hanya jika tidak ada pegawai (termasuk arsip), kebijakan absensi (aktif maupun nonaktif), atau pendaftaran akun yang merujuk bidang tersebut.
- Endpoint DELETE memeriksa ulang relasi di backend dalam transaksi BEGIN IMMEDIATE; data yang masih dipakai ditolak dengan HTTP 409. Karyawan dan role lain tidak memiliki izin DELETE.
- Setiap penghapusan mencatat before/after pada Audit Trail; penghapusan gagal tidak mengubah data apa pun.
- Ditambahkan uji integrasi: referensi pegawai memblokir penghapusan, master tanpa relasi dapat dihapus, kalender bawaan ikut dibersihkan, dan Karyawan mendapat HTTP 403.

## 2026-11-17 — Admin edit bidang kerja & perbaikan jam absensi mobile

- ADMIN operasional dapat mengubah kode, nama, dan deskripsi master bidang kerja dari **Master Karyawan, Kantor & Bidang**; perubahan masuk ke Audit Trail.
- Form edit karyawan tetap memungkinkan ADMIN memindahkan pegawai ke bidang kerja lain. Backend memvalidasi kantor/bidang yang dipilih dan mengembalikan HTTP 400 untuk referensi tidak valid, bukan membiarkan kegagalan foreign key menjadi error server.
- Jam pembukaan sesi pada halaman Absensi sekarang mengikuti waktu server melalui `performance.now()` yang monoton, bukan jam dinding perangkat + offset yang dihitung sekali.
- Waktu dan jadwal disinkronkan ulang setelah izin GPS, saat tab kembali fokus/visible, `pageshow`, serta secara berkala. Jam header mengikuti mekanisme server-clock yang sama.
- Server tetap menjadi otoritas final: endpoint kirim absensi tetap memvalidasi ulang jam sesi, urutan, GPS, geofence, kamera, dan bukti sebelum menyimpan.
- Ditambahkan tes regresi untuk clock drift/resume browser dan integrasi ADMIN untuk edit master bidang serta assignment bidang teknisi.

## 2026-11-17 — Foto profil SUPERADMIN mandiri

- Tombol **Ganti Foto Profil** kini tersedia untuk akun SUPERADMIN.
- Foto pemilik sistem disimpan langsung di tabel `pengguna` (`foto_profil_path`, `foto_profil_updated_at`), tidak membuat atau menghubungkan profil karyawan.
- Ditambahkan endpoint avatar akun `/api/v1/avatars/pengguna/:userId`; foto yang sama tampil di profil, navigasi Superadmin, dan daftar Kelola Akun.
- Endpoint `PUT /api/v1/profile/photo` mendukung upload dan reset foto akun SUPERADMIN dengan Audit Trail.
- Migrasi `013_standalone_superadmin_profile_photos` menambahkan kolom foto untuk database yang sudah berjalan.


## 2026-11-17 — Pemisahan akun SUPERADMIN dari data pegawai

- SUPERADMIN kini merupakan akun pemilik/pengelola sistem yang berdiri sendiri; `pengguna.karyawan_id` nullable dan identitas pemilik disimpan di `nama_tampilan` serta `no_hp`.
- Migrasi `010_separate_superadmin_accounts_from_employee_records` memindahkan identitas Superadmin lama dan melepaskan relasi karyawan. Migrasi `011_exclude_legacy_superadmin_profiles_from_employee_master` menandai profil lama sebagai arsip sistem (`is_system_archive = 1`) sehingga tidak muncul di master pegawai, roster, feed, atau payroll. Baris dan bukti historis tetap dipertahankan.
- Produksi dan demo seed tidak lagi membuat profil karyawan untuk akun SUPERADMIN; ID referensi data demo karyawan disesuaikan.
- Menu Kelola Akun dapat membuat, mengubah, menonaktifkan, dan reset password akun SUPERADMIN tambahan tanpa membuat NIK atau profil pegawai. Sistem mempertahankan minimal satu akun Superadmin aktif.
- Endpoint absensi pribadi dan foto profil pegawai tidak menerima akun SUPERADMIN; Superadmin tetap memantau roster, bukti, audit, dan rekap melalui dashboard.
- Trigger database `trg_pengguna_role_link_insert/update` mencegah akun SUPERADMIN dihubungkan ke profil karyawan dan mewajibkan akun ADMIN/KARYAWAN tetap memiliki relasi pegawai; migrasi `012_enforce_role_employee_link_invariant`.


## 2026-11-17 — Superadmin website favicon settings

- Menu Pengaturan Sistem SUPERADMIN kini mendukung pratinjau, unggah, dan reset favicon website.
- Favicon menerima PNG, SVG, atau ICO maksimal 512 KB; SVG diperiksa untuk menolak elemen/script aktif.
- Favicon disimpan di direktori aset persisten, dimuat melalui endpoint publik khusus, serta langsung diterapkan pada ikon tab browser setelah pengaturan disimpan.
- Pembaruan hanya dapat dilakukan SUPERADMIN dan tetap masuk ke Audit Trail Pengaturan Sistem.
- Migrasi `009_custom_website_favicon_settings` menambahkan `favicon_path` dan `favicon_updated_at` pada `pengaturan_aplikasi`.


## 2026-11-17 — Admin one-time check-in override

- Ditambahkan menu Admin **Izin Check-in Terlambat** untuk melihat sesi berikutnya yang sudah kedaluwarsa.
- Admin dapat membuka akses selama 5, 10, 15, atau 30 menit dengan alasan wajib; izin hanya berlaku satu kali untuk satu karyawan, tanggal, dan sesi.
- Karyawan menerima pembaruan izin otomatis pada halaman Absensi tanpa login ulang. Kamera browser, selfie, GPS/geofence, urutan sesi, dan waktu server tetap diwajibkan.
- Check-in yang memakai izin tetap menyimpan waktu aktual dan status keterlambatan; izin tidak mengubah bukti absensi atau hasil payroll.
- Pemberian izin dan penggunaannya dicatat sebagai audit `OVERRIDE_ABSENSI`; Superadmin dapat memantau melalui audit log.
- Migrasi database `008_admin_one_time_expired_attendance_checkin_access` menambahkan tabel `override_akses_absensi`.

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

## 2026-11-17 — Mobile GPS prompt, centered photo viewer, and employee landing

- GPS tidak lagi diminta otomatis ketika halaman Absensi dibuka. Status awal netral; browser baru diminta izin setelah karyawan menekan Aktifkan Lokasi.
- Jika aplikasi dibuka melalui HTTP IP lokal yang bukan secure context, halaman menjelaskan bahwa GPS/kamera memerlukan HTTPS.
- Lightbox foto Beranda kini diposisikan di tengah layar pada mobile dan desktop, dengan tinggi dibatasi viewport dan detail dapat discroll.
- Saat login, aplikasi menggunakan waktu WIB dari endpoint server dan jadwal sesi berikutnya untuk memilih tab awal: Absensi hanya jika sesi berikutnya sedang terbuka; selain itu Beranda.
- Pengujian unit ditambahkan untuk routing halaman awal berdasarkan status sesi.
- Setelah absensi sesi berhasil, karyawan kembali ke Beranda jika sesi berikutnya belum dibuka; ketika berada di Beranda, jadwal berikutnya diperiksa setiap 15 detik dan tab Absensi dibuka otomatis saat sesi aktif.

## 2026-11-17 — Mobile camera controls and camera lifecycle hardening

- Tombol kamera mobile dirapikan menjadi baris ringkas: Ambil Foto, ganti kamera depan/belakang, dan Batal; label tidak membungkus.
- Capture dinonaktifkan sampai video memiliki frame aktual (loadeddata, readyState, videoWidth, dan videoHeight valid).
- Pergantian kamera menghentikan stream lama, membatalkan request kamera yang tertunda, dan memvalidasi kamera depan/belakang yang benar-benar dibuka.
- Stream video dilepas dari elemen ketika kamera dihentikan; track yang terputus ditangani; error izin, perangkat hilang, dan kamera sibuk dibedakan.
- Ditambahkan kasus UAT untuk kamera depan/belakang dan lifecycle stream. Uji perangkat fisik tetap harus dilakukan pada HP.

## 2026-11-17 — Location-first attendance and editable photo/caption submission

- Tombol Perbarui Lokasi ditampilkan sebagai Langkah 1 yang dominan; kamera dan pengiriman tetap terkunci sampai GPS berhasil dibaca dan aturan geofence sesi terpenuhi.
- Foto kamera adalah draft sebelum pengiriman. Karyawan dapat mengganti foto menggunakan kamera depan/belakang; draft dipertahankan ketika pemeriksaan lokasi gagal agar tidak perlu selfie ulang.
- Caption dapat diedit pada semua sesi. Caption Sesi 1 opsional; keterangan sesi lanjutan tetap wajib sesuai snapshot kebijakan.
- Tombol kirim menampilkan indikator proses untuk pemeriksaan GPS dan pengunggahan/penyimpanan foto serta menonaktifkan submit ganda.
- Setelah API berhasil mencatat sesi, karyawan diarahkan ke paling atas Beranda dan melihat notifikasi sukses; feed Beranda memuat data terbaru saat komponen dibuka.

## 2026-11-17 — Browser GPS address and employee monthly history calendar

- Halaman Absensi menampilkan koordinat browser, akurasi, jarak kantor, dan tautan membuka titik koordinat di Google Maps.
- Alamat teks perkiraan tersedia melalui endpoint reverse geocoding server-side yang opsional menggunakan Google Maps Geocoding API; API key tidak diekspos ke browser, hasil dicache enam jam, dibatasi maksimal 10 request/detik, dan lookup hanya berjalan setelah Perbarui Lokasi ditekan.
- Tanpa API key, alamat teks memberi penjelasan belum dikonfigurasi dan absensi tetap memakai koordinat GPS browser.
- Halaman History menampilkan kalender Senin–Minggu dengan status dari resolver, hari hadir hijau, tidak hadir merah, belum selesai amber, kategori non-kerja dengan warna tersendiri, dan Admin Override ditandai O.
- Tanggal pada kalender dapat dipilih untuk memfilter timeline dan bukti foto. Hari mendatang tanpa hasil resolver tidak ditandai alfa.
- Test inti ditambah untuk aturan status kalender dan Admin Override.

## 2026-11-17 — Attendance feed card visual hierarchy

- Kartu beranda disusun ulang menjadi identitas/waktu, bukti foto, status sesi/geofence, dan caption/lokasi.
- Nama karyawan tidak diulang pada caption; jabatan, bidang, kantor, jam dan tanggal tersusun pada header.
- Foto memakai tinggi maksimum konsisten dan `object-contain` agar bukti foto utuh tanpa crop agresif.
- Status sesi, ketepatan waktu, dan geofence memakai label visual terpisah; lokasi, koordinat GPS, jarak, dan Detail lokasi tetap dipertahankan.
- Jarak di atas 1 km diringkas dalam kilometer agar lebih mudah dibaca.

## 2026-11-17 — Separate actual attendance location from assigned office address

- Menemukan bahwa feed sebelumnya memakai `kt.alamat` (alamat kantor penempatan) sebagai alamat lokasi absensi. Ini menyebabkan koordinat GPS Pontianak tampil bersama alamat kantor Jakarta.
- Migrasi 006 menambahkan `absensi_sesi.lokasi_alamat` untuk menyimpan snapshot alamat perkiraan Geoapify pada saat absensi dibuat.
- API feed mengembalikan `lokasiAktualAlamat` terpisah dari `kantorAlamat`; card menampilkan Lokasi saat absen dan Kantor penempatan sebagai dua informasi berbeda.
- Geoapify lookup dijalankan best-effort dan memakai cache/deduplikasi; kegagalan geocoding tidak memblokir absensi atau mengubah geofence.
- Catatan absensi lama tanpa snapshot dapat di-resolve ketika Detail Lokasi dibuka; card tidak lagi menyamarkan alamat kantor sebagai lokasi aktual.
- Atribusi Geoapify dan OpenStreetMap ditambahkan pada informasi alamat.

## 2026-11-17 — Automatic feed location addresses and centered History photo preview

- Feed Beranda otomatis menyelesaikan alamat untuk record lama saat feed dimuat; pengguna tidak perlu membuka Detail Lokasi.
- Batch endpoint menerima maksimal 60 ID sesi dan membaca koordinat langsung dari database server.
- Hasil reverse geocoding positif maupun kosong/gagal dicache dalam `absensi_lokasi_cache` selama enam jam untuk mencegah request Geoapify berulang.
- Absensi baru tetap menyimpan snapshot lokasi aktual ke `absensi_sesi.lokasi_alamat` pada saat submit.
- Card Beranda hanya menampilkan alamat aktual, koordinat GPS, dan jarak aktual ke kantor; teks kantor penempatan dihilangkan.
- Modal foto History pada mobile sekarang berada di tengah layar, tidak menempel di tepi bawah.

## 2026-11-17 — Submit-time address snapshot, shareable PNG card and post-check-in focus

- Geoapify reverse geocoding is now called only by the attendance submit route, after GPS/geofence validation. The result is stored in `absensi_sesi.lokasi_alamat` in the same attendance transaction; failures do not block the check-in.
- Removed browser GPS-refresh and Beranda feed reverse-geocoding requests. Beranda and its photo preview only read the saved database address (or any legacy address already cached); they never call Geoapify.
- Replaced the Beranda `Detail lokasi` action with `Bagikan`. It renders a 4:5 PNG attendance card with proof photo, employee identity, session/time, activity, GPS address/coordinates and actual office distance.
- Uses the browser's file-share sheet so Android users can choose WhatsApp or Telegram; unsupported browsers download the PNG for manual attachment.
- Attendance submit response now returns the new `sessionId`. After a successful check-in, the employee returns to Beranda, and the newly published post is scrolled into view and highlighted.
- Geofence continues to rely solely on raw GPS coordinates and office policy.