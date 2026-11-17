# Prosedur Backup & Restore — Absensi BIGNET

---

## 1. Apa Saja yang Di-backup?

Script backup (`scripts/backup/backup.ts` & `scripts/backup/backup.sh`) membuat satu paket snapshot konsisten berisi:
1. **`bignet_absensi.db`**: Snapshot database SQLite konsisten saat server tetap hidup (hot backup via `VACUUM INTO`) dan langsung diuji `PRAGMA integrity_check`.
2. **`photos/`**: Seluruh foto selfie & bukti sesi absensi.
3. **`avatars/`**: Seluruh foto profil karyawan & pendaftaran akun.
4. **`assets/`**: Logo kustom aplikasi perusahaan.
5. **`manifest.json` & `checksums.sha256`**: Metadata jumlah baris tabel inti, jumlah media, serta hash SHA-256 setiap file.
6. **Arsip `.tar.gz`**: Arsip terkompresi siap unduh / salin ke storage off-site.

> **Keamanan:** File `.env` dan `.auth_secret` tidak disalin otomatis ke folder backup media publik. Simpan salinan terenkripsi `.env` di pengelola rahasia internal perusahaan.

---

## 2. Cara Menjalankan Backup

### Manual (CLI)
```bash
npm run backup
# Atau tanpa kompresi tar.gz (lebih cepat untuk cek cepat):
npm run backup -- --no-tar
```

### Otomatis Harian via Cron
```cron
30 1 * * * cd /var/www/absensi-bignet && /bin/bash scripts/backup/backup.sh >> /var/www/absensi-bignet/logs/backup.log 2>&1
```

Script otomatis menghapus backup lama di `BACKUP_DIR` yang melebihi `BACKUP_RETENTION_DAYS` (default 30 hari).

---

## 3. Cara Menjalankan Restore

> **Penting:** Hentikan proses aplikasi terlebih dahulu sebelum menjalankan restore agar tidak ada transaksi aktif saat file database diganti.

```bash
# 1. Hentikan server
pm2 stop absensi-bignet   # atau: sudo systemctl stop absensi-bignet

# 2. Jalankan restore dari folder backup atau file .tar.gz
npm run restore -- --from /var/lib/absensi-bignet/backups/bignet_backup_2026-11-17T01-30-00_a1b2.tar.gz

# Untuk otomasi non-interaktif (lewatkan prompt konfirmasi):
npm run restore -- --from /var/lib/absensi-bignet/backups/bignet_backup_...tar.gz --yes

# 3. Nyalakan server kembali & cek health
pm2 start absensi-bignet --env production
curl -fsS http://127.0.0.1:3000/api/v1/health
```

---

## 4. Mekanisme Perlindungan Data saat Restore

Sebelum menimpa database aktif, `scripts/restore/restore.ts` menjalankan 5 tahap pengaman:
1. Mengekstrak `.tar.gz` (jika sumber berbentuk arsip) ke direktori sementara yang bersih.
2. Memverifikasi keberadaan `manifest.json` dan **mencocokkan SHA-256 seluruh file** (`db` dan seluruh foto/avatar/aset). Jika ada 1 byte saja yang rusak/dimodifikasi, restore langsung dibatalkan sebelum menyentuh data aktif.
3. Menjalankan `PRAGMA integrity_check` pada snapshot database backup.
4. Membuat **safety snapshot** database live saat ini ke `BACKUP_DIR/pre_restore_safety/` sebelum menimpa database.
5. Menghapus file `-wal`/`-shm` usang, menyalin DB & seluruh folder media, menjalankan `runMigrations()`, lalu **memverifikasi kecocokan seluruh `absensi_sesi.foto_path` terhadap file fisik di `photos/`**.
