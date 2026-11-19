import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Info,
  Lock,
  LogIn,
  Mail,
  Megaphone,
  UserPlus,
} from 'lucide-react';
import { apiFetch, loginApi } from '../lib/api';
import { useServerClock } from '../lib/server-clock-client';
import type { AuthUser, BidangKerja, Kantor, SystemSettings } from '../shared/types';
import { ServerClock } from './ServerClock';
import { ThemeToggle } from './ThemeToggle';

interface LoginViewProps {
  settings: SystemSettings | null;
  onSuccess: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  { username: 'superadmin', label: 'Superadmin', role: 'Owner' },
  { username: 'admin', label: 'Admin', role: 'Operasional' },
  { username: 'andi', label: 'Andi', role: 'Teknisi 3 Sesi' },
  { username: 'rina', label: 'Rina', role: 'Admin Kantor' },
  { username: 'dimas', label: 'Dimas', role: 'Lead 4 Sesi' },
];

const inputBaseClass =
  'h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-[#f8f9fb] px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#c0392b] focus:bg-white focus:ring-4 focus:ring-[#c0392b]/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:bg-slate-950';
const regInputClass =
  'h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-[#f8f9fb] px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#c0392b] focus:bg-white focus:ring-4 focus:ring-[#c0392b]/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400';
const labelClass =
  'mb-1.5 block text-[11px] font-bold tracking-[0.06em] uppercase text-slate-600 dark:text-slate-400';

export function LoginView({ settings, onSuccess }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const serverClock = useServerClock(30_000);
  const serverYear = serverClock.dateWib ? serverClock.dateWib.slice(0, 4) : '2026';

  // Login states
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Registration options & states
  const [offices, setOffices] = useState<Pick<Kantor, 'id' | 'kode' | 'nama'>[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [regRole, setRegRole] = useState<'KARYAWAN' | 'ADMIN'>('KARYAWAN');
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regHp, setRegHp] = useState('');
  const [regKantorId, setRegKantorId] = useState<number>(1);
  const [regBidangId, setRegBidangId] = useState<number>(1);
  const [regJabatan, setRegJabatan] = useState('Teknisi Lapangan');
  const [regCatatan, setRegCatatan] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regFotoBase64, setRegFotoBase64] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [mode]);

  useEffect(() => {
    apiFetch<{ offices: Pick<Kantor, 'id' | 'kode' | 'nama'>[]; bidangList: BidangKerja[] }>(
      '/api/v1/auth/register-options'
    )
      .then((res) => {
        setOffices(res.offices);
        setBidangList(res.bidangList);
        if (res.offices[0]) setRegKantorId(res.offices[0].id);
        if (res.bidangList[0]) setRegBidangId(res.bidangList[0].id);
      })
      .catch(() => {});
  }, []);

  const handleSelectRegRole = (nextRole: 'KARYAWAN' | 'ADMIN') => {
    setRegRole(nextRole);
    if (nextRole === 'ADMIN') {
      const admBidang = bidangList.find((b) => b.kode === 'ADM');
      if (admBidang) setRegBidangId(admBidang.id);
      setRegJabatan('Admin Operasional');
    } else {
      const tekBidang = bidangList.find((b) => b.kode === 'TEK') || bidangList[0];
      if (tekBidang) setRegBidangId(tekBidang.id);
      setRegJabatan('Teknisi Lapangan');
    }
  };

  const handleRegPhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setRegError('Ukuran foto profil maksimal 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRegFotoBase64(reader.result);
        setRegError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const subtitle = settings?.subjudul_login || 'Sistem Absensi';
  const loginAnnouncement = (settings?.pengumuman_login || '').trim();
  const footerText = settings?.footer_login || 'Sistem Kehadiran & Payroll';
  const showDemo = Boolean(settings?.izin_demo_login);
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '2'
  )}`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await loginApi(identifier, password);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);

    if (regPassword !== regConfirmPassword) {
      setRegError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setRegLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          nama_lengkap: regName,
          username: regUsername,
          email: regEmail,
          no_hp: regHp,
          password: regPassword,
          role_diminta: regRole,
          jabatan: regJabatan,
          kantor_id: regKantorId,
          bidang_id: regBidangId,
          catatan_pendaftar: regCatatan,
          fotoBase64: regFotoBase64,
        }),
      });
      setRegSuccess(
        res.message ||
          'Pendaftaran berhasil dikirim dan menunggu persetujuan (ACC) Superadmin sebelum dapat masuk.'
      );
      setRegName('');
      setRegUsername('');
      setRegEmail('');
      setRegHp('');
      setRegPassword('');
      setRegConfirmPassword('');
      setRegCatatan('');
      setRegFotoBase64(null);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Gagal mengirim pendaftaran akun.');
    } finally {
      setRegLoading(false);
    }
  };

  const quickLogin = async (username: string) => {
    setIdentifier(username);
    setPassword('bignet123');
    setError(null);
    setLoading(true);
    try {
      const res = await loginApi(username, 'bignet123');
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100svh] w-full bg-[#f8f9fb] text-slate-900 dark:bg-slate-950 dark:text-slate-100 lg:grid lg:grid-cols-2">
      {/* Desktop Left Brand Panel (50% split) */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:p-14"
        style={{
          background:
            'radial-gradient(circle at 88% 92%, #d94334 0%, #c0392b 38%, #7f1d15 76%, #4a0e0a 100%)',
        }}
      >
        {/* Top Brand Lockup */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm">
              <img
                src={logoSrc}
                alt={`Logo ${appName}`}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-extrabold tracking-tight text-white">
                PT. BIG
              </p>
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-white/75">
                {subtitle}
              </p>
            </div>
          </div>
          <ThemeToggle onDark />
        </div>

        {/* Center Hero Headline */}
        <div className="relative z-10 my-auto max-w-lg py-10">
          <h1 className="font-display text-4xl font-extrabold leading-[1.12] tracking-tight text-white xl:text-[46px]">
            Selamat Datang di
            <span className="mt-1 block text-[#ffb8b0]">
              {appName.toUpperCase()}
            </span>
          </h1>
          <p className="mt-5 text-sm font-medium uppercase tracking-[0.12em] text-white/85">
            APLIKASI INTERNAL BIGNET
          </p>

          <div className="mt-7 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-black/20 px-4 py-2 backdrop-blur-sm">
            <ServerClock compact onDark />
          </div>
        </div>

        {/* Bottom Copyright */}
        <div className="relative z-10 text-xs text-white/65">
          © {serverYear} {appName.toUpperCase()} · {footerText}
        </div>
      </aside>

      {/* Right Authentication Area (Full Canvas on Mobile) */}
      <main className="flex min-h-screen min-h-[100svh] w-full flex-col items-center justify-center px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {/* Mobile Minimal Utility Bar */}
        <div
          className={`mb-4 flex w-full items-center justify-between lg:hidden ${
            mode === 'register' ? 'max-w-[520px]' : 'max-w-[420px]'
          }`}
        >
          <ServerClock compact />
          <ThemeToggle />
        </div>

        <section
          className={`w-full rounded-2xl border border-slate-100 bg-white px-6 py-8 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.09)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30 sm:px-9 sm:py-10 ${
            mode === 'register' ? 'max-w-[520px]' : 'max-w-[420px]'
          }`}
        >
          {/* Centered Card Header */}
          <div className="text-center">
            <div className="mx-auto inline-flex items-center justify-center dark:rounded-xl dark:bg-white dark:px-3 dark:py-1.5">
              <img
                src={logoSrc}
                alt={`Logo ${appName}`}
                className="h-14 w-auto max-w-[160px] object-contain"
              />
            </div>

            <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#c0392b] dark:text-brand-400">
              {subtitle} · PT. BIG
            </p>

            <h2 className="mt-1.5 font-display text-[22px] font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              {mode === 'login' ? 'Selamat Datang Kembali' : 'Buat Akun Baru'}
            </h2>

            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-[13px]">
              {mode === 'login'
                ? 'Masuk untuk melanjutkan ke sistem absensi.'
                : 'Lengkapi data diri. Akun aktif setelah disetujui Superadmin.'}
            </p>
          </div>

          {loginAnnouncement && mode === 'login' && (
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs leading-relaxed text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/50 dark:text-brand-200">
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#c0392b] dark:text-brand-400" />
              <span className="min-w-0 break-words">{loginAnnouncement}</span>
            </div>
          )}

          {mode === 'login' ? (
            <div className="mt-7">
              {error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="login-identifier" className={labelClass}>
                    Alamat Email atau Username
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      id="login-identifier"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      required
                      autoComplete="username"
                      placeholder="nama@bignet.id atau username"
                      className={inputBaseClass + ' pl-10'}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      htmlFor="login-password"
                      className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400"
                    >
                      Kata Sandi
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowForgotHelp((v) => !v)}
                      className="text-xs font-semibold text-[#c0392b] transition hover:text-[#a93226] hover:underline dark:text-brand-400"
                    >
                      Lupa Kata Sandi?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className={inputBaseClass + ' pl-10 pr-11'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute inset-y-0 right-1 flex w-10 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label={showPass ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {showForgotHelp && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c0392b] dark:text-brand-400" />
                      <span>
                        Silakan hubungi Admin Operasional atau Superadmin PT. BIG untuk mereset kata sandi akun Anda.
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c0392b] px-4 text-sm font-semibold text-white shadow-sm shadow-[#c0392b]/25 transition hover:bg-[#a93226] active:bg-[#922b21] focus:outline-none focus:ring-4 focus:ring-[#c0392b]/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogIn className="h-4 w-4" />
                  {loading ? 'Memverifikasi...' : 'Masuk'}
                </button>
              </form>

              <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
                <p className="mb-3 text-center text-xs text-slate-400 dark:text-slate-500">
                  Belum punya akun?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setRegSuccess(null);
                  }}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <UserPlus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  Buat Akun Baru
                </button>
              </div>

              {showDemo && (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <p className="mb-2.5 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    Akses Cepat Demo · Sandi:{' '}
                    <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                      bignet123
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {DEMO_ACCOUNTS.map((acc) => (
                      <button
                        key={acc.username}
                        type="button"
                        disabled={loading}
                        onClick={() => quickLogin(acc.username)}
                        className="flex min-h-10 flex-col items-center justify-center rounded-lg border border-slate-200/90 bg-[#f8f9fb] px-2 py-1.5 text-center transition hover:border-[#c0392b]/40 hover:bg-brand-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-brand-500/50 dark:hover:bg-brand-950/30"
                      >
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {acc.label}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {acc.role}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mobile Card Footer */}
              <p className="mt-7 text-center text-[11px] tracking-wide text-slate-400 dark:text-slate-500 lg:hidden">
                © {serverYear} {appName.toUpperCase()} · PT. BIG
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {regSuccess ? (
                <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30 sm:p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                      Pendaftaran Terkirim
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {regSuccess}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Anda baru dapat masuk setelah Superadmin menyetujui pendaftaran dan menerbitkan NIK akun.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setRegSuccess(null);
                    }}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#c0392b] px-4 text-xs font-semibold text-white transition hover:bg-[#a93226]"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Kembali ke Halaman Masuk
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {regError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                      {regError}
                    </div>
                  )}

                  <div>
                    <label className={labelClass}>Daftar Sebagai Role</label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => handleSelectRegRole('KARYAWAN')}
                        className={
                          regRole === 'KARYAWAN'
                            ? 'min-h-14 rounded-xl border border-[#c0392b] bg-brand-50 px-3 py-3 text-left text-brand-900 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-100'
                            : 'min-h-14 rounded-xl border border-slate-200 bg-[#f8f9fb] px-3 py-3 text-left text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                        }
                      >
                        <span className="block text-xs font-bold">Teknisi / Karyawan</span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          Absensi sesi, GPS, dan pengajuan
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectRegRole('ADMIN')}
                        className={
                          regRole === 'ADMIN'
                            ? 'min-h-14 rounded-xl border border-[#c0392b] bg-brand-50 px-3 py-3 text-left text-brand-900 dark:border-brand-500 dark:bg-brand-950/40 dark:text-brand-100'
                            : 'min-h-14 rounded-xl border border-slate-200 bg-[#f8f9fb] px-3 py-3 text-left text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                        }
                      >
                        <span className="block text-xs font-bold">Admin Operasional</span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          Approval, kalender, dan payroll
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-[#f8f9fb] p-3 dark:border-slate-700 dark:bg-slate-950/60">
                    {regFotoBase64 ? (
                      <img
                        src={regFotoBase64}
                        alt="Pratinjau foto profil"
                        className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#c0392b] font-display text-sm font-bold text-white">
                        {(regName || 'BG').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Foto Profil Akun
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        PNG, JPG, atau WEBP maksimal 2 MB.
                      </p>
                      <label className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                        <Camera className="h-3.5 w-3.5" />
                        {regFotoBase64 ? 'Ganti Foto' : 'Pilih Foto'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            handleRegPhotoFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="register-name" className={labelClass}>
                        Nama Lengkap
                      </label>
                      <input
                        id="register-name"
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        autoComplete="name"
                        placeholder="Nama sesuai KTP"
                        className={regInputClass}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="register-username" className={labelClass}>
                        Username
                      </label>
                      <input
                        id="register-username"
                        type="text"
                        required
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
                        autoComplete="username"
                        placeholder="contoh: bayu.tek"
                        className={regInputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="register-email" className={labelClass}>
                        Email
                      </label>
                      <input
                        id="register-email"
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        autoComplete="email"
                        placeholder="nama@bignet.id"
                        className={regInputClass}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="register-phone" className={labelClass}>
                        Nomor HP / WhatsApp
                      </label>
                      <input
                        id="register-phone"
                        type="tel"
                        required
                        value={regHp}
                        onChange={(e) => setRegHp(e.target.value)}
                        autoComplete="tel"
                        placeholder="0812..."
                        className={regInputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="register-office" className={labelClass}>
                        Penempatan Kantor
                      </label>
                      <select
                        id="register-office"
                        value={regKantorId}
                        onChange={(e) => setRegKantorId(Number(e.target.value))}
                        className={regInputClass}
                      >
                        {offices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nama}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="register-department" className={labelClass}>
                        Bidang Kerja
                      </label>
                      <select
                        id="register-department"
                        value={regBidangId}
                        onChange={(e) => setRegBidangId(Number(e.target.value))}
                        className={regInputClass}
                      >
                        {bidangList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nama}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="register-position" className={labelClass}>
                      Jabatan / Posisi
                    </label>
                    <input
                      id="register-position"
                      type="text"
                      required
                      value={regJabatan}
                      onChange={(e) => setRegJabatan(e.target.value)}
                      placeholder="contoh: Teknisi Fiber Optik"
                      className={regInputClass}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="register-password" className={labelClass}>
                        Kata Sandi
                      </label>
                      <input
                        id="register-password"
                        type="password"
                        required
                        minLength={6}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="Minimal 6 karakter"
                        className={regInputClass}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="register-confirm-password" className={labelClass}>
                        Konfirmasi Kata Sandi
                      </label>
                      <input
                        id="register-confirm-password"
                        type="password"
                        required
                        minLength={6}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="Ulangi kata sandi"
                        className={regInputClass}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="register-note" className={labelClass}>
                      Catatan untuk Superadmin (Opsional)
                    </label>
                    <input
                      id="register-note"
                      type="text"
                      value={regCatatan}
                      onChange={(e) => setRegCatatan(e.target.value)}
                      placeholder="Informasi tambahan"
                      className={regInputClass}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={regLoading}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#c0392b] px-4 text-sm font-semibold text-white shadow-sm shadow-[#c0392b]/25 transition hover:bg-[#a93226] focus:outline-none focus:ring-4 focus:ring-[#c0392b]/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4" />
                    {regLoading ? 'Mengirim Pendaftaran...' : 'Daftar & Ajukan ACC'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setRegError(null);
                    }}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ArrowLeft className="h-4 w-4 text-slate-500" />
                    Sudah punya akun? Kembali ke Masuk
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
