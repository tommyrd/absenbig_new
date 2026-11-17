import { useCallback, useEffect, useState } from 'react';
import { Calendar, Image as ImageIcon, MapPin, ShieldAlert, X } from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import type { AbsensiSesiRecord, MonthlySummary } from '../../shared/types';
import { StatusBadge } from '../StatusBadge';

export function EmployeeHistoryPage() {
  const [bulan, setBulan] = useState(() => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '11';
    return `${y}-${m}`;
  });
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewSession, setPreviewSession] = useState<AbsensiSesiRecord | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ summary: MonthlySummary }>(
        `/api/v1/history/monthly?bulan=${encodeURIComponent(bulan)}`
      );
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat bulanan.');
    } finally {
      setLoading(false);
    }
  }, [bulan]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Month Selector Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            History & Rekap Kehadiran Pribadi
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Ringkasan HARI MASUK dan bukti sesi absensi berdasarkan resolver server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="month"
            value={bulan}
            onChange={(e) => setBulan(e.target.value)}
            aria-label="Pilih bulan rekap"
            className="min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 w-full sm:w-auto"
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
            <div className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
          </div>
          <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl p-4 text-xs text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {!loading && summary && (
        <>
          {/* Primary Payroll Output: HARI MASUK & TIDAK HADIR */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-slate-800 text-white rounded-xl p-4 sm:p-5">
              <p className="text-xs font-medium text-blue-300">HARI MASUK</p>
              <p className="font-mono text-2xl sm:text-4xl font-bold tabular-nums mt-1.5">
                {summary.hariMasuk}{' '}
                <span className="text-xs sm:text-sm font-sans font-normal text-slate-300">hari</span>
              </p>
              <p className="text-[11px] sm:text-xs text-slate-300 mt-1.5">
                Termasuk absensi sah, libur dibayar, dan off pengganti sah
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">TIDAK HADIR</p>
              <p
                className={`font-mono text-2xl sm:text-4xl font-bold tabular-nums mt-1.5 ${
                  summary.tidakHadir > 0
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {summary.tidakHadir}{' '}
                <span className="text-xs sm:text-sm font-sans font-normal text-slate-500 dark:text-slate-400">hari</span>
              </p>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                Hari kerja tidak memenuhi minimum sesi tanpa izin sah
              </p>
            </div>
          </div>

          {/* Detail Breakdown Below */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">
              Rincian Kategori Bulan {summary.bulan}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Hari Kerja</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {summary.rincian.hariKerja}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Hadir Absensi</p>
                <p className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
                  {summary.rincian.hadirAbsensi}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Libur Dihitung Masuk</p>
                <p className="font-mono text-base font-bold text-sky-700 dark:text-sky-400 tabular-nums mt-0.5">
                  {summary.rincian.liburDihitungMasuk}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Off Pengganti Masuk</p>
                <p className="font-mono text-base font-bold text-indigo-700 dark:text-indigo-400 tabular-nums mt-0.5">
                  {summary.rincian.offDihitungMasuk}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Kerja Khusus</p>
                <p className="font-mono text-base font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">
                  {summary.rincian.kerjaKhusus}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Cuti</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {summary.rincian.cuti}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Izin</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {summary.rincian.izin}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Sakit</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {summary.rincian.sakit}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Hari Libur Total</p>
                <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                  {summary.rincian.hariLibur}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Terlambat Sesi 1</p>
                <p className="font-mono text-base font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-0.5">
                  {summary.rincian.terlambat}
                </p>
              </div>
            </div>
          </div>

          {/* Daily Timeline with Photo Proofs */}
          <div className="space-y-3">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Timeline Harian & Bukti Foto
            </h2>
            <div className="space-y-3">
              {[...summary.days].reverse().map((day) => (
                <div
                  key={day.tanggal}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {day.tanggal}
                        </span>
                        <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{day.dayLabel}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Progres: {day.sessionsCompleted}/{day.policySnapshot.jumlahSesi} sesi · Payroll:{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {day.payrollStatus === 'DIHITUNG_MASUK'
                            ? 'DIHITUNG MASUK'
                            : 'TIDAK DIHITUNG MASUK'}
                        </strong>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={day.operationalStatus} />
                      {day.isOverridden && (
                        <StatusBadge status={day.payrollStatus} />
                      )}
                    </div>
                  </div>

                  {day.isOverridden && day.overrideInfo && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">
                          Admin Override Payroll: {day.overrideInfo.hasil_override.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-0.5">Alasan: {day.overrideInfo.alasan}</p>
                      </div>
                    </div>
                  )}

                  {day.offPenggantiInfo && (
                    <p className="text-xs text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
                      Off Pengganti dari project <strong>{day.offPenggantiInfo.namaProject}</strong> (Kerja tanggal{' '}
                      <span className="font-mono">{day.offPenggantiInfo.tanggalKerjaSumber}</span>)
                    </p>
                  )}

                  {/* Session records with photos */}
                  {day.sessionRecords.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      {day.sessionRecords.map((ses) => (
                        <div
                          key={ses.id}
                          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/50 flex flex-col justify-between gap-2.5"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {ses.nama_sesi}
                              </span>
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums shrink-0">
                                {ses.waktu_server.slice(11, 16)} WIB
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                              <span className="font-semibold">{ses.tipe_aktivitas}</span> ·{' '}
                              {ses.deskripsi_aktivitas}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {ses.jarak_kantor_meter !== null
                                ? `${ses.jarak_kantor_meter}m dari kantor`
                                : 'Lokasi tidak tercatat'}
                            </p>
                          </div>

                          {ses.has_foto ? (
                            <button
                              type="button"
                              onClick={() => setPreviewSession(ses)}
                              className="relative group rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 h-28 sm:h-24 w-full"
                            >
                              <img
                                src={getAuthorizedPhotoUrl(ses.id)}
                                alt={`Foto ${ses.nama_sesi}`}
                                className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                              />
                              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] rounded flex items-center gap-1">
                                <ImageIcon className="w-3 h-3" />
                                Lihat Bukti
                              </span>
                            </button>
                          ) : (
                            <div className="h-10 rounded-md border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-[11px] text-slate-400">
                              Tanpa foto
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Photo Proof Lightbox Modal (Bottom Sheet on Mobile) */}
      {previewSession && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setPreviewSession(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{previewSession.nama_sesi}</p>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {previewSession.tanggal} · {previewSession.waktu_server.slice(11, 19)} WIB
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSession(null)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Tutup foto"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-slate-950 flex items-center justify-center max-h-[58vh]">
              <img
                src={getAuthorizedPhotoUrl(previewSession.id)}
                alt="Bukti absensi"
                className="max-h-[58vh] w-full object-contain"
              />
            </div>
            <div className="p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1 bg-slate-50 dark:bg-slate-800/70">
              <p>
                <strong>Aktivitas:</strong> {previewSession.tipe_aktivitas} —{' '}
                {previewSession.deskripsi_aktivitas}
              </p>
              <p className="font-mono">
                <strong>Geofence:</strong>{' '}
                {previewSession.jarak_kantor_meter !== null
                  ? `${previewSession.jarak_kantor_meter}m (${
                      previewSession.dalam_geofence ? 'Dalam Radius' : 'Luar Radius'
                    })`
                  : 'Tidak ada koordinat'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
