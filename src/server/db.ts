import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  getAssetsDir,
  getAvatarsDir,
  getBackupDir,
  getDataDir,
  getDbPath,
  getPhotosDir,
} from './paths.ts';
import { runMigrations } from './db/migrations.ts';
import { seedDemoDataset, seedProductionBaseline } from './db/seed.ts';

export const DATA_DIR = getDataDir();
export const DB_PATH = getDbPath();
export const PHOTOS_DIR = getPhotosDir();
export const ASSETS_DIR = getAssetsDir();
export const AVATARS_DIR = getAvatarsDir();
export const BACKUP_DIR = getBackupDir();

let _db: DatabaseSync | null = null;
let _activeDbPath: string | null = null;

function ensureStorageDirs(dbFilePath: string) {
  for (const dir of [getDataDir(), getPhotosDir(), getAssetsDir(), getAvatarsDir(), path.dirname(dbFilePath)]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getDb(): DatabaseSync {
  const dbPath = getDbPath();
  if (_db && _activeDbPath === dbPath) {
    return _db;
  }
  if (_db && _activeDbPath !== dbPath) {
    _db.close();
    _db = null;
  }

  ensureStorageDirs(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  runMigrations(db);

  const isProd = process.env.NODE_ENV === 'production';
  const countRow = db.prepare('SELECT COUNT(*) as c FROM kantor').get() as { c: number };

  if (countRow.c === 0) {
    if (!isProd && process.env.SEED_DEMO_DATA !== 'false') {
      seedDemoDataset(db);
    } else if (process.env.BOOTSTRAP_SUPERADMIN_PASSWORD?.trim()) {
      const res = seedProductionBaseline(db);
      if (res.seeded) {
        console.log(
          `[DB] Production baseline bootstrapped for Superadmin @${res.superadminUsername} (demo login disabled).`
        );
      }
    }
  }

  // Enforce demo login disabled in production or whenever ALLOW_DEMO_LOGIN=false
  if ((isProd && process.env.ALLOW_DEMO_LOGIN !== 'true') || process.env.ALLOW_DEMO_LOGIN === 'false') {
    db.prepare(`UPDATE pengaturan_aplikasi SET izin_demo_login = 0 WHERE id = 1 AND izin_demo_login != 0`).run();
  }

  _db = db;
  _activeDbPath = dbPath;
  return db;
}

export function checkpointDb() {
  if (!_db) return;
  try {
    _db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Ignore if DB is already closing
  }
}

export function closeDb() {
  if (!_db) return;
  checkpointDb();
  _db.close();
  _db = null;
  _activeDbPath = null;
}
