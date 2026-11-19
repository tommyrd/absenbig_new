import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch, buildApiUrl, getStoredToken } from '../../lib/api';

interface StorageStats {
  dbSizeBytes: number;
  photosSizeBytes: number;
  photosCount: number;
  avatarsSizeBytes: number;
  avatarsCount: number;
  assetsSizeBytes: number;
  assetsCount: number;
  totalDataBytes: number;
}

interface BackupRecord {
  name: string;
  createdAtWib: string;
  downloadFile: string;
  downloadType: 'tar.gz' | 'db';
  sizeBytes: number;
  dbSizeBytes: number;
  dbSha256: string | null;
  mediaCounts: { photos: number; avatars: number; assets: number } | null;
  tableCounts: Record<string, number> | null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SuperadminBackupTab() {
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [items, setItems] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ storage: StorageStats; items: BackupRecord[] }>(
        '/api/v1/superadmin/backups'
      );
      setStorage(res.storage);
      setItems(res.items);
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal memuat informasi penyimpanan & backup.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleCreateBackup = async () => {
    if (creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ backup: BackupRecord }>('/api/v1/superadmin/backups/create', {
        method: 'POST',
      });
      setNotice({
        type: 'ok',
        text: `Backup "${res.backup.name}" berhasil dibuat (${formatBytes(res.backup.sizeBytes)}) dan lulus verifikasi integritas database.`,
      });
      await loadBackups();
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal membuat backup database & media.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (record: BackupRecord) => {
    if (downloadingFile) return;
    setDownloadingFile(record.downloadFile);
    setNotice(null);
    try {
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(
        buildApiUrl(`/api/v1/superadmin/backups/${encodeURIComponent(record.downloadFile)}/download`),
        {
          method: 'GET',
          credentials: 'include',
          headers,
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Gagal mengunduh file backup.' }));
        throw new Error(errBody.error || 'Gagal mengunduh file backup.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.downloadFile;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setNotice({
        type: 'ok',
        text: `Arsip ${record.downloadFile} berhasil diunduh ke perangkat Anda.`,
      });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengunduh arsip backup.',
      });
    } finally {
      setDownloadingFile(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-[#c0392b] dark:text-brand-400" />
            Backup Sistem & Kapasitas Penyimpanan
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Buat snapshot konsisten SQLite (WAL-safe) beserta seluruh foto bukti & checksum SHA-256 untuk disimpan offline.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={creating}
            onClick={() => void handleCreateBackup()}
            className="min-h-[42px] sm:h-10 px-4 bg-[#c0392b] hover:bg-[#a93226] disabled:opacity-55 text-white rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs"
          >
            {creating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            <span>{creating ? 'Membuat Backup...' : 'Buat Backup Sekarang'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadBackups()}
            className="min-h-[42px] sm:h-10 px-3 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.type === 'err' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium flex items-start gap-2.5 ${
            notice.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Storage Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-[#c0392b]" />
            Database SQLite
          </p>
          <p className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {storage ? formatBytes(storage.dbSizeBytes) : '—'}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <ImageIcon className="w-3.5 h-3.5 text-emerald-600" />
            Foto Bukti Absensi
          </p>
          <p className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {storage ? formatBytes(storage.photosSizeBytes) : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {storage ? `${storage.photosCount} file tersimpan` : ''}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Avatar & Aset Branding</p>
          <p className="font-mono text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {storage ? formatBytes(storage.avatarsSizeBytes + storage.assetsSizeBytes) : '—'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {storage ? `${storage.avatarsCount + storage.assetsCount} file` : ''}
          </p>
        </div>
        <div className="bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-brand-800/70 text-white rounded-xl p-4">
          <p className="text-xs text-brand-200">Total Data Aktif</p>
          <p className="font-mono text-xl font-bold mt-1 tabular-nums">
            {storage ? formatBytes(storage.totalDataBytes) : '—'}
          </p>
          <p className="text-[11px] text-slate-300 mt-0.5">{items.length} arsip backup tersedia</p>
        </div>
      </div>

      {/* Backup Archives List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Daftar Arsip Backup Terverifikasi
          </h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Semua aksi tercatat di Audit Log
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Memuat daftar backup...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Belum ada arsip backup tersimpan di server.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Klik <strong>Buat Backup Sekarang</strong> untuk membuat snapshot database & foto bukti pertama.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((item) => {
              const isDownloading = downloadingFile === item.downloadFile;
              return (
                <div
                  key={item.name}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                        {item.name}
                      </span>
                      <span className="text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        .{item.downloadType}
                      </span>
                      <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      Dibuat: {item.createdAtWib.slice(0, 19).replace('T', ' ')} WIB
                      {item.mediaCounts
                        ? ` · ${item.mediaCounts.photos} foto, ${item.mediaCounts.avatars} avatar, ${item.mediaCounts.assets} aset`
                        : ''}
                    </p>
                    {item.dbSha256 && (
                      <p className="text-[10.5px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-xl">
                        SHA-256 DB: {item.dbSha256}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(downloadingFile)}
                    onClick={() => void handleDownload(item)}
                    className="min-h-[40px] sm:h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    {isDownloading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
                    )}
                    <span>{isDownloading ? 'Mengunduh...' : 'Unduh Arsip'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
