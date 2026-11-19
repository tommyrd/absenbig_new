import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  History,
  Home,
  LogOut,
  User,
  X,
} from 'lucide-react';
import { apiFetch, buildApiUrl, getStoredToken } from '../../lib/api';
import { useResetScroll } from '../../lib/scroll';
import { anchorServerClock, useServerClock } from '../../lib/server-clock-client';
import type { AuthUser, ResolvedDay, SystemSettings } from '../../shared/types';
import { shouldOpenAttendanceOnEntry } from '../../shared/employee-entry';
import { ServerClock } from '../ServerClock';
import { ThemeToggle } from '../ThemeToggle';
import { UserAvatar } from '../UserAvatar';
import { AttendanceFeedView } from '../AttendanceFeedView';
import { EmployeeAbsensiPage, type AttendanceSubmitResult } from './EmployeeAbsensiPage';
import { EmployeeHistoryPage } from './EmployeeHistoryPage';
import { EmployeePengajuanPage } from './EmployeePengajuanPage';
import { EmployeeProfilPage } from './EmployeeProfilPage';

interface AttendanceAlertToast {
  id: number;
  type: 'success' | 'error';
  title: string;
  message: string;
}

interface SuccessNoticeState {
  title: string;
  message: string;
}

type EmployeeTab = 'absensi' | 'beranda' | 'history' | 'pengajuan' | 'profil';

interface EmployeeShellProps {
  user: AuthUser;
  settings: SystemSettings | null;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

const NAV_ITEMS: { id: EmployeeTab; label: string; Icon: typeof Camera }[] = [
  { id: 'beranda', label: 'Beranda', Icon: Home },
  { id: 'absensi', label: 'Absensi', Icon: Camera },
  { id: 'history', label: 'History', Icon: History },
  { id: 'pengajuan', label: 'Pengajuan', Icon: FileText },
  { id: 'profil', label: 'Profil', Icon: User },
];

function getActiveSessionKey(day: ResolvedDay | null): string | null {
  if (!day || !day.mustCheckIn || day.sessionsCompleted >= day.policySnapshot.jumlahSesi) {
    return null;
  }
  const next = day.policySnapshot.sesiList[day.sessionsCompleted];
  if (!next) return null;
  return `${day.tanggal}:${day.sessionsCompleted}:${next.jam_mulai}:${next.jam_selesai}:${day.checkinOverride?.id ?? 0}`;
}

export function EmployeeShell({
  user,
  settings,
  onUserUpdated,
  onLogout,
}: EmployeeShellProps) {
  const [tab, setTab] = useState<EmployeeTab>('beranda');
  const [myDay, setMyDay] = useState<ResolvedDay | null>(null);
  const [serverWibTime, setServerWibTime] = useState<string | null>(null);
  const [initialRouteReady, setInitialRouteReady] = useState(false);
  const [successNotice, setSuccessNotice] = useState<SuccessNoticeState | null>(null);
  const [attendanceAlert, setAttendanceAlert] = useState<AttendanceAlertToast | null>(null);
  const [sessionGateNotice, setSessionGateNotice] = useState<string | null>(null);
  const [focusAttendanceId, setFocusAttendanceId] = useState<number | null>(null);

  const alertTimerRef = useRef<number | null>(null);
  // Prevents immediate bounce-back ONLY when an employee just submitted a session
  // and the next session happens to have an overlapping open time window (or while
  // a fallback refresh is still in flight).
  const suppressedOverlappingSessionRef = useRef<string | null>(null);
  // Tracks which open session key already triggered an auto-redirect from non-beranda tabs
  // so employees can still visit Pengajuan/History/Profil if needed, while Beranda stays gated.
  const autoRedirectedSessionRef = useRef<string | null>(null);

  const clearFocusedAttendance = useCallback(() => setFocusAttendanceId(null), []);

  const dismissAttendanceAlert = useCallback(() => {
    if (alertTimerRef.current !== null) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    setAttendanceAlert(null);
  }, []);

  const showAttendanceAlert = useCallback(
    (type: 'success' | 'error', title: string, message: string) => {
      if (alertTimerRef.current !== null) {
        window.clearTimeout(alertTimerRef.current);
      }
      const alertId = Date.now();
      setAttendanceAlert({ id: alertId, type, title, message });
      alertTimerRef.current = window.setTimeout(
        () => {
          setAttendanceAlert((current) => (current?.id === alertId ? null : current));
          alertTimerRef.current = null;
        },
        type === 'success' ? 7500 : 9500
      );
    },
    []
  );

  useEffect(() => {
    return () => {
      if (alertTimerRef.current !== null) {
        window.clearTimeout(alertTimerRef.current);
      }
    };
  }, []);

  const fetchToday = useCallback(async () => {
    const startedAt = performance.now();
    const res = await apiFetch<{ day: ResolvedDay; serverTime: string; serverEpochMs?: number }>(
      '/api/v1/attendance/today'
    );
    const finishedAt = performance.now();
    if (typeof res.serverEpochMs === 'number' && Number.isFinite(res.serverEpochMs)) {
      anchorServerClock(res.serverEpochMs, startedAt, finishedAt);
    }
    return res;
  }, []);

  const handleSessionFailed = useCallback(
    (message: string) => {
      showAttendanceAlert('error', 'Absensi Gagal', message);
    },
    [showAttendanceAlert]
  );

  const refreshMyDay = useCallback(
    async (result: AttendanceSubmitResult) => {
      const nowPerf = performance.now();
      if (typeof result.serverEpochMs === 'number' && Number.isFinite(result.serverEpochMs)) {
        anchorServerClock(result.serverEpochMs, nowPerf, nowPerf);
      }

      // Immediately suppress the session key that was just submitted (and any
      // immediately-overlapping next session) BEFORE switching to Beranda so
      // the session-open auto-redirect effect can NEVER bounce the employee
      // back to Absensi right after a successful check-in.
      const preSubmitKey = getActiveSessionKey(myDay);
      if (result.updatedDay) {
        const nextKey = getActiveSessionKey(result.updatedDay);
        const checkTime = result.serverTime || serverWibTime || '';
        const nextOverlaps =
          Boolean(nextKey) &&
          Boolean(checkTime) &&
          shouldOpenAttendanceOnEntry(result.updatedDay, checkTime);
        suppressedOverlappingSessionRef.current = nextOverlaps ? nextKey : null;
        autoRedirectedSessionRef.current = nextOverlaps ? nextKey : null;
        setMyDay(result.updatedDay);
        if (result.serverTime) setServerWibTime(result.serverTime);
      } else if (preSubmitKey) {
        suppressedOverlappingSessionRef.current = preSubmitKey;
        autoRedirectedSessionRef.current = preSubmitKey;
      }

      // Redirect straight to Beranda, focus the newly created feed card,
      // and surface an unmistakable success alert + Beranda confirmation banner.
      setSessionGateNotice(null);
      setSuccessNotice({ title: result.title, message: result.message });
      setFocusAttendanceId(result.sessionId);
      showAttendanceAlert('success', result.title, result.message);
      setTab('beranda');

      try {
        const res = await fetchToday();
        setMyDay(res.day);
        if (res.serverTime) setServerWibTime(res.serverTime);

        const nextKey = getActiveSessionKey(res.day);
        const nextOverlaps = shouldOpenAttendanceOnEntry(res.day, res.serverTime);
        suppressedOverlappingSessionRef.current = nextOverlaps ? nextKey : null;
        autoRedirectedSessionRef.current = suppressedOverlappingSessionRef.current;
      } catch {
        // Keep the updated day, success alert, and Beranda view if background sync is delayed.
      }
    },
    [fetchToday, myDay, serverWibTime, showAttendanceAlert]
  );

  // 1. Select the initial page strictly from authoritative server WIB time.
  // If an attendance session is currently open (or Admin granted check-in override),
  // land directly on Absensi — never briefly render Beranda.
  useEffect(() => {
    let active = true;
    fetchToday()
      .then((res) => {
        if (!active) return;
        setMyDay(res.day);
        setServerWibTime(res.serverTime || null);
        const isOpen = shouldOpenAttendanceOnEntry(res.day, res.serverTime);
        if (isOpen) {
          autoRedirectedSessionRef.current = getActiveSessionKey(res.day);
          setTab('absensi');
        } else {
          setTab('beranda');
        }
      })
      .catch(() => {
        if (active) setTab('beranda');
      })
      .finally(() => {
        if (active) setInitialRouteReady(true);
      });

    return () => {
      active = false;
    };
  }, [fetchToday]);

  // 2. Real-time server clock (1-second tick) for instant session-start routing.
  const serverClock = useServerClock(1000);
  const authoritativeTimeWib =
    serverClock.synced && serverClock.timeWib ? serverClock.timeWib : serverWibTime;

  const activeSessionKey = useMemo(() => getActiveSessionKey(myDay), [myDay]);
  const nextSession = myDay?.policySnapshot.sesiList[myDay.sessionsCompleted] ?? null;

  const isSessionOpenNow = useMemo(() => {
    if (!myDay || !authoritativeTimeWib) return false;
    return shouldOpenAttendanceOnEntry(myDay, authoritativeTimeWib);
  }, [myDay, authoritativeTimeWib]);

  // Clear overlap suppression once the suppressed session is no longer active
  useEffect(() => {
    if (
      suppressedOverlappingSessionRef.current &&
      suppressedOverlappingSessionRef.current !== activeSessionKey
    ) {
      suppressedOverlappingSessionRef.current = null;
    }
    if (!isSessionOpenNow) {
      setSessionGateNotice(null);
    }
  }, [activeSessionKey, isSessionOpenNow]);

  const shouldEnforceAttendanceRedirect =
    isSessionOpenNow &&
    Boolean(activeSessionKey) &&
    suppressedOverlappingSessionRef.current !== activeSessionKey;

  // 3. Instant auto-redirect whenever a session opens (clock hits jam_mulai,
  // Admin unlocks check-in override, or policy schedule changes).
  useEffect(() => {
    if (!initialRouteReady || !shouldEnforceAttendanceRedirect || !activeSessionKey) return;

    const alreadyRedirectedThisSession =
      autoRedirectedSessionRef.current === activeSessionKey;

    // Always redirect immediately from Beranda; also redirect from any other tab
    // the moment a new session opens.
    if (tab === 'beranda' || (!alreadyRedirectedThisSession && tab !== 'absensi')) {
      autoRedirectedSessionRef.current = activeSessionKey;
      setTab('absensi');
      if (nextSession) {
        setSessionGateNotice(
          myDay?.checkinOverride?.active
            ? `Izin check-in khusus untuk ${nextSession.nama} aktif. Silakan selesaikan absensi sekarang.`
            : `${nextSession.nama} sedang dibuka (${nextSession.jam_mulai}–${nextSession.jam_selesai} WIB). Silakan lakukan absensi terlebih dahulu.`
        );
      }
    }
  }, [
    initialRouteReady,
    shouldEnforceAttendanceRedirect,
    activeSessionKey,
    tab,
    nextSession,
    myDay?.checkinOverride?.active,
  ]);

  // 4. Background server sync + real-time SSE listener across ALL tabs so
  // Admin check-in overrides, policy changes, or special work trigger instant routing.
  useEffect(() => {
    if (!initialRouteReady) return;
    let active = true;

    const syncFromServer = async () => {
      try {
        const res = await fetchToday();
        if (!active) return;
        setMyDay(res.day);
        if (res.serverTime) setServerWibTime(res.serverTime);
      } catch {
        // Preserve current view during brief network hiccups.
      }
    };

    const timerId = window.setInterval(() => {
      void syncFromServer();
    }, 15000);

    const token = getStoredToken();
    const streamUrl = buildApiUrl(
      token
        ? `/api/v1/workforce/stream?token=${encodeURIComponent(token)}`
        : '/api/v1/workforce/stream'
    );
    const es = new EventSource(streamUrl);
    es.addEventListener('workforce', () => {
      void syncFromServer();
    });

    return () => {
      active = false;
      window.clearInterval(timerId);
      es.close();
    };
  }, [fetchToday, initialRouteReady]);

  // Ensure viewport lands strictly at top once initial route resolves and on every tab switch
  useResetScroll([initialRouteReady, tab], initialRouteReady);

  const handleSelectTab = (target: EmployeeTab) => {
    if (target === 'beranda' && shouldEnforceAttendanceRedirect && nextSession) {
      setTab('absensi');
      setSessionGateNotice(
        myDay?.checkinOverride?.active
          ? `Izin check-in khusus ${nextSession.nama} sedang aktif. Selesaikan absensi terlebih dahulu sebelum membuka Beranda.`
          : `${nextSession.nama} (${nextSession.jam_mulai}–${nextSession.jam_selesai} WIB) sedang dibuka. Selesaikan absensi terlebih dahulu sebelum membuka Beranda.`
      );
      return;
    }
    setTab(target);
  };

  const showIncompleteReminder =
    tab !== 'absensi' && isSessionOpenNow && myDay !== null;

  if (!initialRouteReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-[#c0392b] dark:border-brand-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Memeriksa jadwal absensi hari ini...
          </p>
        </div>
      </div>
    );
  }

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '2'
  )}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Sticky Top Bar — Zero overlap across mobile, tablet, and desktop */}
      <header className="sticky top-0 z-30 h-14 bg-[#c0392b] dark:bg-slate-900 text-white border-b border-[#a93226] dark:border-slate-800 px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-3 xl:gap-5 min-w-0 flex-1 overflow-hidden">
          <button
            type="button"
            onClick={() => handleSelectTab('beranda')}
            className="flex items-center gap-2 min-w-0 shrink-0 text-left"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0 shadow-xs">
              <img
                src={logoSrc}
                alt={appName}
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-display text-sm sm:text-base font-bold tracking-tight whitespace-nowrap truncate hidden min-[410px]:inline lg:hidden xl:inline">
              {appName}
            </span>
          </button>
          {/* Desktop Navigation (lg+ only so tablets never crowd or collide with clock) */}
          <nav className="hidden lg:flex items-center gap-1 shrink-0">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.id;
              const isAbsensiOpen = item.id === 'absensi' && shouldEnforceAttendanceRedirect;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                    active
                      ? 'bg-white/20 text-white font-semibold'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                  {isAbsensiOpen && (
                    <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse shrink-0" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ServerClock compact onDark />
          <ThemeToggle onDark />
          <button
            type="button"
            onClick={() => handleSelectTab('profil')}
            className="inline-flex items-center gap-2 h-8 sm:h-9 px-1 xl:pr-2.5 rounded-lg hover:bg-white/10 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0"
            title="Buka Profil & Foto Saya"
            aria-label="Profil Saya"
          >
            <UserAvatar
              karyawanId={user.karyawan_id}
              name={user.nama_lengkap}
              role={user.role}
              version={user.foto_profil_updated_at}
              size="xs"
            />
            <span className="hidden xl:inline max-w-[120px] truncate">{user.nama_lengkap}</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg text-xs font-medium text-white/90 hover:bg-white/15 border border-white/20 whitespace-nowrap shrink-0"
            aria-label="Keluar Akun"
            title="Keluar Akun"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      {/* High-Visibility Floating Attendance Alert (Success & Failure) */}
      {attendanceAlert && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md pointer-events-none">
          <div
            role={attendanceAlert.type === 'error' ? 'alert' : 'status'}
            aria-live={attendanceAlert.type === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all ${
              attendanceAlert.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500/80 shadow-emerald-950/25'
                : 'bg-[#c0392b] text-white border-red-400/70 shadow-red-950/30'
            }`}
          >
            <div className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
              {attendanceAlert.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-white" />
              ) : (
                <AlertCircle className="w-4 h-4 text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug">{attendanceAlert.title}</p>
              <p className="text-xs text-white/90 mt-0.5 leading-relaxed">
                {attendanceAlert.message}
              </p>
            </div>
            <button
              type="button"
              onClick={dismissAttendanceAlert}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-white/15 text-white/90"
              aria-label="Tutup pemberitahuan absensi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-5 pb-20 lg:pb-10">
        {tab === 'absensi' && sessionGateNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3.5 text-brand-900 shadow-xs dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-100"
          >
            <Camera className="mt-0.5 h-4 w-4 shrink-0 text-[#c0392b] dark:text-brand-400" />
            <p className="min-w-0 flex-1 text-xs sm:text-sm font-semibold">{sessionGateNotice}</p>
            <button
              type="button"
              onClick={() => setSessionGateNotice(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/60"
              aria-label="Tutup pemberitahuan sesi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {tab === 'beranda' && successNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
          >
            <div className="mt-0.5 w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/70 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug">{successNotice.title}</p>
              <p className="text-xs sm:text-sm text-emerald-800 dark:text-emerald-200 mt-0.5 leading-relaxed">
                {successNotice.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSuccessNotice(null)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
              aria-label="Tutup notifikasi absensi berhasil"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showIncompleteReminder && myDay && (
          <div className="mb-4 sm:mb-5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2.5 text-xs text-amber-950 dark:text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
              <span>
                Sesi absensi sedang dibuka ({myDay.sessionsCompleted}/
                {myDay.policySnapshot.jumlahSesi} sesi tercatat). Segera selesaikan absensi sesi
                berikutnya.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTab('absensi')}
              className="min-h-[44px] sm:min-h-[34px] px-3.5 py-2 sm:py-1.5 rounded-lg bg-amber-900 hover:bg-amber-800 dark:bg-amber-700 dark:hover:bg-amber-600 text-white text-xs font-semibold whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              Absen Sekarang
            </button>
          </div>
        )}

        {tab === 'beranda' && (
          <AttendanceFeedView
            user={user}
            myDay={myDay}
            focusAttendanceId={focusAttendanceId}
            onFocusHandled={clearFocusedAttendance}
            onGoToAbsensi={() => setTab('absensi')}
          />
        )}
        {tab === 'absensi' && (
          <EmployeeAbsensiPage
            user={user}
            onSessionSubmitted={refreshMyDay}
            onSessionFailed={handleSessionFailed}
          />
        )}
        {tab === 'history' && <EmployeeHistoryPage />}
        {tab === 'pengajuan' && <EmployeePengajuanPage />}
        {tab === 'profil' && (
          <EmployeeProfilPage
            user={user}
            myDay={myDay}
            onUserUpdated={onUserUpdated}
            onLogout={onLogout}
          />
        )}
      </main>

      {/* Mobile & Tablet Fixed Bottom Nav */}
      <nav
        aria-label="Navigasi Karyawan"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 pb-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800"
      >
        <div className="max-w-xl mx-auto h-14 grid grid-cols-5 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.Icon;
            const active = tab === item.id;
            const isAbsensiOpen = item.id === 'absensi' && shouldEnforceAttendanceRedirect;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`relative min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? 'text-[#c0392b] dark:text-brand-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="relative">
                  <Icon className="w-5 h-5" />
                  {isAbsensiOpen && (
                    <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#c0392b] ring-2 ring-white dark:ring-slate-900 animate-pulse" />
                  )}
                </span>
                <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
