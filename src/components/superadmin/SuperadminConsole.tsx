import { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  Home,
  Image as ImageIcon,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import { exportPayrollToExcel, exportPayrollToImage } from '../../lib/exportUtils';
import type {
  AuditLog,
  AuthUser,
  MonthlySummary,
  OverrideKehadiran,
  PendaftaranAkun,
  PeriodePayroll,
  SystemSettings,
} from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { AttendanceFeedView } from '../AttendanceFeedView';
import { ProfileSettingsPanel } from '../ProfileSettingsPanel';
import { ServerClock } from '../ServerClock';
import { StatusBadge } from '../StatusBadge';
import { ThemeToggle } from '../ThemeToggle';
import { UserAvatar } from '../UserAvatar';
import { SuperadminAccountsTab } from './SuperadminAccountsTab';
import { SuperadminSettingsTab } from './SuperadminSettingsTab';

type SuperTab =
  | 'beranda'
  | 'overview'
  | 'accounts'
  | 'settings'
  | 'audit'
  | 'evidence'
  | 'payroll'
  | 'profile';

interface EvidenceRow {
  id: number;
  karyawan_id: number;
  nama_lengkap: string;
  nik: string;
  kantor_nama: string;
  bidang_nama: string;
  tanggal: string;
  urutan_sesi: number;
  nama_sesi: string;
  waktu_server: string;
  status_ketepatan: string;
  jarak_kantor_meter: number | null;
  dalam_geofence: number;
  tipe_aktivitas: string;
  deskripsi_aktivitas: string;
  foto_path: string | null;
}

interface OverviewPayload {
  bulan: string;
  metrics: {
    totalKaryawan: number;
    totalHariMasuk: number;
    totalTidakHadir: number;
    totalNormalMasuk: number;
    totalOverrideMasuk: number;
    totalOverrideTidakMasuk: number;
  };
  recentOverrides: OverrideKehadiran[];
  recentEvidence: EvidenceRow[];
}

interface SuperadminConsoleProps {
  user: AuthUser;
  settings: SystemSettings | null;
  onUserUpdated: (user: AuthUser) => void;
  onSettingsUpdated: (settings: SystemSettings) => void;
  onLogout: () => void;
}

export function SuperadminConsole({
  user,
  settings,
  onUserUpdated,
  onSettingsUpdated,
  onLogout,
}: SuperadminConsoleProps) {
  const [tab, setTab] = useState<SuperTab>('beranda');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulan, setBulan] = useState(() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '11';
    return `${y}-${m}`;
  });

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [modulFilter, setModulFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [period, setPeriod] = useState<PeriodePayroll | null>(null);
  const [pendingRegCount, setPendingRegCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedAudit, setSelectedAudit] = useState<AuditLog | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRow | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const auditQs = new URLSearchParams();
      if (modulFilter) auditQs.set('modul', modulFilter);
      if (roleFilter) auditQs.set('actorRole', roleFilter);

      const [ov, au, pay, regs] = await Promise.all([
        apiFetch<OverviewPayload>(`/api/v1/superadmin/overview?bulan=${encodeURIComponent(bulan)}`),
        apiFetch<{ items: AuditLog[] }>(`/api/v1/audit?${auditQs.toString()}`),
        apiFetch<{ period: PeriodePayroll | null; items: MonthlySummary[] }>(
          `/api/v1/payroll/summary?bulan=${encodeURIComponent(bulan)}`
        ),
        apiFetch<{ items: PendaftaranAkun[] }>(`/api/v1/superadmin/registrations?status=PENDING`),
      ]);
      setOverview(ov);
      setAudits(au.items);
      setSummaries(pay.items);
      setPeriod(pay.period);
      setPendingRegCount(regs.items.length);
    } finally {
      setLoading(false);
    }
  }, [bulan, modulFilter, roleFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const overrideCols: ColumnDef<OverrideKehadiran>[] = [
    {
      key: 'tanggal',
      header: 'Tanggal Terdampak',
      sortValue: (r) => r.tanggal,
      render: (r) => (
        <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
          {r.tanggal}
        </span>
      ),
    },
    {
      key: 'karyawan',
      header: 'Karyawan',
      sortValue: (r) => r.karyawan_nama || '',
      render: (r) => (
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {r.karyawan_nama}
        </span>
      ),
    },
    {
      key: 'perubahan',
      header: 'Awal → Override',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-mono text-slate-600 dark:text-slate-400">{r.hasil_awal}</span>
          <span className="text-slate-400">→</span>
          <StatusBadge status={r.hasil_override} />
        </div>
      ),
    },
    {
      key: 'alasan',
      header: 'Alasan Admin',
      render: (r) => <span className="text-xs text-slate-700 dark:text-slate-300">{r.alasan}</span>,
    },
    {
      key: 'actor',
      header: 'Dieksekusi Oleh',
      render: (r) => (
        <div className="text-xs">
          <p className="font-semibold text-slate-800 dark:text-slate-200">@{r.admin_nama}</p>
          <p className="font-mono text-slate-500 dark:text-slate-400">
            {r.created_at.slice(0, 16).replace('T', ' ')}
          </p>
        </div>
      ),
    },
  ];

  const auditCols: ColumnDef<AuditLog>[] = [
    {
      key: 'waktu',
      header: 'Waktu Server',
      sortValue: (r) => r.waktu_server,
      render: (r) => (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
          {r.waktu_server.slice(0, 19).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Aktor & Role',
      sortValue: (r) => r.actor_name,
      render: (r) => (
        <div className="text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.actor_name}</p>
          <p className="font-mono text-slate-500 dark:text-slate-400">{r.actor_role}</p>
        </div>
      ),
    },
    {
      key: 'aksi',
      header: 'Modul & Aksi',
      sortValue: (r) => r.modul,
      render: (r) => (
        <div className="text-xs">
          <p className="font-bold text-navy-900 dark:text-blue-400">{r.modul}</p>
          <p className="font-mono text-slate-600 dark:text-slate-400">{r.aksi}</p>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target / Karyawan',
      render: (r) => (
        <div className="text-xs text-slate-700 dark:text-slate-300">
          <p>{r.karyawan_nama || `${r.target_entity} #${r.target_id}`}</p>
          {r.tanggal_terdampak && (
            <p className="font-mono text-slate-500 dark:text-slate-400">Tgl: {r.tanggal_terdampak}</p>
          )}
        </div>
      ),
    },
    {
      key: 'alasan',
      header: 'Alasan',
      render: (r) => (
        <span className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 max-w-xs">
          {r.alasan || '—'}
        </span>
      ),
    },
    {
      key: 'detail',
      header: 'Before / After',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => setSelectedAudit(r)}
          className="inline-flex items-center gap-1 min-h-[36px] px-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
        >
          <Eye className="w-3.5 h-3.5" />
          Inspeksi
        </button>
      ),
    },
  ];

  const evidenceCols: ColumnDef<EvidenceRow>[] = [
    {
      key: 'waktu',
      header: 'Waktu Server',
      sortValue: (r) => r.waktu_server,
      render: (r) => (
        <span className="font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
          {r.tanggal} · {r.waktu_server.slice(11, 16)}
        </span>
      ),
    },
    {
      key: 'karyawan',
      header: 'Karyawan',
      sortValue: (r) => r.nama_lengkap,
      render: (r) => (
        <div className="text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.nama_lengkap}</p>
          <p className="text-slate-500 dark:text-slate-400">
            {r.nik} · {r.kantor_nama.split('(')[0].trim()}
          </p>
        </div>
      ),
    },
    {
      key: 'sesi',
      header: 'Sesi & Aktivitas',
      render: (r) => (
        <div className="text-xs max-w-xs">
          <p className="font-semibold text-slate-800 dark:text-slate-200">{r.nama_sesi}</p>
          <p className="text-slate-500 dark:text-slate-400 truncate">
            {r.tipe_aktivitas} · {r.deskripsi_aktivitas}
          </p>
        </div>
      ),
    },
    {
      key: 'geo',
      header: 'Geofence & Ketepatan',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <StatusBadge status={r.status_ketepatan} />
          <span className="font-mono text-slate-600 dark:text-slate-400">
            {r.jarak_kantor_meter !== null ? `${r.jarak_kantor_meter}m` : 'No GPS'}
          </span>
        </div>
      ),
    },
    {
      key: 'foto',
      header: 'Bukti Foto',
      align: 'right',
      render: (r) =>
        r.foto_path ? (
          <button
            type="button"
            onClick={() => setSelectedEvidence(r)}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Lihat Foto
          </button>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">Tanpa foto</span>
        ),
    },
  ];

  const payrollCols: ColumnDef<MonthlySummary>[] = [
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
      sortValue: (r) => r.karyawanNama,
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.karyawanNama}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {r.kantorNama.split('(')[0].trim()} · {r.bidangNama}
          </p>
        </div>
      ),
    },
    {
      key: 'masuk',
      header: 'HARI MASUK',
      align: 'right',
      sortValue: (r) => r.hariMasuk,
      render: (r) => (
        <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
          {r.hariMasuk} hari
        </span>
      ),
    },
    {
      key: 'absen',
      header: 'TIDAK HADIR',
      align: 'right',
      sortValue: (r) => r.tidakHadir,
      render: (r) => (
        <span
          className={`font-mono text-sm font-bold tabular-nums ${
            r.tidakHadir > 0
              ? 'text-red-700 dark:text-red-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {r.tidakHadir} hari
        </span>
      ),
    },
    {
      key: 'ov',
      header: 'Override',
      align: 'center',
      sortValue: (r) => r.rincian.totalOverride,
      render: (r) => (
        <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
          {r.rincian.totalOverride}
        </span>
      ),
    },
  ];

  const menuItems: { id: SuperTab; label: string; Icon: typeof ShieldCheck; badge?: number }[] = [
    { id: 'beranda', label: 'Beranda Absensi', Icon: Home },
    { id: 'overview', label: 'Ringkasan & Override', Icon: ShieldAlert },
    { id: 'accounts', label: 'Kelola Akun & ACC', Icon: Users, badge: pendingRegCount },
    { id: 'settings', label: 'Pengaturan Sistem', Icon: Settings },
    { id: 'audit', label: 'Audit Trail Append-Only', Icon: History },
    { id: 'evidence', label: 'Bukti Foto & GPS', Icon: Camera },
    { id: 'payroll', label: 'Rekap Payroll & Export', Icon: FileSpreadsheet },
    { id: 'profile', label: 'Profil & Akun Saya', Icon: UserCog },
  ];

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex transition-colors">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-navy-950 text-white shrink-0">
        <div className="h-16 px-5 border-b border-white/10 flex items-center gap-2.5">
          <img
            src={logoSrc}
            alt={appName}
            className="w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5 border border-white/15 shrink-0"
          />
          <span className="font-display text-base font-bold tracking-tight truncate">
            {appName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTab('profile')}
          className="px-4 py-4 border-b border-white/10 text-xs text-left hover:bg-white/5 transition-colors flex items-center gap-3"
        >
          <UserAvatar
            karyawanId={user.karyawan_id}
            name={user.nama_lengkap}
            role={user.role}
            version={user.foto_profil_updated_at}
            size="md"
          />
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{user.nama_lengkap}</p>
            <p className="text-amber-300 mt-0.5 font-semibold">SUPERADMIN · OWNER</p>
            <p className="text-slate-400 mt-0.5 text-[11px]">Kelola Profil & Foto</p>
          </div>
        </button>
        <nav className="flex-1 p-3 space-y-1">
          {menuItems.map((m) => {
            const Icon = m.Icon;
            const active = tab === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setTab(m.id)}
                className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left transition-colors ${
                  active
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{m.label}</span>
                </span>
                {m.badge && m.badge > 0 ? (
                  <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-navy-950 shrink-0">
                    {m.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
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
          className="fixed inset-0 z-50 bg-black/50 lg:hidden flex"
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="w-72 bg-navy-950 text-white h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={logoSrc}
                  alt={appName}
                  className="w-7 h-7 rounded-md object-contain bg-white/10 p-0.5 shrink-0"
                />
                <span className="font-display text-sm font-bold truncate">{appName}</span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-300" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setTab('profile');
                setDrawerOpen(false);
              }}
              className="px-4 py-3 border-b border-white/10 flex items-center gap-3 text-left"
            >
              <UserAvatar
                karyawanId={user.karyawan_id}
                name={user.nama_lengkap}
                role={user.role}
                version={user.foto_profil_updated_at}
                size="sm"
              />
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-white truncate">{user.nama_lengkap}</p>
                <p className="text-amber-300 text-[11px]">SUPERADMIN · Profil</p>
              </div>
            </button>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {menuItems.map((m) => {
                const Icon = m.Icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setTab(m.id);
                      setDrawerOpen(false);
                    }}
                    className={`w-full px-3 py-3 rounded-lg text-xs font-medium flex items-center justify-between gap-2 text-left ${
                      tab === m.id ? 'bg-blue-700 text-white' : 'text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{m.label}</span>
                    </span>
                    {m.badge && m.badge > 0 ? (
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-400 text-navy-950">
                        {m.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-white/10">
              <button
                type="button"
                onClick={onLogout}
                className="w-full px-3 py-3 rounded-lg text-xs font-medium text-red-200 hover:bg-red-500/20 flex items-center gap-2.5"
              >
                <LogOut className="w-4 h-4" />
                Keluar Akun
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-12 lg:h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 transition-colors">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
              Konsol Owner / CEO · {menuItems.find((m) => m.id === tab)?.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {tab !== 'beranda' && tab !== 'profile' && tab !== 'accounts' && tab !== 'settings' && (
              <input
                type="month"
                value={bulan}
                onChange={(e) => setBulan(e.target.value)}
                className="h-9 px-2.5 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hidden sm:block"
              />
            )}
            <ServerClock compact />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setTab('profile')}
              className="inline-flex items-center gap-2 pl-1.5 pr-2 sm:pr-2.5 py-1 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <UserAvatar
                karyawanId={user.karyawan_id}
                name={user.nama_lengkap}
                role={user.role}
                version={user.foto_profil_updated_at}
                size="xs"
              />
              <span className="hidden sm:inline">Profil</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[38px] rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-xs font-semibold text-red-800 dark:text-red-300 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden xs:inline sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-5 sm:space-y-6">
          {tab === 'beranda' ? (
            <AttendanceFeedView
              user={user}
              onNavigateAudit={() => setTab('evidence')}
            />
          ) : tab === 'profile' ? (
            <ProfileSettingsPanel
              user={user}
              onUserUpdated={onUserUpdated}
              onLogout={onLogout}
            />
          ) : tab === 'accounts' ? (
            <SuperadminAccountsTab
              currentUser={user}
              onCurrentUserUpdated={onUserUpdated}
              onPendingCountChange={setPendingRegCount}
            />
          ) : tab === 'settings' ? (
            <SuperadminSettingsTab onSettingsUpdated={onSettingsUpdated} />
          ) : (
            <>
              {/* Mobile Month Selector */}
              <div className="sm:hidden flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Periode Data
                </span>
                <input
                  type="month"
                  value={bulan}
                  onChange={(e) => setBulan(e.target.value)}
                  className="h-10 px-2.5 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Executive Metrics Strip */}
              {overview && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-navy-900 text-white rounded-xl p-4 sm:p-5">
                    <p className="text-[11px] sm:text-xs text-blue-300 font-medium">
                      TOTAL HARI MASUK
                    </p>
                    <p className="font-mono text-2xl sm:text-3xl font-bold tabular-nums mt-1">
                      {overview.metrics.totalHariMasuk}
                    </p>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Normal: {overview.metrics.totalNormalMasuk} · Override:{' '}
                      {overview.metrics.totalOverrideMasuk}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
                      TOTAL TIDAK HADIR
                    </p>
                    <p className="font-mono text-2xl sm:text-3xl font-bold text-red-700 dark:text-red-400 tabular-nums mt-1">
                      {overview.metrics.totalTidakHadir}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Override Tidak Masuk: {overview.metrics.totalOverrideTidakMasuk}
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
                      TOTAL ADMIN OVERRIDE
                    </p>
                    <p className="font-mono text-2xl sm:text-3xl font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
                      {overview.recentOverrides.length}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Semua bukti asli tetap utuh
                    </p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
                      STATUS PERIODE {bulan}
                    </p>
                    <div className="mt-2">
                      <StatusBadge status={period?.status === 'CLOSED' ? 'CLOSED' : 'OPEN'} />
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                      {audits.length} entri audit tercatat
                    </p>
                  </div>
                </div>
              )}

              {tab === 'overview' && overview && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Daftar Perubahan & Admin Override Terbaru
                    </h2>
                  </div>
                  <DataTable
                    data={overview.recentOverrides}
                    columns={overrideCols}
                    getRowId={(r) => r.id}
                    loading={loading}
                    searchPlaceholder="Cari nama karyawan atau alasan override..."
                    searchFilter={(r, q) =>
                      (r.karyawan_nama || '').toLowerCase().includes(q) ||
                      r.alasan.toLowerCase().includes(q)
                    }
                  />
                </div>
              )}

              {tab === 'audit' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-navy-900 dark:bg-slate-900 border border-transparent dark:border-slate-800 text-white text-xs flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    <span>
                      Audit trail bersifat <strong>append-only</strong> pada level database SQLite. Admin tidak memiliki akses untuk mengubah atau menghapus catatan audit mana pun.
                    </span>
                  </div>
                  <DataTable
                    data={audits}
                    columns={auditCols}
                    getRowId={(r) => r.id}
                    loading={loading}
                    searchPlaceholder="Cari aktor, aksi, atau alasan..."
                    searchFilter={(r, q) =>
                      r.actor_name.toLowerCase().includes(q) ||
                      r.aksi.toLowerCase().includes(q) ||
                      (r.alasan || '').toLowerCase().includes(q) ||
                      (r.karyawan_nama || '').toLowerCase().includes(q)
                    }
                    filterToolbar={
                      <>
                        <select
                          value={modulFilter}
                          onChange={(e) => setModulFilter(e.target.value)}
                          className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg w-full sm:w-auto"
                        >
                          <option value="">Semua Modul</option>
                          <option value="OVERRIDE_KEHADIRAN">OVERRIDE KEHADIRAN</option>
                          <option value="CLOSING_KOREKSI">KOREKSI CLOSING</option>
                          <option value="MONTHLY_CLOSING">MONTHLY CLOSING</option>
                          <option value="MANAJEMEN_AKUN">MANAJEMEN AKUN & ACC</option>
                          <option value="PENDAFTARAN_AKUN">PENDAFTARAN AKUN</option>
                          <option value="PENGATURAN_SISTEM">PENGATURAN SISTEM</option>
                          <option value="PROFIL_AKUN">PROFIL AKUN</option>
                          <option value="ABSENSI">ABSENSI</option>
                          <option value="PENGAJUAN">PENGAJUAN</option>
                          <option value="POLICY_SESI">POLICY SESI</option>
                          <option value="KALENDER_LIBUR">KALENDER LIBUR</option>
                          <option value="KERJA_KHUSUS">KERJA KHUSUS</option>
                          <option value="EXPORT_LAPORAN">EXPORT LAPORAN</option>
                        </select>
                        <select
                          value={roleFilter}
                          onChange={(e) => setRoleFilter(e.target.value)}
                          className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg w-full sm:w-auto"
                        >
                          <option value="">Semua Role</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="KARYAWAN">KARYAWAN</option>
                          <option value="SUPERADMIN">SUPERADMIN</option>
                        </select>
                      </>
                    }
                  />
                </div>
              )}

              {tab === 'evidence' && overview && (
                <DataTable
                  data={overview.recentEvidence}
                  columns={evidenceCols}
                  getRowId={(r) => r.id}
                  loading={loading}
                  searchPlaceholder="Cari nama, NIK, atau aktivitas..."
                  searchFilter={(r, q) =>
                    r.nama_lengkap.toLowerCase().includes(q) ||
                    r.nik.toLowerCase().includes(q) ||
                    r.deskripsi_aktivitas.toLowerCase().includes(q)
                  }
                />
              )}

              {tab === 'payroll' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Rekap Kehadiran Bulanan ({bulan})
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => exportPayrollToExcel(bulan, summaries)}
                        className="min-h-[42px] sm:min-h-[36px] px-3.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        Excel
                      </button>
                      <button
                        type="button"
                        onClick={() => exportPayrollToImage(bulan, summaries, 'png')}
                        className="min-h-[42px] sm:min-h-[36px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <ImageIcon className="w-4 h-4" />
                        PNG
                      </button>
                      <button
                        type="button"
                        onClick={() => exportPayrollToImage(bulan, summaries, 'jpeg')}
                        className="min-h-[42px] sm:min-h-[36px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                      >
                        <Download className="w-4 h-4" />
                        JPG
                      </button>
                    </div>
                  </div>
                  <DataTable
                    data={summaries}
                    columns={payrollCols}
                    getRowId={(r) => r.karyawanId}
                    loading={loading}
                    searchPlaceholder="Cari NIK atau nama..."
                    searchFilter={(r, q) =>
                      r.karyawanNama.toLowerCase().includes(q) || r.nik.toLowerCase().includes(q)
                    }
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Audit Snapshot Modal */}
      {selectedAudit && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelectedAudit(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] sm:max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                  Audit #{selectedAudit.id} · {selectedAudit.modul} ({selectedAudit.aksi})
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {selectedAudit.waktu_server} · {selectedAudit.actor_name} ({selectedAudit.actor_role})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAudit(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">IP Address:</span>{' '}
                  <span className="font-mono text-slate-900 dark:text-slate-100">
                    {selectedAudit.ip_address}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Tanggal Terdampak:</span>{' '}
                  <span className="font-mono text-slate-900 dark:text-slate-100">
                    {selectedAudit.tanggal_terdampak || '—'}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500 dark:text-slate-400">Alasan:</span>{' '}
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {selectedAudit.alasan || '—'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Before Snapshot
                  </p>
                  <pre className="p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-[11px] overflow-x-auto">
                    {selectedAudit.before_json
                      ? JSON.stringify(JSON.parse(selectedAudit.before_json), null, 2)
                      : 'null'}
                  </pre>
                </div>
                <div>
                  <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    After Snapshot
                  </p>
                  <pre className="p-3 rounded-lg bg-slate-950 text-emerald-300 font-mono text-[11px] overflow-x-auto">
                    {selectedAudit.after_json
                      ? JSON.stringify(JSON.parse(selectedAudit.after_json), null, 2)
                      : 'null'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Proof Lightbox */}
      {selectedEvidence && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelectedEvidence(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {selectedEvidence.nama_lengkap} · {selectedEvidence.nama_sesi}
                </p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {selectedEvidence.tanggal} · {selectedEvidence.waktu_server.slice(11, 19)} WIB
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvidence(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="bg-slate-950 flex items-center justify-center max-h-[60vh]">
              <img
                src={getAuthorizedPhotoUrl(selectedEvidence.id)}
                alt="Bukti absensi"
                className="max-h-[60vh] w-full object-contain"
              />
            </div>
            <div className="p-4 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 space-y-1">
              <p>
                <strong>Aktivitas:</strong> {selectedEvidence.tipe_aktivitas} —{' '}
                {selectedEvidence.deskripsi_aktivitas}
              </p>
              <p className="font-mono">
                <strong>Geofence:</strong>{' '}
                {selectedEvidence.jarak_kantor_meter !== null
                  ? `${selectedEvidence.jarak_kantor_meter}m (${
                      selectedEvidence.dalam_geofence ? 'Dalam Radius' : 'Luar Radius'
                    })`
                  : 'Koordinat tidak ada'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
