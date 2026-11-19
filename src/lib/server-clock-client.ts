import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import {
  createServerClockSync,
  formatServerEpochPartsInWib,
  getEstimatedServerEpochMs,
  type ServerClockSync,
} from '../shared/server-clock';

export { formatServerEpochPartsInWib };

export interface ServerClockSnapshot {
  synced: boolean;
  syncFailed: boolean;
  nowMs: number | null;
  dateWib: string;
  yearMonthWib: string;
  timeWib: string;
  hmWib: string;
  dateLabelWib: string;
  dateTimeLabelWib: string;
}

interface TimeApiResponse {
  serverTimeIso: string;
  date: string;
  time: string;
  timezone: string;
  epochMs: number;
}

let currentSync: ServerClockSync | null = null;
let syncFailedState = false;
let inflightSync: Promise<boolean> | null = null;
let initialized = false;
let resyncTimerId: number | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

export function anchorServerClock(
  serverEpochMs: number,
  requestStartedAtPerformanceMs?: number,
  responseReceivedAtPerformanceMs?: number
): void {
  const perfNow = performance.now();
  const start = requestStartedAtPerformanceMs ?? perfNow;
  const end = responseReceivedAtPerformanceMs ?? perfNow;
  const sync = createServerClockSync(serverEpochMs, start, end);
  if (!sync) return;
  currentSync = sync;
  syncFailedState = false;
  notifyListeners();
}

export async function syncServerClock(): Promise<boolean> {
  if (inflightSync) return inflightSync;
  inflightSync = (async () => {
    try {
      const requestStartedAt = performance.now();
      const res = await apiFetch<TimeApiResponse>('/api/v1/time');
      const responseReceivedAt = performance.now();
      if (typeof res.epochMs === 'number' && Number.isFinite(res.epochMs)) {
        const sync = createServerClockSync(res.epochMs, requestStartedAt, responseReceivedAt);
        if (sync) {
          currentSync = sync;
          syncFailedState = false;
          notifyListeners();
          return true;
        }
      }
      if (!currentSync) {
        syncFailedState = true;
        notifyListeners();
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            if (!currentSync) void syncServerClock();
          }, 3000);
        }
      }
      return false;
    } catch {
      if (!currentSync) {
        syncFailedState = true;
        notifyListeners();
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            if (!currentSync) void syncServerClock();
          }, 3000);
        }
      }
      return false;
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
}

export function initServerClock(): Promise<boolean> {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true;
    const handleForeground = () => {
      if (document.visibilityState === 'visible') {
        void syncServerClock();
      }
    };
    window.addEventListener('focus', handleForeground);
    window.addEventListener('pageshow', handleForeground);
    document.addEventListener('visibilitychange', handleForeground);
    resyncTimerId = window.setInterval(() => {
      void syncServerClock();
    }, 30_000);
  }
  return syncServerClock();
}

export async function ensureServerClockSynced(): Promise<boolean> {
  if (currentSync) return true;
  return initServerClock();
}

export function getServerNowMs(): number | null {
  if (!currentSync) return null;
  return getEstimatedServerEpochMs(currentSync, performance.now());
}

export function getServerClockSnapshot(): ServerClockSnapshot {
  const nowMs = getServerNowMs();
  if (nowMs === null) {
    return {
      synced: false,
      syncFailed: syncFailedState,
      nowMs: null,
      dateWib: '',
      yearMonthWib: '',
      timeWib: '',
      hmWib: '',
      dateLabelWib: '',
      dateTimeLabelWib: '',
    };
  }
  return {
    synced: true,
    syncFailed: false,
    nowMs,
    ...formatServerEpochPartsInWib(nowMs),
  };
}

export function getServerWibDateString(): string {
  return getServerClockSnapshot().dateWib;
}

export function getServerWibYearMonth(): string {
  return getServerClockSnapshot().yearMonthWib;
}

export function getServerWibTimeString(): string {
  return getServerClockSnapshot().timeWib;
}

export function getServerWibHm(): string {
  return getServerClockSnapshot().hmWib;
}

export function formatServerWibDateTime(): string {
  const snap = getServerClockSnapshot();
  return snap.synced ? snap.dateTimeLabelWib : 'Waktu server belum tersinkron';
}

export function useServerClock(tickMs = 1000): ServerClockSnapshot & { refresh: () => Promise<boolean> } {
  const [snapshot, setSnapshot] = useState<ServerClockSnapshot>(() => getServerClockSnapshot());

  useEffect(() => {
    void initServerClock();

    const update = () => {
      setSnapshot(getServerClockSnapshot());
    };

    listeners.add(update);
    update();

    const timerId = window.setInterval(update, tickMs);
    return () => {
      listeners.delete(update);
      window.clearInterval(timerId);
    };
  }, [tickMs]);

  return {
    ...snapshot,
    refresh: syncServerClock,
  };
}

export function _resetServerClockForTests() {
  currentSync = null;
  syncFailedState = false;
  inflightSync = null;
  if (resyncTimerId !== null && typeof window !== 'undefined') {
    window.clearInterval(resyncTimerId);
    resyncTimerId = null;
  }
  initialized = false;
}
