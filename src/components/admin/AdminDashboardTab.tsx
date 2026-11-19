import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import {
  buildMonitoringCheckInCaption,
  buildMonitoringCheckInRows,
  createMonitoringCheckInImage,
  type EarlyReportRow,
} from '../../lib/monitoring-snapshot';
import type { BidangKerja, Kantor, Pengajuan, WorkforceMember } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';

interface SnapshotModalState {
  file: File;
  previewUrl: string;
  caption: string;
  tanggal: string;
  serverTimeWib: string;
  filterLabel: string;
  rowCount: number;
  canNativeShareFiles: boolean;
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below for restricted iframe contexts.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function AdminDashboardTab({ onNavigateApproval }: { onNavigateApproval: () => void }) {
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [earlyRows, setEarlyRows] = useState<EarlyReportRow[]>([]);
  const [serverDate, setServerDate] = useState('');
  const [serverTimeWib, setServerTimeWib] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [kantorFilter, setKantorFilter] = useState('');
  const [bidangFilter, setBidangFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot PNG & Share modal state
  const [generatingPng, setGeneratingPng] = useState(false);
  const [snapshotModal, setSnapshotModal] = useState<SnapshotModalState | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [nativeShareBusy, setNativeShareBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wf, early, reqs, off, bid] = await Promise.all([
        apiFetch<{ tanggal: string; serverTime?: string; items: WorkforceMember[] }>(
          '/api/v1/workforce/today'
        ),
        apiFetch<{ tanggal: string; items: EarlyReportRow[] }>('/api/v1/payroll/early-report'),
        apiFetch<{ items: Pengajuan[] }>('/api/v1/requests?status=PENDING'),
        apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
        apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
      ]);
      setWorkforce(wf.items);
      setEarlyRows(early.items);
      setServerDate(wf.tanggal || early.tanggal || '');
      setServerTimeWib(wf.serverTime || '');
      setPendingCount(reqs.items.length);
      setOffices(off.items);
      setBidangList(bid.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dashboard operasional.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => {
      if (snapshotModal?.previewUrl) {
        URL.revokeObjectURL(snapshotModal.previewUrl);
      }
    };
  }, [snapshotModal?.previewUrl]);

  const closeSnapshotModal = useCallback(() => {
    setSnapshotModal(null);
    setModalNotice(null);
    setCaptionCopied(false);
  }, []);

  const earlyByEmp = useMemo(() => {
    const map = new Map<number, EarlyReportRow>();
    for (const row of earlyRows) map.set(row.karyawan_id, row);
    return map;
  }, [earlyRows]);

  const filteredWorkforce = useMemo(
    () =>
      workforce.filter((w) => {
        if (kantorFilter && String(w.kantorId) !== kantorFilter) return false;
        if (bidangFilter && String(w.bidangId) !== bidangFilter) return false;
        return true;
      }),
    [workforce, kantorFilter, bidangFilter]
  );

  const activeFilterLabel = useMemo(() => {
    const kantorName = kantorFilter
      ? offices.find((o) => String(o.id) === kantorFilter)?.nama.split('(')[0].trim() || 'Kantor Terpilih'
      : 'Semua Kantor';
    const bidangName = bidangFilter
      ? bidangList.find((b) => String(b.id) === bidangFilter)?.nama || 'Bidang Terpilih'
      : 'Semua Bidang';
    return `${kantorName} · ${bidangName}`;
  }, [kantorFilter, bidangFilter, offices, bidangList]);

  const handleOpenMonitoringSnapshot = async () => {
    if (generatingPng || loading) return;
    setGeneratingPng(true);
    setSnapshotError(null);
    setModalNotice(null);
    setCaptionCopied(false);
    try {
      // Pull fresh server WIB time so the snapshot header timestamp is always authoritative.
      let tanggal = serverDate;
      let timeWib = serverTimeWib;
      try {
        const timeRes = await apiFetch<{ date: string; time: string }>('/api/v1/time');
        if (timeRes.date) tanggal = timeRes.date;
        if (timeRes.time) timeWib = timeRes.time;
      } catch {
        // Keep last synced server time from loadAll.
      }

      const rows = buildMonitoringCheckInRows(filteredWorkforce, earlyRows);
      const snapshotInput = {
        tanggal: tanggal || new Date().toISOString().slice(0, 10),
        serverTimeWib: timeWib || '--:--',
        filterLabel: activeFilterLabel,
        rows,
      };

      const file = await createMonitoringCheckInImage(snapshotInput);
      const caption = buildMonitoringCheckInCaption(snapshotInput);
      const previewUrl = URL.createObjectURL(file);
      const canNativeShareFiles =
        typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      setSnapshotModal({
        file,
        previewUrl,
        caption,
        tanggal: snapshotInput.tanggal,
        serverTimeWib: snapshotInput.serverTimeWib,
        filterLabel: activeFilterLabel,
        rowCount: rows.length,
        canNativeShareFiles,
      });
    } catch (err) {
      setSnapshotError(
        err instanceof Error ? err.message : 'Gagal membuat gambar PNG laporan jam masuk.'
      );
    } finally {
      setGeneratingPng(false);
    }
  };

  const triggerDownloadPng = (file: File, url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadOnly = () => {
    if (!snapshotModal) return;
    triggerDownloadPng(snapshotModal.file, snapshotModal.previewUrl);
    setModalNotice(`Gambar ${snapshotModal.file.name} berhasil diunduh.`);
  };

  const handleCopyCaption = async () => {
    if (!snapshotModal) return;
    const copied = await copyTextSafe(snapshotModal.caption);
    if (copied) {
      setCaptionCopied(true);
      setModalNotice('Caption laporan jam masuk berhasil disalin ke clipboard.');
      window.setTimeout(() => setCaptionCopied(false), 2500);
    } else {
      setModalNotice('Salin manual teks caption di kotak sebelah kiri.');
    }
  };

  const handleDownloadAndCopy = async () => {
    if (!snapshotModal) return;
    triggerDownloadPng(snapshotModal.file, snapshotModal.previewUrl);
    const copied = await copyTextSafe(snapshotModal.caption);
    if (copied) {
      setCaptionCopied(true);
      setModalNotice('PNG laporan jam masuk diunduh & caption disalin! Siap dikirim ke grup.');
      window.setTimeout(() => setCaptionCopied(false), 2500);
    } else {
      setModalNotice('PNG laporan jam masuk berhasil diunduh.');
    }
  };

  const handleNativeShare = async () => {
    if (!snapshotModal || nativeShareBusy) return;
    setNativeShareBusy(true);
    setModalNotice(null);
    try {
      await navigator.share({
        files: [snapshotModal.file],
        title: `Laporan Jam Masuk Harian — ${snapshotModal.tanggal}`,
        text: snapshotModal.caption,
      });
      closeSnapshotModal();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      await handleDownloadAndCopy();
    } finally {
      setNativeShareBusy(false);
    }
  };

  const lateCount = earlyRows.filter((r) => r.status_ketepatan === 'TERLAMBAT').length;
  const workingCount = workforce.filter((w) => w.isWorkingToday).length;
  const doneCount = workforce.filter((w) => w.operationalStatus === 'HADIR').length;

  const wfCols: ColumnDef<WorkforceMember>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik,
      render: (r) => (
        <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.nik}</span>
      ),
    },
    {
      key: 'nama',
      header: 'Karyawan',
      sortValue: (r) => r.namaLengkap,
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.namaLengkap}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{r.jabatan}</p>
        </div>
      ),
    },
    {
      key: 'penempatan',
      header: 'Kantor / Bidang',
      sortValue: (r) => r.kantorNama,
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {r.kantorNama.split('(')[0].trim()}
          </p>
          <p className="text-slate-500 dark:text-slate-400">{r.bidangNama}</p>
        </div>
      ),
    },
    {
      key: 'sesi1',
      header: 'Jam Masuk (Sesi 1)',
      sortValue: (r) => r.sesi1Time || '99:99',
      render: (r) => {
        const early = earlyByEmp.get(r.karyawanId);
        const lateMins = early?.keterlambatan_menit ?? 0;
        if (r.sesi1Time) {
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-lg font-mono text-xs font-bold tabular-nums border ${
                  r.sesi1Terlambat
                    ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                    : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                }`}
              >
                {r.sesi1Time} WIB
              </span>
              {r.sesi1Terlambat ? (
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  {lateMins > 0 ? `+${lateMins}m` : 'Terlambat'}
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Tepat
                </span>
              )}
            </div>
          );
        }
        return r.isWorkingToday ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[11px] font-semibold">
            Belum absen
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
        );
      },
    },
    {
      key: 'progres',
      header: 'Progres Sesi',
      sortValue: (r) => r.sessionsCompleted,
      render: (r) => (
        <span className="font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {r.sessionsCompleted} / {r.sessionsTotal} sesi
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status Operasional',
      sortValue: (r) => r.operationalStatus,
      render: (r) => <StatusBadge status={r.operationalStatus} />,
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Dashboard & Monitoring Operasional
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pantau jam masuk sesi 1, kehadiran hari ini, dan unduh laporan gambar (PNG) untuk dibagikan.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            disabled={loading || generatingPng}
            onClick={() => void handleOpenMonitoringSnapshot()}
            className="min-h-[44px] sm:h-9 px-3.5 bg-[#c0392b] hover:bg-[#a93226] disabled:opacity-55 text-white rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors"
          >
            {generatingPng ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5" />
            )}
            <span>{generatingPng ? 'Menyiapkan PNG...' : 'Unduh / Bagikan PNG Jam Masuk'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="min-h-[44px] sm:h-9 px-3.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </button>
        </div>
      </div>

      {snapshotError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs font-medium text-red-800 dark:text-red-200 flex items-center justify-between gap-2"
        >
          <span>{snapshotError}</span>
          <button
            type="button"
            onClick={() => setSnapshotError(null)}
            className="opacity-70 hover:opacity-100"
            aria-label="Tutup pesan error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Bekerja Hari Ini</p>
          <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
            {workingCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Tuntas Hadir</p>
          <p className="font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
            {doneCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Terlambat Sesi 1</p>
          <p className="font-mono text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
            {lateCount}
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateApproval}
          className="text-left bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-brand-700/70 text-white rounded-xl p-4 hover:bg-navy-800 dark:hover:bg-slate-800 transition-colors"
        >
          <p className="text-xs text-brand-200">Menunggu Approval</p>
          <p className="font-mono text-2xl font-bold tabular-nums mt-1">{pendingCount}</p>
          <p className="text-[11px] text-slate-300 mt-0.5">Klik untuk proses pengajuan →</p>
        </button>
      </div>

      {/* Monitoring Table */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Monitoring Kehadiran & Laporan Jam Masuk Hari Ini
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Filter aktif: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeFilterLabel}</span> (ikut diterapkan ke gambar PNG)
          </p>
        </div>
        <DataTable
          data={filteredWorkforce}
          columns={wfCols}
          getRowId={(r) => r.karyawanId}
          loading={loading}
          error={error}
          onRetry={loadAll}
          searchPlaceholder="Cari NIK atau nama karyawan..."
          searchFilter={(r, q) =>
            r.namaLengkap.toLowerCase().includes(q) ||
            r.nik.toLowerCase().includes(q) ||
            r.bidangNama.toLowerCase().includes(q)
          }
          filterToolbar={
            <>
              <select
                value={kantorFilter}
                onChange={(e) => setKantorFilter(e.target.value)}
                className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
              >
                <option value="">Semua Kantor</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nama}
                  </option>
                ))}
              </select>
              <select
                value={bidangFilter}
                onChange={(e) => setBidangFilter(e.target.value)}
                className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
              >
                <option value="">Semua Bidang</option>
                {bidangList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nama}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </div>

      {/* Monitoring Check-In PNG Preview & Share Modal */}
      {snapshotModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={closeSnapshotModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="monitoring-snapshot-title"
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2
                  id="monitoring-snapshot-title"
                  className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate"
                >
                  Laporan Gambar Jam Masuk Hari Ini (PNG)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {snapshotModal.filterLabel} · {snapshotModal.rowCount} karyawan · Update{' '}
                  {snapshotModal.serverTimeWib.slice(0, 5)} WIB
                </p>
              </div>
              <button
                type="button"
                onClick={closeSnapshotModal}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label="Tutup pratinjau laporan jam masuk"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            {/* Body: PNG Preview + Ready-to-Share Caption */}
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-7 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pratinjau Gambar (Highlight Jam Masuk)
                </p>
                <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 shadow-sm">
                  <img
                    src={snapshotModal.previewUrl}
                    alt={`Laporan jam masuk ${snapshotModal.tanggal}`}
                    className="w-full h-auto max-h-[56dvh] object-contain mx-auto block"
                  />
                </div>
              </div>

              <div className="md:col-span-5 space-y-2.5 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Caption Laporan Pagi
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyCaption()}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      captionCopied
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {captionCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Tersalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Salin
                      </>
                    )}
                  </button>
                </div>

                <textarea
                  readOnly
                  value={snapshotModal.caption}
                  rows={13}
                  aria-label="Caption laporan jam masuk harian"
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs leading-relaxed text-slate-800 dark:text-slate-100 font-mono resize-none focus:outline-none focus:border-brand-500"
                />

                {modalNotice && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-start gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                    <span>{modalNotice}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 shrink-0">
              {snapshotModal.canNativeShareFiles ? (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadOnly}
                    className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Unduh PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyCaption()}
                    className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    {captionCopied ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    {captionCopied ? 'Caption Tersalin' : 'Salin Caption'}
                  </button>
                  <button
                    type="button"
                    disabled={nativeShareBusy}
                    onClick={() => void handleNativeShare()}
                    className="min-h-[42px] px-4 rounded-xl bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
                  >
                    {nativeShareBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    Bagikan PNG & Caption
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadOnly}
                    className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Unduh PNG Saja
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadAndCopy()}
                    className="min-h-[42px] px-4 rounded-xl bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Download className="w-4 h-4" />
                    Unduh PNG & Salin Caption
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
