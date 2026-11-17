import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  Lock,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import { exportPayrollToExcel, exportPayrollToImage } from '../../lib/exportUtils';
import type { BidangKerja, Kantor, MonthlySummary, PeriodePayroll, ResolvedDay } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';

export function AdminPayrollTab() {
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

  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [period, setPeriod] = useState<PeriodePayroll | null>(null);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [kantorId, setKantorId] = useState('');
  const [bidangId, setBidangId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Employee Detail & Override Drawer
  const [inspectSummary, setInspectSummary] = useState<MonthlySummary | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<{
    karyawanId: number;
    karyawanNama: string;
    day: ResolvedDay;
  } | null>(null);
  const [hasilOverride, setHasilOverride] = useState<'DIHITUNG_MASUK' | 'TIDAK_DIHITUNG_MASUK'>(
    'DIHITUNG_MASUK'
  );
  const [overrideAlasan, setOverrideAlasan] = useState('');
  const [postClosingConfirm, setPostClosingConfirm] = useState(false);
  const [overrideErr, setOverrideErr] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);

  // Closing Modal
  const [closeModal, setCloseModal] = useState(false);
  const [closeNote, setCloseNote] = useState('Rekap kehadiran dan override telah divalidasi.');
  const [closing, setClosing] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ bulan });
      if (kantorId) qs.set('kantorId', kantorId);
      if (bidangId) qs.set('bidangId', bidangId);
      const [res, off, bid] = await Promise.all([
        apiFetch<{ bulan: string; period: PeriodePayroll | null; items: MonthlySummary[] }>(
          `/api/v1/payroll/summary?${qs.toString()}`
        ),
        apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
        apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
      ]);
      setSummaries(res.items);
      setPeriod(res.period);
      setOffices(off.items);
      setBidangList(bid.items);

      if (inspectSummary) {
        const refreshed = res.items.find((s) => s.karyawanId === inspectSummary.karyawanId) || null;
        setInspectSummary(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat rekap payroll.');
    } finally {
      setLoading(false);
    }
  }, [bulan, kantorId, bidangId, inspectSummary]);

  useEffect(() => {
    loadSummary();
  }, [bulan, kantorId, bidangId]);

  const submitOverride = async (e: FormEvent) => {
    e.preventDefault();
    if (!overrideTarget) return;
    setSavingOverride(true);
    setOverrideErr(null);
    try {
      await apiFetch('/api/v1/payroll/override', {
        method: 'POST',
        body: JSON.stringify({
          karyawanId: overrideTarget.karyawanId,
          tanggal: overrideTarget.day.tanggal,
          hasilOverride,
          alasan: overrideAlasan,
          koreksiSetelahClosing: postClosingConfirm,
        }),
      });
      setOverrideTarget(null);
      setOverrideAlasan('');
      setPostClosingConfirm(false);
      await loadSummary();
    } catch (err) {
      setOverrideErr(err instanceof Error ? err.message : 'Gagal menyimpan Admin Override.');
    } finally {
      setSavingOverride(false);
    }
  };

  const handleClosePeriod = async (e: FormEvent) => {
    e.preventDefault();
    setClosing(true);
    try {
      await apiFetch('/api/v1/payroll/close', {
        method: 'POST',
        body: JSON.stringify({ bulan, catatan: closeNote }),
      });
      setCloseModal(false);
      await loadSummary();
    } finally {
      setClosing(false);
    }
  };

  const totalMasuk = summaries.reduce((a, s) => a + s.hariMasuk, 0);
  const totalTidakHadir = summaries.reduce((a, s) => a + s.tidakHadir, 0);
  const totalOverrides = summaries.reduce((a, s) => a + s.rincian.totalOverride, 0);

  const columns: ColumnDef<MonthlySummary>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik,
      render: (r) => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.nik}</span>,
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
      key: 'hariMasuk',
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
      key: 'tidakHadir',
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
      key: 'rincian',
      header: 'Rincian (Absen / Libur / Off / Izin-Sakit-Cuti)',
      render: (r) => (
        <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
          {r.rincian.hadirAbsensi} abs · {r.rincian.liburDihitungMasuk} lbr ·{' '}
          {r.rincian.offDihitungMasuk} off · {r.rincian.izin + r.rincian.sakit + r.rincian.cuti} i/s/c
        </div>
      ),
    },
    {
      key: 'override',
      header: 'Override',
      align: 'center',
      sortValue: (r) => r.rincian.totalOverride,
      render: (r) =>
        r.rincian.totalOverride > 0 ? (
          <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
            {r.rincian.totalOverride}x
          </span>
        ) : (
          <span className="text-xs text-slate-400">0</span>
        ),
    },
    {
      key: 'aksi',
      header: 'Detail & Override',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => setInspectSummary(r)}
          className="min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-navy-900 dark:text-slate-100"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Inspeksi / Override
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              Rekap Payroll, Override & Closing
            </h1>
            <StatusBadge status={period?.status === 'CLOSED' ? 'CLOSED' : 'OPEN'} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Output utama HARI MASUK dan TIDAK HADIR bersumber langsung dari PayrollDayResolver server.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={bulan}
            onChange={(e) => setBulan(e.target.value)}
            className="min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 w-full sm:w-auto"
          />
          <button
            type="button"
            onClick={() => exportPayrollToExcel(bulan, summaries)}
            className="min-h-[44px] sm:h-10 px-3.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 flex-1 sm:flex-none"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => exportPayrollToImage(bulan, summaries, 'png')}
            className="min-h-[44px] sm:h-10 px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 flex-1 sm:flex-none"
          >
            <ImageIcon className="w-4 h-4" />
            PNG
          </button>
          <button
            type="button"
            onClick={() => exportPayrollToImage(bulan, summaries, 'jpeg')}
            className="min-h-[44px] sm:h-10 px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 flex-1 sm:flex-none"
          >
            <Download className="w-4 h-4" />
            JPG
          </button>
          {period?.status !== 'CLOSED' && (
            <button
              type="button"
              onClick={() => setCloseModal(true)}
              className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Lock className="w-4 h-4" />
              Tutup Periode
            </button>
          )}
        </div>
      </div>

      {/* Prominent Top Payroll Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-slate-800 text-white rounded-xl p-4 sm:p-5">
          <p className="text-xs text-blue-300 font-medium">TOTAL HARI MASUK ({bulan})</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold tabular-nums mt-1">{totalMasuk} hari</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">TOTAL TIDAK HADIR ({bulan})</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold text-red-700 dark:text-red-400 tabular-nums mt-1">
            {totalTidakHadir} hari
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">ADMIN OVERRIDE AKTIF</p>
          <p className="font-mono text-2xl sm:text-3xl font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
            {totalOverrides} kasus
          </p>
        </div>
      </div>

      <DataTable
        data={summaries}
        columns={columns}
        getRowId={(r) => r.karyawanId}
        loading={loading}
        error={error}
        onRetry={loadSummary}
        searchPlaceholder="Cari NIK atau nama karyawan..."
        searchFilter={(r, q) =>
          r.karyawanNama.toLowerCase().includes(q) || r.nik.toLowerCase().includes(q)
        }
        filterToolbar={
          <>
            <select
              value={kantorId}
              onChange={(e) => setKantorId(e.target.value)}
              className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
            >
              <option value="">Semua Kantor</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama}
                </option>
              ))}
            </select>
            <select
              value={bidangId}
              onChange={(e) => setBidangId(e.target.value)}
              className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
            >
              <option value="">Semua Bidang</option>
              {bidangList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nama}
                </option>
              ))}
            </select>
          </>
        }
      />

      {/* Employee Day Inspector & Admin Override Drawer */}
      {inspectSummary && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-full flex flex-col border-l border-slate-200 dark:border-slate-800">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-navy-900 dark:bg-slate-950 text-white">
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold truncate">
                  {inspectSummary.karyawanNama} ({inspectSummary.nik})
                </h2>
                <p className="text-xs text-slate-300 mt-0.5">
                  Bulan {inspectSummary.bulan} · HARI MASUK: {inspectSummary.hariMasuk} · TIDAK
                  HADIR: {inspectSummary.tidakHadir}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectSummary(null)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {[...inspectSummary.days].reverse().map((day) => (
                <div
                  key={day.tanggal}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {day.tanggal}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{day.dayLabel}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={day.operationalStatus} />
                      <StatusBadge status={day.payrollStatus} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <span>
                      Sesi: <strong className="font-mono text-slate-900 dark:text-slate-100">{day.sessionsCompleted}/{day.policySnapshot.jumlahSesi}</strong> · Sumber Payroll:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">{day.payrollSource}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideTarget({
                          karyawanId: inspectSummary.karyawanId,
                          karyawanNama: inspectSummary.karyawanNama,
                          day,
                        });
                        setHasilOverride(
                          day.payrollStatus === 'DIHITUNG_MASUK'
                            ? 'TIDAK_DIHITUNG_MASUK'
                            : 'DIHITUNG_MASUK'
                        );
                        setOverrideAlasan('');
                        setOverrideErr(null);
                      }}
                      className="min-h-[36px] text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      Admin Override Tanggal Ini
                    </button>
                  </div>

                  {day.isOverridden && day.overrideInfo && (
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                      <strong>Override Aktif:</strong> Awal ({day.overrideInfo.hasil_awal}) →{' '}
                      <strong>{day.overrideInfo.hasil_override}</strong> · Alasan:{' '}
                      {day.overrideInfo.alasan}
                    </div>
                  )}

                  {day.sessionRecords.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {day.sessionRecords.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-[11px]"
                        >
                          {s.has_foto && (
                            <img
                              src={getAuthorizedPhotoUrl(s.id)}
                              alt={s.nama_sesi}
                              className="w-9 h-9 rounded object-cover"
                            />
                          )}
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              S{s.urutan_sesi} · {s.waktu_server.slice(11, 16)}
                            </p>
                            <p className="text-slate-500 dark:text-slate-400 max-w-[160px] truncate">
                              {s.deskripsi_aktivitas}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Admin Override Modal (Bottom Sheet on Mobile) */}
      {overrideTarget && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Admin Override Payroll
              </h2>
              <button
                type="button"
                onClick={() => setOverrideTarget(null)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitOverride} className="p-5 space-y-4 overflow-y-auto">
              {overrideErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                  {overrideErr}
                </div>
              )}
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {overrideTarget.karyawanNama} · {overrideTarget.day.tanggal}
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  Status awal: {overrideTarget.day.operationalStatus} ({overrideTarget.day.payrollStatus})
                </p>
                <p className="text-slate-500 dark:text-slate-400">
                  Admin Override dapat menetapkan hasil hari sebagai DIHITUNG MASUK saat karyawan mengalami kendala HP/GPS. Ini adalah koreksi payroll, bukan pembuatan sesi, foto, atau bukti GPS palsu. Alasan, Admin, dan waktu tindakan tercatat di Audit Trail Superadmin.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tetapkan Hasil Payroll
                </label>
                <select
                  value={hasilOverride}
                  onChange={(e) =>
                    setHasilOverride(
                      e.target.value as 'DIHITUNG_MASUK' | 'TIDAK_DIHITUNG_MASUK'
                    )
                  }
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="DIHITUNG_MASUK">DIHITUNG MASUK</option>
                  <option value="TIDAK_DIHITUNG_MASUK">TIDAK DIHITUNG MASUK</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Alasan Override (Wajib)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={overrideAlasan}
                  onChange={(e) => setOverrideAlasan(e.target.value)}
                  placeholder="Jelaskan dasar keputusan koreksi payroll ini..."
                  className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {period?.status === 'CLOSED' && (
                <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                  <input
                    type="checkbox"
                    required
                    checked={postClosingConfirm}
                    onChange={(e) => setPostClosingConfirm(e.target.checked)}
                    className="w-4 h-4 accent-navy-900 dark:accent-blue-500 mt-0.5"
                  />
                  <span>
                    Periode {bulan} sudah CLOSED. Konfirmasi ini adalah Koreksi Khusus Pasca-Closing.
                  </span>
                </label>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingOverride}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg"
                >
                  {savingOverride ? 'Menyimpan...' : 'Simpan Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monthly Closing Modal (Bottom Sheet on Mobile) */}
      {closeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Tutup Periode Payroll ({bulan})
              </h2>
              <button
                type="button"
                onClick={() => setCloseModal(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleClosePeriod} className="p-5 space-y-4 overflow-y-auto">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs space-y-1 text-slate-700 dark:text-slate-300">
                <p>Total Karyawan: <strong className="text-slate-900 dark:text-slate-100">{summaries.length}</strong></p>
                <p>Snapshot HARI MASUK: <strong className="text-emerald-700 dark:text-emerald-400">{totalMasuk} hari</strong></p>
                <p>Snapshot TIDAK HADIR: <strong className="text-red-700 dark:text-red-400">{totalTidakHadir} hari</strong></p>
                <p>Total Override Tercatat: <strong className="text-slate-900 dark:text-slate-100">{totalOverrides}</strong></p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Catatan Closing
                </label>
                <textarea
                  rows={2}
                  required
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCloseModal(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={closing}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg"
                >
                  {closing ? 'Menutup...' : 'Kunci & Simpan Snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
