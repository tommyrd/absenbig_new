import { ShieldCheck } from 'lucide-react';
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
  return (
    <ProfileSettingsPanel
      user={user}
      onUserUpdated={onUserUpdated}
      onLogout={onLogout}
      extraContent={
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            Kebijakan Sesi Aktif Hari Ini
          </h2>
          {myDay ? (
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
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Memuat kebijakan aktif...</p>
          )}
        </div>
      }
    />
  );
}
