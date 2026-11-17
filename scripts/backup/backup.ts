import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  getAssetsDir,
  getAvatarsDir,
  getBackupDir,
  getDataDir,
  getDbPath,
  getPhotosDir,
} from '../../src/server/paths.ts';
import { getWibIsoString } from '../../src/server/time.ts';

export interface BackupOptions {
  dataDir?: string;
  dbPath?: string;
  backupRootDir?: string;
  retentionDays?: number;
  compressTarGz?: boolean;
}

export interface BackupManifest {
  app: string;
  createdAtWib: string;
  backupName: string;
  dbFile: string;
  dbSha256: string;
  dbSizeBytes: number;
  tableCounts: Record<string, number>;
  mediaCounts: {
    photos: number;
    avatars: number;
    assets: number;
  };
  files: { relativePath: string; sha256: string; sizeBytes: number }[];
  archivePath?: string;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

function copyDirCollectFiles(
  srcDir: string,
  destDir: string,
  baseRelPrefix: string,
  outFiles: { relativePath: string; sha256: string; sizeBytes: number }[]
): number {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirCollectFiles(srcPath, destPath, `${baseRelPrefix}/${entry.name}`, outFiles);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);
      outFiles.push({
        relativePath: `${baseRelPrefix}/${entry.name}`,
        sha256: sha256File(destPath),
        sizeBytes: stat.size,
      });
      count += 1;
    }
  }
  return count;
}

export function cleanupOldBackups(backupRootDir: string, retentionDays: number): string[] {
  if (!fs.existsSync(backupRootDir) || retentionDays <= 0) return [];
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const entry of fs.readdirSync(backupRootDir, { withFileTypes: true })) {
    if (!entry.name.startsWith('bignet_backup_')) continue;
    const full = path.join(backupRootDir, entry.name);
    const stat = fs.statSync(full);
    if (stat.mtimeMs < cutoffMs) {
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}

export function runBackup(options: BackupOptions = {}): {
  backupDir: string;
  manifest: BackupManifest;
  removedOld: string[];
} {
  const dataDir = options.dataDir || getDataDir();
  const dbPath = options.dbPath || getDbPath();
  const backupRootDir = options.backupRootDir || getBackupDir();
  const retentionDays =
    options.retentionDays ?? (Number(process.env.BACKUP_RETENTION_DAYS) || 30);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database aktif tidak ditemukan pada ${dbPath}`);
  }

  fs.mkdirSync(backupRootDir, { recursive: true });
  const stamp = getWibIsoString().replace(/[:+]/g, '-').replace(/[^\dT-]/g, '').slice(0, 19);
  const rand = crypto.randomBytes(2).toString('hex');
  const backupName = `bignet_backup_${stamp}_${rand}`;
  const targetDir = path.join(backupRootDir, backupName);
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. Hot WAL-safe SQLite snapshot via VACUUM INTO
  const dbSnapshotPath = path.join(targetDir, 'bignet_absensi.db');
  const liveDb = new DatabaseSync(dbPath);
  try {
    liveDb.exec('PRAGMA busy_timeout = 5000;');
    const escapedPath = dbSnapshotPath.replace(/'/g, "''");
    liveDb.exec(`VACUUM INTO '${escapedPath}';`);
  } finally {
    liveDb.close();
  }

  // 2. Verify snapshot integrity & record table row counts
  const snapDb = new DatabaseSync(dbSnapshotPath);
  const tableCounts: Record<string, number> = {};
  try {
    const check = snapDb.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') {
      throw new Error(`Integrity check gagal pada snapshot database: ${check.integrity_check}`);
    }
    for (const table of [
      'kantor',
      'karyawan',
      'pengguna',
      'kebijakan_absensi',
      'absensi_sesi',
      'pengajuan',
      'override_kehadiran',
      'periode_payroll',
      'audit_log',
      'pendaftaran_akun',
    ]) {
      const exists = snapDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (exists) {
        const row = snapDb.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        tableCounts[table] = row.c;
      }
    }
  } finally {
    snapDb.close();
  }

  const dbStat = fs.statSync(dbSnapshotPath);
  const dbSha = sha256File(dbSnapshotPath);

  // 3. Copy persistent media folders (photos, avatars, assets) - never copy .env!
  const files: { relativePath: string; sha256: string; sizeBytes: number }[] = [
    { relativePath: 'bignet_absensi.db', sha256: dbSha, sizeBytes: dbStat.size },
  ];

  const photosSrc = options.dataDir ? path.join(dataDir, 'photos') : getPhotosDir();
  const avatarsSrc = options.dataDir ? path.join(dataDir, 'avatars') : getAvatarsDir();
  const assetsSrc = options.dataDir ? path.join(dataDir, 'assets') : getAssetsDir();

  const photosCount = copyDirCollectFiles(photosSrc, path.join(targetDir, 'photos'), 'photos', files);
  const avatarsCount = copyDirCollectFiles(avatarsSrc, path.join(targetDir, 'avatars'), 'avatars', files);
  const assetsCount = copyDirCollectFiles(assetsSrc, path.join(targetDir, 'assets'), 'assets', files);

  const manifest: BackupManifest = {
    app: 'Absensi BIGNET',
    createdAtWib: getWibIsoString(),
    backupName,
    dbFile: 'bignet_absensi.db',
    dbSha256: dbSha,
    dbSizeBytes: dbStat.size,
    tableCounts,
    mediaCounts: {
      photos: photosCount,
      avatars: avatarsCount,
      assets: assetsCount,
    },
    files,
  };

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const checksumLines = files.map((f) => `${f.sha256}  ${f.relativePath}`).join('\n') + '\n';
  fs.writeFileSync(path.join(targetDir, 'checksums.sha256'), checksumLines);

  // 4. Optional .tar.gz archive creation
  if (options.compressTarGz !== false) {
    try {
      const tarPath = path.join(backupRootDir, `${backupName}.tar.gz`);
      execFileSync('tar', ['-czf', tarPath, '-C', backupRootDir, backupName]);
      manifest.archivePath = tarPath;
    } catch {
      // Directory backup remains intact even if tar is unavailable
    }
  }

  // 5. Retention rotation
  const removedOld = cleanupOldBackups(backupRootDir, retentionDays);

  return { backupDir: targetDir, manifest, removedOld };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  try {
    const noTar = process.argv.includes('--no-tar');
    const result = runBackup({ compressTarGz: !noTar });
    console.log(`[BACKUP] Berhasil dibuat: ${result.backupDir}`);
    if (result.manifest.archivePath) {
      console.log(`[BACKUP] Arsip terkompresi: ${result.manifest.archivePath}`);
    }
    console.log(
      `[BACKUP] DB SHA256: ${result.manifest.dbSha256} (${result.manifest.dbSizeBytes} bytes)`
    );
    console.log(
      `[BACKUP] Media: ${result.manifest.mediaCounts.photos} foto absensi, ${result.manifest.mediaCounts.avatars} avatar, ${result.manifest.mediaCounts.assets} aset.`
    );
    if (result.removedOld.length > 0) {
      console.log(`[BACKUP] Rotasi retensi menghapus ${result.removedOld.length} backup lama.`);
    }
  } catch (err) {
    console.error('[BACKUP] Gagal:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
