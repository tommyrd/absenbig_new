import { useCallback, useEffect, useRef, useState } from 'react';
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
import { apiFetch } from '../../lib/api';
import type { AuthUser, ResolvedDay, SystemSettings } from '../../shared/types';
import { shouldOpenAttendanceOnEntry } from '../../shared/employee-entry';
import { ServerClock } from '../ServerClock';
import { ThemeToggle } from '../ThemeToggle';
import { UserAvatar } from '../UserAvatar';
import { AttendanceFeedView } from '../AttendanceFeedView';
import { EmployeeAbsensiPage } from './EmployeeAbsensiPage';
import { EmployeeHistoryPage } from './EmployeeHistoryPage';
import { EmployeePengajuanPage } from './EmployeePengajuanPage';
import { EmployeeProfilPage } from './EmployeeProfilPage';

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

export function EmployeeShell({
  user,
  settings,
  onUserUpdated,
  onLogout,
}: EmployeeShellProps) {
  const [tab, setTab] = useState<EmployeeTab>('beranda');
  const [myDay, setMyDay] = useState<ResolvedDay | null>(null);
  const [serverWibHm, setServerWibHm] = useState<string | null>(null);
  const [initialRouteReady, setInitialRouteReady] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [focusAttendanceId, setFocusAttendanceId] = useState<number | null>(null);
  const suppressedAutoOpenSessionRef = useRef<string | null>(null);

  const fetchToday = useCallback(
    () =>
      apiFetch<{ day: ResolvedDay; serverTime: string; serverEpochMs?: number }>(
        '/api/v1/attendance/today'
      ),
    []
  );

  const refreshMyDay = useCallback(async (message: string, sessionId: number) => {
    // A successful check-in returns the employee to Beranda and focuses
    // the exact feed card created by the server transaction.
    setSuccessNotice(message);
    setFocusAttendanceId(sessionId);
    setTab('beranda');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    try {
      const res = await fetchToday();
      setMyDay(res.day);
      if (res.serverTime) setServerWibHm(res.serverTime.slice(0, 5));

      // If the next session is already open (overlapping time windows), keep
      // the user on Beranda after this successful check-in. A future session
      // that has not started yet will still open automatically at its start.
      const next = res.day.policySnapshot.sesiList[res.day.sessionsCompleted];
      const nextKey = next
        ? `${res.day.tanggal}:${res.day.sessionsCompleted}:${next.jam_mulai}`
        : null;
      suppressedAutoOpenSessionRef.current = shouldOpenAttendanceOnEntry(
        res.day,
        res.serverTime
      )
        ? nextKey
        : null;
    } catch {
      // Keep the success notice and Beranda even if refreshing the feed is delayed.
    }
  }, [fetchToday]);

  // Select the first page from the server's WIB time and the employee's next
  // incomplete session. Never briefly render Beranda before redirecting.
  useEffect(() => {
    let active = true;
    fetchToday()
      .then((res) => {
        if (!active) return;
        setMyDay(res.day);
        setServerWibHm(res.serverTime?.slice(0, 5) || null);
        setTab(
          shouldOpenAttendanceOnEntry(res.day, res.serverTime)
            ? 'absensi'
            : 'beranda'
        );
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

  // While employees are on Beranda, watch for the next session opening.
  // Use server WIB time so a device clock or timezone cannot trigger early.
  useEffect(() => {
    if (tab !== 'beranda') return;

    const checkNextSession = async () => {
      try {
        const res = await fetchToday();
        setMyDay(res.day);
        if (res.serverTime) setServerWibHm(res.serverTime.slice(0, 5));
        const next = res.day.policySnapshot.sesiList[res.day.sessionsCompleted];
        const nextKey = next
          ? `${res.day.tanggal}:${res.day.sessionsCompleted}:${next.jam_mulai}`
          : null;
        const alreadyLandedOnHomeForThisOpenSession =
          Boolean(nextKey) && suppressedAutoOpenSessionRef.current === nextKey;
        if (
          shouldOpenAttendanceOnEntry(res.day, res.serverTime) &&
          !alreadyLandedOnHomeForThisOpenSession
        ) {
          setTab('absensi');
        }
      } catch {
        // Preserve the current page during temporary network interruptions.
      }
    };

    const timerId = window.setInterval(checkNextSession, 15000);
    return () => window.clearInterval(timerId);
  }, [fetchToday, tab]);

  const nowWibHm =
    serverWibHm ||
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

  const showIncompleteReminder =
    tab !== 'absensi' &&
    myDay !== null &&
    shouldOpenAttendanceOnEntry(myDay, `${nowWibHm}:00`);

  if (!initialRouteReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-navy-900 dark:border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Memeriksa jadwal absensi hari ini...
          </p>
        </div>
      </div>
    );
  }

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Compact Sticky Top Bar (< 48px mobile) */}
      <header className="sticky top-0 z-30 h-12 md:h-14 bg-navy-900 dark:bg-slate-900 text-white border-b border-navy-800 dark:border-slate-800 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-4 sm:gap-5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={logoSrc}
              alt={appName}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-contain bg-white/10 p-0.5 border border-white/15 shrink-0"
            />
            <span className="font-display text-sm sm:text-base font-bold tracking-tight whitespace-nowrap truncate">
              {appName}
            </span>
          </div>
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white/15 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <ServerClock compact onDark />
          <ThemeToggle onDark />
          <button
            type="button"
            onClick={() => setTab('profil')}
            className="inline-flex items-center gap-2 pl-1 pr-1.5 sm:pr-2 py-1 rounded-lg hover:bg-white/10 text-xs font-medium text-slate-100 whitespace-nowrap shrink-0 min-h-[40px] sm:min-h-[36px]"
            title="Buka Profil & Foto Saya"
          >
            <UserAvatar
              karyawanId={user.karyawan_id}
              name={user.nama_lengkap}
              role={user.role}
              version={user.foto_profil_updated_at}
              size="xs"
            />
            <span className="hidden sm:inline max-w-[110px] truncate">{user.nama_lengkap}</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 min-h-[40px] sm:min-h-[36px] rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 border border-white/15 whitespace-nowrap shrink-0"
            aria-label="Keluar Akun"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-5 pb-20 md:pb-10">
        {tab === 'beranda' && successNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-900 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
          >
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="min-w-0 flex-1 text-sm font-semibold">{successNotice}</p>
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
                Sesi absensi hari ini belum selesai ({myDay.sessionsCompleted}/
                {myDay.policySnapshot.jumlahSesi} sesi tercatat). Jangan lupa menyelesaikan sesi
                berikutnya.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setTab('absensi')}
              className="min-h-[44px] sm:min-h-[34px] px-3.5 py-2 sm:py-1.5 rounded-lg bg-amber-900 hover:bg-amber-800 dark:bg-amber-700 dark:hover:bg-amber-600 text-white text-xs font-semibold whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              Kembali ke Absensi
            </button>
          </div>
        )}

        {tab === 'beranda' && (
          <AttendanceFeedView
            user={user}
            myDay={myDay}
            focusAttendanceId={focusAttendanceId}
            onFocusHandled={() => setFocusAttendanceId(null)}
            onGoToAbsensi={() => setTab('absensi')}
          />
        )}
        {tab === 'absensi' && (
          <EmployeeAbsensiPage user={user} onSessionSubmitted={refreshMyDay} />
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

      {/* Mobile Fixed Bottom Nav (< 56px height) */}
      <nav
        aria-label="Navigasi Karyawan"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 pb-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-5 items-center"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.Icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
