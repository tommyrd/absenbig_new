# Pengujian Otomatis & Panduan UAT — Absensi BIGNET

---

## 1. Hasil Pengujian Otomatis Terverifikasi (`npm test`)

Seluruh pengujian dijalankan menggunakan `tsx --test tests/*.test.ts` dengan hasil aktual **17/17 Lulus (0 gagal)**:

### A. Suite Inti Bisnis (`tests/core.test.ts` — 9 Test)
1. **Geofence Haversine distance calculation** — Akurasi perhitungan jarak meter antara koordinat GPS karyawan dan kantor.
2. **Policy Hierarchy resolves `KARYAWAN > BIDANG > DEFAULT`** — Prioritas kebijakan sesi (2, 3, atau 4 sesi) berjalan akurat.
3. **Kantor A Sunday is `HARI_LIBUR`, Kantor B Sunday is 2 sessions** — Kalender kantor yang berbeda tidak menyebabkan salah hitung `TIDAK_HADIR`.
4. **Workforce feed strips sensitive data** — Data GPS mentah, path foto internal, dan alasan pengajuan pribadi tidak bocor ke endpoint workforce.
5. **Monthly summary totals `HARI MASUK` and `TIDAK HADIR` consistently** — Sinkronisasi hasil kalkulasi bulanan.
6. **Audit log strictly append-only via SQLite triggers** — Trigger SQLite memblokir `UPDATE` dan `DELETE` pada tabel `audit_log`.
7. **System settings default initialization** — Pengaturan branding dan login terinisialisasi konsisten.
8. **Registration table and profile photo columns** — Kolom profil dan tabel `pendaftaran_akun` tersedia.
9. **System settings RBAC & Feed access across all roles** — Endpoint settings terproteksi khusus `SUPERADMIN`, Beranda Feed & foto dapat diakses lintas role, validasi sumber kamera & jam mulai sesi berjalan.

### B. Suite Hardening Production (`tests/production.test.ts` — 8 Test)
Berjalan terisolasi penuh pada direktori temporer (tanpa menyentuh data aktif):
1. **Idempotent migrations & clean production seeding** — 3 versi migrasi aman dijalankan ulang; `seedProductionBaseline` membuat hanya 1 Superadmin awal dengan `izin_demo_login = 0` dan kata sandi ter-hash `scrypt`.
2. **Health check & HttpOnly cookie login** — `/api/v1/health` (200 OK WIB), sandi salah ditolak (401), login benar menerbitkan cookie `HttpOnly; SameSite=Lax`.
3. **Brute-force rate limiting** — Percobaan gagal ke-9 pada login memicu HTTP `429` dengan header `Retry-After`.
4. **Account lifecycle & Registration ACC workflow** — Pembuatan akun karyawan/admin mewajibkan sandi >= 6 karakter, avatar dengan magic bytes palsu ditolak (`400`), akun `PENDING` & `REJECTED` diblokir saat login (`403`), dan `ACC` oleh Superadmin langsung mengaktifkan login.
5. **RBAC isolation, query-token guard & token revocation** — `?token=` ditolak pada `/api/v1/auth/me` (`401`), diizinkan pada `/api/v1/avatars/*`; Karyawan & Admin ditolak (`403`) pada endpoint Superadmin; token kedaluwarsa ditolak; ganti kata sandi & logout langsung merevoke token lama; penonaktifan akun memutus sesi aktif.
6. **SVG XSS protection, browser-camera-only, `jam_mulai` gate & strict geofence** — SVG mengandung `<script>` ditolak (`400`); logo SVG bersih disajikan dengan `X-Content-Type-Options: nosniff` + CSP; absensi sebelum `jam_mulai` ditolak (`400`); `FILE_UPLOAD` ditolak (`400`); kantor `TOLAK_LUAR_RADIUS` menolak GPS di luar radius atau kosong; PNG kamera valid tersimpan dengan SHA-256 checksum.
7. **Special work, Off Pengganti, Payroll closing & post-closing override** — Kuota off pengganti terkunci saat pengajuan dan berstatus `DIPAKAI` setelah approval Admin; override pada bulan `CLOSED` membutuhkan flag `koreksiSetelahClosing` (`409` vs `201`) dan tercatat pada modul `CLOSING_KOREKSI`.
8. **Disaster recovery Backup & Restore end-to-end** — `runBackup()` membuat snapshot database + foto + `manifest.json` + `.tar.gz`; setelah simulasi kehilangan DB & folder `photos/`, `runRestore()` memulihkan DB & seluruh tautan foto (`missingPhotosCount === 0`); modifikasi 1 byte pada arsip backup langsung terdeteksi dan membatalkan restore sebelum menyentuh data aktif.

---

## 2. Pengujian Build, Typecheck & Live Server Production

| Verifikasi | Perintah | Hasil |
|---|---|---|
| TypeScript Check | `npm run lint` (`tsc --noEmit`) | Lulus (0 error) |
| Frontend Bundle | `npm run build` (`vite build`) | Lulus (`dist/` bersih tanpa warning) |
| Production Server Boot | `NODE_ENV=production node server.ts` | Lulus (`/api/v1/health` 200 OK WIB, `/` 200 HTML, `izin_demo_login=0`, security headers aktif) |

---

## 3. Skenario UAT Manual Sebelum Go-Live

1. **UAT Pendaftaran & ACC (HP Browser + Desktop Superadmin):**
   - Karyawan & Admin mendaftar via halaman login (unggah foto profil PNG/JPG).
   - Verifikasi login gagal sebelum di-ACC, lalu Superadmin melakukan ACC dan akun berhasil login.
2. **UAT Absensi Kamera Browser & Beranda Feed (iOS Safari / Android Chrome HTTPS):**
   - Uji akses kamera depan/belakang browser, pastikan izin GPS aktif.
   - Uji sebelum `jam_mulai` (tombol/submit ditolak), lalu setelah `jam_mulai` berhasil absen dan posting muncul real-time di Beranda Feed akun lain.
3. **UAT Dark Mode & Mobile Responsive:**
   - Cek navigasi tab bawah mobile dan toggle dark/light mode di seluruh peran (`KARYAWAN`, `ADMIN`, `SUPERADMIN`).
4. **UAT Payroll, Export Excel & Audit Log:**
   - Lakukan pengajuan cuti/off pengganti -> approve Admin -> cek rekap bulanan -> unduh Excel -> pastikan riwayat tercatat pada Audit Log.
