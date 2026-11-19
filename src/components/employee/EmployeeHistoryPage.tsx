import { useCallback, useEffect, useState } from 'react';
import { Calendar, Image as ImageIcon, MapPin, ShieldAlert, X } from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import { getServerWibYearMonth, useServerClock } from '../../lib/server-clock-client';
import type { AbsensiSesiRecord, MonthlySummary } from '../../shared/types';
import { getHistoryCalendarStatus, type HistoryCalendarStatus } from '../../shared/history-calendar';
import { StatusBadge } from '../StatusBadge';

const HISTORY_CALENDAR_STYLES: Record<
  HistoryCalendarStatus,
  { label: string; shortLabel: string; className: string }
> = {
  HADIR: {
    label: 'Hadir',
    shortLabel: 'HADIR',
    className: 'bg-emerald-100 border-emerald-300 text-emerald-950 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200',
  },
  TIDAK_HADIR: {
    label: 'Tidak Hadir',
    shortLabel: 'ALFA',
    className: 'bg-rose-100 border-rose-300 text-rose-950 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-200',
  },
  BELUM_SELESAI: {
    label: 'Belum Selesai',
    shortLabel: 'PROSES',
    className: 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200',
  },
  HARI_LIBUR: {
    label: 'Hari Libur',
    shortLabel: 'LIBUR',
    className: 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300',
  },
  OFF_PENGGANTI: {
    label: 'Off Pengganti',
    shortLabel: 'OFF+',
    className: 'bg-indigo-100 border-indigo-300 text-indigo-950 dark:bg-indigo-950/60 dark:border-indigo-800 dark:text-indigo-200',
  },
  CUTI: {
    label: 'Cuti',
    shortLabel: 'CUTI',
    className: 'bg-violet-100 border-violet-300 text-violet-950 dark:bg-violet-950/60 dark:border-violet-800 dark:text-violet-200',
  },
  IZIN: {
    label: 'Izin',
    shortLabel: 'IZIN',
    className: 'bg-cyan-100 border-cyan-300 text-cyan-950 dark:bg-cyan-950/60 dark:border-cyan-800 dark:text-cyan-200',
  },
  SAKIT: {
    label: 'Sakit',
    shortLabel: 'SAKIT',
    className: 'bg-orange-100 border-orange-300 text-orange-950 dark:bg-orange-950/60 dark:border-orange-800 dark:text-orange-200',
  },
  OFF: {
    label: 'Off',
    shortLabel: 'OFF',
    className: 'bg-slate-100 border-slate-300 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400',
  },
  OVERRIDE_MASUK: {
    label: 'Admin Override · Dihitung Masuk',
    shortLabel: 'OVR +',
    className: 'bg-emerald-200 border-emerald-500 text-emerald-950 dark:bg-emerald-900/70 dark:border-emerald-600 dark:text-emerald-100',
  },
  OVERRIDE_TIDAK_MASUK: {
    label: 'Admin Override · Tidak Dihitung Masuk',
    shortLabel: 'OVR −',
    className: 'bg-rose-200 border-rose-500 text-rose-950 dark:bg-rose-900/70 dark:border-rose-600 dark:text-rose-100',
  },
};

export function EmployeeHistoryPage() {
  const { yearMonthWib: serverYearMonth } = useServerClock(60000);
  const [bulan, setBulan] = useState(() => getServerWibYearMonth());
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewSession, setPreviewSession] = useState<AbsensiSesiRecord | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!bulan && serverYearMonth) {
      setBulan(serverYearMonth);
    }
  }, [bulan, serverYearMonth]);

  const loadHistory = useCallback(async () => {
    if (!bulan) return;
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

  const validMonth = /^\d{4}-\d{2}$/.test(bulan);
  const [yearPart, monthPart] = validMonth ? bulan.split('-') : ['2026', '01'];
  const calendarYear = Number(yearPart);
  const calendarMonth = Number(monthPart);
  const monthDayCount = validMonth ? new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate() : 0;
  // Calendar is Monday-first to match the Indonesian work-week layout.
  const firstWeekdayOffset = validMonth
    ? (new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay() + 6) % 7
    : 0;
  const calendarCells: (number | null)[] = validMonth
    ? [
        ...Array.from({ length: firstWeekdayOffset }, () => null),
        ...Array.from({ length: monthDayCount }, (_, index) => index + 1),
      ]
    : [];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  const monthTitle = validMonth
    ? new Intl.DateTimeFormat('id-ID', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)))
    : 'Menyinkronkan waktu server...';
  const dayByDate = new Map((summary?.days || []).map((day) => [day.tanggal, day] as const));
  const selectedDay = selectedDate
    ? summary?.days.find((day) => day.tanggal === selectedDate) || null
    : null;
  const timelineDays = summary
    ? selectedDate
      ? summary.days.filter((day) => day.tanggal === selectedDate)
      : [...summary.days].reverse()
    : [];

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
            onChange={(e) => {
              setBulan(e.target.value);
              setSelectedDate(null);
            }}
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
              <p className="text-xs font-medium text-brand-200">HARI MASUK</p>
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

          {/* Monthly attendance calendar with resolver-backed status colors */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Kalender Kehadiran
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
                  {monthTitle} · Ketuk tanggal untuk melihat rincian absensi
                </p>
              </div>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Tampilkan Semua Tanggal
                </button>
              )}
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2" role="grid" aria-label={`Kalender kehadiran ${monthTitle}`}>
              {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((weekday) => (
                <div
                  key={weekday}
                  role="columnheader"
                  className="py-1.5 text-center text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400"
                >
                  {weekday}
                </div>
              ))}
              {calendarCells.map((dateNumber, index) => {
                if (dateNumber === null) {
                  return <div key={`empty-${index}`} aria-hidden="true" className="min-h-[54px] sm:min-h-[68px]" />;
                }

                const dateKey = `${bulan}-${String(dateNumber).padStart(2, '0')}`;
                const day = dayByDate.get(dateKey);
                if (!day) {
                  return (
                    <div
                      key={dateKey}
                      className="min-h-[54px] sm:min-h-[68px] rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600"
                      aria-label={`${dateKey}, belum dievaluasi`}
                    >
                      <span className="text-xs sm:text-sm font-semibold">{dateNumber}</span>
                      <span className="text-[8px] sm:text-[9px]">—</span>
                    </div>
                  );
                }

                const status = getHistoryCalendarStatus(day);
                const appearance = HISTORY_CALENDAR_STYLES[status];
                const isSelected = selectedDate === dateKey;
                return (
                  <button
                    key={dateKey}
                    type="button"
                    role="gridcell"
                    aria-pressed={isSelected}
                    aria-label={`${dateKey}: ${appearance.label}; ${day.sessionsCompleted} dari ${day.policySnapshot.jumlahSesi} sesi`}
                    title={`${dateKey} · ${appearance.label}${day.isOverridden ? ' · Admin Override' : ''}`}
                    onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                    className={`relative min-h-[54px] sm:min-h-[68px] rounded-lg border p-1 sm:p-2 flex flex-col items-center justify-center gap-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${appearance.className} ${isSelected ? 'ring-2 ring-brand-600 ring-offset-2 dark:ring-offset-slate-900 z-10' : 'hover:brightness-95'}`}
                  >
                    <span className="text-xs sm:text-sm font-bold tabular-nums">{dateNumber}</span>
                    <span className="text-[8px] sm:text-[10px] leading-tight font-semibold text-center">
                      {appearance.shortLabel}
                    </span>
                    {day.sessionsCompleted > 0 && (
                      <span className="text-[8px] sm:text-[9px] opacity-80 tabular-nums">
                        {day.sessionsCompleted}/{day.policySnapshot.jumlahSesi}
                      </span>
                    )}
                    {day.isOverridden && (
                      <span className="absolute top-0.5 right-1 text-[7px] sm:text-[8px] font-black">O</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-2 text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300">
              {[
                ['bg-emerald-500', 'Hadir'],
                ['bg-rose-500', 'Tidak Hadir'],
                ['bg-amber-500', 'Belum Selesai'],
                ['bg-slate-400', 'Libur / Off'],
                ['bg-indigo-500', 'Off Pengganti'],
                ['bg-violet-500', 'Cuti'],
                ['bg-cyan-500', 'Izin'],
                ['bg-orange-500', 'Sakit'],
                ['bg-brand-600', 'O = Admin Override'],
              ].map(([dot, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm ${dot}`} />
                  {label}
                </span>
              ))}
            </div>

            {selectedDay && (
              <div className="rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50/70 dark:bg-brand-950/30 p-3 text-xs space-y-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  {selectedDay.tanggal} · {selectedDay.dayLabel}
                </p>
                <p className="text-slate-700 dark:text-slate-300">
                  Status: <strong>{HISTORY_CALENDAR_STYLES[getHistoryCalendarStatus(selectedDay)].label}</strong>
                  {' · '}Sesi tercatat: {selectedDay.sessionsCompleted}/{selectedDay.policySnapshot.jumlahSesi}
                </p>
                {selectedDay.isOverridden && selectedDay.overrideInfo && (
                  <p className="text-amber-800 dark:text-amber-300">
                    Admin Override: {selectedDay.overrideInfo.hasil_override.replace(/_/g, ' ')} — {selectedDay.overrideInfo.alasan}
                  </p>
                )}
                <p className="text-slate-500 dark:text-slate-400">
                  Rincian sesi dan bukti foto ditampilkan di bagian bawah.
                </p>
              </div>
            )}
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                {selectedDate ? `Rincian ${selectedDate}` : 'Timeline Harian & Bukti Foto'}
              </h2>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-brand-600 dark:text-brand-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Hapus Filter
                </button>
              )}
            </div>
            <div className="space-y-3">
              {timelineDays.map((day) => (
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

      {/* Centered Photo Proof Lightbox Modal */}
      {previewSession && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          onClick={() => setPreviewSession(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full overflow-hidden border border-slate-200 dark:border-slate-800 max-h-[calc(100dvh-1.5rem)] shadow-2xl flex flex-col"
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
            <div className="bg-slate-950 flex items-center justify-center max-h-[48dvh] sm:max-h-[58vh] overflow-hidden">
              <img
                src={getAuthorizedPhotoUrl(previewSession.id)}
                alt="Bukti absensi"
                className="max-h-[48dvh] sm:max-h-[58vh] w-full object-contain"
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
