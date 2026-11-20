import type { DatabaseSync } from 'node:sqlite';
import { getWibIsoString } from '../time.ts';
import { SCHEMA_SQL } from './schema.ts';

export interface MigrationRecord {
  version: string;
  name: string;
  applied_at: string;
}

interface MigrationDef {
  version: string;
  name: string;
  disableForeignKeys?: boolean;
  up: (db: DatabaseSync) => void;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

const MIGRATIONS: MigrationDef[] = [
  {
    version: '001',
    name: 'initial_schema_and_audit_triggers',
    up: (db) => {
      db.exec(SCHEMA_SQL);
      db.prepare(`INSERT OR IGNORE INTO pengaturan_aplikasi (id, updated_at) VALUES (1, ?)`).run(
        getWibIsoString()
      );
    },
  },
  {
    version: '002',
    name: 'profile_photos_and_login_branding_columns',
    up: (db) => {
      if (!hasColumn(db, 'karyawan', 'foto_profil_path')) {
        db.exec(`ALTER TABLE karyawan ADD COLUMN foto_profil_path TEXT;`);
      }
      if (!hasColumn(db, 'karyawan', 'foto_profil_updated_at')) {
        db.exec(`ALTER TABLE karyawan ADD COLUMN foto_profil_updated_at TEXT;`);
      }
      if (!hasColumn(db, 'pengaturan_aplikasi', 'judul_form_login')) {
        db.exec(
          `ALTER TABLE pengaturan_aplikasi ADD COLUMN judul_form_login TEXT NOT NULL DEFAULT 'Masuk ke Akun Anda';`
        );
      }
      if (!hasColumn(db, 'pengaturan_aplikasi', 'pengumuman_login')) {
        db.exec(
          `ALTER TABLE pengaturan_aplikasi ADD COLUMN pengumuman_login TEXT NOT NULL DEFAULT '';`
        );
      }
    },
  },
  {
    version: '003',
    name: 'token_version_revocation_and_query_indexes',
    up: (db) => {
      if (!hasColumn(db, 'pengguna', 'token_version')) {
        db.exec(`ALTER TABLE pengguna ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;`);
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS revoked_tokens (
          jti TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          revoked_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi_sesi(tanggal, waktu_server DESC);
        CREATE INDEX IF NOT EXISTS idx_pengajuan_dates ON pengajuan(karyawan_id, status, tanggal_mulai, tanggal_akhir);
        CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at);
      `);
    },
  },
  {
    version: '004',
    name: 'require_strict_geofence_for_all_offices',
    up: (db) => {
      // Existing offices must follow the strict attendance radius policy.
      db.exec(`UPDATE kantor SET geofence_mode = 'TOLAK_LUAR_RADIUS'`);
    },
  },
  {
    version: '005',
    name: 'configurable_office_requirement_per_attendance_policy',
    up: (db) => {
      if (!hasColumn(db, 'kebijakan_absensi', 'aturan_lokasi')) {
        db.exec(
          `ALTER TABLE kebijakan_absensi ADD COLUMN aturan_lokasi TEXT NOT NULL DEFAULT 'SESI_PERTAMA_KANTOR';`
        );
      }
    },
  },
  {
    version: '006',
    name: 'persist_actual_attendance_location_address',
    up: (db) => {
      if (!hasColumn(db, 'absensi_sesi', 'lokasi_alamat')) {
        db.exec(`ALTER TABLE absensi_sesi ADD COLUMN lokasi_alamat TEXT;`);
      }
    },
  },
  {
    version: '007',
    name: 'cache_legacy_attendance_location_addresses',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS absensi_lokasi_cache (
          absensi_sesi_id INTEGER PRIMARY KEY REFERENCES absensi_sesi(id) ON DELETE CASCADE,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          alamat TEXT,
          provider TEXT NOT NULL DEFAULT 'GEOAPIFY',
          resolved_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_absensi_lokasi_cache_resolved
          ON absensi_lokasi_cache(resolved_at);
      `);
    },
  },
  {
    version: '008',
    name: 'admin_one_time_expired_attendance_checkin_access',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS override_akses_absensi (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
          tanggal TEXT NOT NULL,
          urutan_sesi INTEGER NOT NULL CHECK(urutan_sesi BETWEEN 1 AND 4),
          nama_sesi TEXT NOT NULL,
          alasan TEXT NOT NULL,
          admin_id INTEGER NOT NULL REFERENCES pengguna(id),
          status TEXT NOT NULL DEFAULT 'AKTIF' CHECK(status IN ('AKTIF','DIGUNAKAN','KEDALUWARSA','DICABUT')),
          berlaku_sampai TEXT NOT NULL,
          used_at TEXT,
          used_session_id INTEGER REFERENCES absensi_sesi(id),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_override_akses_emp_date
          ON override_akses_absensi(karyawan_id, tanggal, urutan_sesi, status, berlaku_sampai);
      `);
    },
  },
  {
    version: '009',
    name: 'custom_website_favicon_settings',
    up: (db) => {
      if (!hasColumn(db, 'pengaturan_aplikasi', 'favicon_path')) {
        db.exec(`ALTER TABLE pengaturan_aplikasi ADD COLUMN favicon_path TEXT;`);
      }
      if (!hasColumn(db, 'pengaturan_aplikasi', 'favicon_updated_at')) {
        db.exec(`ALTER TABLE pengaturan_aplikasi ADD COLUMN favicon_updated_at TEXT;`);
      }
    },
  },
  {
    version: '010',
    name: 'separate_superadmin_accounts_from_employee_records',
    disableForeignKeys: true,
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(pengguna)').all() as {
        name: string;
        notnull: number;
      }[];
      const employeeLink = columns.find((column) => column.name === 'karyawan_id');
      const alreadyDecoupled =
        employeeLink?.notnull === 0 &&
        hasColumn(db, 'pengguna', 'nama_tampilan') &&
        hasColumn(db, 'pengguna', 'no_hp');

      if (!alreadyDecoupled) {
        db.exec(`
          CREATE TABLE pengguna_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('KARYAWAN','ADMIN','SUPERADMIN')),
            karyawan_id INTEGER REFERENCES karyawan(id),
            nama_tampilan TEXT NOT NULL DEFAULT '',
            no_hp TEXT NOT NULL DEFAULT '',
            aktif INTEGER NOT NULL DEFAULT 1,
            token_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
          );

          INSERT INTO pengguna_new (
            id, username, email, password_hash, role, karyawan_id,
            nama_tampilan, no_hp, aktif, token_version, created_at
          )
          SELECT
            u.id, u.username, u.email, u.password_hash, u.role,
            CASE WHEN u.role = 'SUPERADMIN' THEN NULL ELSE u.karyawan_id END,
            CASE WHEN u.role = 'SUPERADMIN'
              THEN COALESCE(NULLIF(k.nama_lengkap, ''), 'Superadmin')
              ELSE '' END,
            CASE WHEN u.role = 'SUPERADMIN' THEN COALESCE(k.no_hp, '') ELSE '' END,
            u.aktif, COALESCE(u.token_version, 1), u.created_at
          FROM pengguna u
          LEFT JOIN karyawan k ON k.id = u.karyawan_id;

          UPDATE karyawan
          SET aktif = 0, jabatan = 'Akun Pemilik Sistem (Arsip)'
          WHERE id IN (
            SELECT karyawan_id FROM pengguna
            WHERE role = 'SUPERADMIN' AND karyawan_id IS NOT NULL
          );

          DROP TABLE pengguna;
          ALTER TABLE pengguna_new RENAME TO pengguna;
        `);
      } else {
        db.exec(`
          UPDATE pengguna
          SET nama_tampilan = COALESCE(
                NULLIF(nama_tampilan, ''),
                (SELECT nama_lengkap FROM karyawan WHERE karyawan.id = pengguna.karyawan_id),
                'Superadmin'
              ),
              no_hp = COALESCE(
                (SELECT no_hp FROM karyawan WHERE karyawan.id = pengguna.karyawan_id),
                no_hp,
                ''
              )
          WHERE role = 'SUPERADMIN';

          UPDATE karyawan
          SET aktif = 0, jabatan = 'Akun Pemilik Sistem (Arsip)'
          WHERE id IN (
            SELECT karyawan_id FROM pengguna
            WHERE role = 'SUPERADMIN' AND karyawan_id IS NOT NULL
          );

          UPDATE pengguna SET karyawan_id = NULL WHERE role = 'SUPERADMIN';
        `);
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error('Migrasi pemisahan akun Superadmin menghasilkan pelanggaran foreign key.');
      }
    },
  },
  {
    version: '011',
    name: 'exclude_legacy_superadmin_profiles_from_employee_master',
    up: (db) => {
      if (!hasColumn(db, 'karyawan', 'is_system_archive')) {
        db.exec(`ALTER TABLE karyawan ADD COLUMN is_system_archive INTEGER NOT NULL DEFAULT 0 CHECK(is_system_archive IN (0, 1));`);
      }
      // Catch existing installations where migration 010 was applied before this marker existed.
      db.prepare(
        `UPDATE karyawan
         SET is_system_archive = 1,
             aktif = 0,
             jabatan = 'Akun Pemilik Sistem (Arsip)'
         WHERE (
           (aktif = 0 AND lower(trim(jabatan)) IN ('superadmin / owner', 'owner / ceo', 'akun pemilik sistem (arsip)'))
           OR id IN (
             SELECT k.id
             FROM karyawan k
             JOIN pengguna u ON lower(u.email) = lower(k.email)
             WHERE u.role = 'SUPERADMIN' AND u.karyawan_id IS NULL
           )
         )`
      ).run();
    },
  },
  {
    version: '012',
    name: 'enforce_role_employee_link_invariant',
    up: (db) => {
      const invalid = db.prepare(
        `SELECT id, role FROM pengguna
         WHERE (role = 'SUPERADMIN' AND karyawan_id IS NOT NULL)
            OR (role <> 'SUPERADMIN' AND karyawan_id IS NULL)`
      ).all() as { id: number; role: string }[];
      if (invalid.length > 0) {
        throw new Error('Ada akun dengan relasi pegawai yang tidak sesuai role; periksa data pengguna sebelum migrasi 012.');
      }

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_pengguna_role_link_insert
        BEFORE INSERT ON pengguna
        FOR EACH ROW
        WHEN (NEW.role = 'SUPERADMIN' AND NEW.karyawan_id IS NOT NULL)
          OR (NEW.role <> 'SUPERADMIN' AND NEW.karyawan_id IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'SUPERADMIN harus tanpa profil karyawan; ADMIN/KARYAWAN wajib terhubung ke karyawan.');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_pengguna_role_link_update
        BEFORE UPDATE OF role, karyawan_id ON pengguna
        FOR EACH ROW
        WHEN (NEW.role = 'SUPERADMIN' AND NEW.karyawan_id IS NOT NULL)
          OR (NEW.role <> 'SUPERADMIN' AND NEW.karyawan_id IS NULL)
        BEGIN
          SELECT RAISE(ABORT, 'SUPERADMIN harus tanpa profil karyawan; ADMIN/KARYAWAN wajib terhubung ke karyawan.');
        END;
      `);
    },
  },
  {
    version: '013',
    name: 'standalone_superadmin_profile_photos',
    up: (db) => {
      if (!hasColumn(db, 'pengguna', 'foto_profil_path')) {
        db.exec(`ALTER TABLE pengguna ADD COLUMN foto_profil_path TEXT;`);
      }
      if (!hasColumn(db, 'pengguna', 'foto_profil_updated_at')) {
        db.exec(`ALTER TABLE pengguna ADD COLUMN foto_profil_updated_at TEXT;`);
      }
    },
  },
  {
    version: '014',
    name: 'allow_single_session_attendance_policies',
    disableForeignKeys: true,
    up: (db) => {
      const policyTable = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'kebijakan_absensi'`)
        .get() as { sql?: string } | undefined;
      if (policyTable?.sql && !/IN\s*\(\s*1\s*,/i.test(policyTable.sql)) {
        db.exec(`
          CREATE TABLE kebijakan_absensi_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL CHECK(level IN ('DEFAULT','BIDANG','KARYAWAN')),
            bidang_id INTEGER REFERENCES bidang_kerja(id),
            karyawan_id INTEGER REFERENCES karyawan(id),
            nama TEXT NOT NULL,
            jumlah_sesi INTEGER NOT NULL CHECK(jumlah_sesi IN (1,2,3,4)),
            min_sesi_hadir INTEGER NOT NULL,
            toleransi_terlambat_menit INTEGER NOT NULL DEFAULT 15,
            aturan_lokasi TEXT NOT NULL DEFAULT 'SESI_PERTAMA_KANTOR',
            wajib_foto_semua_sesi INTEGER NOT NULL DEFAULT 1,
            wajib_aktivitas_sesi_lanjut INTEGER NOT NULL DEFAULT 1,
            libur_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
            off_pengganti_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
            izin_dihitung_masuk INTEGER NOT NULL DEFAULT 0,
            sakit_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
            cuti_dihitung_masuk INTEGER NOT NULL DEFAULT 1,
            berlaku_mulai TEXT NOT NULL,
            aktif INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
          );

          INSERT INTO kebijakan_absensi_new (
            id, level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
            toleransi_terlambat_menit, aturan_lokasi, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
            libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
            sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
          )
          SELECT
            id, level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
            toleransi_terlambat_menit, COALESCE(aturan_lokasi, 'SESI_PERTAMA_KANTOR'),
            wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
            libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
            sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
          FROM kebijakan_absensi;

          DROP TABLE kebijakan_absensi;
          ALTER TABLE kebijakan_absensi_new RENAME TO kebijakan_absensi;
        `);
      }

      const kkTable = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'penugasan_kerja_khusus'`)
        .get() as { sql?: string } | undefined;
      if (kkTable?.sql && !/IN\s*\(\s*1\s*,/i.test(kkTable.sql)) {
        db.exec(`
          CREATE TABLE penugasan_kerja_khusus_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
            tanggal TEXT NOT NULL,
            nama_project TEXT NOT NULL,
            keterangan TEXT NOT NULL DEFAULT '',
            jumlah_sesi INTEGER NOT NULL CHECK(jumlah_sesi IN (1,2,3,4)),
            min_sesi_hadir INTEGER NOT NULL,
            berhak_off_pengganti INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'AKTIF' CHECK(status IN ('AKTIF','SELESAI','DIBATALKAN')),
            created_by INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(karyawan_id, tanggal)
          );

          INSERT INTO penugasan_kerja_khusus_new (
            id, karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir,
            berhak_off_pengganti, status, created_by, created_at
          )
          SELECT
            id, karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir,
            berhak_off_pengganti, status, created_by, created_at
          FROM penugasan_kerja_khusus;

          DROP TABLE penugasan_kerja_khusus;
          ALTER TABLE penugasan_kerja_khusus_new RENAME TO penugasan_kerja_khusus;
        `);
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error('Migrasi dukungan kebijakan 1 sesi menghasilkan pelanggaran foreign key.');
      }
    },
  },
  {
    version: '015',
    name: 'support_holiday_emergency_work_requests',
    disableForeignKeys: true,
    up(db) {
      const pengajuanTable = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pengajuan'`)
        .get() as { sql?: string } | undefined;

      if (pengajuanTable?.sql && !/KERJA_HARI_LIBUR/i.test(pengajuanTable.sql)) {
        db.exec(`
          CREATE TABLE pengajuan_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            karyawan_id INTEGER NOT NULL REFERENCES karyawan(id),
            jenis TEXT NOT NULL CHECK(jenis IN ('CUTI','OFF','OFF_PENGGANTI','IZIN','SAKIT','KERJA_HARI_LIBUR')),
            tanggal_mulai TEXT NOT NULL,
            tanggal_akhir TEXT NOT NULL,
            alasan TEXT NOT NULL,
            catatan TEXT NOT NULL DEFAULT '',
            lampiran_nama TEXT,
            hak_off_id INTEGER REFERENCES hak_off_pengganti(id),
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
            diproses_oleh INTEGER REFERENCES pengguna(id),
            diproses_pada TEXT,
            alasan_keputusan TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          INSERT INTO pengajuan_new (
            id, karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan,
            lampiran_nama, hak_off_id, status, diproses_oleh, diproses_pada,
            alasan_keputusan, created_at, updated_at
          )
          SELECT
            id, karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan,
            lampiran_nama, hak_off_id, status, diproses_oleh, diproses_pada,
            alasan_keputusan, created_at, updated_at
          FROM pengajuan;

          DROP TABLE pengajuan;
          ALTER TABLE pengajuan_new RENAME TO pengajuan;
          CREATE INDEX IF NOT EXISTS idx_pengajuan_karyawan ON pengajuan(karyawan_id, status);
        `);
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error('Migrasi dukungan kerja hari libur darurat menghasilkan pelanggaran foreign key.');
      }
    },
  },
  {
    version: '016',
    name: 'employee_specific_holidays',
    up(db) {
      if (!hasColumn(db, 'hari_libur', 'target_scope')) {
        db.exec(
          `ALTER TABLE hari_libur ADD COLUMN target_scope TEXT NOT NULL DEFAULT 'ALL' CHECK(target_scope IN ('ALL','KANTOR','KARYAWAN'));`
        );
        db.exec(
          `UPDATE hari_libur SET target_scope = CASE WHEN kantor_id IS NOT NULL THEN 'KANTOR' ELSE 'ALL' END;`
        );
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS hari_libur_karyawan (
          hari_libur_id INTEGER NOT NULL REFERENCES hari_libur(id) ON DELETE CASCADE,
          karyawan_id INTEGER NOT NULL REFERENCES karyawan(id) ON DELETE CASCADE,
          PRIMARY KEY (hari_libur_id, karyawan_id)
        );
        CREATE INDEX IF NOT EXISTS idx_hari_libur_karyawan_emp ON hari_libur_karyawan(karyawan_id);
      `);
    },
  },
];

export function runMigrations(db: DatabaseSync): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const existing = db
    .prepare(`SELECT version FROM schema_migrations`)
    .all() as { version: string }[];
  const appliedSet = new Set(existing.map((r) => r.version));

  const newlyApplied: string[] = [];
  for (const mig of MIGRATIONS) {
    if (appliedSet.has(mig.version)) continue;
    if (mig.disableForeignKeys) {
      db.exec('PRAGMA foreign_keys = OFF');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      mig.up(db);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`
      ).run(mig.version, mig.name, getWibIsoString());
      db.exec('COMMIT');
      newlyApplied.push(`${mig.version}_${mig.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (mig.disableForeignKeys) {
        db.exec('PRAGMA foreign_keys = ON');
      }
    }
  }
  return newlyApplied;
}

export function getAppliedMigrations(db: DatabaseSync): MigrationRecord[] {
  return db
    .prepare(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`)
    .all() as unknown as MigrationRecord[];
}
