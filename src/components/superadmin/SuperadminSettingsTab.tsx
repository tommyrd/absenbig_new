import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Image as ImageIcon,
  Megaphone,
  RotateCcw,
  Save,
  Settings,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { SystemSettings } from '../../shared/types';

interface SuperadminSettingsTabProps {
  onSettingsUpdated: (settings: SystemSettings) => void;
}

export function SuperadminSettingsTab({ onSettingsUpdated }: SuperadminSettingsTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [namaAplikasi, setNamaAplikasi] = useState('Absensi BIGNET');
  const [subjudulLogin, setSubjudulLogin] = useState('Sistem Kehadiran Terpadu');
  const [judulHeroLogin, setJudulHeroLogin] = useState('');
  const [deskripsiLogin, setDeskripsiLogin] = useState('');
  const [judulFormLogin, setJudulFormLogin] = useState('Masuk ke Akun Anda');
  const [pengumumanLogin, setPengumumanLogin] = useState('');
  const [footerLogin, setFooterLogin] = useState('');
  const [retensiFotoHari, setRetensiFotoHari] = useState(365);
  const [wajibGpsAbsensi, setWajibGpsAbsensi] = useState(true);
  const [izinDemoLogin, setIzinDemoLogin] = useState(true);

  const [logoPreview, setLogoPreview] = useState<string>(`/api/v1/assets/logo?v=${Date.now()}`);
  const [pendingLogoBase64, setPendingLogoBase64] = useState<string | null>(null);
  const [resetLogo, setResetLogo] = useState(false);
  const [hasCustomLogo, setHasCustomLogo] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ settings: SystemSettings }>('/api/v1/settings');
      const s = res.settings;
      setNamaAplikasi(s.nama_aplikasi);
      setSubjudulLogin(s.subjudul_login);
      setJudulHeroLogin(s.judul_hero_login);
      setDeskripsiLogin(s.deskripsi_login);
      setJudulFormLogin(s.judul_form_login || 'Masuk ke Akun Anda');
      setPengumumanLogin(s.pengumuman_login || '');
      setFooterLogin(s.footer_login);
      setRetensiFotoHari(s.retensi_foto_hari);
      setWajibGpsAbsensi(Boolean(s.wajib_gps_absensi));
      setIzinDemoLogin(Boolean(s.izin_demo_login));
      setHasCustomLogo(s.has_custom_logo);
      setLogoPreview(`/api/v1/assets/logo?v=${encodeURIComponent(s.logo_updated_at || '1')}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMsg({ type: 'err', text: 'Ukuran file logo maksimal 2 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPendingLogoBase64(reader.result);
        setLogoPreview(reader.result);
        setResetLogo(false);
        setMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleResetLogo = () => {
    setPendingLogoBase64(null);
    setResetLogo(true);
    setLogoPreview(`/api/v1/assets/logo?reset=1&v=${Date.now()}`);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch<{ settings: SystemSettings }>('/api/v1/settings', {
        method: 'PUT',
        body: JSON.stringify({
          nama_aplikasi: namaAplikasi,
          subjudul_login: subjudulLogin,
          judul_hero_login: judulHeroLogin,
          deskripsi_login: deskripsiLogin,
          judul_form_login: judulFormLogin,
          pengumuman_login: pengumumanLogin,
          footer_login: footerLogin,
          retensi_foto_hari: retensiFotoHari,
          wajib_gps_absensi: wajibGpsAbsensi,
          izin_demo_login: izinDemoLogin,
          logoBase64: pendingLogoBase64,
          resetLogo,
        }),
      });
      setPendingLogoBase64(null);
      setResetLogo(false);
      setHasCustomLogo(res.settings.has_custom_logo);
      setLogoPreview(
        `/api/v1/assets/logo?v=${encodeURIComponent(res.settings.logo_updated_at || String(Date.now()))}`
      );
      onSettingsUpdated(res.settings);
      setMsg({
        type: 'ok',
        text: 'Pengaturan sistem & tampilan dashboard login berhasil disimpan oleh Superadmin.',
      });
    } catch (err) {
      setMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan sistem.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Pengaturan Sistem & Branding Aplikasi (Superadmin)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Kelola logo perusahaan, teks dashboard halaman login, pengumuman masuk, serta parameter operasional global.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] sm:min-h-[40px] px-5 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 self-stretch sm:self-auto disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
        </button>
      </div>

      {msg && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            msg.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800/70 dark:text-emerald-300'
              : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800/70 dark:text-red-300'
          }`}
        >
          {msg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Live Login Dashboard Preview + Logo Upload */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            Pratinjau Dashboard Login & Logo
          </h2>

          {/* Live Preview Card */}
          <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="p-4 sm:p-5 bg-navy-900 text-white space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src={logoPreview}
                  alt="Preview Logo Aplikasi"
                  className="w-11 h-11 rounded-xl object-contain bg-white/10 p-1 border border-white/15 shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-white truncate">
                    {namaAplikasi || 'Absensi BIGNET'}
                  </p>
                  <p className="text-xs text-blue-300 truncate">{subjudulLogin}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-white/10 space-y-1.5">
                <p className="font-display text-sm font-bold leading-snug text-white">
                  {judulHeroLogin || 'Headline Utama Halaman Login'}
                </p>
                <p className="text-[11px] text-slate-300 line-clamp-2">{deskripsiLogin}</p>
              </div>
              {footerLogin && (
                <p className="text-[10px] text-slate-400 pt-1">{footerLogin}</p>
              )}
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-800/80 space-y-2">
              <p className="font-display text-xs font-bold text-slate-900 dark:text-slate-100">
                {judulFormLogin || 'Masuk ke Akun Anda'}
              </p>
              {pengumumanLogin.trim() && (
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/70 text-[11px] text-blue-900 dark:text-blue-200 flex items-start gap-2">
                  <Megaphone className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-700 dark:text-blue-400" />
                  <span>{pengumumanLogin}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
            <label className="flex-1 min-h-[44px] px-4 py-2 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4 shrink-0" />
              <span>Unggah Logo Baru</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  handleLogoFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {(hasCustomLogo || pendingLogoBase64) && (
              <button
                type="button"
                onClick={handleResetLogo}
                className="min-h-[44px] px-3.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Default</span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            PNG, JPG, WEBP, atau SVG maksimal 2 MB. Logo langsung tampil di dashboard login dan header seluruh role.
          </p>
        </div>

        {/* Right: System Branding, Login Copy & Operational Parameters */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings className="w-4 h-4 text-blue-700 dark:text-blue-400" />
            Branding Aplikasi, Teks Login & Kebijakan Sistem
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nama Aplikasi / Branding Perusahaan
              </label>
              <input
                type="text"
                required
                value={namaAplikasi}
                onChange={(e) => setNamaAplikasi(e.target.value)}
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Subjudul Panel Login
              </label>
              <input
                type="text"
                value={subjudulLogin}
                onChange={(e) => setSubjudulLogin(e.target.value)}
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Judul Form Masuk Login
              </label>
              <input
                type="text"
                value={judulFormLogin}
                onChange={(e) => setJudulFormLogin(e.target.value)}
                placeholder="Masuk ke Akun Anda"
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Footer Dashboard Login
              </label>
              <input
                type="text"
                value={footerLogin}
                onChange={(e) => setFooterLogin(e.target.value)}
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Headline Utama Dashboard Login
            </label>
            <input
              type="text"
              value={judulHeroLogin}
              onChange={(e) => setJudulHeroLogin(e.target.value)}
              className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Deskripsi Dashboard Login
            </label>
            <textarea
              rows={2}
              value={deskripsiLogin}
              onChange={(e) => setDeskripsiLogin(e.target.value)}
              className="w-full p-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Pengumuman / Informasi Login (Opsional)
              </label>
              <input
                type="text"
                value={pengumumanLogin}
                onChange={(e) => setPengumumanLogin(e.target.value)}
                placeholder="Kosongkan jika tidak perlu menampilkan info di halaman login"
                className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Retensi Foto (Hari)
              </label>
              <input
                type="number"
                min={30}
                max={3650}
                value={retensiFotoHari}
                onChange={(e) => setRetensiFotoHari(Number(e.target.value))}
                className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
            <label className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300 font-medium cursor-pointer min-h-[28px]">
              <input
                type="checkbox"
                checked={wajibGpsAbsensi}
                onChange={(e) => setWajibGpsAbsensi(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-blue-700"
              />
              <span>Aktifkan validasi GPS & jarak geofence saat absensi sesi</span>
            </label>
            <label className="flex items-start gap-2.5 text-slate-700 dark:text-slate-300 font-medium cursor-pointer min-h-[28px]">
              <input
                type="checkbox"
                checked={izinDemoLogin}
                onChange={(e) => setIzinDemoLogin(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-blue-700"
              />
              <span>Tampilkan panel akses cepat akun demo pada halaman login</span>
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}
