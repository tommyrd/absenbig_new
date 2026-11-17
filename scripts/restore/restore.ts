import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../../src/server/db/migrations.ts';
import { getBackupDir, getDataDir, getDbPath } from '../../src/server/paths.ts';
import type { BackupManifest } from '../backup/backup.ts';

export interface RestoreOptions {
  fromPath: string;
  dataDir?: string;
  dbPath?: string;
  backupRootDir?: string;
  skipSafetySnapshot?: boolean;
}

export interface RestoreResult {
  restoredDbPath: string;
  safetySnapshotPath?: string;
  verifiedFilesCount: number;
  photoLinksChecked: number;
  missingPhotosCount: number;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyDirRecursive(srcDir: string, destDir: string) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

export function runRestore(options: RestoreOptions): RestoreResult {
  const targetDataDir = options.dataDir || getDataDir();
  const targetDbPath = options.dbPath || getDbPath();
  const backupRootDir = options.backupRootDir || getBackupDir();

  let sourceDir = path.resolve(options.fromPath);
  let tempExtractDir: string | null = null;

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Sumber backup tidak ditemukan: ${sourceDir}`);
  }

  try {
    if (fs.statSync(sourceDir).isFile() && sourceDir.endsWith('.tar.gz')) {
      tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bignet_restore_'));
      execFileSync('tar', ['-xzf', sourceDir, '-C', tempExtractDir]);
      const entries = fs.readdirSync(tempExtractDir);
      if (entries.length === 1 && fs.statSync(path.join(tempExtractDir, entries[0])).isDirectory()) {
        sourceDir = path.join(tempExtractDir, entries[0]);
      } else {
        sourceDir = tempExtractDir;
      }
    }

    const manifestPath = path.join(sourceDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json tidak ditemukan di ${sourceDir}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

    // 1. Validate every file checksum before modifying live data
    for (const entry of manifest.files) {
      const fPath = path.join(sourceDir, entry.relativePath);
      if (!fs.existsSync(fPath)) {
        throw new Error(`File backup hilang: ${entry.relativePath}`);
      }
      const actualSha = sha256File(fPath);
      if (actualSha !== entry.sha256) {
        throw new Error(`Checksum tidak cocok untuk ${entry.relativePath}. Restore dibatalkan.`);
      }
    }

    const sourceDbPath = path.join(sourceDir, manifest.dbFile);
    const checkSnap = new DatabaseSync(sourceDbPath);
    try {
      const integrity = checkSnap.prepare('PRAGMA integrity_check;').get() as {
        integrity_check: string;
      };
      if (integrity.integrity_check !== 'ok') {
        throw new Error(`Database backup gagal integrity check: ${integrity.integrity_check}`);
      }
    } finally {
      checkSnap.close();
    }

    // 2. Create safety backup of current live DB if it exists
    let safetySnapshotPath: string | undefined;
    if (!options.skipSafetySnapshot && fs.existsSync(targetDbPath)) {
      const safetyDir = path.join(backupRootDir, 'pre_restore_safety');
      fs.mkdirSync(safetyDir, { recursive: true });
      safetySnapshotPath = path.join(safetyDir, `pre_restore_${Date.now()}.db`);
      const liveDb = new DatabaseSync(targetDbPath);
      try {
        const escaped = safetySnapshotPath.replace(/'/g, "''");
        liveDb.exec(`VACUUM INTO '${escaped}';`);
      } finally {
        liveDb.close();
      }
    }

    // 3. Ensure target directories & restore DB cleanly (removing stale -wal / -shm)
    fs.mkdirSync(targetDataDir, { recursive: true });
    fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      const stale = `${targetDbPath}${suffix}`;
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }
    fs.copyFileSync(sourceDbPath, targetDbPath);

    // 4. Restore media directories (photos, avatars, assets)
    for (const folder of ['photos', 'avatars', 'assets']) {
      const srcSub = path.join(sourceDir, folder);
      const destSub = path.join(targetDataDir, folder);
      if (fs.existsSync(srcSub)) {
        copyDirRecursive(srcSub, destSub);
      }
    }

    // 5. Run pending migrations & verify photo links
    const restoredDb = new DatabaseSync(targetDbPath);
    let photoLinksChecked = 0;
    let missingPhotosCount = 0;
    try {
      restoredDb.exec('PRAGMA journal_mode = WAL;');
      restoredDb.exec('PRAGMA foreign_keys = ON;');
      runMigrations(restoredDb);

      const photoRows = restoredDb
        .prepare(`SELECT foto_path FROM absensi_sesi WHERE foto_path IS NOT NULL`)
        .all() as { foto_path: string }[];
      const photosDir = path.join(targetDataDir, 'photos');
      for (const r of photoRows) {
        photoLinksChecked += 1;
        if (!fs.existsSync(path.join(photosDir, path.basename(r.foto_path)))) {
          missingPhotosCount += 1;
        }
      }
    } finally {
      restoredDb.close();
    }

    return {
      restoredDbPath: targetDbPath,
      safetySnapshotPath,
      verifiedFilesCount: manifest.files.length,
      photoLinksChecked,
      missingPhotosCount,
    };
  } finally {
    if (tempExtractDir && fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  }
}

async function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  (async () => {
    const args = process.argv.slice(2);
    const fromIdx = args.indexOf('--from');
    const fromPath = fromIdx >= 0 ? args[fromIdx + 1] : args.find((a) => !a.startsWith('--'));
    const autoYes = args.includes('--yes');

    if (!fromPath) {
      console.error('Penggunaan: npm run restore -- --from <path-backup-dir-atau-tar.gz> [--yes]');
      process.exit(1);
    }

    if (!autoYes) {
      const ok = await promptConfirm(
        `[RESTORE] Operasi ini akan menimpa database & media aktif dengan ${fromPath} (snapshot keamanan dibuat otomatis). Ketik "yes" untuk melanjutkan: `
      );
      if (!ok) {
        console.log('[RESTORE] Dibatalkan.');
        process.exit(0);
      }
    }

    const res = runRestore({ fromPath });
    console.log(`[RESTORE] Sukses! Database dipulihkan ke: ${res.restoredDbPath}`);
    if (res.safetySnapshotPath) {
      console.log(`[RESTORE] Snapshot keamanan sebelumnya: ${res.safetySnapshotPath}`);
    }
    console.log(
      `[RESTORE] ${res.verifiedFilesCount} berkas terverifikasi SHA-256. Relasi foto absensi: ${res.photoLinksChecked} dicek, ${res.missingPhotosCount} hilang.`
    );
  })().catch((err) => {
    console.error('[RESTORE] Gagal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
