import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CalendarDays,
  CheckSquare,
  Clock,
  FileSpreadsheet,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Sliders,
  UserCog,
  X,
} from 'lucide-react';
import { apiFetch, buildApiUrl, getStoredToken } from '../../lib/api';
import { useResetScroll } from '../../lib/scroll';
import type { AuthUser, Pengajuan, SystemSettings, WorkforceMember } from '../../shared/types';
import { AttendanceFeedView } from '../AttendanceFeedView';
import { ProfileSettingsPanel } from '../ProfileSettingsPanel';
import { ServerClock } from '../ServerClock';
import { ThemeToggle } from '../ThemeToggle';
import { UserAvatar } from '../UserAvatar';
import { PWAInstallButton } from '../PWAInstallButton';
import { AdminApprovalTab } from './AdminApprovalTab';
import { AdminCalendarTab } from './AdminCalendarTab';
import { AdminCheckinOverrideTab } from './AdminCheckinOverrideTab';
import { AdminDashboardTab } from './AdminDashboardTab';
import { AdminMasterTab } from './AdminMasterTab';
import { AdminPayrollTab } from './AdminPayrollTab';
import { AdminPolicyTab } from './AdminPolicyTab';

type AdminTab =
  | 'beranda'
  | 'dashboard'
  | 'checkin-override'
  | 'master'
  | 'policy'
  | 'calendar'
  | 'approval'
  | 'payroll'
  | 'profile';

const ADMIN_MENU: { id: AdminTab; label: string; Icon: typeof LayoutDashboard }[] = [
  { id: 'beranda', label: 'Beranda Absensi', Icon: Home },
  { id: 'dashboard', label: 'Monitoring Hari Ini', Icon: LayoutDashboard },
  { id: 'checkin-override', label: 'Izin Check-in Terlambat', Icon: Clock },
  { id: 'approval', label: 'Approval Pengajuan', Icon: CheckSquare },
  { id: 'payroll', label: 'Rekap Payroll & Override', Icon: FileSpreadsheet },
  { id: 'calendar', label: 'Kalender & Kerja Khusus', Icon: CalendarDays },
  { id: 'policy', label: 'Kebijakan Sesi', Icon: Sliders },
  { id: 'master', label: 'Master Karyawan & Kantor', Icon: Building2 },
  { id: 'profile', label: 'Profil & Akun Saya', Icon: UserCog },
];

interface AdminShellProps {
  user: AuthUser;
  settings: SystemSettings | null;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

export function AdminShell({
  user,
  settings,
  onUserUpdated,
  onLogout,
}: AdminShellProps) {
  const [tab, setTab] = useState<AdminTab>('beranda');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [badges, setBadges] = useState({ pendingRequests: 0, missingCheckIn: 0 });

  useResetScroll([tab]);

  const refreshBadges = useCallback(async () => {
    try {
      const [reqs, wf] = await Promise.all([
        apiFetch<{ items: Pengajuan[] }>('/api/v1/requests?status=PENDING'),
        apiFetch<{ items: WorkforceMember[] }>('/api/v1/workforce/today'),
      ]);
      const missingCheckIn = wf.items.filter(
        (w) => !w.sesi1Time && (w.isWorkingToday || w.operationalStatus === 'TIDAK_HADIR')
      ).length;
      setBadges({
        pendingRequests: reqs.items.length,
        missingCheckIn,
      });
    } catch {
      // Keep last known badge counts on transient network issues
    }
  }, []);

  useEffect(() => {
    void refreshBadges();
  }, [refreshBadges, tab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshBadges();
    }, 60000);

    const token = getStoredToken();
    const streamUrl = buildApiUrl(
      token
        ? `/api/v1/workforce/stream?token=${encodeURIComponent(token)}`
        : '/api/v1/workforce/stream'
    );
    const es = new EventSource(streamUrl);
    es.addEventListener('workforce', () => {
      void refreshBadges();
    });

    return () => {
      window.clearInterval(timer);
      es.close();
    };
  }, [refreshBadges]);

  const getMenuBadge = (id: AdminTab): { count: number; tone: 'amber' | 'rose' } | null => {
    if (id === 'approval' && badges.pendingRequests > 0) {
      return { count: badges.pendingRequests, tone: 'amber' };
    }
    if (id === 'dashboard' && badges.missingCheckIn > 0) {
      return { count: badges.missingCheckIn, tone: 'rose' };
    }
    return null;
  };

  const selectTab = (id: AdminTab) => {
    setTab(id);
    setDrawerOpen(false);
  };

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex transition-colors">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:flex-col lg:h-screen w-64 bg-gradient-to-b from-[#4a0e0a] via-[#5c140e] to-[#3d0c07] dark:bg-slate-900 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 text-white border-r border-brand-900 dark:border-slate-800 shrink-0">
        <div className="h-16 px-5 border-b border-white/10 dark:border-slate-800 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white p-1 flex items-center justify-center shrink-0 shadow-xs">
            <img
              src={logoSrc}
              alt={appName}
              className="w-full h-full object-contain"
            />
          </div>
          <span className="font-display text-base font-bold tracking-tight truncate">
            {appName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => selectTab('profile')}
          className="px-4 py-4 border-b border-white/10 dark:border-slate-800 text-xs text-left hover:bg-white/5 transition-colors flex items-center gap-3"
        >
          <UserAvatar
            karyawanId={user.karyawan_id}
            name={user.nama_lengkap}
            role={user.role}
            version={user.foto_profil_updated_at}
            size="md"
            previewable={false}
          />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{user.nama_lengkap}</p>
            <p className="text-brand-200 mt-0.5">ADMIN OPERASIONAL · Profil</p>
          </div>
        </button>
        <nav className="min-h-0 flex-1 p-3 space-y-1 overflow-y-auto overscroll-contain">
          {ADMIN_MENU.map((m) => {
            const Icon = m.Icon;
            const active = tab === m.id;
            const badge = getMenuBadge(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectTab(m.id)}
                className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-colors text-left ${
                  active
                    ? 'bg-[#c0392b] text-white shadow-sm'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{m.label}</span>
                </span>
                {badge && (
                  <span
                    className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${
                      badge.tone === 'amber'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-white/20 text-white border border-white/25'
                    }`}
                  >
                    {badge.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10 dark:border-slate-800">
          <button
            type="button"
            onClick={onLogout}
            className="w-full px-3 py-2.5 rounded-lg text-xs font-medium text-red-200 hover:bg-red-500/20 hover:text-white flex items-center gap-2.5 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Keluar Akun
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden flex"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="w-72 bg-gradient-to-b from-[#4a0e0a] via-[#5c140e] to-[#3d0c07] dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 text-white h-full flex flex-col border-r border-brand-900 dark:border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 px-4 border-b border-white/10 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-white p-0.5 flex items-center justify-center shrink-0">
                  <img
                    src={logoSrc}
                    alt={appName}
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="font-display text-sm font-bold truncate">{appName}</span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/10"
                aria-label="Tutup menu"
              >
                <X className="w-5 h-5 text-white/75" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => selectTab('profile')}
              className="px-4 py-3 border-b border-white/10 dark:border-slate-800 flex items-center gap-3 text-left"
            >
              <UserAvatar
                karyawanId={user.karyawan_id}
                name={user.nama_lengkap}
                role={user.role}
                version={user.foto_profil_updated_at}
                size="sm"
                previewable={false}
              />
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-white truncate">{user.nama_lengkap}</p>
                <p className="text-brand-200 text-[11px]">ADMIN · Profil</p>
              </div>
            </button>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {ADMIN_MENU.map((m) => {
                const Icon = m.Icon;
                const active = tab === m.id;
                const badge = getMenuBadge(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectTab(m.id)}
                    className={`w-full min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left ${
                      active ? 'bg-[#c0392b] text-white' : 'text-white/75 hover:bg-white/10'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{m.label}</span>
                    </span>
                    {badge && (
                      <span
                        className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${
                          badge.tone === 'amber'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-white/20 text-white border border-white/25'
                        }`}
                      >
                        {badge.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-white/10 dark:border-slate-800">
              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[44px] px-3 py-2.5 rounded-lg text-xs font-medium text-red-200 hover:bg-red-500/20 flex items-center gap-2.5"
              >
                <LogOut className="w-4 h-4" />
                Keluar Akun
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-64">
        <header className="sticky top-0 z-30 h-14 lg:h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
              aria-label="Buka menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              <span className="hidden md:inline text-slate-400 dark:text-slate-500 font-medium">
                Konsol Admin ·{' '}
              </span>
              {ADMIN_MENU.find((m) => m.id === tab)?.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton />
            <ServerClock compact />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => selectTab('profile')}
              className="inline-flex items-center justify-center gap-2 h-8 sm:h-9 px-1 sm:px-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
              aria-label="Profil Saya"
              title="Profil & Akun Saya"
            >
              <UserAvatar
                karyawanId={user.karyawan_id}
                name={user.nama_lengkap}
                role={user.role}
                version={user.foto_profil_updated_at}
                size="xs"
                previewable={false}
              />
              <span className="hidden sm:inline">Profil</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-xs font-semibold text-red-800 dark:text-red-300 whitespace-nowrap shrink-0"
              aria-label="Keluar Akun"
              title="Keluar Akun"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {tab === 'beranda' && (
            <AttendanceFeedView
              user={user}
              onNavigateMonitoring={() => setTab('dashboard')}
            />
          )}
          {tab === 'dashboard' && (
            <AdminDashboardTab onNavigateApproval={() => setTab('approval')} />
          )}
          {tab === 'checkin-override' && <AdminCheckinOverrideTab />}
          {tab === 'approval' && <AdminApprovalTab />}
          {tab === 'payroll' && (
            <AdminPayrollTab settings={settings} printedByName={user.nama_lengkap} />
          )}
          {tab === 'calendar' && <AdminCalendarTab />}
          {tab === 'policy' && <AdminPolicyTab />}
          {tab === 'master' && (
            <AdminMasterTab settings={settings} printedByName={user.nama_lengkap} />
          )}
          {tab === 'profile' && (
            <ProfileSettingsPanel
              user={user}
              onUserUpdated={onUserUpdated}
              onLogout={onLogout}
            />
          )}
        </main>
      </div>
    </div>
  );
}
