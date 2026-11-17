import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { createServerClockSync, getEstimatedServerEpochMs, type ServerClockSync } from '../shared/server-clock';

interface ServerClockProps {
  compact?: boolean;
  onDark?: boolean;
}

export function ServerClock({ compact = false, onDark = false }: ServerClockProps) {
  const syncRef = useRef<ServerClockSync | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    let syncRequestId = 0;

    const synchronize = async () => {
      const requestId = ++syncRequestId;
      const requestStartedAt = performance.now();
      try {
        const res = await apiFetch<{ epochMs?: number }>('/api/v1/time');
        const responseReceivedAt = performance.now();
        if (!mounted || requestId !== syncRequestId || typeof res.epochMs !== 'number') return;
        const sync = createServerClockSync(
          res.epochMs,
          requestStartedAt,
          responseReceivedAt
        );
        if (!sync) return;
        syncRef.current = sync;
        setNowMs(getEstimatedServerEpochMs(sync, performance.now()));
      } catch {
        // Keep the last trusted estimate while the network is temporarily unavailable.
      }
    };

    void synchronize();

    const timer = window.setInterval(() => {
      const sync = syncRef.current;
      if (sync) {
        setNowMs(getEstimatedServerEpochMs(sync, performance.now()));
      }
    }, 1000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void synchronize();
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    const resyncTimer = window.setInterval(() => void synchronize(), 30000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.clearInterval(resyncTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  const serverDate = nowMs === null ? null : new Date(nowMs);
  const formattedTime = serverDate
    ? new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .format(serverDate)
        .replace(/\./g, ':')
    : '--:--:--';

  const formattedDate = serverDate
    ? new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(serverDate)
    : '--';

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
        {serverDate ? `${formattedDate} · Waktu Server Terkunci` : 'Menyinkronkan waktu server...'}
      </div>
    </div>
  );
}
