import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getAssetsDir, getAvatarsDir, getDataDir, getDbPath, getPhotosDir } from '../paths.ts';
import { getAppliedMigrations, runMigrations } from './migrations.ts';
import { seedDemoDataset, seedProductionBaseline } from './seed.ts';

const cmd = process.argv[2] || 'status';

function ensureDirs() {
  for (const dir of [getDataDir(), getPhotosDir(), getAssetsDir(), getAvatarsDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const dbDir = path.dirname(getDbPath());
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
}

ensureDirs();
const db = new DatabaseSync(getDbPath());
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

try {
  if (cmd === 'migrate') {
    const applied = runMigrations(db);
    console.log(
      applied.length > 0
        ? `[DB] Migrasi berhasil diterapkan: ${applied.join(', ')}`
        : '[DB] Semua migrasi sudah up-to-date.'
    );
  } else if (cmd === 'seed-prod') {
    runMigrations(db);
    const result = seedProductionBaseline(db);
    if (!result.seeded) {
      console.log('[DB] Database sudah terisi; seed production dilewati untuk melindungi data aktif.');
    } else {
      console.log(`[DB] Seed baseline production selesai. Superadmin username: ${result.superadminUsername}`);
      if (result.generatedPassword) {
        console.log(
          `[DB] Sandi awal Superadmin (simpan segera & ganti setelah login): ${result.generatedPassword}`
        );
      }
    }
  } else if (cmd === 'seed-demo') {
    if (process.env.NODE_ENV === 'production' && process.env.FORCE_DEMO_SEED !== 'true') {
      console.error('[DB] Ditolak: seed-demo tidak diizinkan saat NODE_ENV=production.');
      process.exit(1);
    }
    runMigrations(db);
    const ok = seedDemoDataset(db);
    console.log(ok ? '[DB] Seed data demo selesai.' : '[DB] Database sudah memiliki data; seed demo dilewati.');
  } else if (cmd === 'status') {
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    const migrations = hasTable ? getAppliedMigrations(db) : [];
    const empCount = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='karyawan'").get()
        ? (db.prepare('SELECT COUNT(*) as c FROM karyawan').get() as { c: number }).c
        : 0
    );
    console.log(
      JSON.stringify(
        {
          dbPath: getDbPath(),
          dataDir: getDataDir(),
          migrationsCount: migrations.length,
          migrations,
          karyawanCount: empCount,
        },
        null,
        2
      )
    );
  } else {
    console.error(`Perintah tidak dikenal: ${cmd}. Gunakan: migrate | seed-prod | seed-demo | status`);
    process.exit(1);
  }
} finally {
  db.close();
}
