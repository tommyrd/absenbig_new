import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Camera,
  CheckCircle2,
  KeyRound,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Save,
  Sun,
  Trash2,
  User,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useTheme, type ThemeMode } from '../lib/theme';
import type { AuthUser } from '../shared/types';
import { UserAvatar } from './UserAvatar';

interface ProfileSettingsPanelProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
  extraContent?: ReactNode;
}

export function ProfileSettingsPanel({
  user,
  onUserUpdated,
  onLogout,
  extraContent,
}: ProfileSettingsPanelProps) {
  const { mode, setTheme } = useTheme();
  const [namaLengkap, setNamaLengkap] = useState(user.nama_lengkap);
  const [email, setEmail] = useState(user.email);
  const [noHp, setNoHp] = useState(user.no_hp || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [securityInfo, setSecurityInfo] = useState<{
    mfaEnabled: boolean;
    mfaRequired: boolean;
    idleTimeoutMinutes: number;
    absoluteTimeoutHours: number;
    currentSessionId: string | null;
    sessions: Array<{
      sessionId: string;
      created_at: string;
      last_seen_at: string;
      idleExpiresAt: number;
      absoluteExpiresAt: number;
      ip_address: string | null;
      user_agent: string | null;
      current: boolean;
    }>;
  } | null>(null);
  const [loadingSecurity, setLoadingSecurity] = useState(true);
  const [securityMsg, setSecurityMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);
  const isStandaloneAccount = user.karyawan_id === null;

  const loadSecurityInfo = async () => {
    setLoadingSecurity(true);
    try {
      const result = await apiFetch<typeof securityInfo>('/api/v1/auth/security');
      setSecurityInfo(result);
    } catch (err) {
      setSecurityMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memuat keamanan sesi.' });
    } finally {
      setLoadingSecurity(false);
    }
  };

  useEffect(() => {
    void loadSecurityInfo();
  }, [user.id]);

  const handleRevokeSession = async (sessionId: string, current: boolean) => {
    setRevokingSession(sessionId);
    setSecurityMsg(null);
    try {
      await apiFetch('/api/v1/auth/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
      if (current) {
        onLogout();
        return;
      }
      setSecurityMsg({ type: 'ok', text: 'Sesi perangkat berhasil dicabut.' });
      await loadSecurityInfo();
    } catch (err) {
      setSecurityMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mencabut sesi.' });
    } finally {
      setRevokingSession(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setRevokingSession('others');
    setSecurityMsg(null);
    try {
      const result = await apiFetch<{ revokedCount: number }>('/api/v1/auth/sessions/revoke-others', { method: 'POST' });
      setSecurityMsg({ type: 'ok', text: result.revokedCount + ' sesi perangkat lain berhasil dicabut.' });
      await loadSecurityInfo();
    } catch (err) {
      setSecurityMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal mencabut sesi perangkat lain.' });
    } finally {
      setRevokingSession(null);
    }
  };

  const handleUploadPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setPhotoMsg({ type: 'err', text: 'Ukuran foto profil maksimal 2 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') return;
      setSavingPhoto(true);
      setPhotoMsg(null);
      try {
        const res = await apiFetch<{ user: AuthUser }>('/api/v1/profile/photo', {
          method: 'PUT',
          body: JSON.stringify({ fotoBase64: reader.result }),
        });
        onUserUpdated(res.user);
        setPhotoMsg({ type: 'ok', text: 'Foto profil berhasil diperbarui.' });
      } catch (err) {
        setPhotoMsg({
          type: 'err',
          text: err instanceof Error ? err.message : 'Gagal mengunggah foto profil.',
        });
      } finally {
        setSavingPhoto(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = async () => {
    setSavingPhoto(true);
    setPhotoMsg(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/v1/profile/photo', {
        method: 'PUT',
        body: JSON.stringify({ removePhoto: true }),
      });
      onUserUpdated(res.user);
      setPhotoMsg({ type: 'ok', text: 'Foto profil dikembalikan ke avatar default.' });
    } catch (err) {
      setPhotoMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menghapus foto profil.',
      });
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/v1/profile', {
        method: 'PUT',
        body: JSON.stringify({
          nama_lengkap: namaLengkap,
          email,
          no_hp: noHp,
        }),
      });
      onUserUpdated(res.user);
      setProfileMsg({ type: 'ok', text: 'Profil akun berhasil diperbarui dan tercatat di audit.' });
    } catch (err) {
      setProfileMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal memperbarui profil.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPassMsg(null);
    if (newPassword !== confirmPassword) {
      setPassMsg({ type: 'err', text: 'Konfirmasi kata sandi baru tidak cocok.' });
      return;
    }
    setSavingPass(true);
    try {
      await apiFetch('/api/v1/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassMsg({ type: 'ok', text: 'Kata sandi berhasil diganti.' });
    } catch (err) {
      setPassMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengganti kata sandi.',
      });
    } finally {
      setSavingPass(false);
    }
  };

  const themeOptions: { id: ThemeMode; label: string; Icon: typeof Sun }[] = [
    { id: 'light', label: 'Terang', Icon: Sun },
    { id: 'dark', label: 'Gelap', Icon: Moon },
    { id: 'system', label: 'Sistem', Icon: Monitor },
  ];

  return (
    <div className="space-y-6">
      {/* Identity Banner + Profile Photo Upload + Logout */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4 min-w-0">
            <UserAvatar
              karyawanId={user.karyawan_id}
              userId={user.karyawan_id === null ? user.id : null}
              name={user.nama_lengkap}
              role={user.role}
              version={user.foto_profil_updated_at}
              size="xl"
            />
            <div className="space-y-1 min-w-0 flex-1">
              <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                {user.nama_lengkap}
              </h1>
              {isStandaloneAccount ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {user.role === 'ADMIN'
                    ? <>Admin Operasional · <strong className="text-amber-700 dark:text-amber-300">Non-Pegawai</strong></>
                    : <>Akun Pemilik Sistem · <strong className="text-amber-700 dark:text-amber-300">SUPERADMIN</strong></>}
                </p>
              ) : (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    NIK:{' '}
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                      {user.nik}
                    </span>{' '}
                    · {user.jabatan} · Role:{' '}
                    <strong className="text-navy-900 dark:text-blue-400">{user.role}</strong>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {user.bidang_nama} · {user.kantor_nama}
                  </p>
                </>
              )}
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <label className="min-h-[44px] sm:min-h-[36px] px-3.5 py-2 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{savingPhoto ? 'Mengunggah...' : 'Ganti Foto Profil'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={savingPhoto}
                    className="hidden"
                    onChange={(e) => {
                      handleUploadPhoto(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {user.has_foto_profil && (
                  <button
                    type="button"
                    disabled={savingPhoto}
                    onClick={handleRemovePhoto}
                    className="min-h-[44px] sm:min-h-[36px] px-3.5 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Reset Foto
                  </button>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-[44px] sm:h-10 px-4 border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-800 dark:text-red-300 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 self-stretch sm:self-center"
          >
            <LogOut className="w-4 h-4" />
            Keluar Akun
          </button>
        </div>

        {photoMsg && (
          <div
            className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
              photoMsg.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300'
                : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300'
            }`}
          >
            {photoMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{photoMsg.text}</span>
          </div>
        )}
      </div>

      {/* Theme Appearance Preference Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Tampilan Tema Aplikasi
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pilih mode Terang, Gelap (Dark Mode), atau ikuti pengaturan perangkat Anda.
          </p>
        </div>
        <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl gap-1 sm:w-auto">
          {themeOptions.map(({ id, label, Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={`min-h-[44px] sm:min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-navy-900 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Edit Profile Form */}
        <form
          onSubmit={handleSaveProfile}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              Pengaturan Profil Saya
            </h2>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              @{user.username}
            </span>
          </div>

          {profileMsg && (
            <div
              className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
                profileMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300'
                  : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300'
              }`}
            >
              {profileMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{profileMsg.text}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nama Lengkap
            </label>
            <input
              type="text"
              required
              value={namaLengkap}
              onChange={(e) => setNamaLengkap(e.target.value)}
              className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email Perusahaan
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nomor HP / WhatsApp
              </label>
              <input
                type="text"
                value={noHp}
                onChange={(e) => setNoHp(e.target.value)}
                placeholder="0812..."
                className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="pt-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              Geofence kantor: <strong className="font-mono">{user.kantor_radius}m</strong>
            </span>
            <button
              type="submit"
              disabled={savingProfile}
              className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </div>
        </form>

        {/* Change Password Form */}
        <form
          onSubmit={handleChangePassword}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-700 dark:text-amber-400" />
            Keamanan & Ganti Kata Sandi
          </h2>

          {passMsg && (
            <div
              className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
                passMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300'
                  : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300'
              }`}
            >
              {passMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{passMsg.text}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Kata Sandi Saat Ini
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kata Sandi Baru
              </label>
              <input
                type="password"
                required
                minLength={15}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 15 karakter"
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Konfirmasi Sandi Baru
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="pt-1 flex justify-end">
            <button
              type="submit"
              disabled={savingPass}
              className="w-full sm:w-auto min-h-[44px] sm:h-10 px-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {savingPass ? 'Memperbarui...' : 'Perbarui Kata Sandi'}
            </button>
          </div>
        </form>
      </div>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              Keamanan Sesi & Perangkat
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Sesi otomatis berakhir setelah tidak aktif atau mencapai batas maksimum.
            </p>
          </div>
          {securityInfo && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Idle {securityInfo.idleTimeoutMinutes} menit
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Maks. {securityInfo.absoluteTimeoutHours} jam
              </span>
              <span className={securityInfo.mfaEnabled
                ? 'rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}>
                MFA {securityInfo.mfaEnabled ? 'Aktif' : securityInfo.mfaRequired ? 'Wajib' : 'Belum aktif'}
              </span>
            </div>
          )}
        </div>

        {securityMsg && (
          <div className={securityMsg.type === 'ok'
            ? 'rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'}>
            {securityMsg.text}
          </div>
        )}

        {loadingSecurity ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Memuat daftar sesi...</p>
        ) : (
          <>
            <div className="space-y-2">
              {securityInfo?.sessions.map((session) => (
                <div key={session.sessionId} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {session.current ? 'Perangkat ini' : 'Perangkat lain'}
                      </span>
                      {session.current && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">Sesi aktif</span>}
                    </div>
                    <p className="break-words text-[11px] text-slate-600 dark:text-slate-300">{session.user_agent || 'Browser tidak terdeteksi'}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      IP {session.ip_address || 'Tidak tersedia'} · Login {new Date(session.created_at).toLocaleString('id-ID')}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Aktivitas terakhir {new Date(session.last_seen_at).toLocaleString('id-ID')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={revokingSession !== null}
                    onClick={() => void handleRevokeSession(session.sessionId, session.current)}
                    className="min-h-10 shrink-0 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    {revokingSession === session.sessionId ? 'Memproses...' : session.current ? 'Keluar dari perangkat ini' : 'Cabut sesi'}
                  </button>
                </div>
              ))}
              {!securityInfo?.sessions.length && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  Tidak ada sesi aktif lain yang tercatat.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Admin dan Superadmin wajib mengaktifkan MFA melalui aplikasi Authenticator saat login.
              </p>
              <button
                type="button"
                disabled={revokingSession !== null || (securityInfo?.sessions.length || 0) <= 1}
                onClick={() => void handleRevokeOtherSessions()}
                className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
              >
                {revokingSession === 'others' ? 'Memproses...' : 'Cabut semua sesi lain'}
              </button>
            </div>
          </>
        )}
      </section>

      {extraContent}
    </div>
  );
}
