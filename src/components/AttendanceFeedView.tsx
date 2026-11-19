import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, buildApiUrl, getAuthorizedPhotoUrl, getStoredToken } from '../lib/api';
import type {
  AttendanceFeedPost,
  AttendanceFeedRosterItem,
  AuthUser,
  BidangKerja,
  Kantor,
  ResolvedDay,
} from '../shared/types';
import { StatusBadge } from './StatusBadge';
import { UserAvatar } from './UserAvatar';
import {
  buildAttendanceShareCaption,
  createAttendanceShareImage,
} from '../lib/attendance-share';

interface SharePreviewState {
  post: AttendanceFeedPost;
  file: File;
  previewUrl: string;
  caption: string;
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

interface FeedTodayResponse {
  tanggal: string;
  serverTime: string;
  totalBekerja: number;
  totalHadirSelesai: number;
  totalSudahAbsen: number;
  roster: AttendanceFeedRosterItem[];
  posts: AttendanceFeedPost[];
}

interface AttendanceFeedViewProps {
  user: AuthUser;
  myDay?: ResolvedDay | null;
  onGoToAbsensi?: () => void;
  focusAttendanceId?: number | null;
  onFocusHandled?: () => void;
  onNavigateMonitoring?: () => void;
  onNavigateAudit?: () => void;
}

function formatDateLabel(ymd: string, todayYmd?: string): string {
  if (todayYmd && ymd === todayYmd) return 'Hari Ini';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
    : `${Math.round(meters).toLocaleString('id-ID')} m`;
}

function getShortLocationLine(post: AttendanceFeedPost): string {
  if (post.lokasiAktualAlamat && post.lokasiAktualAlamat.trim()) {
    const parts = post.lokasiAktualAlamat
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.slice(0, 2).join(', ');
  }
  return post.kantorNama.split('(')[0].trim();
}

export function AttendanceFeedView({
  user,
  myDay,
  onGoToAbsensi,
  focusAttendanceId,
  onFocusHandled,
  onNavigateMonitoring,
  onNavigateAudit,
}: AttendanceFeedViewProps) {
  const [feed, setFeed] = useState<FeedTodayResponse | null>(null);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [scope, setScope] = useState<'recent' | 'today'>('recent');
  const [kantorFilter, setKantorFilter] = useState('');
  const [bidangFilter, setBidangFilter] = useState('');
  const [selectedEmpId, setSelectedEmpId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [lightboxPost, setLightboxPost] = useState<AttendanceFeedPost | null>(null);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<number, boolean>>({});
  const [sharingPostId, setSharingPostId] = useState<number | null>(null);
  const [sharePreview, setSharePreview] = useState<SharePreviewState | null>(null);
  const [shareActionBusy, setShareActionBusy] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [shareModalNotice, setShareModalNotice] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const focusedPostRef = useRef<number | null>(null);

  const loadFeed = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('scope', scope);
      if (kantorFilter) qs.set('kantorId', kantorFilter);
      if (bidangFilter) qs.set('bidangId', bidangFilter);
      const res = await apiFetch<FeedTodayResponse>(`/api/v1/feed/today?${qs.toString()}`);
      setFeed(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat beranda absensi.');
    } finally {
      setLoading(false);
    }
  }, [scope, kantorFilter, bidangFilter]);

  useEffect(() => {
    Promise.all([
      apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
      apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
    ])
      .then(([o, b]) => {
        setOffices(o.items);
        setBidangList(b.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // Real-time SSE sync across all roles
  useEffect(() => {
    const token = getStoredToken();
    const url = buildApiUrl(
      token
        ? `/api/v1/workforce/stream?token=${encodeURIComponent(token)}`
        : '/api/v1/workforce/stream'
    );
    const es = new EventSource(url);
    es.addEventListener('connected', () => setLiveConnected(true));
    es.addEventListener('workforce', () => {
      void loadFeed();
    });
    es.onerror = () => setLiveConnected(false);
    return () => {
      es.close();
      setLiveConnected(false);
    };
  }, [loadFeed]);

  useEffect(() => {
    if (
      !focusAttendanceId ||
      focusedPostRef.current === focusAttendanceId ||
      !feed?.posts.some((post) => post.id === focusAttendanceId)
    ) {
      return;
    }

    const targetId = focusAttendanceId;
    const timerId = window.setTimeout(() => {
      const target = document.getElementById(`attendance-post-${targetId}`);
      if (!target) return;
      focusedPostRef.current = targetId;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocusHandled?.();
    }, 180);

    return () => window.clearTimeout(timerId);
  }, [focusAttendanceId, feed?.posts, onFocusHandled]);

  // Clean up generated snapshot preview object URL on close/unmount.
  useEffect(() => {
    return () => {
      if (sharePreview?.previewUrl) {
        URL.revokeObjectURL(sharePreview.previewUrl);
      }
    };
  }, [sharePreview?.previewUrl]);

  const closeSharePreview = useCallback(() => {
    setSharePreview(null);
    setCaptionCopied(false);
    setShareModalNotice(null);
  }, []);

  const handleSharePost = async (post: AttendanceFeedPost) => {
    if (sharingPostId !== null) return;
    setSharingPostId(post.id);
    setShareNotice(null);
    setShareModalNotice(null);
    setCaptionCopied(false);
    try {
      const file = await createAttendanceShareImage(post);
      const caption = buildAttendanceShareCaption(post);
      const previewUrl = URL.createObjectURL(file);
      const canNativeShareFiles =
        typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      setSharePreview({
        post,
        file,
        previewUrl,
        caption,
        canNativeShareFiles,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareNotice(
        err instanceof Error ? err.message : 'Gagal menyiapkan snapshot kartu absensi.'
      );
    } finally {
      setSharingPostId(null);
    }
  };

  const triggerSnapshotDownload = (file: File, previewUrl: string) => {
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCopyShareCaption = async () => {
    if (!sharePreview) return;
    const copied = await copyTextSafe(sharePreview.caption);
    if (copied) {
      setCaptionCopied(true);
      setShareModalNotice('Caption berhasil disalin ke clipboard.');
      window.setTimeout(() => setCaptionCopied(false), 2500);
    } else {
      setShareModalNotice('Tidak dapat menyalin otomatis. Silakan blok dan salin teks caption di atas.');
    }
  };

  const handleDownloadSnapshotOnly = () => {
    if (!sharePreview) return;
    triggerSnapshotDownload(sharePreview.file, sharePreview.previewUrl);
    setShareModalNotice('Snapshot PNG berhasil diunduh.');
  };

  const handleDownloadAndCopy = async () => {
    if (!sharePreview) return;
    triggerSnapshotDownload(sharePreview.file, sharePreview.previewUrl);
    const copied = await copyTextSafe(sharePreview.caption);
    if (copied) {
      setCaptionCopied(true);
      setShareModalNotice('Snapshot PNG diunduh & caption disalin! Tinggal tempel ke WhatsApp/Telegram.');
      window.setTimeout(() => setCaptionCopied(false), 2500);
    } else {
      setShareModalNotice('Snapshot PNG diunduh. Salin caption di atas untuk melengkapi pesan.');
    }
  };

  const handleNativeShareSnapshot = async () => {
    if (!sharePreview || shareActionBusy) return;
    setShareActionBusy(true);
    setShareModalNotice(null);
    try {
      await navigator.share({
        files: [sharePreview.file],
        title: `Bukti Absensi BIGNET — ${sharePreview.post.namaLengkap}`,
        text: sharePreview.caption,
      });
      setShareNotice('Snapshot absensi dan caption berhasil dibagikan.');
      closeSharePreview();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      // Fallback gracefully if OS share sheet rejects files+text combo.
      await handleDownloadAndCopy();
    } finally {
      setShareActionBusy(false);
    }
  };

  const sortedRoster = useMemo(() => {
    const list = [...(feed?.roster || [])];
    return list.sort((a, b) => {
      if (a.sessionsCompleted > 0 && b.sessionsCompleted === 0) return -1;
      if (a.sessionsCompleted === 0 && b.sessionsCompleted > 0) return 1;
      if (a.lastSessionTime && b.lastSessionTime) {
        return b.lastSessionTime.localeCompare(a.lastSessionTime);
      }
      return a.namaLengkap.localeCompare(b.namaLengkap);
    });
  }, [feed?.roster]);

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (feed?.posts || []).filter((post) => {
      if (selectedEmpId && post.karyawanId !== selectedEmpId) return false;
      if (!q) return true;
      return (
        post.namaLengkap.toLowerCase().includes(q) ||
        post.bidangNama.toLowerCase().includes(q) ||
        post.kantorNama.toLowerCase().includes(q) ||
        post.kantorAlamat.toLowerCase().includes(q) ||
        (post.lokasiAktualAlamat || '').toLowerCase().includes(q) ||
        post.deskripsiAktivitas.toLowerCase().includes(q) ||
        post.namaSesi.toLowerCase().includes(q)
      );
    });
  }, [feed?.posts, search, selectedEmpId]);

  const selectedPerson = selectedEmpId
    ? sortedRoster.find((r) => r.karyawanId === selectedEmpId) || null
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-8 items-start">
      {/* Main Instagram-Style Feed Column */}
      <div className="lg:col-span-7 xl:col-span-8">
        <div className="max-w-[520px] mx-auto w-full space-y-4">
          {/* 1. Instagram Stories Rail */}
          <section
            aria-label="Status kehadiran rekan hari ini"
            className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start gap-3 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedEmpId(null)}
                className="flex flex-col items-center gap-1.5 shrink-0 w-[62px] text-center group"
              >
                <div
                  className={`w-[58px] h-[58px] rounded-full p-[2.5px] transition-transform group-active:scale-95 ${
                    selectedEmpId === null
                      ? 'bg-gradient-to-tr from-[#f59e0b] via-[#e1306c] to-[#c0392b]'
                      : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                >
                  <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center border-2 border-white dark:border-slate-900 text-slate-700 dark:text-slate-200">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
                <span
                  className={`text-[11px] truncate w-full leading-tight ${
                    selectedEmpId === null
                      ? 'font-bold text-slate-900 dark:text-white'
                      : 'font-medium text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Semua
                </span>
              </button>

              {sortedRoster.map((person) => {
                const selected = selectedEmpId === person.karyawanId;
                const hasAbsenToday = person.sessionsCompleted > 0;
                const ringBg = selected
                  ? 'bg-gradient-to-tr from-[#922b21] via-[#c0392b] to-[#f97316]'
                  : hasAbsenToday
                    ? 'bg-gradient-to-tr from-[#f59e0b] via-[#e1306c] to-[#c0392b]'
                    : 'bg-slate-200 dark:bg-slate-700';

                return (
                  <button
                    key={person.karyawanId}
                    type="button"
                    onClick={() => setSelectedEmpId(selected ? null : person.karyawanId)}
                    className="flex flex-col items-center gap-1.5 shrink-0 w-[62px] text-center group"
                  >
                    <div className="relative">
                      <div
                        className={`w-[58px] h-[58px] rounded-full p-[2.5px] transition-transform group-active:scale-95 ${
                          selected ? 'scale-105' : ''
                        } ${ringBg}`}
                      >
                        <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 p-[2px]">
                          <UserAvatar
                            karyawanId={person.karyawanId}
                            name={person.namaLengkap}
                            role={person.role}
                            version={person.fotoProfilUpdatedAt}
                            size="lg"
                            className="!w-full !h-full !rounded-full !border-0"
                          />
                        </div>
                      </div>
                      {hasAbsenToday && (
                        <span className="absolute -bottom-0.5 right-0 px-1.5 py-[1px] rounded-full bg-brand-600 text-white font-mono text-[9px] font-bold border-2 border-white dark:border-slate-900 tabular-nums leading-tight">
                          {person.sessionsCompleted}/{person.sessionsTotal}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] truncate w-full leading-tight ${
                        selected
                          ? 'font-bold text-brand-600 dark:text-brand-400'
                          : 'font-medium text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {person.namaLengkap.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Mobile Quick Check-In Action */}
          {user.role === 'KARYAWAN' &&
            onGoToAbsensi &&
            myDay?.mustCheckIn &&
            myDay.sessionsCompleted < myDay.policySnapshot.jumlahSesi && (
              <button
                type="button"
                onClick={onGoToAbsensi}
                className="lg:hidden w-full min-h-[46px] px-4 bg-gradient-to-r from-[#c0392b] to-[#a93226] hover:from-[#a93226] hover:to-[#922b21] text-white text-xs font-semibold rounded-2xl flex items-center justify-between gap-3 shadow-sm active:scale-[0.99] transition-transform"
              >
                <span className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
                    <Camera className="w-4 h-4" />
                  </span>
                  <span>
                    Absen Sesi {myDay.sessionsCompleted + 1} dari {myDay.policySnapshot.jumlahSesi}
                  </span>
                </span>
                <span className="text-[11px] font-bold bg-white/15 px-2.5 py-1 rounded-full">
                  Buka Kamera →
                </span>
              </button>
            )}

          {/* 3. Compact Search & Filter Bar */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, lokasi, atau aktivitas..."
                  className="w-full min-h-[40px] sm:min-h-[38px] pl-9 pr-3 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`min-w-[40px] min-h-[40px] sm:min-h-[38px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors ${
                  showFilters || kantorFilter || bidangFilter || scope === 'today'
                    ? 'bg-brand-50 dark:bg-brand-950/60 border-brand-200 dark:border-brand-700 text-brand-600 dark:text-brand-200'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
                aria-label="Filter beranda"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Filter</span>
              </button>

              <button
                type="button"
                onClick={() => setRosterModalOpen(true)}
                className="lg:hidden min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              >
                <Users className="w-4 h-4" />
                <span className="font-mono tabular-nums">
                  {feed?.totalSudahAbsen ?? 0}/{feed?.totalBekerja ?? 0}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void loadFeed()}
                className="min-w-[40px] min-h-[40px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center shrink-0"
                aria-label="Muat ulang beranda"
                title={liveConnected ? 'Sinkronisasi real-time aktif' : 'Muat ulang'}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {showFilters && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'recent' | 'today')}
                  aria-label="Rentang waktu feed"
                  className="min-h-[38px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                >
                  <option value="recent">Linimasa Terbaru</option>
                  <option value="today">Hari Ini Saja</option>
                </select>
                <select
                  value={kantorFilter}
                  onChange={(e) => setKantorFilter(e.target.value)}
                  aria-label="Filter kantor"
                  className="min-h-[38px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
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
                  aria-label="Filter bidang"
                  className="min-h-[38px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                >
                  <option value="">Semua Bidang</option>
                  {bidangList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {selectedPerson && (
            <div className="bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
              <p className="text-xs text-brand-950 dark:text-brand-100 truncate">
                Menampilkan postingan <strong>{selectedPerson.namaLengkap}</strong>
              </p>
              <button
                type="button"
                onClick={() => setSelectedEmpId(null)}
                className="text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline shrink-0"
              >
                Tampilkan Semua
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">{error}</p>
              <button
                type="button"
                onClick={() => void loadFeed()}
                className="min-h-[36px] px-3 rounded-lg bg-brand-600 text-white text-xs font-semibold shrink-0"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {shareNotice && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 px-3.5 py-2.5 text-xs text-brand-700 dark:text-brand-200 flex items-center justify-between gap-2"
            >
              <span>{shareNotice}</span>
              <button
                type="button"
                onClick={() => setShareNotice(null)}
                className="text-current opacity-70 hover:opacity-100 shrink-0"
                aria-label="Tutup notifikasi"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 4. Instagram-Style Post Stream */}
          {loading ? (
            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden animate-pulse"
                >
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
                      <div className="h-2.5 w-48 bg-slate-100 dark:bg-slate-800/70 rounded" />
                    </div>
                  </div>
                  <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-800" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 w-40 bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-3 w-full bg-slate-100 dark:bg-slate-800/70 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-2.5">
              <Camera className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Belum Ada Postingan Absensi
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                {scope === 'today'
                  ? 'Belum ada pegawai yang mengirim absensi hari ini. Ubah filter ke Linimasa Terbaru untuk melihat catatan sebelumnya.'
                  : 'Saat pegawai melakukan absensi, foto, lokasi, dan aktivitasnya langsung muncul di linimasa ini.'}
              </p>
              {scope === 'today' && (
                <button
                  type="button"
                  onClick={() => setScope('recent')}
                  className="min-h-[38px] px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold"
                >
                  Tampilkan Linimasa Terbaru
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {filteredPosts.map((post) => {
                const photoBroken = failedPhotoIds[post.id];
                const dateLabel = formatDateLabel(post.tanggal, feed?.tanggal);
                const shortLocation = getShortLocationLine(post);
                const mapsUrl =
                  post.lat !== null && post.lng !== null
                    ? `https://www.google.com/maps/search/?api=1&query=${post.lat},${post.lng}`
                    : null;

                return (
                  <article
                    key={post.id}
                    id={`attendance-post-${post.id}`}
                    className={`bg-white dark:bg-slate-900 border rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-all ${
                      focusAttendanceId === post.id
                        ? 'border-brand-500 ring-4 ring-brand-500/20 shadow-lg'
                        : 'border-slate-200/90 dark:border-slate-800'
                    }`}
                  >
                    {/* A. Instagram Post Header */}
                    <header className="px-3.5 sm:px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-[2px] rounded-full bg-gradient-to-tr from-[#f59e0b] via-[#e1306c] to-[#c0392b] shrink-0">
                          <div className="rounded-full bg-white dark:bg-slate-900 p-[1.5px]">
                            <UserAvatar
                              karyawanId={post.karyawanId}
                              name={post.namaLengkap}
                              role={post.role}
                              version={post.fotoProfilUpdatedAt}
                              size="sm"
                              className="!w-8 !h-8 !rounded-full !border-0"
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <h2 className="text-[13px] sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                              {post.namaLengkap}
                            </h2>
                            <span className="text-slate-300 dark:text-slate-600 text-xs shrink-0">·</span>
                            <span className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 shrink-0">
                              Sesi {post.urutanSesi}/{post.sessionsTotalToday}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLightboxPost(post)}
                            className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors max-w-full text-left"
                            title={post.lokasiAktualAlamat || post.kantorNama}
                          >
                            <MapPin className="w-3 h-3 shrink-0 text-brand-500" />
                            <span className="truncate">{shortLocation}</span>
                          </button>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
                          {post.jamWib}
                        </p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500">
                          {dateLabel}
                        </p>
                      </div>
                    </header>

                    {/* B. Full-Bleed Instagram Photo Frame */}
                    <button
                      type="button"
                      onClick={() => setLightboxPost(post)}
                      className="group relative w-full aspect-[4/3] block bg-slate-100 dark:bg-slate-950 overflow-hidden text-left border-y border-slate-100 dark:border-slate-800/80"
                      aria-label={`Lihat bukti foto absensi ${post.namaLengkap}, ${post.namaSesi}`}
                    >
                      {post.hasFoto && !photoBroken ? (
                        <img
                          src={getAuthorizedPhotoUrl(post.id)}
                          alt={`Bukti absensi ${post.namaLengkap} - ${post.namaSesi}`}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setFailedPhotoIds((prev) => ({ ...prev, [post.id]: true }))
                          }
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-400 p-6 text-center">
                          <Camera className="w-8 h-8 mb-2 opacity-60" />
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {post.namaLengkap}
                          </p>
                          <p className="text-[11px] mt-0.5">Tanpa lampiran foto</p>
                        </div>
                      )}
                    </button>

                    {/* C. Instagram Action & Verification Bar */}
                    <div className="px-3.5 sm:px-4 pt-3 pb-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs min-w-0">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              post.statusKetepatan === 'TERLAMBAT'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {post.statusKetepatan === 'TERLAMBAT' ? (
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            )}
                            {post.statusKetepatan === 'TERLAMBAT'
                              ? `Terlambat ${post.keterlambatanMenit}m`
                              : 'Tepat waktu'}
                          </span>

                          {post.jarakKantorMeter !== null && (
                            <span
                              className={`inline-flex items-center gap-1 font-medium ${
                                post.dalamGeofence
                                  ? 'text-slate-600 dark:text-slate-300'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              {post.dalamGeofence ? 'Dalam radius' : 'Luar radius'} ·{' '}
                              <span className="font-mono tabular-nums">
                                {formatDistance(post.jarakKantorMeter)}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {mapsUrl && (
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-8 w-8 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-brand-600 dark:hover:text-brand-400 flex items-center justify-center transition-colors"
                              title="Buka lokasi di Google Maps"
                              aria-label="Buka lokasi di Google Maps"
                            >
                              <Navigation className="w-4 h-4" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setLightboxPost(post)}
                            className="h-8 w-8 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors"
                            title="Lihat detail absensi & lokasi"
                            aria-label="Lihat detail absensi"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSharePost(post)}
                            disabled={sharingPostId !== null}
                            className="h-8 px-2.5 rounded-full text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/50 hover:text-brand-600 dark:hover:text-brand-300 disabled:opacity-50 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
                            aria-label={`Bagikan kartu absensi ${post.namaLengkap}`}
                          >
                            {sharingPostId === post.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
                            ) : (
                              <Share2 className="w-4 h-4" />
                            )}
                            <span>{sharingPostId === post.id ? '...' : 'Bagikan'}</span>
                          </button>
                        </div>
                      </div>

                      {/* D. Classic Instagram Inline Caption */}
                      <div className="text-[13px] leading-relaxed text-slate-800 dark:text-slate-200 break-words">
                        <span className="font-bold text-slate-900 dark:text-white mr-1.5">
                          {post.namaLengkap}
                        </span>
                        <span className="whitespace-pre-wrap">
                          {post.deskripsiAktivitas.trim() || 'Melakukan absensi kerja.'}
                        </span>
                      </div>

                      {/* E. Full Resolved Location Line (clean, scannable) */}
                      {post.lokasiAktualAlamat && (
                        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                          <span className="line-clamp-2">{post.lokasiAktualAlamat}</span>
                        </p>
                      )}

                      {/* F. Subtle Instagram Uppercase Meta Footer */}
                      <div className="pt-0.5 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <span className="truncate">
                          {dateLabel} · {post.jamWib} WIB · {post.namaSesi}
                        </span>
                        <span className="shrink-0 truncate max-w-[42%]">
                          {post.bidangNama}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Desktop Right Column (Instagram Web Account & Colleagues Sidebar) */}
      <aside className="hidden lg:block lg:col-span-5 xl:col-span-4 space-y-4 lg:sticky lg:top-20">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar
                karyawanId={user.karyawan_id}
                userId={user.karyawan_id === null ? user.id : null}
                name={user.nama_lengkap}
                role={user.role}
                version={user.foto_profil_updated_at}
                size="md"
                className="!rounded-full"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {user.nama_lengkap}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {user.role === 'SUPERADMIN' && user.karyawan_id === null
                    ? 'Pemilik Sistem · Bukan Pegawai'
                    : `${user.jabatan} · ${user.kantor_nama.split('(')[0].trim()}`}
                </p>
              </div>
            </div>
            {myDay && <StatusBadge status={myDay.operationalStatus} />}
          </div>

          {user.role === 'KARYAWAN' &&
            onGoToAbsensi &&
            myDay?.mustCheckIn &&
            myDay.sessionsCompleted < myDay.policySnapshot.jumlahSesi && (
              <button
                type="button"
                onClick={onGoToAbsensi}
                className="w-full min-h-[42px] bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <Camera className="w-4 h-4" />
                Absen Sesi {myDay.sessionsCompleted + 1} ({myDay.sessionsCompleted}/{myDay.policySnapshot.jumlahSesi})
              </button>
            )}

          {user.role === 'ADMIN' && onNavigateMonitoring && (
            <button
              type="button"
              onClick={onNavigateMonitoring}
              className="w-full min-h-[40px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
            >
              Monitoring Tabel Operasional
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          {user.role === 'SUPERADMIN' && onNavigateAudit && (
            <button
              type="button"
              onClick={onNavigateAudit}
              className="w-full min-h-[40px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
            >
              Lihat Audit Bukti Foto & GPS
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Today's Colleagues */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Pegawai Hari Ini
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {feed?.totalSudahAbsen ?? 0} sudah absen · {feed?.totalHadirSelesai ?? 0} tuntas hadir
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {sortedRoster.length} org
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
            {sortedRoster.map((m) => {
              const isSelected = selectedEmpId === m.karyawanId;
              return (
                <button
                  key={m.karyawanId}
                  type="button"
                  onClick={() => setSelectedEmpId(isSelected ? null : m.karyawanId)}
                  className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                    isSelected ? 'bg-brand-50/70 dark:bg-brand-950/35' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      karyawanId={m.karyawanId}
                      name={m.namaLengkap}
                      role={m.role}
                      version={m.fotoProfilUpdatedAt}
                      size="sm"
                      className="!rounded-full"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {m.namaLengkap}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.bidangNama} · {m.kantorNama.split('(')[0].trim()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {m.sessionsCompleted > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {m.sessionsCompleted}/{m.sessionsTotal}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                        <Clock className="w-3 h-3" />
                        {m.operationalStatus.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Mobile Roster Sheet */}
      {rosterModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center lg:hidden"
          onClick={() => setRosterModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-3xl w-full max-h-[82vh] flex flex-col border-t border-slate-200 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 mb-1" />
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Daftar Pegawai Hari Ini
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Ketuk nama pegawai untuk memfilter linimasa
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterModalOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
                aria-label="Tutup daftar pegawai"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto p-1">
              {sortedRoster.map((m) => (
                <button
                  key={m.karyawanId}
                  type="button"
                  onClick={() => {
                    setSelectedEmpId(selectedEmpId === m.karyawanId ? null : m.karyawanId);
                    setRosterModalOpen(false);
                  }}
                  className="w-full px-3.5 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      karyawanId={m.karyawanId}
                      name={m.namaLengkap}
                      role={m.role}
                      version={m.fotoProfilUpdatedAt}
                      size="sm"
                      className="!rounded-full"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {m.namaLengkap}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {m.bidangNama} · {m.kantorNama.split('(')[0].trim()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {m.sessionsCompleted}/{m.sessionsTotal}
                    </span>
                    {m.lastSessionTime && (
                      <p className="text-[10px] font-mono text-slate-400">{m.lastSessionTime} WIB</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal for Full Photo & Complete Location Details */}
      {lightboxPost && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={() => setLightboxPost(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar
                  karyawanId={lightboxPost.karyawanId}
                  name={lightboxPost.namaLengkap}
                  role={lightboxPost.role}
                  version={lightboxPost.fotoProfilUpdatedAt}
                  size="sm"
                  className="!rounded-full"
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {lightboxPost.namaLengkap}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {lightboxPost.namaSesi} · {lightboxPost.tanggal} {lightboxPost.jamWib} WIB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxPost(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Tutup pratinjau"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            <div className="bg-slate-950 flex-none flex items-center justify-center max-h-[48dvh] overflow-hidden">
              {lightboxPost.hasFoto && !failedPhotoIds[lightboxPost.id] ? (
                <img
                  src={getAuthorizedPhotoUrl(lightboxPost.id)}
                  alt={`Foto absensi ${lightboxPost.namaLengkap}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[48dvh] w-full object-contain"
                />
              ) : (
                <div className="py-12 text-center text-slate-400">
                  <Camera className="w-8 h-8 mx-auto mb-2 opacity-60" />
                  <p className="text-xs">Tanpa lampiran foto</p>
                </div>
              )}
            </div>

            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900">
              <p className="text-sm text-slate-900 dark:text-slate-100 leading-relaxed">
                <strong>{lightboxPost.namaLengkap}</strong>{' '}
                {lightboxPost.deskripsiAktivitas}
              </p>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {lightboxPost.lokasiAktualAlamat || lightboxPost.kantorNama}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Kantor: {lightboxPost.kantorNama} ·{' '}
                        {lightboxPost.jarakKantorMeter !== null
                          ? `${formatDistance(lightboxPost.jarakKantorMeter)} (${lightboxPost.dalamGeofence ? 'Dalam Radius' : 'Luar Radius'})`
                          : 'Tanpa GPS'}
                      </p>
                      {lightboxPost.lat !== null && lightboxPost.lng !== null && (
                        <p className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">
                          GPS {lightboxPost.lat.toFixed(6)}, {lightboxPost.lng.toFixed(6)}
                        </p>
                      )}
                    </div>
                  </div>
                  {lightboxPost.lat !== null && lightboxPost.lng !== null && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${lightboxPost.lat},${lightboxPost.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
                    >
                      <Navigation className="w-3 h-3" />
                      Maps
                    </a>
                  )}
                </div>
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  disabled={sharingPostId !== null}
                  onClick={() => {
                    const postToShare = lightboxPost;
                    setLightboxPost(null);
                    void handleSharePost(postToShare);
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  <Share2 className="w-4 h-4" />
                  Bagikan Snapshot & Caption
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Preview & Share Modal (Image + Structured Caption) */}
      {sharePreview && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={closeSharePreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-snapshot-title"
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2
                  id="share-snapshot-title"
                  className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate"
                >
                  Bagikan Snapshot Absensi
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {sharePreview.post.namaLengkap} · {sharePreview.post.namaSesi} ·{' '}
                  {sharePreview.post.jamWib} WIB
                </p>
              </div>
              <button
                type="button"
                onClick={closeSharePreview}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label="Tutup jendela bagikan"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            {/* Modal Body: Snapshot Preview + Caption */}
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {/* Left: Crisp PNG Snapshot Preview */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Pratinjau Snapshot (PNG)
                </p>
                <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 shadow-sm">
                  <img
                    src={sharePreview.previewUrl}
                    alt={`Snapshot absensi ${sharePreview.post.namaLengkap}`}
                    className="w-full h-auto max-h-[52dvh] object-contain mx-auto block"
                  />
                </div>
              </div>

              {/* Right: Structured Caption Ready to Share / Copy */}
              <div className="space-y-2.5 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Caption Siap Bagikan
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyShareCaption()}
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
                        Salin Caption
                      </>
                    )}
                  </button>
                </div>

                <textarea
                  readOnly
                  value={sharePreview.caption}
                  rows={11}
                  aria-label="Caption bukti kehadiran"
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs leading-relaxed text-slate-800 dark:text-slate-100 font-mono resize-none focus:outline-none focus:border-brand-500"
                />

                {shareModalNotice && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-start gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                    <span>{shareModalNotice}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 shrink-0">
              {sharePreview.canNativeShareFiles ? (
                <>
                  <button
                    type="button"
                    onClick={handleDownloadSnapshotOnly}
                    className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    Unduh PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyShareCaption()}
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
                    disabled={shareActionBusy}
                    onClick={() => void handleNativeShareSnapshot()}
                    className="min-h-[42px] px-4 rounded-xl bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm disabled:opacity-60"
                  >
                    {shareActionBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    Bagikan Snapshot & Caption
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCopyShareCaption()}
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
