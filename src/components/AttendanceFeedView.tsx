import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
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
  onNavigateMonitoring?: () => void;
  onNavigateAudit?: () => void;
}

function formatDateLabel(ymd: string, todayYmd?: string): string {
  if (todayYmd && ymd === todayYmd) return 'Hari Ini';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function AttendanceFeedView({
  user,
  myDay,
  onGoToAbsensi,
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
  const [resolvedLocationByPost, setResolvedLocationByPost] = useState<Record<number, string>>({});
  const [locationLookupStatus, setLocationLookupStatus] = useState<
    Record<number, 'loading' | 'unconfigured' | 'not-found' | 'error'>
  >({});

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
    loadFeed();
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
      loadFeed();
    });
    es.onerror = () => setLiveConnected(false);
    return () => {
      es.close();
      setLiveConnected(false);
    };
  }, [loadFeed]);

  // Legacy feed records predate the persisted location-address snapshot.
  // Resolve those addresses only when someone opens Detail Lokasi to avoid
  // spending Geoapify credits for every historical post in the feed.
  useEffect(() => {
    const post = lightboxPost;
    if (
      !post ||
      post.lokasiAktualAlamat ||
      resolvedLocationByPost[post.id] ||
      post.lat === null ||
      post.lng === null
    ) {
      return;
    }

    let active = true;
    setLocationLookupStatus((current) => ({ ...current, [post.id]: 'loading' }));
    const params = new URLSearchParams({ lat: String(post.lat), lng: String(post.lng) });
    apiFetch<{ address: string | null; configured: boolean }>(
      `/api/v1/location/reverse?${params.toString()}`
    )
      .then((result) => {
        if (!active) return;
        if (result.address) {
          setResolvedLocationByPost((current) => ({ ...current, [post.id]: result.address! }));
          setLocationLookupStatus((current) => {
            const next = { ...current };
            delete next[post.id];
            return next;
          });
        } else {
          setLocationLookupStatus((current) => ({
            ...current,
            [post.id]: result.configured ? 'not-found' : 'unconfigured',
          }));
        }
      })
      .catch(() => {
        if (active) {
          setLocationLookupStatus((current) => ({ ...current, [post.id]: 'error' }));
        }
      });

    return () => {
      active = false;
    };
  }, [
    lightboxPost?.id,
    lightboxPost?.lat,
    lightboxPost?.lng,
    lightboxPost?.lokasiAktualAlamat,
    resolvedLocationByPost,
  ]);

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

  const formatDistance = (meters: number) =>
    meters >= 1000
      ? `${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
      : `${Math.round(meters).toLocaleString('id-ID')} m`;

  const formatLocationSubtitle = (post: AttendanceFeedPost) => {
    const officeShort = post.kantorNama.split('(')[0].trim();
    if (post.jarakKantorMeter !== null) {
      return `${officeShort} · ${formatDistance(post.jarakKantorMeter)} dari kantor`;
    }
    return officeShort;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Instagram-Style Home Stream */}
      <div className="lg:col-span-7 xl:col-span-8">
        <div className="max-w-[540px] mx-auto w-full space-y-4">
          {/* 1. Instagram Stories Strip (Circular Colleague Avatars) */}
          <div className="flex items-start gap-3.5 overflow-x-auto pb-2 pt-0.5 px-0.5">
            <button
              type="button"
              onClick={() => setSelectedEmpId(null)}
              className="flex flex-col items-center gap-1.5 shrink-0 w-16 text-center"
            >
              <div
                className={`w-16 h-16 rounded-full p-[2.5px] transition-all ${
                  selectedEmpId === null
                    ? 'bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-500'
                    : 'bg-slate-200 dark:bg-slate-800'
                }`}
              >
                <div className="w-full h-full rounded-full bg-white dark:bg-slate-900 flex items-center justify-center border-2 border-white dark:border-slate-950 text-slate-700 dark:text-slate-200">
                  <Users className="w-6 h-6" />
                </div>
              </div>
              <span
                className={`text-[11px] truncate w-full ${
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
                ? 'bg-gradient-to-tr from-amber-500 via-rose-500 to-blue-600'
                : hasAbsenToday
                ? 'bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-500'
                : 'bg-slate-200 dark:bg-slate-800';

              return (
                <button
                  key={person.karyawanId}
                  type="button"
                  onClick={() =>
                    setSelectedEmpId(selected ? null : person.karyawanId)
                  }
                  className="flex flex-col items-center gap-1.5 shrink-0 w-16 text-center"
                >
                  <div className="relative">
                    <div className={`w-16 h-16 rounded-full p-[2.5px] transition-transform ${selected ? 'scale-105' : ''} ${ringBg}`}>
                      <div className="w-full h-full rounded-full bg-white dark:bg-slate-950 p-[2px]">
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
                      <span className="absolute -bottom-0.5 right-0 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[9px] font-bold border-2 border-slate-50 dark:border-slate-950 tabular-nums">
                        {person.sessionsCompleted}/{person.sessionsTotal}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[11px] truncate w-full ${
                      selected
                        ? 'font-bold text-blue-700 dark:text-blue-400'
                        : 'font-medium text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {person.namaLengkap.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 2. Compact Toolbar (Scope, Search, Filter Drawer, Mobile Roster Button) */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, lokasi, atau aktivitas..."
                  className="w-full min-h-[42px] sm:min-h-[38px] pl-9 pr-3 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`min-w-[42px] min-h-[42px] sm:min-h-[38px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors ${
                  showFilters || kantorFilter || bidangFilter || scope === 'today'
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                }`}
                aria-label="Filter beranda"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Filter</span>
              </button>

              <button
                type="button"
                onClick={() => setRosterModalOpen(true)}
                className="lg:hidden min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
              >
                <Users className="w-4 h-4" />
                <span>{feed?.totalSudahAbsen ?? 0}/{feed?.totalBekerja ?? 0}</span>
              </button>

              <button
                type="button"
                onClick={loadFeed}
                className="min-w-[42px] min-h-[42px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0"
                aria-label="Muat ulang beranda"
                title={liveConnected ? 'Sinkronisasi Real-Time Aktif' : 'Muat Ulang'}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {showFilters && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'recent' | 'today')}
                  aria-label="Rentang waktu feed"
                  className="min-h-[40px] sm:min-h-[36px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                >
                  <option value="recent">Linimasa Terbaru (Semua)</option>
                  <option value="today">Absen Hari Ini Saja</option>
                </select>
                <select
                  value={kantorFilter}
                  onChange={(e) => setKantorFilter(e.target.value)}
                  aria-label="Filter kantor"
                  className="min-h-[40px] sm:min-h-[36px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
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
                  className="min-h-[40px] sm:min-h-[36px] px-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
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

          {/* Mobile Quick Absensi CTA when employee has pending sessions */}
          {user.role === 'KARYAWAN' &&
            onGoToAbsensi &&
            myDay?.mustCheckIn &&
            myDay.sessionsCompleted < myDay.policySnapshot.jumlahSesi && (
              <button
                type="button"
                onClick={onGoToAbsensi}
                className="lg:hidden w-full min-h-[44px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center justify-between gap-3"
              >
                <span className="flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Buka Kamera Absensi ({myDay.sessionsCompleted}/{myDay.policySnapshot.jumlahSesi} sesi)
                </span>
                <span className="text-[11px] opacity-90">Absen →</span>
              </button>
            )}

          {selectedPerson && (
            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/70 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
              <p className="text-xs text-blue-950 dark:text-blue-100 truncate">
                Menampilkan foto absensi <strong>{selectedPerson.namaLengkap}</strong>
              </p>
              <button
                type="button"
                onClick={() => setSelectedEmpId(null)}
                className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline shrink-0"
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
                onClick={loadFeed}
                className="min-h-[38px] px-3 rounded-lg bg-red-700 text-white text-xs font-semibold shrink-0"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {/* 3. Instagram-Style Scroll-Down Stream */}
          {loading ? (
            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden animate-pulse"
                >
                  <div className="p-3.5 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3.5 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                      <div className="h-3 w-48 bg-slate-100 dark:bg-slate-800/70 rounded" />
                    </div>
                  </div>
                  <div className="aspect-square bg-slate-200 dark:bg-slate-800" />
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
                  ? 'Belum ada pegawai yang mengirim absensi hari ini. Ubah filter ke Linimasa Terbaru untuk melihat absensi sebelumnya.'
                  : 'Saat pegawai mengirim absensi dari kamera browser, foto, nama, lokasi, dan aktivitasnya langsung muncul di sini.'}
              </p>
              {scope === 'today' && (
                <button
                  type="button"
                  onClick={() => setScope('recent')}
                  className="min-h-[40px] px-4 rounded-xl bg-navy-900 dark:bg-blue-600 text-white text-xs font-semibold"
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
                const actualLocationAddress =
                  post.lokasiAktualAlamat || resolvedLocationByPost[post.id] || null;
                return (
                  <article
                    key={post.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm"
                  >
                    {/* 1. Employee identity and attendance time */}
                    <header className="px-3.5 sm:px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          karyawanId={post.karyawanId}
                          name={post.namaLengkap}
                          role={post.role}
                          version={post.fotoProfilUpdatedAt}
                          size="md"
                          className="!w-10 !h-10 !rounded-full shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-bold leading-tight text-slate-900 dark:text-slate-100 truncate">
                            {post.namaLengkap}
                          </h2>
                          <p className="mt-1 text-[11px] leading-tight text-slate-500 dark:text-slate-400 truncate">
                            {post.jabatan} <span aria-hidden="true">·</span> {post.bidangNama}
                          </p>
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate">{post.kantorNama.split('(')[0].trim()}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right pl-1">
                          <p className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {post.jamWib}
                          </p>
                          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            WIB · {dateLabel}
                          </p>
                        </div>
                      </div>
                    </header>

                    {/* 2. Photo evidence with a consistent maximum height */}
                    <button
                      type="button"
                      onClick={() => setLightboxPost(post)}
                      className="relative w-full h-[min(74vw,320px)] sm:h-[320px] block bg-slate-100 dark:bg-slate-950 overflow-hidden text-left"
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
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 p-6 text-center">
                          <Camera className="w-8 h-8 mb-2 opacity-70" />
                          <p className="text-sm font-semibold">{post.namaLengkap}</p>
                          <p className="text-xs mt-1">Bukti foto tidak tersedia</p>
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-md bg-slate-950/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
                        Lihat foto
                      </span>
                    </button>

                    {/* 3. Session and location verification status */}
                    <div className="px-3.5 sm:px-4 pt-3 pb-2.5 space-y-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-md bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 text-[11px] font-bold text-blue-800 dark:text-blue-200">
                          {post.namaSesi} · {post.sessionsCompletedToday}/{post.sessionsTotalToday} sesi
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                            post.statusKetepatan === 'TERLAMBAT'
                              ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                              : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                          }`}
                        >
                          {post.statusKetepatan === 'TERLAMBAT'
                            ? `Terlambat ${post.keterlambatanMenit} menit`
                            : 'Tepat waktu'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                            post.jarakKantorMeter === null
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              : post.dalamGeofence
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'
                          }`}
                        >
                          <MapPin className="w-3 h-3" />
                          {post.jarakKantorMeter === null
                            ? 'GPS tidak tersedia'
                            : post.dalamGeofence
                              ? 'Dalam radius'
                              : 'Di luar radius'}
                        </span>
                      </div>

                      {/* 4. Activity caption and concise location footer */}
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {post.tipeAktivitas === 'CHECK_IN'
                            ? 'Absen masuk'
                            : post.tipeAktivitas === 'STANDBY'
                              ? 'Status standby'
                              : 'Aktivitas pekerjaan'}
                        </p>
                        <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                          {post.deskripsiAktivitas.trim() || 'Tidak ada keterangan aktivitas.'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-0.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Lokasi saat absen
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-slate-700 dark:text-slate-200 line-clamp-2">
                            {actualLocationAddress ||
                              'Alamat aktual belum tersimpan pada catatan lama. Buka Detail lokasi untuk mencarinya dari GPS.'}
                          </p>
                          {(actualLocationAddress || post.lat !== null) && (
                            <p className="mt-1 text-[9px] text-slate-400 dark:text-slate-500">
                              Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer" className="underline">Geoapify</a>
                              {' · '}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap contributors</a>
                            </p>
                          )}
                          {post.lat !== null && post.lng !== null && (
                            <p className="mt-1 text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                              GPS {post.lat.toFixed(5)}, {post.lng.toFixed(5)}
                            </p>
                          )}
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Kantor penempatan
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300 line-clamp-2">
                            {post.kantorNama} · {post.kantorAlamat}
                          </p>
                          {post.jarakKantorMeter !== null && (
                            <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                              Jarak aktual ke kantor: {formatDistance(post.jarakKantorMeter)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setLightboxPost(post)}
                          className="min-h-[38px] shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          Detail lokasi
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Desktop Right Column (Instagram Web Style Account & Colleagues Panel) */}
      <aside className="hidden lg:block lg:col-span-5 xl:col-span-4 space-y-4 lg:sticky lg:top-20">
        {/* Current User Mini Profile Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar
                karyawanId={user.karyawan_id}
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
                  {user.jabatan} · {user.kantor_nama.split('(')[0].trim()}
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
                className="w-full min-h-[42px] bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Absen Kamera Sekarang ({myDay.sessionsCompleted}/{myDay.policySnapshot.jumlahSesi})
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

        {/* Today's Colleagues Summary */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
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
                    isSelected ? 'bg-blue-50/70 dark:bg-blue-950/35' : ''
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

      {/* Mobile Roster Sheet Modal */}
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
                  Ketuk nama pegawai untuk memfilter postingan beranda
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

      {/* Lightbox Modal for Post Photo & Complete Location Details */}
      {lightboxPost && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={() => setLightboxPost(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[calc(100dvh-1.5rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
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
                    {lightboxPost.namaLengkap} · {lightboxPost.namaSesi}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {formatLocationSubtitle(lightboxPost)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLightboxPost(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Tutup pratinjau"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="bg-slate-950 flex-none flex items-center justify-center max-h-[44dvh] sm:max-h-[52dvh] overflow-hidden">
              <img
                src={getAuthorizedPhotoUrl(lightboxPost.id)}
                alt={`Foto absensi ${lightboxPost.namaLengkap}`}
                referrerPolicy="no-referrer"
                className="max-h-[44dvh] sm:max-h-[52dvh] w-full object-contain"
              />
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80">
              <p className="text-sm text-slate-900 dark:text-slate-100">
                <strong>{lightboxPost.namaLengkap}</strong> — {lightboxPost.deskripsiAktivitas}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Alamat GPS merupakan hasil perkiraan reverse geocoding. Powered by{' '}
                <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 dark:text-blue-400 underline">
                  Geoapify
                </a>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                <span>Waktu: {lightboxPost.tanggal} {lightboxPost.waktuServer.slice(11, 19)} WIB</span>
                <span>
                  Geofence:{' '}
                  {lightboxPost.jarakKantorMeter !== null
                    ? `${lightboxPost.jarakKantorMeter}m (${lightboxPost.dalamGeofence ? 'Dalam Radius' : 'Luar Radius'})`
                    : 'Tanpa GPS'}
                </span>
                <span className="sm:col-span-2">
                  Lokasi Saat Absen: {lightboxPost.lokasiAktualAlamat || resolvedLocationByPost[lightboxPost.id] || (
                    locationLookupStatus[lightboxPost.id] === 'loading'
                      ? 'Sedang mencari alamat dari koordinat GPS...'
                      : locationLookupStatus[lightboxPost.id] === 'unconfigured'
                        ? 'Geoapify belum dikonfigurasi pada server'
                        : locationLookupStatus[lightboxPost.id] === 'not-found'
                          ? 'Alamat tidak ditemukan untuk koordinat ini'
                          : locationLookupStatus[lightboxPost.id] === 'error'
                            ? 'Gagal mengambil alamat. Koordinat GPS tetap menjadi bukti lokasi.'
                            : 'Alamat belum tersimpan pada catatan absensi lama'
                  )}
                </span>
                <span className="sm:col-span-2">
                  Kantor Penempatan: {lightboxPost.kantorNama} — {lightboxPost.kantorAlamat}
                </span>
                {lightboxPost.lat !== null && lightboxPost.lng !== null && (
                  <span className="sm:col-span-2">
                    Koordinat Browser: {lightboxPost.lat.toFixed(6)}, {lightboxPost.lng.toFixed(6)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
