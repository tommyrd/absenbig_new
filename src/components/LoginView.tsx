import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Megaphone,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { apiFetch, loginApi } from '../lib/api';
import type { AuthUser, BidangKerja, Kantor, SystemSettings } from '../shared/types';
import { ServerClock } from './ServerClock';
import { ThemeToggle } from './ThemeToggle';

interface LoginViewProps {
  settings: SystemSettings | null;
  onSuccess: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  {
    username: 'andi',
    label: 'Andi Pratama',
    role: 'Teknisi / Karyawan · 3 Sesi, Kantor A',
  },
  {
    username: 'rina',
    label: 'Rina Kusuma',
    role: 'Admin Kantor (Karyawan) · 2 Sesi, Kantor A',
  },
  {
    username: 'dimas',
    label: 'Dimas Nugroho',
    role: 'Lead Teknisi · 4 Sesi, Kantor B',
  },
  {
    username: 'admin',
    label: 'Siti Rahmawati',
    role: 'Admin Operasional & HR',
  },
  {
    username: 'superadmin',
    label: 'Budi Santoso',
    role: 'Superadmin · Owner / CEO',
  },
];

const inputClass =
  'h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500';
const labelClass = 'mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300';

export function LoginView({ settings, onSuccess }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login states (never prefill hardcoded credentials in production)
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
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

  // The login and registration panels have different heights. Always return
  // to the top when switching modes so a long registration form never opens
  // with its heading hidden above the viewport.
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
  const subtitle = settings?.subjudul_login || 'Sistem Kehadiran Terpadu';
  const heroTitle =
    settings?.judul_hero_login ||
    'Presensi sesi akurat, kalender fleksibel, rekap payroll teraudit.';
  const heroDesc =
    settings?.deskripsi_login ||
    'Akses langsung melalui browser ponsel, tablet, maupun desktop tanpa perlu memasang aplikasi tambahan.';
  const formTitle = settings?.judul_form_login || 'Masuk ke Akun Anda';
  const loginAnnouncement = (settings?.pengumuman_login || '').trim();
  const footerText =
    settings?.footer_login || 'Kantor Pusat Jakarta · Kantor Operasional Bandung';
  const showDemo = Boolean(settings?.izin_demo_login);
  const logoSrc = `/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
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
    <div className="min-h-screen min-h-[100svh] w-full overflow-x-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto flex w-full max-w-7xl justify-center px-4 py-7 sm:px-6 sm:py-10 lg:py-12">
        <div className="w-full max-w-[480px] min-w-0">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
            {/* Compact navy brand header */}
            <div className="bg-gradient-to-br from-navy-900 via-navy-900 to-navy-800 px-5 py-5 text-white sm:px-7 sm:py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <img
                    src={logoSrc}
                    alt={`Logo ${appName}`}
                    className="h-11 w-11 shrink-0 rounded-xl border border-white/15 bg-white/10 object-contain p-1.5"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold tracking-tight sm:text-lg">
                      {appName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-blue-200 sm:text-xs">
                      {subtitle}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="hidden sm:block">
                    <ServerClock compact onDark />
                  </div>
                  <ThemeToggle onDark />
                </div>
              </div>
              <div className="mt-5 border-t border-white/10 pt-4">
                <h1 className="font-display text-lg font-semibold leading-snug tracking-tight sm:text-xl">
                  {heroTitle}
                </h1>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  {heroDesc}
                </p>
              </div>
            </div>

            {/* Authentication content remains in normal document flow.
                Login is compact; registration can grow and scroll naturally. */}
            <div className="space-y-5 px-5 py-5 sm:space-y-6 sm:px-7 sm:py-6">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
                      {mode === 'login' ? formTitle : 'Pendaftaran Akun Baru'}
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {mode === 'login'
                        ? 'Masuk menggunakan username atau email perusahaan.'
                        : 'Lengkapi data berikut. Akun aktif setelah disetujui Superadmin.'}
                    </p>
                  </div>
                </div>

                {loginAnnouncement && mode === 'login' && (
                  <div className="mt-4 flex min-w-0 items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-950 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
                    <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-400" />
                    <span className="min-w-0 break-words">{loginAnnouncement}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setRegError(null);
                  }}
                  className={mode === 'login'
                    ? 'flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-navy-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Masuk Akun
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setRegSuccess(null);
                  }}
                  className={mode === 'register'
                    ? 'flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-navy-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Buat Akun
                </button>
              </div>

              {mode === 'login' ? (
                <div className="space-y-4">
                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="login-identifier" className={labelClass}>
                        Username atau Email
                      </label>
                      <input
                        id="login-identifier"
                        type="text"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        required
                        autoComplete="username"
                        placeholder="Masukkan username atau email"
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <label htmlFor="login-password" className={labelClass}>
                        Kata Sandi
                      </label>
                      <div className="relative">
                        <input
                          id="login-password"
                          type={showPass ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          placeholder="Masukkan kata sandi"
                          className={inputClass + ' pr-12'}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass((v) => !v)}
                          className="absolute inset-y-0 right-1 flex min-h-11 w-10 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
                          aria-label={showPass ? 'Sembunyikan sandi' : 'Lihat sandi'}
                        >
                          {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-800 focus:outline-none focus:ring-4 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
                    >
                      <Lock className="h-4 w-4" />
                      {loading ? 'Memverifikasi...' : 'Masuk ke Sistem'}
                    </button>
                  </form>

                  <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-slate-500 dark:text-slate-400">
                      Baru bergabung sebagai Admin atau Teknisi?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setError(null);
                        setRegSuccess(null);
                      }}
                      className="inline-flex min-h-9 items-center self-start font-semibold text-blue-700 transition hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300 sm:self-auto"
                    >
                      Buat Akun Baru
                      <UserPlus className="ml-1.5 h-3.5 w-3.5" />
                    </button>
                  </div>

                  {showDemo && (
                    <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <ShieldCheck className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                        Akses Cepat Akun Demo (Sandi: bignet123)
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {DEMO_ACCOUNTS.map((acc) => (
                          <button
                            key={acc.username}
                            type="button"
                            disabled={loading}
                            onClick={() => quickLogin(acc.username)}
                            className="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50/50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {acc.label}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                                {acc.role}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1 font-mono text-xs font-medium text-blue-700 dark:text-blue-400">
                              <UserCheck className="h-3.5 w-3.5" />
                              @{acc.username}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
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
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-xs font-semibold text-white transition hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600"
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
                            className={regRole === 'KARYAWAN'
                              ? 'min-h-14 rounded-xl border border-blue-600 bg-blue-50 px-3 py-3 text-left text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100'
                              : 'min-h-14 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}
                          >
                            <span className="block text-xs font-bold">Teknisi / Karyawan</span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                              Absensi sesi, GPS, dan pengajuan
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectRegRole('ADMIN')}
                            className={regRole === 'ADMIN'
                              ? 'min-h-14 rounded-xl border border-blue-600 bg-blue-50 px-3 py-3 text-left text-blue-950 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100'
                              : 'min-h-14 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}
                          >
                            <span className="block text-xs font-bold">Admin Operasional</span>
                            <span className="mt-1 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                              Approval, kalender, dan payroll
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/60">
                        {regFotoBase64 ? (
                          <img
                            src={regFotoBase64}
                            alt="Pratinjau foto profil"
                            className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                          />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-navy-900 font-display text-sm font-bold text-white dark:bg-blue-700">
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
                          <label htmlFor="register-name" className={labelClass}>Nama Lengkap</label>
                          <input
                            id="register-name"
                            type="text"
                            required
                            value={regName}
                            onChange={(e) => setRegName(e.target.value)}
                            autoComplete="name"
                            placeholder="Nama sesuai KTP"
                            className={inputClass}
                          />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="register-username" className={labelClass}>Username</label>
                          <input
                            id="register-username"
                            type="text"
                            required
                            value={regUsername}
                            onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
                            autoComplete="username"
                            placeholder="contoh: bayu.tek"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <label htmlFor="register-email" className={labelClass}>Email</label>
                          <input
                            id="register-email"
                            type="email"
                            required
                            value={regEmail}
                            onChange={(e) => setRegEmail(e.target.value)}
                            autoComplete="email"
                            placeholder="nama@bignet.id"
                            className={inputClass}
                          />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="register-phone" className={labelClass}>Nomor HP / WhatsApp</label>
                          <input
                            id="register-phone"
                            type="tel"
                            required
                            value={regHp}
                            onChange={(e) => setRegHp(e.target.value)}
                            autoComplete="tel"
                            placeholder="0812..."
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <label htmlFor="register-office" className={labelClass}>Penempatan Kantor</label>
                          <select
                            id="register-office"
                            value={regKantorId}
                            onChange={(e) => setRegKantorId(Number(e.target.value))}
                            className={inputClass}
                          >
                            {offices.map((o) => (
                              <option key={o.id} value={o.id}>{o.nama}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="register-department" className={labelClass}>Bidang Kerja</label>
                          <select
                            id="register-department"
                            value={regBidangId}
                            onChange={(e) => setRegBidangId(Number(e.target.value))}
                            className={inputClass}
                          >
                            {bidangList.map((b) => (
                              <option key={b.id} value={b.id}>{b.nama}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="register-position" className={labelClass}>Jabatan / Posisi</label>
                        <input
                          id="register-position"
                          type="text"
                          required
                          value={regJabatan}
                          onChange={(e) => setRegJabatan(e.target.value)}
                          placeholder="contoh: Teknisi Fiber Optik"
                          className={inputClass}
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <label htmlFor="register-password" className={labelClass}>Kata Sandi</label>
                          <input
                            id="register-password"
                            type="password"
                            required
                            minLength={6}
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            autoComplete="new-password"
                            placeholder="Minimal 6 karakter"
                            className={inputClass}
                          />
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="register-confirm-password" className={labelClass}>Konfirmasi Kata Sandi</label>
                          <input
                            id="register-confirm-password"
                            type="password"
                            required
                            minLength={6}
                            value={regConfirmPassword}
                            onChange={(e) => setRegConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            placeholder="Ulangi kata sandi"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="register-note" className={labelClass}>Catatan untuk Superadmin (Opsional)</label>
                        <input
                          id="register-note"
                          type="text"
                          value={regCatatan}
                          onChange={(e) => setRegCatatan(e.target.value)}
                          placeholder="Informasi tambahan"
                          className={inputClass}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={regLoading}
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-800 focus:outline-none focus:ring-4 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
                      >
                        <UserPlus className="h-4 w-4" />
                        {regLoading ? 'Mengirim Pendaftaran...' : 'Daftar & Ajukan ACC'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </section>

          <footer className="px-3 pb-2 pt-5 text-center text-[11px] leading-relaxed text-slate-500 dark:text-slate-500">
            {footerText}
          </footer>
        </div>
      </main>
    </div>
  );
}
