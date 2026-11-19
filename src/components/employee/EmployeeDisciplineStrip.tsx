import { useEffect, useMemo, useState } from 'react';
import { Award, Bell, BellOff, CalendarCheck2, Flame } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getServerWibYearMonth } from '../../lib/server-clock-client';
import {
  getNotificationPermission,
  isNotificationSupported,
  isReminderEnabled,
  requestNotificationPermission,
  setReminderEnabled,
  type ReminderPermission,
} from '../../lib/session-reminder';
import type { HakOffPengganti, MonthlySummary } from '../../shared/types';

interface EmployeeDisciplineStripProps {
  onGoToHistory: () => void;
  onGoToPengajuan: () => void;
}

export function EmployeeDisciplineStrip({
  onGoToHistory,
  onGoToPengajuan,
}: EmployeeDisciplineStripProps) {
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [offRights, setOffRights] = useState<HakOffPengganti[]>([]);
  const [loading, setLoading] = useState(true);

  const [notifSupported] = useState(() => isNotificationSupported());
  const [notifPermission, setNotifPermission] = useState<ReminderPermission>(() =>
    getNotificationPermission()
  );
  const [reminderOn, setReminderOn] = useState(() => isReminderEnabled());
  const [reminderHint, setReminderHint] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const bulan = getServerWibYearMonth();
    Promise.all([
      apiFetch<{ summary: MonthlySummary }>(
        `/api/v1/attendance/history?bulan=${encodeURIComponent(bulan)}`
      ),
      apiFetch<{ items: HakOffPengganti[] }>('/api/v1/off-rights'),
    ])
      .then(([histRes, offRes]) => {
        if (!active) return;
        setSummary(histRes.summary);
        setOffRights(offRes.items || []);
      })
      .catch(() => {
        // Non-blocking personal summary strip
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    if (!summary) {
      return { streak: 0, attendancePct: 100, hariMasuk: 0, tidakHadir: 0, availableOff: 0 };
    }

    // Calculate consecutive recent on-time workdays up to today
    const pastOrTodayWorkdays = [...summary.days]
      .filter((d) => d.dayType === 'HARI_KERJA' || d.dayType === 'KERJA_KHUSUS')
      .filter((d) => d.operationalStatus !== 'BELUM_SELESAI')
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal));

    let streak = 0;
    for (const day of pastOrTodayWorkdays) {
      const sesi1 = day.sessionRecords.find((s) => s.urutan_sesi === 1);
      if (day.operationalStatus === 'HADIR' && (!sesi1 || sesi1.status_ketepatan === 'TEPAT_WAKTU')) {
        streak += 1;
      } else if (
        day.operationalStatus === 'CUTI' ||
        day.operationalStatus === 'SAKIT' ||
        day.operationalStatus === 'IZIN' ||
        day.operationalStatus === 'OFF_PENGGANTI'
      ) {
        continue;
      } else {
        break;
      }
    }

    const totalEvaluated = summary.hariMasuk + summary.tidakHadir;
    const attendancePct =
      totalEvaluated > 0 ? Math.round((summary.hariMasuk / totalEvaluated) * 100) : 100;
    const availableOff = offRights.filter((o) => o.status === 'TERSEDIA').length;

    return {
      streak,
      attendancePct,
      hariMasuk: summary.hariMasuk,
      tidakHadir: summary.tidakHadir,
      availableOff,
    };
  }, [summary, offRights]);

  const handleToggleReminder = async () => {
    setReminderHint(null);
    if (!notifSupported) {
      setReminderHint('Browser ini belum mendukung notifikasi pengingat sesi.');
      return;
    }
    if (reminderOn) {
      setReminderEnabled(false);
      setReminderOn(false);
      setReminderHint('Pengingat notifikasi sesi dimatikan.');
      return;
    }
    if (notifPermission === 'granted') {
      setReminderEnabled(true);
      setReminderOn(true);
      setReminderHint('Pengingat sesi aktif saat jendela absen dibuka & 15 menit sebelum tutup.');
      return;
    }
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === 'granted') {
      setReminderOn(true);
      setReminderHint('Pengingat sesi diaktifkan! Anda akan diingatkan otomatis.');
    } else if (result === 'denied') {
      setReminderHint('Izin notifikasi diblokir browser. Aktifkan izin notifikasi di pengaturan situs.');
    }
  };

  if (loading) {
    return (
      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-3">
        {[1, 2, 3].map((k) => (
          <div
            key={k}
            className="h-20 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Ringkasan Kedisiplinan Pribadi" className="mb-4 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={onGoToHistory}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-brand-300 dark:hover:border-brand-700 p-3.5 transition-colors flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Streak Tepat Waktu
            </p>
            <p className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight mt-0.5">
              {stats.streak} <span className="text-xs font-sans font-semibold text-slate-500">hari</span>
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={onGoToHistory}
          className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-emerald-300 dark:hover:border-emerald-700 p-3.5 transition-colors flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CalendarCheck2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Kehadiran Bulan Ini
            </p>
            <p className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums leading-tight mt-0.5">
              {stats.attendancePct}%
              <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 ml-1.5">
                ({stats.hariMasuk} masuk)
              </span>
            </p>
          </div>
        </button>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onGoToPengajuan}
            className="text-left flex items-center gap-3 min-w-0 flex-1 group"
          >
            <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800/80 text-[#c0392b] dark:text-brand-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Hak Off Pengganti
              </p>
              <p className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums leading-tight mt-0.5 group-hover:text-[#c0392b] dark:group-hover:text-brand-400">
                {stats.availableOff}{' '}
                <span className="text-xs font-sans font-semibold text-slate-500">tersedia</span>
              </p>
            </div>
          </button>

          {notifSupported && (
            <button
              type="button"
              onClick={() => void handleToggleReminder()}
              title={
                reminderOn
                  ? 'Pengingat notifikasi sesi aktif (klik untuk matikan)'
                  : 'Aktifkan notifikasi pengingat sesi absensi'
              }
              className={`min-h-[36px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                reminderOn
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {reminderOn ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{reminderOn ? 'Pengingat ON' : 'Pengingat'}</span>
            </button>
          )}
        </div>
      </div>

      {reminderHint && (
        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
          {reminderHint}
        </p>
      )}
    </section>
  );
}
