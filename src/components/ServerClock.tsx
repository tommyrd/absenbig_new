import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ServerClockProps {
  compact?: boolean;
  onDark?: boolean;
}

export function ServerClock({ compact = false, onDark = false }: ServerClockProps) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    apiFetch<{ epochMs?: number; serverTimeMs?: number }>('/api/v1/time')
      .then((res) => {
        const ms = typeof res?.epochMs === 'number' ? res.epochMs : res?.serverTimeMs;
        if (mounted && typeof ms === 'number' && Number.isFinite(ms)) {
          setOffsetMs(ms - Date.now());
        }
      })
      .catch(() => {});

    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const targetMs = Number.isFinite(nowMs + offsetMs) ? nowMs + offsetMs : Date.now();
  const serverDate = new Date(targetMs);
  const formattedTime = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(serverDate)
    .replace(/\./g, ':');

  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(serverDate);

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
        {formattedDate} · Waktu Server Terkunci
      </div>
    </div>
  );
}
