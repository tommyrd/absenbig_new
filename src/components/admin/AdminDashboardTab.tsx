import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Share2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { canCopyImageToClipboard, copyPngFileToClipboard } from '../../lib/clipboard-image';
import { getServerWibDateString } from '../../lib/server-clock-client';
import {
  buildMonitoringCheckInCaption,
  buildMonitoringCheckInRows,
  createMonitoringCheckInImage,
  type EarlyReportRow,
} from '../../lib/monitoring-snapshot';
import {
  buildGroupMissingCheckInMessage,
  buildIndividualWaReminderUrl,
} from '../../lib/whatsapp-reminder';
import type { BidangKerja, Kantor, Pengajuan, WorkforceMember } from '../../shared/types';
import { AttendanceTrendChart } from '../AttendanceTrendChart';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';
import { UserAvatar } from '../UserAvatar';
import { AdminMonitoringMapModal } from './AdminMonitoringMapModal';

type QuickStatusFilter = 'ALL' | 'CHECKED_IN' | 'LATE' | 'NOT_CHECKED_IN' | 'LEAVE_OR_OFF';

interface SnapshotModalState {
  file: File;
  previewUrl: string;
  caption: string;
  tanggal: string;
  serverTimeWib: string;
  filterLabel: string;
  rowCount: number;
  scope: 'all' | 'filtered';
  selectedOfficeId: string;
  totalAllCount: number;
  totalFilteredCount: number;
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
  const [statusFilter, setStatusFilter] = useState<QuickStatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot PNG & Share modal state
  const [generatingPng, setGeneratingPng] = useState(false);
  const [snapshotModal, setSnapshotModal] = useState<SnapshotModalState | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [nativeShareBusy, setNativeShareBusy] = useState(false);
  const supportsImageCopy = canCopyImageToClipboard();
  const [mapOpen, setMapOpen] = useState(false);
  const [waListCopied, setWaListCopied] = useState(false);

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
    setImageCopied(false);
  }, []);

  const earlyByEmp = useMemo(() => {
    const map = new Map<number, EarlyReportRow>();
    for (const row of earlyRows) map.set(row.karyawan_id, row);
    return map;
  }, [earlyRows]);

  const baseFilteredWorkforce = useMemo(
    () =>
      workforce.filter((w) => {
        if (kantorFilter && String(w.kantorId) !== kantorFilter) return false;
        if (bidangFilter && String(w.bidangId) !== bidangFilter) return false;
        return true;
      }),
    [workforce, kantorFilter, bidangFilter]
  );

  const statusCounts = useMemo(() => {
    let checkedIn = 0;
    let late = 0;
    let notCheckedIn = 0;
    let leaveOrOff = 0;
    for (const w of baseFilteredWorkforce) {
      if (w.sesi1Time) {
        checkedIn += 1;
        if (w.sesi1Terlambat) late += 1;
      } else if (w.isWorkingToday || w.operationalStatus === 'TIDAK_HADIR') {
        notCheckedIn += 1;
      } else {
        leaveOrOff += 1;
      }
    }
    return {
      all: baseFilteredWorkforce.length,
      checkedIn,
      late,
      notCheckedIn,
      leaveOrOff,
    };
  }, [baseFilteredWorkforce]);

  const filteredWorkforce = useMemo(
    () =>
      baseFilteredWorkforce.filter((w) => {
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'CHECKED_IN') return Boolean(w.sesi1Time);
        if (statusFilter === 'LATE') return Boolean(w.sesi1Time && w.sesi1Terlambat);
        if (statusFilter === 'NOT_CHECKED_IN') {
          return !w.sesi1Time && (w.isWorkingToday || w.operationalStatus === 'TIDAK_HADIR');
        }
        return !w.sesi1Time && !w.isWorkingToday && w.operationalStatus !== 'TIDAK_HADIR';
      }),
    [baseFilteredWorkforce, statusFilter]
  );

  const officeBreakdown = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; working: number; checkedIn: number; late: number; missing: number }
    >();
    for (const o of offices) {
      map.set(o.id, {
        id: o.id,
        name: o.nama.split('(')[0].trim(),
        working: 0,
        checkedIn: 0,
        late: 0,
        missing: 0,
      });
    }
    for (const w of workforce) {
      const entry = map.get(w.kantorId) || {
        id: w.kantorId,
        name: w.kantorNama.split('(')[0].trim(),
        working: 0,
        checkedIn: 0,
        late: 0,
        missing: 0,
      };
      if (w.isWorkingToday) entry.working += 1;
      if (w.sesi1Time) {
        entry.checkedIn += 1;
        if (w.sesi1Terlambat) entry.late += 1;
      } else if (w.isWorkingToday || w.operationalStatus === 'TIDAK_HADIR') {
        entry.missing += 1;
      }
      map.set(w.kantorId, entry);
    }
    return Array.from(map.values()).filter((item) => item.working > 0 || item.checkedIn > 0 || item.missing > 0);
  }, [offices, workforce]);

  const missingMembers = useMemo(
    () =>
      workforce.filter(
        (w) => !w.sesi1Time && (w.isWorkingToday || w.operationalStatus === 'TIDAK_HADIR')
      ),
    [workforce]
  );

  const missingCheckInCount = missingMembers.length;

  const handleCopyMissingWaList = async () => {
    const scoped = kantorFilter
      ? missingMembers.filter((m) => String(m.kantorId) === kantorFilter)
      : missingMembers;
    const msg = buildGroupMissingCheckInMessage(
      scoped,
      serverDate || getServerWibDateString(),
      serverTimeWib
    );
    const ok = await copyTextSafe(msg);
    if (ok) {
      setWaListCopied(true);
      window.setTimeout(() => setWaListCopied(false), 2600);
    }
  };

  const activeFilterLabel = useMemo(() => {
    const kantorName = kantorFilter
      ? offices.find((o) => String(o.id) === kantorFilter)?.nama.split('(')[0].trim() || 'Kantor Terpilih'
      : 'Semua Kantor';
    const bidangName = bidangFilter
      ? bidangList.find((b) => String(b.id) === bidangFilter)?.nama || 'Bidang Terpilih'
      : 'Semua Bidang';
    return `${kantorName} · ${bidangName}`;
  }, [kantorFilter, bidangFilter, offices, bidangList]);

  const hasActiveFilter = Boolean(kantorFilter || bidangFilter);

  const generateSnapshotForScope = useCallback(
    async (
      scope: 'all' | 'filtered',
      freshWorkforce: WorkforceMember[],
      freshEarly: EarlyReportRow[],
      tanggal: string,
      timeWib: string,
      overrideOfficeId = ''
    ) => {
      const filteredList = freshWorkforce.filter((w) => {
        if (kantorFilter && String(w.kantorId) !== kantorFilter) return false;
        if (bidangFilter && String(w.bidangId) !== bidangFilter) return false;
        return true;
      });

      let targetList = scope === 'filtered' ? filteredList : freshWorkforce;
      let label =
        scope === 'filtered' && hasActiveFilter
          ? activeFilterLabel
          : 'Semua Karyawan · Semua Kantor';

      if (overrideOfficeId) {
        targetList = freshWorkforce.filter((w) => String(w.kantorId) === overrideOfficeId);
        const officeName =
          offices.find((o) => String(o.id) === overrideOfficeId)?.nama.split('(')[0].trim() ||
          'Kantor Terpilih';
        label = `${officeName} · Semua Bidang`;
      }

      const rows = buildMonitoringCheckInRows(targetList, freshEarly);
      const snapshotInput = {
        tanggal: tanggal || getServerWibDateString(),
        serverTimeWib: timeWib || '--:--',
        filterLabel: label,
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
        filterLabel: label,
        rowCount: rows.length,
        scope,
        selectedOfficeId: overrideOfficeId,
        totalAllCount: freshWorkforce.length,
        totalFilteredCount: filteredList.length,
        canNativeShareFiles,
      });
    },
    [activeFilterLabel, bidangFilter, hasActiveFilter, kantorFilter, offices]
  );

  const handleOpenMonitoringSnapshot = async (requestedScope: 'all' | 'filtered' = 'all') => {
    if (generatingPng || loading) return;
    setGeneratingPng(true);
    setSnapshotError(null);
    setModalNotice(null);
    setCaptionCopied(false);
    try {
      // Pull fresh live data & server WIB time so EVERY employee who just checked in is captured.
      let latestWorkforce = workforce;
      let latestEarly = earlyRows;
      let tanggal = serverDate;
      let timeWib = serverTimeWib;
      try {
        const [wfRes, earlyRes, timeRes] = await Promise.all([
          apiFetch<{ tanggal: string; serverTime?: string; items: WorkforceMember[] }>(
            '/api/v1/workforce/today'
          ),
          apiFetch<{ tanggal: string; items: EarlyReportRow[] }>('/api/v1/payroll/early-report'),
          apiFetch<{ date: string; time: string }>('/api/v1/time'),
        ]);
        latestWorkforce = wfRes.items;
        latestEarly = earlyRes.items;
        setWorkforce(wfRes.items);
        setEarlyRows(earlyRes.items);
        tanggal = timeRes.date || wfRes.tanggal || earlyRes.tanggal || tanggal;
        timeWib = timeRes.time || wfRes.serverTime || timeWib;
        setServerDate(tanggal);
        setServerTimeWib(timeWib);
      } catch {
        // Keep last synced server data if live refresh encounters a brief hiccup.
      }

      const effectiveScope = requestedScope === 'filtered' && hasActiveFilter ? 'filtered' : 'all';
      await generateSnapshotForScope(effectiveScope, latestWorkforce, latestEarly, tanggal, timeWib);
    } catch (err) {
      setSnapshotError(
        err instanceof Error ? err.message : 'Gagal membuat gambar PNG laporan jam masuk.'
      );
    } finally {
      setGeneratingPng(false);
    }
  };

  const handleSwitchSnapshotScope = async (nextScope: 'all' | 'filtered') => {
    if (!snapshotModal || generatingPng) return;
    setGeneratingPng(true);
    setModalNotice(null);
    setCaptionCopied(false);
    setImageCopied(false);
    try {
      await generateSnapshotForScope(
        nextScope,
        workforce,
        earlyRows,
        snapshotModal.tanggal,
        snapshotModal.serverTimeWib,
        ''
      );
    } catch (err) {
      setModalNotice(
        err instanceof Error ? err.message : 'Gagal memperbarui cakupan gambar PNG.'
      );
    } finally {
      setGeneratingPng(false);
    }
  };

  const handleSwitchSnapshotOffice = async (officeId: string) => {
    if (!snapshotModal || generatingPng) return;
    setGeneratingPng(true);
    setModalNotice(null);
    setCaptionCopied(false);
    setImageCopied(false);
    try {
      await generateSnapshotForScope(
        'all',
        workforce,
        earlyRows,
        snapshotModal.tanggal,
        snapshotModal.serverTimeWib,
        officeId
      );
    } catch (err) {
      setModalNotice(
        err instanceof Error ? err.message : 'Gagal memfilter gambar PNG per kantor.'
      );
    } finally {
      setGeneratingPng(false);
    }
  };

  const handleCopySnapshotImage = async () => {
    if (!snapshotModal) return;
    const copied = await copyPngFileToClipboard(snapshotModal.file);
    if (copied) {
      setImageCopied(true);
      setModalNotice('Gambar PNG disalin ke clipboard! Tinggal Ctrl+V / tempel ke grup WhatsApp Web.');
      window.setTimeout(() => setImageCopied(false), 2500);
    } else {
      setModalNotice('Browser ini belum mendukung salin gambar langsung. Gunakan Unduh PNG.');
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
      setModalNotice('Salin manual teks caption di kotak caption.');
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
        <div className="flex items-center gap-2.5 min-w-0">
          <UserAvatar
            karyawanId={r.karyawanId}
            name={r.namaLengkap}
            role="KARYAWAN"
            subtitle={`${r.bidangNama} · ${r.kantorNama.split('(')[0].trim()}`}
            size="sm"
            className="!rounded-full"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{r.namaLengkap}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.bidangNama}</p>
          </div>
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
        const waUrl =
          !r.sesi1Time && (r.isWorkingToday || r.operationalStatus === 'TIDAK_HADIR')
            ? buildIndividualWaReminderUrl(r, serverDate || getServerWibDateString(), serverTimeWib)
            : null;
        if (r.operationalStatus === 'TIDAK_HADIR') {
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-[11px] font-semibold">
                Tidak masuk
              </span>
              {waUrl && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Kirim pengingat WhatsApp ke ${r.namaLengkap}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold"
                >
                  <MessageCircle className="w-3 h-3" />
                  WA
                </a>
              )}
            </div>
          );
        }
        return r.isWorkingToday ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[11px] font-semibold">
              Belum absen
            </span>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Kirim pengingat WhatsApp ke ${r.namaLengkap}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold"
              >
                <MessageCircle className="w-3 h-3" />
                WA
              </a>
            )}
          </div>
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
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="min-h-[44px] sm:h-9 px-3.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-1.5"
          >
            <MapPin className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
            Peta Lokasi
          </button>
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

      {/* Operational Anomaly & Per-Office Summary Strip */}
      {!loading && (lateCount > 0 || missingCheckInCount > 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/35 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2.5 text-xs text-amber-950 dark:text-amber-100">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              <strong>Perhatian Operasional Hari Ini:</strong>{' '}
              {lateCount > 0 ? `${lateCount} karyawan terlambat Sesi 1` : ''}
              {lateCount > 0 && missingCheckInCount > 0 ? ' · ' : ''}
              {missingCheckInCount > 0 ? `${missingCheckInCount} karyawan wajib kerja belum absen Sesi 1` : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {lateCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === 'LATE' ? 'ALL' : 'LATE')}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white"
              >
                {statusFilter === 'LATE' ? 'Reset Filter' : `Lihat Terlambat (${lateCount})`}
              </button>
            )}
            {missingCheckInCount > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setStatusFilter(statusFilter === 'NOT_CHECKED_IN' ? 'ALL' : 'NOT_CHECKED_IN')
                  }
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#c0392b] hover:bg-[#a93226] text-white"
                >
                  {statusFilter === 'NOT_CHECKED_IN'
                    ? 'Reset Filter'
                    : `Belum Absen (${missingCheckInCount})`}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyMissingWaList()}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 text-white inline-flex items-center gap-1"
                >
                  {waListCopied ? <Check className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5" />}
                  {waListCopied ? 'Daftar WA Tersalin' : 'Salin Daftar WA'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!loading && officeBreakdown.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {officeBreakdown.map((item) => {
            const selected = kantorFilter === String(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setKantorFilter(selected ? '' : String(item.id))}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  selected
                    ? 'border-[#c0392b] bg-brand-50/70 dark:bg-brand-950/35 ring-1 ring-[#c0392b]/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    <Building2 className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400 shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0">
                    {item.checkedIn}/{item.working}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Masuk: {item.checkedIn} · Terlambat: {item.late} · Belum absen: {item.missing}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Monitoring Table */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Monitoring Kehadiran & Laporan Jam Masuk Hari Ini
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Total <span className="font-semibold text-slate-700 dark:text-slate-300">{workforce.length} karyawan</span> siap di-capture penuh ke gambar PNG
          </p>
        </div>

        {/* One-Click Quick Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: 'Semua', count: statusCounts.all },
              { id: 'CHECKED_IN', label: 'Sudah Masuk', count: statusCounts.checkedIn },
              { id: 'LATE', label: 'Terlambat', count: statusCounts.late },
              { id: 'NOT_CHECKED_IN', label: 'Belum Masuk', count: statusCounts.notCheckedIn },
              { id: 'LEAVE_OR_OFF', label: 'Izin / Cuti / Libur', count: statusCounts.leaveOrOff },
            ] as { id: QuickStatusFilter; label: string; count: number }[]
          ).map((chip) => {
            const active = statusFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatusFilter(chip.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#c0392b] text-white border-[#c0392b] shadow-xs'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <span>{chip.label}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-white/90' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
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

      {/* Attendance & Lateness Trend Analytics */}
      <AttendanceTrendChart kantorId={kantorFilter} />

      {/* Daily Attendance Map Modal */}
      <AdminMonitoringMapModal
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        initialOfficeId={kantorFilter}
      />

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
                  {snapshotModal.filterLabel} · {snapshotModal.rowCount} karyawan ·{' '}
                  {snapshotModal.tanggal} · {snapshotModal.serverTimeWib} WIB
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

            {/* Quick Office & Scope Selector right inside Snapshot Modal */}
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Kantor Snapshot:
                </span>
                <select
                  value={snapshotModal.selectedOfficeId}
                  disabled={generatingPng}
                  onChange={(e) => void handleSwitchSnapshotOffice(e.target.value)}
                  aria-label="Pilih kantor untuk snapshot PNG"
                  className="h-8 px-2.5 text-[11px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                >
                  <option value="">Semua Kantor ({snapshotModal.totalAllCount})</option>
                  {offices.map((o) => (
                    <option key={o.id} value={String(o.id)}>
                      {o.nama.split('(')[0].trim()}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilter && !snapshotModal.selectedOfficeId && (
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                  <button
                    type="button"
                    disabled={generatingPng}
                    onClick={() => void handleSwitchSnapshotScope('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      snapshotModal.scope === 'all'
                        ? 'bg-[#c0392b] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Semua ({snapshotModal.totalAllCount})
                  </button>
                  <button
                    type="button"
                    disabled={generatingPng}
                    onClick={() => void handleSwitchSnapshotScope('filtered')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      snapshotModal.scope === 'filtered'
                        ? 'bg-[#c0392b] text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Filter Tabel ({snapshotModal.totalFilteredCount})
                  </button>
                </div>
              )}
            </div>

            {/* Body: Scrollable Full-Width PNG Preview + Ready-to-Share Caption */}
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-7 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Pratinjau PNG ({snapshotModal.rowCount} Karyawan)
                  </p>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    Gulir untuk cek semua nama
                  </span>
                </div>
                <div className="rounded-xl overflow-y-auto overscroll-contain max-h-[58dvh] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 shadow-sm">
                  <img
                    src={snapshotModal.previewUrl}
                    alt={`Laporan jam masuk ${snapshotModal.tanggal}`}
                    className="w-full h-auto block"
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
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-end gap-2 shrink-0">
              {supportsImageCopy && (
                <button
                  type="button"
                  onClick={() => void handleCopySnapshotImage()}
                  className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                >
                  {imageCopied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  {imageCopied ? 'Gambar Tersalin' : 'Salin Gambar'}
                </button>
              )}
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
