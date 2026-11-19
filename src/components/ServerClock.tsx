import { Clock } from 'lucide-react';
import { useServerClock } from '../lib/server-clock-client';

interface ServerClockProps {
  compact?: boolean;
  onDark?: boolean;
}

export function ServerClock({ compact = false, onDark = false }: ServerClockProps) {
  const { synced, timeWib, dateLabelWib } = useServerClock(1000);
  const formattedTime = synced && timeWib ? timeWib : '--:--:--';
  const formattedDate = synced && dateLabelWib ? dateLabelWib : '--';

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs font-mono tabular-nums whitespace-nowrap shrink-0 ${
          onDark ? 'text-slate-200' : 'text-slate-700 dark:text-slate-200'
        }`}
      >
        <Clock
          className={`w-3.5 h-3.5 shrink-0 ${
            onDark ? 'text-blue-400' : 'text-blue-700 dark:text-blue-400'
          }`}
        />
        <span>{formattedTime} WIB</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
        {formattedTime}{' '}
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">WIB</span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
        {synced ? `${formattedDate} · Waktu Server Terkunci` : 'Menyinkronkan waktu server...'}
      </div>
    </div>
  );
}
