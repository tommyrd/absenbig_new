import path from 'node:path';

export function getDataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

export function getDbPath(): string {
  return path.resolve(process.env.DB_PATH || path.join(getDataDir(), 'bignet_absensi.db'));
}

export function getPhotosDir(): string {
  return path.join(getDataDir(), 'photos');
}

export function getAssetsDir(): string {
  return path.join(getDataDir(), 'assets');
}

export function getAvatarsDir(): string {
  return path.join(getDataDir(), 'avatars');
}

export function getBackupDir(): string {
  return path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
}
