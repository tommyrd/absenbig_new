import { useState } from 'react';
import { Bell, BellOff, ShieldCheck } from 'lucide-react';
import {
  getNotificationPermission,
  isNotificationSupported,
  isReminderEnabled,
  requestNotificationPermission,
  setReminderEnabled,
  type ReminderPermission,
} from '../../lib/session-reminder';
import type { AuthUser, ResolvedDay } from '../../shared/types';
import { ProfileSettingsPanel } from '../ProfileSettingsPanel';

interface EmployeeProfilPageProps {
  user: AuthUser;
  myDay: ResolvedDay | null;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void;
}

export function EmployeeProfilPage({
  user,
  myDay,
  onUserUpdated,
  onLogout,
}: EmployeeProfilPageProps) {
  const [notifSupported] = useState(() => isNotificationSupported());
  const [notifPermission, setNotifPermission] = useState<ReminderPermission>(() =>
    getNotificationPermission()
  );
  const [reminderOn, setReminderOn] = useState(() => isReminderEnabled());
  const [reminderHint, setReminderHint] = useState<string | null>(null);

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
      setReminderHint('Pengingat aktif saat jendela sesi dibuka dan 15 menit sebelum ditutup.');
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

  return (
    <ProfileSettingsPanel
      user={user}
      onUserUpdated={onUserUpdated}
      onLogout={onLogout}
      extraContent={
        <div className="space-y-4">
          {notifSupported && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    {reminderOn ? (
                      <Bell className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <BellOff className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                    )}
                    Pengingat Notifikasi Sesi
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Notifikasi otomatis saat sesi absensi dibuka dan 15 menit sebelum ditutup.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleReminder()}
                  className={`min-h-[38px] px-3.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                    reminderOn
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {reminderOn ? 'Aktif' : 'Aktifkan'}
                </button>
              </div>
              {reminderHint && (
                <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                  {reminderHint}
                </p>
              )}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              Kebijakan Sesi Aktif Hari Ini
            </h2>
            {myDay ? (
              myDay.policySnapshot.policyId === null ? (
                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-amber-950 dark:text-amber-100 space-y-1">
                    <p className="font-semibold">
                      {myDay.upcomingPolicy
                        ? `Belum Berlaku — Mulai ${myDay.upcomingPolicy.berlakuMulai}`
                        : 'Belum Ada Kebijakan Sesi Aktif'}
                    </p>
                    <p className="text-amber-800 dark:text-amber-200">
                      {myDay.upcomingPolicy
                        ? `Kebijakan "${myDay.upcomingPolicy.policyName}" (${myDay.upcomingPolicy.level}) akan aktif mulai ${myDay.upcomingPolicy.berlakuMulai} dengan target ${myDay.upcomingPolicy.minSesiHadir}/${myDay.upcomingPolicy.jumlahSesi} sesi.`
                        : 'Saat ini belum ada jadwal sesi absensi yang aktif untuk akun Anda.'}
                    </p>
                  </div>
                  {myDay.upcomingPolicy && myDay.upcomingPolicy.sesiList.length > 0 && (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {myDay.upcomingPolicy.sesiList.map((s) => (
                        <div key={s.urutan} className="py-2 flex items-center justify-between">
                          <span className="font-medium text-slate-700 dark:text-slate-300">{s.nama}</span>
                          <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                            {s.jam_mulai} – {s.jam_selesai} WIB
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {myDay.policySnapshot.policyName}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Tingkat Prioritas: <strong>{myDay.policySnapshot.level}</strong> · Minimum hadir:{' '}
                      <strong className="font-mono text-slate-900 dark:text-slate-100">
                        {myDay.policySnapshot.minSesiHadir}/{myDay.policySnapshot.jumlahSesi}
                      </strong>{' '}
                      sesi · Toleransi terlambat:{' '}
                      <strong className="font-mono text-slate-900 dark:text-slate-100">
                        {myDay.policySnapshot.toleransiTerlambatMenit} menit
                      </strong>
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {myDay.policySnapshot.sesiList.map((s) => (
                      <div key={s.urutan} className="py-2 flex items-center justify-between">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{s.nama}</span>
                        <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                          {s.jam_mulai} – {s.jam_selesai} WIB
                        </span>
                      </div>
                    ))}
                  </div>
                  {myDay.upcomingPolicy &&
                    myDay.upcomingPolicy.policyId !== myDay.policySnapshot.policyId && (
                      <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 text-sky-900 dark:text-sky-200">
                        Jadwal mendatang mulai{' '}
                        <strong className="font-mono">{myDay.upcomingPolicy.berlakuMulai}</strong>:{' '}
                        <strong>{myDay.upcomingPolicy.policyName}</strong> ({myDay.upcomingPolicy.jumlahSesi} sesi).
                      </div>
                    )}
                </div>
              )
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Memuat kebijakan aktif...</p>
            )}
          </div>
        </div>
      }
    />
  );
}
