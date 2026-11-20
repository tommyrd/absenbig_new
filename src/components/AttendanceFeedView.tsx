import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, buildApiUrl, getAuthorizedPhotoUrl, getStoredToken } from '../lib/api';
import { canCopyImageToClipboard, copyPngFileToClipboard } from '../lib/clipboard-image';
import type {
  AttendanceFeedPost,
  AttendanceFeedRosterItem,
  AuthUser,
  BidangKerja,
  Kantor,
  ResolvedDay,
  Role,
  TeamDirectoryMember,
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
  const [rosterModalTab, setRosterModalTab] = useState<'today' | 'directory'>('today');
  const [teamDirectory, setTeamDirectory] = useState<TeamDirectoryMember[]>([]);
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryRoleFilter, setDirectoryRoleFilter] = useState<'ALL' | Role>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [lightboxPost, setLightboxPost] = useState<AttendanceFeedPost | null>(null);
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<number, boolean>>({});
  const [sharingPostId, setSharingPostId] = useState<number | null>(null);
  const [sharePreview, setSharePreview] = useState<SharePreviewState | null>(null);
  const [shareActionBusy, setShareActionBusy] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);
  const [shareModalNotice, setShareModalNotice] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [deleteTargetPost, setDeleteTargetPost] = useState<AttendanceFeedPost | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingPost, setDeletingPost] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focusedPostRef = useRef<number | null>(null);
  const supportsImageCopy = canCopyImageToClipboard();
  const canDeletePosts = user.role === 'SUPERADMIN';

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

  const openDeletePostModal = (post: AttendanceFeedPost) => {
    setDeleteTargetPost(post);
    setDeleteReason('');
    setDeleteError(null);
  };

  const confirmDeletePost = async () => {
    if (!deleteTargetPost || deletingPost) return;
    const cleanReason = deleteReason.trim();
    if (cleanReason.length < 3) {
      setDeleteError('Alasan penghapusan wajib diisi minimal 3 karakter.');
      return;
    }
    setDeletingPost(true);
    setDeleteError(null);
    try {
      await apiFetch(`/api/v1/attendance/sessions/${deleteTargetPost.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ alasan: cleanReason }),
      });
      const deletedName = deleteTargetPost.namaLengkap;
      const deletedSesi = deleteTargetPost.namaSesi;
      if (lightboxPost?.id === deleteTargetPost.id) {
        setLightboxPost(null);
      }
      setDeleteTargetPost(null);
      setDeleteReason('');
      setShareNotice(`Postingan ${deletedName} (${deletedSesi}) berhasil dihapus dan dicatat ke Audit Trail.`);
      await loadFeed();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus postingan absensi.');
    } finally {
      setDeletingPost(false);
    }
  };

  const loadDirectory = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: TeamDirectoryMember[] }>('/api/v1/team/directory');
      setTeamDirectory(res.items);
    } catch {
      // Non-blocking
    }
  }, []);

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
    void loadDirectory();
  }, [loadDirectory]);

  const managementMembers = useMemo(
    () => teamDirectory.filter((m) => m.role === 'SUPERADMIN' || m.role === 'ADMIN'),
    [teamDirectory]
  );

  const filteredDirectory = useMemo(() => {
    const q = directorySearch.trim().toLowerCase();
    return teamDirectory.filter((m) => {
      if (directoryRoleFilter !== 'ALL' && m.role !== directoryRoleFilter) return false;
      if (!q) return true;
      return (
        m.namaLengkap.toLowerCase().includes(q) ||
        (m.bidangNama || '').toLowerCase().includes(q) ||
        (m.kantorNama || '').toLowerCase().includes(q) ||
        (m.role === 'ADMIN' ? 'operator admin' : m.role.toLowerCase()).includes(q)
      );
    });
  }, [teamDirectory, directoryRoleFilter, directorySearch]);

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
      void loadDirectory();
    });
    es.onerror = () => setLiveConnected(false);
    return () => {
      es.close();
      setLiveConnected(false);
    };
  }, [loadFeed, loadDirectory]);

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
    setImageCopied(false);
    setShareModalNotice(null);
  }, []);

  const handleSharePost = async (post: AttendanceFeedPost) => {
    if (sharingPostId !== null) return;
    setSharingPostId(post.id);
    setShareNotice(null);
    setShareModalNotice(null);
    setCaptionCopied(false);
    setImageCopied(false);
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

  const handleCopyShareImage = async () => {
    if (!sharePreview) return;
    const copied = await copyPngFileToClipboard(sharePreview.file);
    if (copied) {
      setImageCopied(true);
      setShareModalNotice('Gambar PNG berhasil disalin ke clipboard! Tinggal Ctrl+V / tempel ke WhatsApp Web.');
      window.setTimeout(() => setImageCopied(false), 2500);
    } else {
      setShareModalNotice('Browser ini membatasi salin gambar langsung. Gunakan Unduh PNG.');
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

  const lightboxIndex = lightboxPost
    ? filteredPosts.findIndex((p) => p.id === lightboxPost.id)
    : -1;

  const navigateLightbox = useCallback(
    (delta: -1 | 1) => {
      if (!lightboxPost || filteredPosts.length <= 1) return;
      const idx = filteredPosts.findIndex((p) => p.id === lightboxPost.id);
      if (idx === -1) return;
      const nextIdx = (idx + delta + filteredPosts.length) % filteredPosts.length;
      setLightboxPost(filteredPosts[nextIdx]);
    },
    [filteredPosts, lightboxPost]
  );

  useEffect(() => {
    if (!lightboxPost) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxPost(null);
      else if (e.key === 'ArrowLeft') navigateLightbox(-1);
      else if (e.key === 'ArrowRight') navigateLightbox(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxPost, navigateLightbox]);

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
                            previewable={false}
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
                onClick={() => {
                  setRosterModalTab('today');
                  setRosterModalOpen(true);
                }}
                className="lg:hidden min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                title="Lihat daftar tim & foto profil semua role"
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
                              subtitle={`${post.bidangNama} · ${post.kantorNama.split('(')[0].trim()}`}
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

                    {/* B. Full Uncropped Attendance Photo Frame */}
                    <button
                      type="button"
                      onClick={() => setLightboxPost(post)}
                      className="group relative w-full block bg-slate-950 overflow-hidden text-left border-y border-slate-100 dark:border-slate-800/80"
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
                          className="w-full max-h-[520px] object-contain mx-auto transition-transform duration-300 group-hover:scale-[1.01]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full aspect-[4/3] flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-400 p-6 text-center">
                          <Camera className="w-8 h-8 mb-2 opacity-60" />
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {post.namaLengkap}
                          </p>
                          <p className="text-[11px] mt-0.5">Tanpa lampiran foto</p>
                        </div>
                      )}
                    </button>

                    {/* C. Clean Action Bar + Structured Location Strip + Caption + Footer */}
                    <div className="px-3.5 sm:px-4 pt-3 pb-3.5 space-y-3">
                      {/* Row 1: Compact Timeliness Status (Left) & Crisp Action Icons (Right) */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                            post.statusKetepatan === 'TERLAMBAT'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60'
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
                            className="h-8 px-2.5 rounded-full text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/50 hover:text-brand-600 dark:hover:text-brand-300 disabled:opacity-50 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap"
                            aria-label={`Bagikan kartu absensi ${post.namaLengkap}`}
                          >
                            {sharingPostId === post.id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
                            ) : (
                              <Share2 className="w-4 h-4" />
                            )}
                            <span>{sharingPostId === post.id ? '...' : 'Bagikan'}</span>
                          </button>
                          {canDeletePosts && (
                            <button
                              type="button"
                              onClick={() => openDeletePostModal(post)}
                              className="h-8 w-8 rounded-full text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/60 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center transition-colors"
                              title="Hapus postingan absensi (Superadmin)"
                              aria-label={`Hapus postingan absensi ${post.namaLengkap}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Highlighted Activity Caption (without repeating employee name) */}
                      <div className="rounded-lg border-l-[3px] border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 px-3 py-2 text-[13px] sm:text-[13.5px] font-semibold leading-relaxed text-slate-900 dark:text-slate-100 break-words whitespace-pre-wrap">
                        {post.deskripsiAktivitas.trim() || 'Melakukan absensi kerja.'}
                      </div>

                      {/* Row 3: Complete Location & Office/Region Verification Detail Card */}
                      <div className="rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/75 dark:border-slate-700/70 px-3 py-2.5 space-y-1.5">
                        {post.statusWilayahAbsensi === 'DI_LUAR_WILAYAH' ? (
                          <div className="flex items-start justify-between gap-2 text-[11px]">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
                              <div className="min-w-0">
                                <p className="font-semibold text-sky-800 dark:text-sky-200 leading-snug">
                                  Di Luar Wilayah Penempatan
                                  {post.wilayahPenempatanNama
                                    ? ` (${post.wilayahPenempatanNama})`
                                    : ''}
                                </p>
                                {post.wilayahTerdeteksiNama && (
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                                    Area terdeteksi: {post.wilayahTerdeteksiNama}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className="shrink-0 whitespace-nowrap font-semibold text-[10px] px-2 py-0.5 rounded-md bg-sky-100/80 dark:bg-sky-950/70 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-200">
                              Bebas geofence
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-2.5 text-[11px]">
                            <div className="flex items-start gap-1.5 min-w-0">
                              <MapPin
                                className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                  post.jarakKantorMeter === null
                                    ? 'text-slate-400 dark:text-slate-500'
                                    : post.dalamGeofence
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-800 dark:text-slate-100 leading-snug break-words">
                                  {post.kantorValidasiNama || post.kantorNama}
                                </p>
                                {post.wilayahPenempatanNama && (
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    Wilayah {post.wilayahPenempatanNama}
                                  </p>
                                )}
                              </div>
                            </div>
                            {post.jarakKantorMeter !== null ? (
                              <span
                                className={`shrink-0 whitespace-nowrap font-mono tabular-nums text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                                  post.dalamGeofence
                                    ? 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/70 text-rose-700 dark:text-rose-300'
                                }`}
                              >
                                {post.dalamGeofence ? 'Dalam radius · ' : 'Luar radius · '}
                                {formatDistance(post.jarakKantorMeter)}
                              </span>
                            ) : (
                              <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                                Tanpa GPS
                              </span>
                            )}
                          </div>
                        )}

                        {(post.lokasiAktualAlamat || post.kantorAlamat) && (
                          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 pl-5 break-words">
                            {post.lokasiAktualAlamat || post.kantorAlamat}
                          </p>
                        )}

                        {post.alasanPengecualianGeofence && (
                          <p className="text-[11px] leading-snug text-sky-700 dark:text-sky-300 pl-5">
                            {post.alasanPengecualianGeofence}
                          </p>
                        )}

                        {post.lat !== null && post.lng !== null && (
                          <div className="pl-5 pt-1.5 mt-1 border-t border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between gap-2 text-[10px]">
                            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                              GPS {post.lat.toFixed(6)}, {post.lng.toFixed(6)}
                            </span>
                            {mapsUrl && (
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap"
                              >
                                <Navigation className="w-3 h-3" />
                                Buka Maps
                              </a>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Row 4: Clean Hairline Meta Footer */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <span className="truncate">
                          {dateLabel} · {post.jamWib} WIB · {post.namaSesi}
                        </span>
                        <span className="shrink-0 truncate max-w-[42%] font-semibold text-slate-500 dark:text-slate-400">
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
                subtitle={
                  user.role === 'SUPERADMIN' && user.karyawan_id === null
                    ? 'Pemilik Sistem'
                    : user.role === 'ADMIN'
                    ? `Operator · ${user.kantor_nama.split('(')[0].trim()}`
                    : `${user.bidang_nama} · ${user.kantor_nama.split('(')[0].trim()}`
                }
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
                    : user.role === 'ADMIN'
                    ? `Operator · ${user.kantor_nama.split('(')[0].trim()}`
                    : `${user.bidang_nama} · ${user.kantor_nama.split('(')[0].trim()}`}
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

        {/* Leadership & Operators Directory Card (Cross-Role Profile Photos) */}
        {managementMembers.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Pimpinan & Operator
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Klik foto profil untuk memperbesar
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRosterModalTab('directory');
                  setRosterModalOpen(true);
                }}
                className="text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline shrink-0"
              >
                Semua Tim ({teamDirectory.length})
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[220px] overflow-y-auto">
              {managementMembers.map((m) => {
                const sub =
                  m.role === 'SUPERADMIN'
                    ? m.kantorNama
                      ? `Superadmin · ${m.kantorNama.split('(')[0].trim()}`
                      : 'Superadmin · Pemilik Sistem'
                    : m.kantorNama
                    ? `Operator · ${m.kantorNama.split('(')[0].trim()}`
                    : 'Operator';
                return (
                  <div
                    key={m.userId}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        karyawanId={m.karyawanId}
                        userId={m.userId}
                        name={m.namaLengkap}
                        role={m.role}
                        subtitle={sub}
                        version={m.fotoProfilUpdatedAt}
                        size="sm"
                        className="!rounded-full"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {m.namaLengkap}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {sub}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                        m.role === 'SUPERADMIN'
                          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          : 'bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                      }`}
                    >
                      {m.role === 'SUPERADMIN' ? 'Superadmin' : 'Operator'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
            {sortedRoster.map((m) => {
              const isSelected = selectedEmpId === m.karyawanId;
              const sub = `${m.bidangNama} · ${m.kantorNama.split('(')[0].trim()}`;
              return (
                <div
                  key={m.karyawanId}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                    isSelected ? 'bg-brand-50/70 dark:bg-brand-950/35' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <UserAvatar
                      karyawanId={m.karyawanId}
                      name={m.namaLengkap}
                      role={m.role}
                      subtitle={sub}
                      version={m.fotoProfilUpdatedAt}
                      size="sm"
                      className="!rounded-full"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedEmpId(isSelected ? null : m.karyawanId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {m.namaLengkap}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {sub}
                      </p>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEmpId(isSelected ? null : m.karyawanId)}
                    className="text-right shrink-0"
                  >
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
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Roster & Cross-Role Team Directory Modal (Mobile & Desktop) */}
      {rosterModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setRosterModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col border-t sm:border border-slate-200 dark:border-slate-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  {rosterModalTab === 'today' ? 'Daftar Pegawai Hari Ini' : 'Direktori Tim (Semua Role)'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {rosterModalTab === 'today'
                    ? 'Ketuk foto profil untuk memperbesar · ketuk nama untuk filter linimasa'
                    : 'Klik foto profil Superadmin, Operator, atau Karyawan untuk memperbesar'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRosterModalOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Tutup daftar tim"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>

            <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setRosterModalTab('today')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
                    rosterModalTab === 'today'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Pegawai Hari Ini ({sortedRoster.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterModalTab('directory')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
                    rosterModalTab === 'directory'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Semua Role ({teamDirectory.length})
                </button>
              </div>

              {rosterModalTab === 'directory' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={directorySearch}
                      onChange={(e) => setDirectorySearch(e.target.value)}
                      placeholder="Cari nama, bidang, kantor, atau role..."
                      className="w-full h-9 pl-9 pr-3 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: 'ALL', label: 'Semua' },
                        { id: 'SUPERADMIN', label: 'Superadmin' },
                        { id: 'ADMIN', label: 'Operator' },
                        { id: 'KARYAWAN', label: 'Karyawan' },
                      ] as const
                    ).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setDirectoryRoleFilter(r.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          directoryRoleFilter === r.id
                            ? 'bg-brand-600 text-white border-brand-600'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto p-1 flex-1">
              {rosterModalTab === 'today' ? (
                sortedRoster.map((m) => {
                  const sub = `${m.bidangNama} · ${m.kantorNama.split('(')[0].trim()}`;
                  return (
                    <div
                      key={m.karyawanId}
                      className="w-full px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <UserAvatar
                          karyawanId={m.karyawanId}
                          name={m.namaLengkap}
                          role={m.role}
                          subtitle={sub}
                          version={m.fotoProfilUpdatedAt}
                          size="sm"
                          className="!rounded-full"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEmpId(selectedEmpId === m.karyawanId ? null : m.karyawanId);
                            setRosterModalOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {m.namaLengkap}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {sub}
                          </p>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEmpId(selectedEmpId === m.karyawanId ? null : m.karyawanId);
                          setRosterModalOpen(false);
                        }}
                        className="text-right shrink-0"
                      >
                        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                          {m.sessionsCompleted}/{m.sessionsTotal}
                        </span>
                        {m.lastSessionTime && (
                          <p className="text-[10px] font-mono text-slate-400">{m.lastSessionTime} WIB</p>
                        )}
                      </button>
                    </div>
                  );
                })
              ) : filteredDirectory.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Tidak ada anggota tim yang cocok dengan pencarian.
                </div>
              ) : (
                filteredDirectory.map((m) => {
                  const kantorShort = m.kantorNama ? m.kantorNama.split('(')[0].trim() : null;
                  const sub =
                    m.role === 'SUPERADMIN'
                      ? kantorShort
                        ? `Superadmin · ${kantorShort}`
                        : 'Superadmin · Pemilik Sistem'
                      : m.role === 'ADMIN'
                      ? kantorShort
                        ? `Operator · ${kantorShort}`
                        : 'Operator'
                      : [m.bidangNama, kantorShort].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={m.userId}
                      className="w-full px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          karyawanId={m.karyawanId}
                          userId={m.userId}
                          name={m.namaLengkap}
                          role={m.role}
                          subtitle={sub}
                          version={m.fotoProfilUpdatedAt}
                          size="md"
                          className="!rounded-full"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {m.namaLengkap}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {sub}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                          m.role === 'SUPERADMIN'
                            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                            : m.role === 'ADMIN'
                            ? 'bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800'
                            : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {m.role === 'SUPERADMIN'
                          ? 'Superadmin'
                          : m.role === 'ADMIN'
                          ? 'Operator'
                          : 'Karyawan'}
                      </span>
                    </div>
                  );
                })
              )}
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
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <UserAvatar
                  karyawanId={lightboxPost.karyawanId}
                  name={lightboxPost.namaLengkap}
                  role={lightboxPost.role}
                  subtitle={`${lightboxPost.bidangNama} · ${lightboxPost.kantorNama.split('(')[0].trim()}`}
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
                    {lightboxIndex >= 0 && filteredPosts.length > 1
                      ? ` · ${lightboxIndex + 1}/${filteredPosts.length}`
                      : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {filteredPosts.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigateLightbox(-1)}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200"
                      aria-label="Foto sebelumnya"
                      title="Sebelumnya (Panah Kiri)"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateLightbox(1)}
                      className="min-w-[36px] min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200"
                      aria-label="Foto berikutnya"
                      title="Berikutnya (Panah Kanan)"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setLightboxPost(null)}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Tutup pratinjau"
                >
                  <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>
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
                        {lightboxPost.statusWilayahAbsensi === 'DI_LUAR_WILAYAH' ? (
                          <>
                            <span className="font-semibold text-sky-700 dark:text-sky-300">
                              Di Luar Wilayah Penempatan
                            </span>
                            {lightboxPost.wilayahPenempatanNama
                              ? ` (${lightboxPost.wilayahPenempatanNama})`
                              : ''}
                            {lightboxPost.wilayahTerdeteksiNama
                              ? ` · Area terdeteksi: ${lightboxPost.wilayahTerdeteksiNama}`
                              : ''}
                          </>
                        ) : (
                          <>
                            Kantor: {lightboxPost.kantorValidasiNama || lightboxPost.kantorNama} ·{' '}
                            {lightboxPost.jarakKantorMeter !== null
                              ? `${formatDistance(lightboxPost.jarakKantorMeter)} (${lightboxPost.dalamGeofence ? 'Dalam Radius' : 'Luar Radius'})`
                              : 'Tanpa GPS'}
                          </>
                        )}
                      </p>
                      {lightboxPost.alasanPengecualianGeofence && (
                        <p className="text-[11px] text-sky-700 dark:text-sky-300 mt-0.5">
                          {lightboxPost.alasanPengecualianGeofence}
                        </p>
                      )}
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

              <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                {canDeletePosts ? (
                  <button
                    type="button"
                    onClick={() => openDeletePostModal(lightboxPost)}
                    className="min-h-[40px] px-3.5 rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    Hapus Postingan
                  </button>
                ) : (
                  <span />
                )}
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
                  {sharePreview.post.tanggal} ·{' '}
                  {sharePreview.post.waktuServer.length >= 19
                    ? sharePreview.post.waktuServer.slice(11, 19)
                    : sharePreview.post.jamWib}{' '}
                  WIB
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
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-end gap-2 shrink-0">
              {supportsImageCopy && (
                <button
                  type="button"
                  onClick={() => void handleCopyShareImage()}
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

      {/* Superadmin Audited Delete Attendance Post Modal */}
      {deleteTargetPost && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={() => {
            if (!deletingPost) setDeleteTargetPost(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-post-modal-title"
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h2
                  id="delete-post-modal-title"
                  className="font-display text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  Hapus Postingan Absensi
                </h2>
              </div>
              <button
                type="button"
                disabled={deletingPost}
                onClick={() => setDeleteTargetPost(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500"
                aria-label="Tutup dialog hapus"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {deleteTargetPost.namaLengkap}
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  {deleteTargetPost.namaSesi} · {deleteTargetPost.tanggal} · {deleteTargetPost.jamWib} WIB
                </p>
                {deleteTargetPost.deskripsiAktivitas && (
                  <p className="text-slate-500 dark:text-slate-400 line-clamp-2">
                    {deleteTargetPost.deskripsiAktivitas}
                  </p>
                )}
              </div>

              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                Tindakan ini akan menghapus data sesi absensi beserta fotonya dari Beranda & Riwayat, dan tetap dicatat secara permanen di <strong>Audit Trail</strong>.
              </p>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Alasan Penghapusan <span className="text-red-600">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['Data uji coba / testing', 'Absensi duplikat / salah kirim'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setDeleteReason(preset);
                        setDeleteError(null);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  value={deleteReason}
                  onChange={(e) => {
                    setDeleteReason(e.target.value);
                    setDeleteError(null);
                  }}
                  placeholder="Contoh: Hapus data uji coba / testing aplikasi"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                />
              </div>

              {deleteError && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 text-red-700 dark:text-red-300 text-xs">
                  {deleteError}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingPost}
                onClick={() => setDeleteTargetPost(null)}
                className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingPost}
                onClick={() => void confirmDeletePost()}
                className="min-h-[38px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {deletingPost ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {deletingPost ? 'Menghapus...' : 'Hapus Postingan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
