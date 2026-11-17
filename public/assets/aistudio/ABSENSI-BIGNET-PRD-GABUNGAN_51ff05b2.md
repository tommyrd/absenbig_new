# DOKUMENTASI LENGKAP ABSENSI BIGNET

Dokumen gabungan seluruh PRD dan requirement proyek Absensi BIGNET.

------------------------------------------------------------------------

# DOKUMEN: README.md

# Absensi BIGNET --- Dokumen Produk

Paket ini adalah konsolidasi requirement hasil diskusi sampai 16
November 2026 untuk menjadi acuan Antigravity.

Urutan baca: 1. `00-MASTER-PROMPT-ANTIGRAVITY.md` 2. `01-PRD.md` 3.
`02-RBAC.md` 4. `03-ATURAN-ABSENSI.md` 5. `04-KALENDER-KERJA-DAN-OFF.md`
6. `05-PENGAJUAN.md` 7. `06-UI-UX.md` 8. `07-REKAP-PAYROLL.md` 9.
`08-AUDIT-DAN-KEAMANAN.md` 10. `09-ARSITEKTUR-TEKNOLOGI.md` 11.
`10-MODEL-DATA.md` 12. `11-ACCEPTANCE-CHECKLIST.md` 13.
`PROJECT-STATUS.md` 14. `CHANGELOG.md`

Dokumen ini memisahkan keputusan yang sudah disepakati dari hal yang
masih perlu keputusan. Jangan mengarang aturan yang belum diputuskan.

------------------------------------------------------------------------

# DOKUMEN: 00-MASTER-PROMPT-ANTIGRAVITY.md

# MASTER PROMPT ANTIGRAVITY --- ABSENSI BIGNET

Anda adalah engineering agent untuk membangun Absensi BIGNET. Sebelum
coding, baca seluruh dokumen dalam folder ini.

## Aturan wajib

-   Ikuti requirement dan business rules yang tertulis. Jangan mengarang
    aturan yang belum diputuskan.
-   Jika ada konflik, hentikan bagian terkait dan laporkan konflik serta
    opsi penyelesaiannya.
-   Platform versi awal adalah satu responsive web application. Jangan
    membuat APK Android/iOS native.
-   Bahasa UI utama Bahasa Indonesia.
-   Backend adalah sumber kebenaran untuk waktu server, policy sesi,
    kalender, hasil kehadiran, payroll summary, approval, dan audit.
-   Semua operasi yang memengaruhi kehadiran/payroll harus divalidasi di
    server dan diaudit.
-   Admin Override tidak boleh mengubah/memalsukan bukti absensi asli.
-   Audit trail bersifat append-only dan tidak dapat dihapus Admin.
-   Semua halaman responsive. Karyawan mobile-first; Admin juga harus
    nyaman di mobile.
-   Semua tabel mengikuti standar BIGNET: search, filter, sorting,
    pagination, nomor urut, selection/bulk action bila relevan, loading,
    empty, error, dan mobile state.
-   Jangan mengubah UI yang telah disetujui tanpa instruksi eksplisit.
-   Jangan menyimpan secret/credential dalam repository.

## Alur kerja per unit

1.  Identifikasi dokumen dan file yang terdampak.
2.  Buat rencana perubahan.
3.  Implementasikan satu unit terukur.
4.  Tambahkan automated test.
5.  Jalankan test, lint, typecheck, build.
6.  Periksa desktop dan mobile.
7.  Perbarui dokumen, CHANGELOG, dan PROJECT-STATUS.
8.  Commit dengan pesan yang jelas.

## Urutan implementasi

Auth/RBAC → master karyawan/bidang/kantor → policy sesi → kalender →
absensi/GPS/foto → pengajuan/approval → kerja khusus/off pengganti →
resolver payroll → override/audit → dashboard per role →
history/export/closing → hardening/UAT.

Fitur hanya selesai jika requirement, validasi backend, otorisasi,
audit, responsive UI, test, dan dokumentasi sudah terpenuhi.

------------------------------------------------------------------------

# DOKUMEN: 01-PRD.md

# PRODUCT REQUIREMENTS DOCUMENT --- ABSENSI BIGNET

## 1. Ringkasan

Absensi BIGNET adalah aplikasi absensi responsive berbasis website untuk
Karyawan, Admin, dan Superadmin. Aplikasi mencatat absensi berbasis
sesi, aktivitas/standby, foto, lokasi, kalender kerja, pengajuan, serta
menghasilkan rekap bulanan HARI MASUK dan TIDAK HADIR sebagai data
pendukung penggajian.

## 2. Tujuan

-   Karyawan dapat absen dari browser HP, tablet, laptop, atau desktop
    tanpa memasang APK.
-   Karyawan mengetahui status dirinya dan siapa saja yang bekerja hari
    ini.
-   Admin dapat mengatur policy absensi yang berbeda per bidang maupun
    individu.
-   Sistem mendukung kalender kerja berbeda per kantor, hari raya, kerja
    khusus, dan off pengganti.
-   Sistem menghasilkan rekap bulanan yang akurat dan dapat diaudit.
-   Owner/CEO melalui Superadmin dapat mengawasi seluruh perubahan yang
    memengaruhi payroll.

## 3. Platform

Satu responsive web application. Browser meminta izin kamera dan lokasi.
Website tidak dapat menjamin anti-fake-GPS 100%; gunakan validasi
berlapis dan jangan mengklaim perlindungan mutlak. Tidak ada APK native
Android/iOS pada versi awal.

## 4. Role

-   Karyawan: absensi, workforce hari ini, history pribadi dengan foto,
    rekap, pengajuan.
-   Admin: operasional, master data, policy, kalender, approval,
    override, laporan, closing.
-   Superadmin: akun Owner/CEO untuk monitoring menyeluruh, audit,
    laporan dan bukti; bukan operator koreksi harian.

## 5. Fungsi inti

-   Login dan RBAC.
-   Master karyawan, bidang kerja, kantor/lokasi.
-   Policy sesi 2/3/4 dan minimum hadir bertingkat.
-   Absensi dengan server time, GPS/geofence, kamera, aktivitas/standby.
-   Kalender kerja per kantor dan tanggal khusus.
-   Hari libur perusahaan, kerja khusus, off pengganti.
-   Pengajuan cuti/off/izin/sakit dan approval.
-   Beranda workforce.
-   History visual dengan foto.
-   Rekap bulanan HARI MASUK/TIDAK HADIR.
-   Admin Override.
-   Audit trail append-only.
-   Export dan monthly closing.

## 6. Prinsip produk

1.  Hari libur bukan otomatis TIDAK HADIR.
2.  Hari libur/off yang menurut kebijakan dihitung masuk menambah HARI
    MASUK payroll.
3.  Jumlah sesi dan minimum hadir mengikuti policy paling spesifik.
4.  Admin dapat menentukan DIHITUNG MASUK atau TIDAK DIHITUNG MASUK
    untuk karyawan/tanggal tertentu.
5.  Override tidak mengubah record absensi asli.
6.  Superadmin dapat melihat seluruh perubahan dan jejaknya.
7.  Rekap utama selalu menampilkan HARI MASUK dan TIDAK HADIR paling
    atas.
8.  Karyawan dapat melihat siapa yang bekerja hari ini, tanpa data
    sensitif rekan.
9.  Backend menjadi sumber kebenaran.

## 7. Di luar ruang lingkup awal

-   APK Android/iOS native.
-   Transfer gaji dan integrasi bank.
-   Perhitungan nominal gaji, pajak, BPJS, tunjangan/potongan.
-   Status DINAS (tidak digunakan).

## 8. Perlu keputusan lanjutan

-   Apakah izin, sakit, cuti menambah HARI MASUK atau kategori terpisah.
-   Apakah foto wajib setiap sesi atau sesi tertentu.
-   Detail toleransi keterlambatan.
-   Kuota dan batas pengajuan off/cuti.
-   Lingkup penetapan kerja khusus.
-   Retensi foto dan audit.

------------------------------------------------------------------------

# DOKUMEN: 02-RBAC.md

# RBAC & AKUN

## Karyawan

-   Melihat status diri, workforce hari ini, history/foto sendiri, dan
    rekap bulanan sendiri.
-   Melakukan absensi sesuai policy.
-   Membuat, membaca, mengedit pengajuan PENDING, dan membatalkan
    pengajuan sesuai aturan.
-   Tidak dapat mengubah hasil absensi/payroll.

## Admin

-   Mengelola karyawan, bidang, kantor, lokasi, policy, sesi, kalender.
-   Melihat absensi/history seluruh karyawan.
-   Mengelola pengajuan, approval, kerja khusus, dan off pengganti.
-   Melakukan Admin Override hasil payroll harian.
-   Melihat/export laporan dan menutup periode.
-   Tidak boleh menghapus audit trail.

## Superadmin (Owner/CEO)

-   Monitoring semua karyawan, absensi, foto/bukti, pengajuan, policy,
    kalender, override, payroll summary, closing, dan audit.
-   Melihat actor, waktu, target, before/after, alasan.
-   Read-only untuk koreksi operasional harian.

## Otorisasi

RBAC harus divalidasi di backend. Karyawan tidak boleh melihat foto
absensi, koordinat GPS detail, alasan izin pribadi, atau data sensitif
rekan kerja. Admin hanya mengakses lingkup organisasi yang diberikan.

------------------------------------------------------------------------

# DOKUMEN: 03-ATURAN-ABSENSI.md

# ATURAN ABSENSI

## Session Engine

-   Admin dapat mengatur 2, 3, atau 4 sesi.
-   Nama, rentang waktu, aktif/nonaktif, toleransi, dan aturan aktivitas
    dapat diatur.
-   Waktu resmi selalu waktu server.
-   Sesi wajib dilakukan berurutan; tidak boleh melompati sesi
    sebelumnya.
-   Karyawan tetap boleh membuka Beranda, History, Pengajuan, Profil
    ketika sesi belum selesai; tampilkan pengingat untuk kembali ke
    Absensi.
-   Sesi terlewat tetap terlihat dan menyediakan alur keterangan sesuai
    aturan.

## Hierarki policy

Prioritas: policy khusus karyawan → policy bidang kerja → policy
default. Jumlah sesi dan minimum sesi hadir dapat berbeda pada setiap
tingkatan. Policy historis harus dapat ditelusuri agar perubahan policy
baru tidak mengubah perhitungan masa lalu.

## Resolver

Backend menentukan status harian berdasarkan policy, server time, record
sesi, bukti, kalender, kerja khusus, off pengganti, pengajuan approved,
dan Admin Override. Jika seluruh sesi wajib dilakukan dan valid, sistem
otomatis menetapkan HADIR. Minimum sesi untuk status hadir mengikuti
policy yang berlaku. Jika minimum tidak terpenuhi dan tidak ada
pengecualian sah, hasil akhir TIDAK HADIR setelah waktu evaluasi
selesai.

## GPS, kamera, bukti

-   Browser meminta izin lokasi dan kamera.
-   Simpan waktu server, koordinat, accuracy, sesi, foto, dan metadata
    perangkat/browser yang relevan.
-   Geofence divalidasi backend.
-   IP/jaringan hanya sinyal tambahan.
-   Foto disimpan private dengan akses terotorisasi.
-   Website tidak menjamin deteksi fake GPS 100%.

## Aktivitas/standby

Sesi 2 sampai sesi terakhir dapat meminta deskripsi aktivitas atau
status standby sesuai policy. Kebutuhan foto aktivitas/selfie mengikuti
konfigurasi; detail wajib foto per sesi perlu dikonfirmasi.

## Admin Override

Admin dapat menetapkan karyawan/tanggal sebagai DIHITUNG MASUK atau
TIDAK DIHITUNG MASUK apa pun hasil awalnya. Wajib alasan dan audit
before/after. Bukti absensi asli tidak diubah. Superadmin dapat melihat
semua override.

------------------------------------------------------------------------

# DOKUMEN: 04-KALENDER-KERJA-DAN-OFF.md

# KALENDER KERJA, HARI LIBUR, KERJA KHUSUS, OFF PENGGANTI

## Kalender kantor

-   Kalender berbeda per kantor.
-   Kantor A: Senin-Sabtu kerja, Minggu libur.
-   Kantor B: Senin-Minggu kerja; Minggu setengah hari dengan 2 sesi.
-   Hari lain mengikuti policy sesi yang berlaku.

## Hari raya

Perusahaan tidak otomatis libur pada semua tanggal merah. Admin
menentukan hari raya/tanggal yang menjadi libur perusahaan, lingkup
kantor/karyawan, dan apakah dihitung masuk payroll.

## Status hari

-   HARI KERJA
-   HARI LIBUR
-   KERJA KHUSUS
-   OFF PENGGANTI

Status pengajuan/ketidakhadiran: CUTI, OFF, IZIN, SAKIT, TIDAK HADIR.
Tidak ada status DINAS.

## Kerja khusus

Teknisi dapat ditetapkan bekerja pada Minggu/hari libur karena project.
Admin menetapkan karyawan/tim, tanggal, project/keterangan, policy sesi,
dan apakah pekerjaan tersebut berhak menghasilkan off pengganti.
Karyawan melihat banner KERJA KHUSUS dan tombol mulai absensi. Jika
memenuhi minimum sesi, status operasional HADIR.

## Off pengganti

-   Hak berasal dari kerja khusus pada hari off/libur yang ditetapkan
    berhak.
-   Karyawan mengajukan tanggal penggunaan; Admin menyetujui/menolak.
-   Satu hak hanya boleh dipakai satu kali.
-   Simpan tanggal kerja sumber, project, tanggal off, status approval,
    dan penggunaan.
-   Saat hari-H tampilkan banner OFF PENGGANTI; tidak meminta absensi.
-   Off pengganti sah dihitung masuk payroll sesuai kebijakan.

## Hari libur

Tampilkan notifikasi HARI LIBUR dan pesan tidak perlu absensi. Hari
libur tidak boleh otomatis dihitung tidak hadir. Kebijakan apakah libur
dihitung masuk payroll harus dapat dikonfigurasi.

------------------------------------------------------------------------

# DOKUMEN: 05-PENGAJUAN.md

# PENGAJUAN & APPROVAL

## Jenis

CUTI, OFF, OFF PENGGANTI, IZIN, SAKIT. Tidak ada DINAS.

## Karyawan

Dapat membuat, melihat, mengedit selama PENDING, membatalkan, dan
melihat alasan penolakan. Form berisi jenis, tanggal mulai/akhir,
alasan, catatan, dan lampiran bila dibutuhkan. Untuk OFF PENGGANTI,
pilih hak off tersedia yang belum digunakan.

## Admin

Dapat melihat/filter, approve/reject dengan alasan, mengoreksi sesuai
kewenangan, dan membuat pengajuan atas nama karyawan bila diperlukan.

## CRUD dan jejak

Pengajuan yang telah diproses tidak dihapus permanen. Gunakan CANCELLED
dengan alasan dan actor. Delete hanya untuk draft/data yang belum
berdampak sesuai kebijakan. Semua approval, rejection, edit, dan
pembatalan diaudit.

## Hari-H

Jika disetujui, Absensi/Beranda menampilkan status dan tanggal. Tidak
tampil tombol absen jika hari tersebut memang tidak wajib absen. Off
pengganti menampilkan tanggal kerja sumber. Jika karyawan tetap bekerja
pada tanggal cuti/off yang disetujui, Admin harus membatalkan/mengoreksi
status melalui alur tercatat; jangan ubah otomatis.

## Status

DRAFT, PENDING, APPROVED, REJECTED, CANCELLED, dan EXPIRED bila
pengajuan melewati tanggal tanpa digunakan/ditindaklanjuti.

------------------------------------------------------------------------

# DOKUMEN: 06-UI-UX.md

# UI/UX DESIGN SYSTEM

## Arah visual

Modern, profesional, dark navy + putih + aksen, gradient halus,
whitespace, radius medium, status badge jelas. Bahasa Indonesia.
Responsive; Karyawan mobile-first dan Admin juga mobile-friendly. Ikuti
pola Gudang BIGNET Clean untuk akun, tabel, dan timeline. Jangan ubah UI
yang telah disetujui tanpa instruksi.

## Navigasi Karyawan

Bottom nav: Absensi, Beranda, History, Pengajuan, Profil.

## Beranda Karyawan

Gabungan dashboard pribadi + social workforce: - status dan progres
absensi diri, - jumlah orang yang bekerja hari ini, - daftar nama,
bidang, status, progres sesi tiap karyawan, - filter kantor/bidang, -
update real-time jika tersedia. Jumlah sesi per orang harus dinamis
mengikuti policy masing-masing. Jangan tampilkan koordinat GPS detail,
foto absensi, alasan izin pribadi, atau data sensitif rekan.

## Halaman Absensi

-   Hari kerja: stepper sesi, lokasi, kamera, tombol absensi.
-   Hari libur: banner HARI LIBUR, tidak perlu absen.
-   Kerja khusus: nama project/keterangan dan tombol mulai absensi.
-   Off pengganti: banner, tanggal kerja yang digantikan, tidak perlu
    absen.
-   Cuti/izin/sakit approved: tampilkan status dan rentang tanggal.
    Stepper mendukung 2/3/4 sesi.

## History Karyawan

Pemilih bulan; HARI MASUK dan TIDAK HADIR di atas; detail kategori dan
kalender/timeline di bawah. Tanggal yang memiliki absensi menampilkan
foto/selfie, status, progres sesi, waktu server, aktivitas/standby,
serta lokasi sesuai hak akses. Hari libur/off tanpa absensi tidak
memerlukan foto.

## Pengajuan

Daftar status, tombol Buat Pengajuan, form, detail, edit/cancel sesuai
status, alasan penolakan.

## Admin

Dashboard, monitoring, tabel standar BIGNET
(search/filter/sort/pagination/numbering/selection jika
relevan/loading/empty/error/mobile), kalender, policy, approval, kerja
khusus/off, override, laporan, closing.

## Superadmin

Dashboard Owner/CEO, HARI MASUK/TIDAK HADIR, normal vs override, audit
timeline, detail before/after, foto/bukti, filter dan export. Read-only
operasional.

Status selalu memakai label teks, bukan warna saja.

------------------------------------------------------------------------

# DOKUMEN: 07-REKAP-PAYROLL.md

# REKAP KEHADIRAN UNTUK PAYROLL

## Output utama

Tujuan utama adalah menghitung per karyawan per bulan: - HARI MASUK: XX
hari - TIDAK HADIR: XX hari

Dua angka ini harus tampil paling atas dan mudah dibaca. Ini data
pendukung penggajian; bukan otomatis perhitungan nominal gaji.

## Detail di bawah angka utama

-   hari kerja,
-   hari libur,
-   kerja khusus,
-   off pengganti,
-   hadir melalui absensi,
-   hari dihitung masuk karena libur,
-   hari dihitung masuk karena off,
-   izin, sakit, cuti,
-   detail sesi/aktivitas,
-   timeline harian.

## Prinsip hitung

-   Jangan menghitung hanya record absensi.
-   Resolver menentukan hasil harian berdasarkan policy, kalender,
    absensi, approval, kerja khusus, off pengganti, dan override.
-   Libur yang menurut kebijakan dihitung masuk menambah HARI MASUK.
-   Off pengganti sah yang dibayar menambah HARI MASUK.
-   Hari kerja yang tidak memenuhi aturan dan tidak memiliki
    pengecualian sah menjadi TIDAK HADIR.
-   Admin Override menjadi hasil payroll final untuk tanggal tersebut.
-   Satu karyawan/tanggal hanya berkontribusi sekali.
-   Perlakuan payroll izin, sakit, cuti perlu keputusan eksplisit;
    jangan mengasumsikan.

## Konsistensi dan export

Karyawan melihat rekap sendiri; Admin/Superadmin melihat sesuai role.
Semua angka berasal dari resolver/summary backend yang sama. Export
mendukung Excel dan PNG/JPG; PDF dapat ditambahkan. Laporan awal masuk
dapat menampilkan nama, waktu sesi 1, dan indikator terlambat.

## Monthly closing

Admin dapat menutup periode setelah validasi. Simpan snapshot HARI
MASUK/TIDAK HADIR, jumlah override, dan anomali. Setelah closing,
perubahan melalui koreksi khusus yang diaudit. Superadmin dapat melihat
closing dan koreksi.

------------------------------------------------------------------------

# DOKUMEN: 08-AUDIT-DAN-KEAMANAN.md

# AUDIT & KEAMANAN

Superadmin adalah akun Owner/CEO. Semua aktivitas yang dapat memengaruhi
absensi/payroll wajib dapat ditelusuri.

## Wajib diaudit

Absensi/perubahan validasi; Admin Override;
approval/rejection/cancellation; perubahan kalender/hari libur; kerja
khusus; hak/penggunaan off pengganti; perubahan policy/jumlah/minimum
sesi/toleransi; perubahan bidang/kantor yang memengaruhi policy; export
sensitif; monthly closing dan koreksi setelah closing.

## Data audit

Actor/user, role, timestamp server, IP/user-agent bila tersedia,
modul/aksi, target entity, karyawan/tanggal terdampak, before snapshot,
after snapshot, alasan, request/correlation ID bila tersedia.

## Append-only

Admin tidak dapat menghapus atau mengedit audit. Koreksi menghasilkan
event baru yang merujuk event sebelumnya. Superadmin dapat membaca dan
mengekspor. Pertimbangkan pembatasan database/privilege untuk memperkuat
sifat append-only.

## Dashboard Superadmin

Tampilkan jumlah HARI MASUK/TIDAK HADIR, hasil normal vs override,
daftar perubahan Admin, filter
tanggal/aktor/karyawan/bidang/kantor/jenis, detail before/after dan
alasan, serta tautan bukti absensi.

## Keamanan

HTTPS, password hashing, validasi server-side, RBAC backend, rate limit,
CSRF/session security, private storage untuk foto, backup, dan larangan
secret di GitHub.

------------------------------------------------------------------------

# DOKUMEN: 09-ARSITEKTUR-TEKNOLOGI.md

# TECH STACK & ARSITEKTUR

## Rekomendasi stack

-   Next.js + TypeScript.
-   Tailwind CSS + shadcn/ui.
-   TanStack Query.
-   React Hook Form + Zod.
-   Laravel API + Sanctum.
-   PostgreSQL + PostGIS.
-   Redis untuk cache/queue.
-   Laravel Reverb + Echo untuk real-time.
-   S3-compatible storage/MinIO untuk foto.
-   Leaflet/MapLibre bila peta diperlukan.
-   Laravel Excel/PhpSpreadsheet untuk Excel.
-   Nginx, Docker, GitHub, pnpm.

Pilih versi dependency stabil dan kompatibel saat bootstrap; kunci versi
dan catat di dokumen.

## Arsitektur

Modular monolith Laravel, bukan microservices pada fase awal. Backend
sumber kebenaran. Modul: Auth/RBAC, Employee, Office/Location,
Attendance Policy, Session, Attendance, Activity, Work Calendar, Special
Work, Off Replacement, Request/Approval, Payroll Summary, Override,
Audit, Report/Export, Settings.

## Service inti

SessionPolicyResolver, AttendanceSessionService, GeofenceService,
AttendanceResolver, PayrollDayResolver, MonthlyAttendanceSummaryService,
OffReplacementService, AuditService, PayrollClosingService.

## API dan realtime

REST API `/api/v1`. Kelompok endpoint auth, employees, offices,
policies, sessions, attendance, calendars, special-work,
off-replacements, requests, monthly reports, payroll periods, audit
logs. Reverb/Echo untuk workforce status; gunakan private/presence
channel dan batasi payload sesuai role.

## Reliability

Transaksi database untuk absensi/approval/override/off use; unique
constraint employee/date/session; idempotency untuk retry; queue export;
scheduler rekap; validasi sesi tetap memeriksa server time pada request.

------------------------------------------------------------------------

# DOKUMEN: 10-MODEL-DATA.md

# MODEL DATA --- KONSEPTUAL

Ini rancangan entitas awal, bukan migration final. Finalisasi data
dictionary dan ERD sebelum implementasi.

## Entitas

pengguna, karyawan, peran, bidang_kerja, kantor, lokasi_absensi,
kebijakan_absensi, kebijakan_absensi_bidang, kebijakan_absensi_karyawan,
sesi_absensi, kalender_kerja, pola_hari_kerja, tanggal_khusus,
hari_libur, penugasan_kerja_khusus, absensi_harian, detail_absensi_sesi,
foto_absensi, aktivitas_absensi, pengajuan, persetujuan_pengajuan,
hak_off_pengganti, penggunaan_off_pengganti, override_kehadiran,
ringkasan_kehadiran_bulanan, periode_payroll, audit_log, export_log,
pengaturan_aplikasi.

## Relasi pokok

-   Pengguna terhubung ke karyawan.
-   Karyawan terhubung ke bidang dan kantor.
-   Policy default/bidang/individu memiliki sesi.
-   Kalender dimiliki kantor dan dapat memiliki override tanggal.
-   Absensi harian memiliki detail sesi, foto, aktivitas.
-   Pengajuan dimiliki karyawan dan diproses Admin.
-   Kerja khusus dapat menghasilkan hak off.
-   Hak off hanya dapat digunakan sekali.
-   Override terhubung ke karyawan/tanggal/hasil payroll.
-   Audit mencatat perubahan.
-   Periode payroll memiliki snapshot bulanan.

## Constraint

-   Unik karyawan/tanggal/sesi untuk mencegah absensi ganda.
-   Hak off tidak boleh digunakan dua kali.
-   Satu karyawan/tanggal memiliki satu hasil payroll final aktif;
    perubahan dibuat sebagai versi/event baru.
-   Periode closed hanya dapat dikoreksi melalui alur khusus.
-   Index untuk employee, office, date, status, policy, request, audit
    actor, payroll period.
-   File foto di object storage; DB menyimpan path, checksum/metadata,
    pemilik, sesi, timestamp.
-   Snapshot policy yang berlaku pada tanggal lampau harus dapat
    direkonstruksi.

## Perlu dirinci

Setiap tabel harus memiliki tujuan, kolom/tipe, nullable/default, PK/FK,
unique/index, enum/status, relasi, retensi, contoh data. Tetapkan
penamaan Bahasa Indonesia konsisten di DB/API/frontend.

------------------------------------------------------------------------

# DOKUMEN: 11-ACCEPTANCE-CHECKLIST.md

# ACCEPTANCE CHECKLIST

## Platform/RBAC

-   [ ] Karyawan dapat login via browser HP/laptop tanpa APK.
-   [ ] Menu tiap role sesuai izin.
-   [ ] Semua halaman responsive.

## Policy/sesi

-   [ ] 2/3/4 sesi dapat dikonfigurasi.
-   [ ] Policy default → bidang → individu berjalan benar.
-   [ ] Jumlah sesi dan minimum hadir dapat berbeda.
-   [ ] Server time otoritatif.
-   [ ] Sesi berurutan dan reminder tampil.

## Absensi

-   [ ] Foto, waktu server, sesi, lokasi, accuracy tersimpan.
-   [ ] Geofence divalidasi backend.
-   [ ] Aktivitas/standby mengikuti policy.
-   [ ] Foto hanya terlihat oleh pihak berwenang.

## Workforce

-   [ ] Beranda menampilkan siapa bekerja hari ini.
-   [ ] Progres sesi dinamis per orang.
-   [ ] Status real-time bila Reverb aktif.
-   [ ] Informasi sensitif rekan tidak bocor.

## Kalender/off

-   [ ] Kantor A Senin-Sabtu kerja, Minggu libur.
-   [ ] Kantor B Senin-Minggu, Minggu 2 sesi.
-   [ ] Admin menentukan hari raya/libur.
-   [ ] Libur tidak otomatis TIDAK HADIR.
-   [ ] Kerja khusus dapat dibuat.
-   [ ] Hak off terkait kerja khusus dan hanya sekali pakai.
-   [ ] Off hari-H tampil jelas dan tidak meminta absensi.

## Pengajuan

-   [ ] Create/read/update pending/cancel berjalan.
-   [ ] Admin approve/reject dengan alasan.
-   [ ] Hari-H menampilkan status approved.
-   [ ] Perubahan/pembatalan diaudit.

## Payroll/audit

-   [ ] HARI MASUK dan TIDAK HADIR tampil paling atas.
-   [ ] Detail bulanan di bawah.
-   [ ] Libur/off sesuai konfigurasi payroll dihitung masuk.
-   [ ] Admin dapat override masuk/tidak masuk.
-   [ ] Override tidak mengubah bukti asli.
-   [ ] Monthly closing menyimpan snapshot.
-   [ ] Superadmin melihat semua perubahan dan before/after.
-   [ ] Audit tidak dapat dihapus Admin.

## UI

-   [ ] Tabel standar BIGNET.
-   [ ] Search/filter/sort/pagination.
-   [ ] Loading/empty/error/mobile state.
-   [ ] Status tidak hanya dibedakan dengan warna.

------------------------------------------------------------------------

# DOKUMEN: PROJECT-STATUS.md

# PROJECT STATUS --- ABSENSI BIGNET

Tahap: konsolidasi requirement dan dokumentasi. Status implementasi kode
belum dinilai.

## Keputusan utama

-   Web responsive saja pada versi awal.
-   Role Karyawan, Admin, Superadmin (Owner/CEO).
-   Policy sesi 2/3/4; hierarki default → bidang → individu.
-   Kalender per kantor: Kantor A Senin-Sabtu, Kantor B Senin-Minggu
    dengan Minggu 2 sesi.
-   Hari raya ditentukan Admin.
-   Kerja khusus dan off pengganti.
-   Pengajuan cuti/off/izin/sakit.
-   Output payroll utama HARI MASUK dan TIDAK HADIR.
-   Admin Override hasil payroll harian.
-   Superadmin memonitor audit menyeluruh.
-   History Karyawan menyertakan foto absensi.
-   Beranda Karyawan menampilkan workforce hari ini.

## Langkah berikutnya

1.  Review requirement.
2.  Putuskan poin bertanda perlu keputusan.
3.  Finalisasi ERD/data dictionary.
4.  Buat wireframe seluruh role dan kondisi mobile.
5.  Baru implementasi bertahap.

## Belum diputuskan

Perlakuan payroll izin/sakit/cuti; kewajiban foto per sesi; toleransi
terlambat; kuota off/cuti; retensi data; lingkup kerja khusus dan
prioritas konflik kalender.

------------------------------------------------------------------------

# DOKUMEN: CHANGELOG.md

# CHANGELOG

## 2026-11-16 --- Konsolidasi requirement

-   Platform versi awal responsive website, tanpa APK native.
-   Policy sesi dinamis dan hierarki default/bidang/individu.
-   Kalender per kantor, hari raya, kerja khusus, off pengganti.
-   Pengajuan dan approval Admin.
-   Output payroll utama HARI MASUK/TIDAK HADIR.
-   Admin Override hasil payroll harian.
-   Superadmin Owner/CEO dengan monitoring audit.
-   History visual dengan foto.
-   Beranda workforce Karyawan.
