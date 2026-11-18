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
    name: 'separate_admin_operational_accounts_from_employee_records',
    up: (db) => {
      db.exec(`
        DROP TRIGGER IF EXISTS trg_pengguna_role_link_insert;
        DROP TRIGGER IF EXISTS trg_pengguna_role_link_update;

        UPDATE pengguna
        SET nama_tampilan = COALESCE(
              NULLIF(nama_tampilan, ''),
              (SELECT k.nama_lengkap FROM karyawan k WHERE k.id = pengguna.karyawan_id),
              'Admin Operasional'
            ),
            no_hp = COALESCE(
              NULLIF(no_hp, ''),
              (SELECT k.no_hp FROM karyawan k WHERE k.id = pengguna.karyawan_id),
              ''
            ),
            foto_profil_path = COALESCE(
              foto_profil_path,
              (SELECT k.foto_profil_path FROM karyawan k WHERE k.id = pengguna.karyawan_id)
            ),
            foto_profil_updated_at = COALESCE(
              foto_profil_updated_at,
              (SELECT k.foto_profil_updated_at FROM karyawan k WHERE k.id = pengguna.karyawan_id)
            )
        WHERE role = 'ADMIN' AND karyawan_id IS NOT NULL;

        UPDATE karyawan
        SET aktif = 0,
            is_system_archive = 1,
            jabatan = 'Akun Admin Operasional (Arsip)'
        WHERE id IN (
          SELECT karyawan_id FROM pengguna
          WHERE role = 'ADMIN' AND karyawan_id IS NOT NULL
        );

        UPDATE pengguna
        SET karyawan_id = NULL
        WHERE role = 'ADMIN' AND karyawan_id IS NOT NULL;

        CREATE TRIGGER trg_pengguna_role_link_insert
        BEFORE INSERT ON pengguna
        FOR EACH ROW
        WHEN (NEW.role = 'KARYAWAN' AND NEW.karyawan_id IS NULL)
          OR (NEW.role IN ('ADMIN','SUPERADMIN') AND NEW.karyawan_id IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'KARYAWAN wajib memiliki profil pegawai; ADMIN OPERASIONAL dan SUPERADMIN adalah akun non-pegawai.');
        END;

        CREATE TRIGGER trg_pengguna_role_link_update
        BEFORE UPDATE OF role, karyawan_id ON pengguna
        FOR EACH ROW
        WHEN (NEW.role = 'KARYAWAN' AND NEW.karyawan_id IS NULL)
          OR (NEW.role IN ('ADMIN','SUPERADMIN') AND NEW.karyawan_id IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'KARYAWAN wajib memiliki profil pegawai; ADMIN OPERASIONAL dan SUPERADMIN adalah akun non-pegawai.');
        END;
      `);

      const invalid = db.prepare(
        `SELECT id, role FROM pengguna
         WHERE (role = 'KARYAWAN' AND karyawan_id IS NULL)
            OR (role IN ('ADMIN','SUPERADMIN') AND karyawan_id IS NOT NULL)`
      ).all();
      if (invalid.length > 0) {
        throw new Error('Migrasi 014 gagal memisahkan akun Admin Operasional dari profil pegawai.');
      }

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        throw new Error('Migrasi 014 menghasilkan pelanggaran foreign key.');
      }
    },
  },

  {
    version: '015',
    name: 'harden_sessions_csrf_and_mfa',
    up: (db) => {
      for (const [column, ddl] of [
        ['mfa_secret_enc', 'ALTER TABLE pengguna ADD COLUMN mfa_secret_enc TEXT'],
        ['mfa_pending_secret_enc', 'ALTER TABLE pengguna ADD COLUMN mfa_pending_secret_enc TEXT'],
        ['mfa_enabled', 'ALTER TABLE pengguna ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK(mfa_enabled IN (0, 1))'],
        ['mfa_enrolled_at', 'ALTER TABLE pengguna ADD COLUMN mfa_enrolled_at TEXT'],
      ] as const) {
        if (!hasColumn(db, 'pengguna', column)) db.exec(ddl);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          jti TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          idle_expires_at INTEGER NOT NULL,
          absolute_expires_at INTEGER NOT NULL,
          revoked_at TEXT,
          ip_address TEXT,
          user_agent TEXT,
          csrf_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_challenges (
          challenge_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL CHECK(purpose IN ('MFA_LOGIN', 'MFA_ENROLLMENT')),
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES pengguna(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          used_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
          ON auth_sessions(user_id, revoked_at, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_idle_expiry
          ON auth_sessions(idle_expires_at);
        CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry
          ON auth_challenges(expires_at);
        CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user
          ON mfa_recovery_codes(user_id, used_at);
      `);

      // Existing stateless tokens are intentionally invalid after this migration:
      // only sessions recorded in auth_sessions will be accepted from now on.
      db.prepare(`DELETE FROM revoked_tokens WHERE expires_at < ?`).run(Date.now());
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
