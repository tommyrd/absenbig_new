import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Building2 } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface TrendDay {
  tanggal: string;
  label: string;
  tepatWaktu: number;
  terlambat: number;
  izinSakitCuti: number;
  tidakHadir: number;
  belumSelesai: number;
  libur: number;
  totalWajibKerja: number;
}

interface OfficeComparison {
  kantorId: number;
  kantorNama: string;
  tepatWaktu: number;
  terlambat: number;
  izinSakitCuti: number;
  tidakHadir: number;
  hadirTotal: number;
  persenHadir: number;
  persenTepatWaktu: number;
}

interface TrendPayload {
  days: number;
  today: string;
  totals: {
    tepatWaktu: number;
    terlambat: number;
    izinSakitCuti: number;
    tidakHadir: number;
  };
  series: TrendDay[];
  officeComparison: OfficeComparison[];
}

interface AttendanceTrendChartProps {
  kantorId?: string;
  title?: string;
}

export function AttendanceTrendChart({
  kantorId = '',
  title = 'Tren Kehadiran & Keterlambatan',
}: AttendanceTrendChartProps) {
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [data, setData] = useState<TrendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (kantorId) qs.set('kantorId', kantorId);
      const res = await apiFetch<TrendPayload>(`/api/v1/analytics/attendance-trend?${qs.toString()}`);
      setData(res);
      setSelectedIdx(res.series.length > 0 ? res.series.length - 1 : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days, kantorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const series = data?.series || [];
  const maxStack = Math.max(
    1,
    ...series.map((d) => d.tepatWaktu + d.terlambat + d.izinSakitCuti + d.tidakHadir)
  );
  const activeDay = selectedIdx !== null && series[selectedIdx] ? series[selectedIdx] : series[series.length - 1] || null;

  const totalHadir = (data?.totals.tepatWaktu || 0) + (data?.totals.terlambat || 0);
  const onTimePct = totalHadir > 0 ? Math.round(((data?.totals.tepatWaktu || 0) / totalHadir) * 100) : 100;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#c0392b] dark:text-brand-400" />
            {title}
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Distribusi harian ketepatan waktu, keterlambatan Sesi 1, izin/cuti, dan ketidakhadiran.
          </p>
        </div>

        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                days === d
                  ? 'bg-[#c0392b] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {d} Hari
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-44 rounded-lg bg-slate-100 dark:bg-slate-800/70 animate-pulse" />
      ) : !data || series.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
          Data tren kehadiran belum tersedia untuk rentang ini.
        </p>
      ) : (
        <>
          {/* Compact Aggregate Legend Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 shrink-0" />
                Tepat Waktu ({onTimePct}%)
              </div>
              <p className="font-mono text-base font-bold text-emerald-800 dark:text-emerald-200 tabular-nums mt-0.5">
                {data.totals.tepatWaktu}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 shrink-0" />
                Terlambat Sesi 1
              </div>
              <p className="font-mono text-base font-bold text-amber-800 dark:text-amber-200 tabular-nums mt-0.5">
                {data.totals.terlambat}
              </p>
            </div>
            <div className="rounded-lg border border-sky-200/80 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-sky-800 dark:text-sky-300 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 shrink-0" />
                Izin / Sakit / Cuti
              </div>
              <p className="font-mono text-base font-bold text-sky-800 dark:text-sky-200 tabular-nums mt-0.5">
                {data.totals.izinSakitCuti}
              </p>
            </div>
            <div className="rounded-lg border border-red-200/80 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-red-800 dark:text-red-300 font-medium">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-500 shrink-0" />
                Tidak Hadir
              </div>
              <p className="font-mono text-base font-bold text-red-800 dark:text-red-200 tabular-nums mt-0.5">
                {data.totals.tidakHadir}
              </p>
            </div>
          </div>

          {/* Interactive Stacked SVG Bar Chart */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3">
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${Math.max(560, series.length * 36)} 180`}
                className="w-full h-44 min-w-[460px] select-none"
                role="img"
                aria-label={`Grafik tren kehadiran ${days} hari terakhir`}
              >
                {/* Horizontal subtle grid lines */}
                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = 148 - ratio * 124;
                  return (
                    <line
                      key={ratio}
                      x1={8}
                      x2={Math.max(560, series.length * 36) - 8}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      className="text-slate-200 dark:text-slate-800"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                    />
                  );
                })}

                {series.map((d, idx) => {
                  const totalW = Math.max(560, series.length * 36);
                  const slotW = (totalW - 24) / series.length;
                  const barW = Math.min(26, Math.max(10, slotW * 0.62));
                  const x = 12 + idx * slotW + (slotW - barW) / 2;
                  const scale = 124 / maxStack;

                  const hTepat = d.tepatWaktu * scale;
                  const hTelat = d.terlambat * scale;
                  const hIsc = d.izinSakitCuti * scale;
                  const hAbsen = d.tidakHadir * scale;

                  let cursorY = 148;
                  const yTepat = cursorY - hTepat;
                  cursorY = yTepat;
                  const yTelat = cursorY - hTelat;
                  cursorY = yTelat;
                  const yIsc = cursorY - hIsc;
                  cursorY = yIsc;
                  const yAbsen = cursorY - hAbsen;

                  const isSelected = selectedIdx === idx;
                  const showLabel =
                    days <= 14 || idx === 0 || idx === series.length - 1 || idx % 4 === 0;

                  return (
                    <g
                      key={d.tanggal}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => setSelectedIdx(idx)}
                      className="cursor-pointer"
                    >
                      {isSelected && (
                        <rect
                          x={x - 4}
                          y={16}
                          width={barW + 8}
                          height={136}
                          rx={6}
                          className="fill-brand-500/10 dark:fill-brand-400/15"
                        />
                      )}
                      {hTepat > 0 && (
                        <rect x={x} y={yTepat} width={barW} height={hTepat} rx={2} fill="#10b981" />
                      )}
                      {hTelat > 0 && (
                        <rect x={x} y={yTelat} width={barW} height={hTelat} rx={2} fill="#f59e0b" />
                      )}
                      {hIsc > 0 && (
                        <rect x={x} y={yIsc} width={barW} height={hIsc} rx={2} fill="#0ea5e9" />
                      )}
                      {hAbsen > 0 && (
                        <rect x={x} y={yAbsen} width={barW} height={hAbsen} rx={2} fill="#ef4444" />
                      )}
                      {hTepat + hTelat + hIsc + hAbsen === 0 && (
                        <rect
                          x={x}
                          y={144}
                          width={barW}
                          height={4}
                          rx={2}
                          className="fill-slate-300 dark:fill-slate-700"
                        />
                      )}
                      {showLabel && (
                        <text
                          x={x + barW / 2}
                          y={166}
                          textAnchor="middle"
                          fontSize={days > 14 ? 9.5 : 10}
                          className={`${
                            isSelected
                              ? 'fill-slate-900 dark:fill-white font-bold'
                              : 'fill-slate-500 dark:fill-slate-400'
                          }`}
                        >
                          {d.tanggal.slice(8, 10)}/{d.tanggal.slice(5, 7)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {activeDay && (
              <div className="mt-2 pt-2.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {activeDay.label} ({activeDay.tanggal})
                  {activeDay.tanggal === data.today ? ' · Hari Ini' : ''}
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-[11px]">
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Tepat: <strong>{activeDay.tepatWaktu}</strong>
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    Telat: <strong>{activeDay.terlambat}</strong>
                  </span>
                  <span className="text-sky-700 dark:text-sky-400">
                    I/S/C: <strong>{activeDay.izinSakitCuti}</strong>
                  </span>
                  <span className="text-red-700 dark:text-red-400">
                    Absen: <strong>{activeDay.tidakHadir}</strong>
                  </span>
                  {activeDay.libur > 0 && (
                    <span className="text-slate-500 dark:text-slate-400">
                      Libur/Off: <strong>{activeDay.libur}</strong>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Office Comparison Bars */}
          {data.officeComparison.length > 1 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
                Perbandingan Kedisiplinan per Kantor ({days} Hari)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {data.officeComparison.map((o) => (
                  <div
                    key={o.kantorId}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {o.kantorNama}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                        {o.persenHadir}% hadir · {o.persenTepatWaktu}% tepat
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full"
                        style={{
                          width: `${Math.round(
                            (o.tepatWaktu / Math.max(1, o.hadirTotal + o.tidakHadir)) * 100
                          )}%`,
                        }}
                      />
                      <div
                        className="bg-amber-500 h-full"
                        style={{
                          width: `${Math.round(
                            (o.terlambat / Math.max(1, o.hadirTotal + o.tidakHadir)) * 100
                          )}%`,
                        }}
                      />
                      <div
                        className="bg-red-500 h-full"
                        style={{
                          width: `${Math.round(
                            (o.tidakHadir / Math.max(1, o.hadirTotal + o.tidakHadir)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
