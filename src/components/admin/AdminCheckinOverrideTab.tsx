import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface ActiveGrant {
  id: number;
  berlakuSampai: string;
  alasan: string;
  adminNama: string;
  createdAt: string;
}

interface OverrideCandidate {
  karyawanId: number;
  nik: string;
  namaLengkap: string;
  jabatan: string;
  kantorNama: string;
  bidangNama: string;
  urutanSesi: number;
  namaSesi: string;
  jamMulai: string;
  jamSelesai: string;
  terlambatMenit: number;
  activeGrant: ActiveGrant | null;
}

const DURATIONS = [5, 10, 15, 30];

function formatLate(minutes: number): string {
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} jam ${remainder} menit` : `${hours} jam`;
}

export function AdminCheckinOverrideTab() {
  const [items, setItems] = useState<OverrideCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OverrideCandidate | null>(null);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(15);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadItems = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setPageError(null);
    try {
      const result = await apiFetch<{ tanggal: string; serverTime: string; items: OverrideCandidate[] }>(
        '/api/v1/admin/attendance/override-checkins'
      );
      setItems(result.items);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Gagal memuat daftar sesi yang terkunci.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
    const refreshId = window.setInterval(() => void loadItems(true), 30000);
    return () => window.clearInterval(refreshId);
  }, [loadItems]);

  const openGrantForm = (item: OverrideCandidate) => {
    setSelected(item);
    setReason('');
    setDuration(15);
    setFormError(null);
  };

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || saving) return;
    if (reason.trim().length < 5) {
      setFormError('Alasan minimal 5 karakter wajib diisi.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('/api/v1/admin/attendance/override-checkins', {
        method: 'POST',
        body: JSON.stringify({
          karyawanId: selected.karyawanId,
          alasan: reason.trim(),
          durasiMenit: duration,
        }),
      });
      setSelected(null);
      await loadItems(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal membuka akses check-in.');
      await loadItems(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Izin Check-in Terlambat
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Buka kembali satu sesi yang sudah berakhir agar karyawan dapat melakukan absensi dengan bukti asli.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadItems(true)}
          disabled={refreshing}
          className="min-h-[44px] sm:h-9 px-3.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Muat Ulang
        </button>
      </div>

      <div className="rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/25 p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs text-blue-950 dark:text-blue-100">
          <p className="font-bold">Izin tidak menghapus keterlambatan</p>
          <p className="leading-relaxed text-blue-900 dark:text-blue-200">
            Akses berlaku satu kali untuk sesi berikutnya selama 5, 10, 15, atau 30 menit. Karyawan tetap wajib selfie melalui kamera browser, validasi GPS, dan menggunakan waktu server. Status TERLAMBAT serta alasan dan nama Admin tetap tercatat di audit.
          </p>
        </div>
      </div>

      {pageError && (
        <div role="alert" className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-800 dark:text-red-200">
          {pageError}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
          Memuat daftar absensi yang terkunci...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Tidak ada sesi yang menunggu izin</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Daftar ini hanya menampilkan sesi berikutnya yang sudah melewati batas waktu absensi.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
          {items.map((item) => (
            <article key={item.karyawanId} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{item.namaLengkap}</p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.nik}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{item.jabatan} · {item.bidangNama}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.kantorNama}</p>
                </div>
                <span className="shrink-0 rounded-full bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-2.5 py-1 text-[10px] font-bold text-red-800 dark:text-red-300">
                  TERKUNCI
                </span>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.namaSesi} · Sesi {item.urutanSesi}</p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.jamMulai}–{item.jamSelesai} WIB</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                    {item.urutanSesi === 1 ? 'Terlambat' : 'Lewat Jadwal'}
                  </p>
                  <p className="font-mono text-sm font-bold text-red-700 dark:text-red-300">{formatLate(item.terlambatMenit)}</p>
                </div>
              </div>

              {item.activeGrant ? (
                <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/35 p-3 space-y-1">
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-100 inline-flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" /> Izin Aktif sampai {item.activeGrant.berlakuSampai.slice(11, 16)} WIB
                  </p>
                  <p className="text-[11px] text-blue-800 dark:text-blue-200">Dibuka oleh {item.activeGrant.adminNama}. Karyawan belum menggunakan izin ini.</p>
                  <p className="text-[11px] text-blue-800 dark:text-blue-200">Alasan: {item.activeGrant.alasan}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openGrantForm(item)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-lg bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  Buka Akses Check-in
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setSelected(null);
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby="checkin-override-title" className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
              <div>
                <h2 id="checkin-override-title" className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Buka Akses Check-in</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{selected.namaLengkap} · {selected.namaSesi}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} disabled={saving} className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center disabled:opacity-50" aria-label="Tutup">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submitGrant} className="p-5 space-y-4">
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Izin hanya untuk satu kali check-in pada sesi ini. Waktu absensi tetap memakai waktu server dan tetap ditandai terlambat.
              </div>
              <div>
                <label htmlFor="checkin-override-duration" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Masa berlaku akses</label>
                <select id="checkin-override-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="w-full min-h-[44px] px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100">
                  {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} menit</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="checkin-override-reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Alasan pemberian izin</label>
                <textarea id="checkin-override-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} required minLength={5} placeholder="Contoh: teknisi mengalami kendala kendaraan saat menuju lokasi kerja..." className="w-full min-h-[100px] px-3 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 resize-y" />
                <p className="text-[10px] text-slate-400 text-right mt-1">{reason.length}/500</p>
              </div>
              {formError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{formError}</p>}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <button type="button" onClick={() => setSelected(null)} disabled={saving} className="min-h-[44px] px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50">Batal</button>
                <button type="submit" disabled={saving || reason.trim().length < 5} className="min-h-[44px] px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-55">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</> : <><KeyRound className="w-4 h-4" /> Konfirmasi Izin</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
