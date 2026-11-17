import { useEffect, useState, type FormEvent } from 'react';
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

export function LoginView({ settings, onSuccess }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login states
  const [identifier, setIdentifier] = useState('andi');
  const [password, setPassword] = useState('bignet123');
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
  const showDemo = settings ? Boolean(settings.izin_demo_login) : true;
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:grid lg:grid-cols-12">
      {/* Left Dark Navy Brand Panel */}
      <div className="lg:col-span-5 bg-navy-900 dark:bg-navy-950 text-white p-5 sm:p-10 lg:p-14 flex flex-col justify-between relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, #2563eb 0%, transparent 55%), radial-gradient(circle at 80% 85%, #1d4ed8 0%, transparent 50%)',
          }}
        />
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={logoSrc}
              alt={`Logo ${appName}`}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-contain bg-white/10 p-1 border border-white/15 shrink-0"
            />
            <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-white truncate">
              {appName}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ServerClock compact onDark />
            <div className="lg:hidden">
              <ThemeToggle onDark />
            </div>
          </div>
        </div>

        <div className="relative z-10 my-6 sm:my-10 lg:my-0 max-w-md">
          <p className="text-xs font-medium text-blue-300 tracking-wide mb-2 sm:mb-3">
            {subtitle}
          </p>
          <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight leading-tight text-balance">
            {heroTitle}
          </h1>
          <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
            {heroDesc}
          </p>
          <div className="mt-6 sm:mt-8 pt-5 sm:pt-6 border-t border-white/10 grid grid-cols-3 gap-3 sm:gap-4 text-xs">
            <div>
              <p className="font-mono font-semibold text-white text-sm sm:text-base">2 / 3 / 4</p>
              <p className="text-slate-400 mt-0.5 text-[11px] sm:text-xs">Sesi Dinamis</p>
            </div>
            <div>
              <p className="font-mono font-semibold text-white text-sm sm:text-base">WIB</p>
              <p className="text-slate-400 mt-0.5 text-[11px] sm:text-xs">Waktu Server</p>
            </div>
            <div>
              <p className="font-mono font-semibold text-white text-sm sm:text-base">ACC</p>
              <p className="text-slate-400 mt-0.5 text-[11px] sm:text-xs">Approval Superadmin</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-[11px] sm:text-xs text-slate-400">{footerText}</div>
      </div>

      {/* Right Auth Panel: Login & Create Account */}
      <div className="lg:col-span-7 flex items-center justify-center p-4 sm:p-10 lg:p-14">
        <div className="w-full max-w-lg space-y-5 sm:space-y-6">
          {/* Header + Mode Switcher */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {mode === 'login' ? formTitle : 'Pendaftaran Akun Baru'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {mode === 'login'
                    ? 'Gunakan username atau email perusahaan yang sudah disetujui.'
                    : 'Daftar akun Admin atau Teknisi. Akun aktif setelah di-ACC oleh Superadmin.'}
                </p>
              </div>
              <div className="hidden lg:block shrink-0">
                <ThemeToggle showLabel />
              </div>
            </div>

            {loginAnnouncement && mode === 'login' && (
              <div className="p-3 sm:p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 text-xs text-blue-950 dark:text-blue-200 flex items-start gap-2.5">
                <Megaphone className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
                <span>{loginAnnouncement}</span>
              </div>
            )}

            <div className="grid grid-cols-2 p-1 bg-slate-200/75 dark:bg-slate-800/90 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setRegError(null);
                }}
                className={`min-h-[44px] sm:h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-navy-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Masuk Akun</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setRegSuccess(null);
                }}
                className={`min-h-[44px] sm:h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-navy-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Buat Akun</span>
              </button>
            </div>
          </div>

          {mode === 'login' ? (
            <>
              {error && (
                <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300 font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Username atau Email
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="contoh: andi atau andi@bignet.id"
                    className="w-full h-11 px-3.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="w-full h-11 pl-3.5 pr-12 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label={showPass ? 'Sembunyikan sandi' : 'Lihat sandi'}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[46px] h-11 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Lock className="w-4 h-4" />
                  <span>{loading ? 'Memverifikasi...' : 'Masuk ke Sistem'}</span>
                </button>
              </form>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
                <span className="text-slate-600 dark:text-slate-400">
                  Baru bergabung sebagai Admin atau Teknisi?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                    setRegSuccess(null);
                  }}
                  className="min-h-[36px] sm:min-h-0 inline-flex items-center font-semibold text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 self-start sm:self-auto"
                >
                  Buat Akun Baru →
                </button>
              </div>

              {showDemo && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                      Akses Cepat Akun Demo (Sandi: bignet123)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {DEMO_ACCOUNTS.map((acc) => (
                      <button
                        key={acc.username}
                        type="button"
                        disabled={loading}
                        onClick={() => quickLogin(acc.username)}
                        className="w-full min-h-[52px] text-left px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-600 dark:hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {acc.label}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {acc.role}
                          </p>
                        </div>
                        <span className="text-xs font-mono font-medium text-blue-700 dark:text-blue-400 flex items-center gap-1 shrink-0">
                          <UserCheck className="w-3.5 h-3.5" />
                          @{acc.username}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {regSuccess ? (
                <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl p-5 sm:p-6 space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                      Pendaftaran Terkirim — Menunggu ACC Superadmin
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {regSuccess}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
                    <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
                    <span>
                      Anda baru dapat masuk setelah Superadmin menyetujui (ACC) pendaftaran dan
                      menerbitkan NIK akun Anda.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setRegSuccess(null);
                    }}
                    className="w-full min-h-[44px] h-11 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Kembali ke Halaman Masuk
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleRegisterSubmit}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4"
                >
                  {regError && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300 font-medium">
                      {regError}
                    </div>
                  )}

                  {/* Role Choice */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Daftar Sebagai Role
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleSelectRegRole('KARYAWAN')}
                        className={`min-h-[56px] p-3 rounded-xl border text-left transition-colors ${
                          regRole === 'KARYAWAN'
                            ? 'border-navy-900 bg-navy-900/5 text-navy-900 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-xs font-bold">Teknisi / Karyawan</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Absensi sesi, GPS, & pengajuan
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectRegRole('ADMIN')}
                        className={`min-h-[56px] p-3 rounded-xl border text-left transition-colors ${
                          regRole === 'ADMIN'
                            ? 'border-navy-900 bg-navy-900/5 text-navy-900 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-200'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        <p className="text-xs font-bold">Admin Operasional</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Approval, kalender, & payroll
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Foto Profil Pendaftar */}
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                    {regFotoBase64 ? (
                      <img
                        src={regFotoBase64}
                        alt="Pratinjau foto profil"
                        className="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-navy-900 dark:bg-blue-700 text-white flex items-center justify-center font-display text-sm font-bold shrink-0">
                        {(regName || 'BG').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Foto Profil Akun
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        PNG, JPG, atau WEBP maksimal 2 MB.
                      </p>
                      <label className="mt-2 min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                        <Camera className="w-3.5 h-3.5" />
                        <span>{regFotoBase64 ? 'Ganti Foto' : 'Pilih Foto Profil'}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            handleRegPhotoFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Nama Lengkap
                      </label>
                      <input
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Nama lengkap sesuai KTP"
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Username
                      </label>
                      <input
                        type="text"
                        required
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
                        placeholder="contoh: bayu.tek"
                        className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="nama@bignet.id"
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Nomor HP / WhatsApp
                      </label>
                      <input
                        type="text"
                        required
                        value={regHp}
                        onChange={(e) => setRegHp(e.target.value)}
                        placeholder="0812..."
                        className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Penempatan Kantor
                      </label>
                      <select
                        value={regKantorId}
                        onChange={(e) => setRegKantorId(Number(e.target.value))}
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      >
                        {offices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nama}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Bidang Kerja
                      </label>
                      <select
                        value={regBidangId}
                        onChange={(e) => setRegBidangId(Number(e.target.value))}
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
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
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Jabatan / Posisi
                    </label>
                    <input
                      type="text"
                      required
                      value={regJabatan}
                      onChange={(e) => setRegJabatan(e.target.value)}
                      placeholder="contoh: Teknisi Fiber Optik"
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Kata Sandi
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Min. 6 karakter"
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Konfirmasi Kata Sandi
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Catatan untuk Superadmin (Opsional)
                    </label>
                    <input
                      type="text"
                      value={regCatatan}
                      onChange={(e) => setRegCatatan(e.target.value)}
                      placeholder="Misal: Tim instalasi area Bandung Timur"
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={regLoading}
                    className="w-full min-h-[46px] h-11 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>
                      {regLoading ? 'Mengirim Pendaftaran...' : 'Daftar & Ajukan ACC Superadmin'}
                    </span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
