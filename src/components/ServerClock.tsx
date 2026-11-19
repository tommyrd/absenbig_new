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
        title={synced ? `Waktu Server WIB (${formattedDate})` : 'Menyinkronkan waktu server...'}
        className={`inline-flex items-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg border text-[11px] sm:text-xs font-mono font-semibold tracking-tight tabular-nums whitespace-nowrap shrink-0 select-none ${
          onDark
            ? 'bg-black/25 border-white/20 text-white shadow-xs'
            : 'bg-slate-100/95 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            synced
              ? onDark
                ? 'bg-emerald-300'
                : 'bg-emerald-500'
              : 'bg-amber-400 animate-pulse'
          }`}
        />
        <Clock
          className={`w-3.5 h-3.5 shrink-0 hidden min-[380px]:block ${
            onDark ? 'text-white/85' : 'text-[#c0392b] dark:text-brand-400'
          }`}
        />
        <span>{formattedTime}</span>
        <span
          className={`text-[10px] font-bold ${
            onDark ? 'text-white/80' : 'text-[#c0392b] dark:text-brand-400'
          }`}
        >
          WIB
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
        {formattedTime}{' '}
        <span className="text-sm font-semibold text-[#c0392b] dark:text-brand-400">WIB</span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
        {synced ? `${formattedDate} · Waktu Server Terkunci` : 'Menyinkronkan waktu server...'}
      </div>
    </div>
  );
}
