export interface ServerClockSync {
  serverEpochMsAtSync: number;
  performanceMsAtSync: number;
}

/**
 * Convert a server timestamp captured during a request into an estimated
 * server timestamp at response receipt. Advancing with performance.now()
 * avoids depending on a phone's wall clock, which may drift or be changed.
 */
export function createServerClockSync(
  serverEpochMs: number,
  requestStartedAtPerformanceMs: number,
  responseReceivedAtPerformanceMs: number
): ServerClockSync | null {
  if (
    !Number.isFinite(serverEpochMs) ||
    !Number.isFinite(requestStartedAtPerformanceMs) ||
    !Number.isFinite(responseReceivedAtPerformanceMs) ||
    responseReceivedAtPerformanceMs < requestStartedAtPerformanceMs
  ) {
    return null;
  }

  const roundTripMs = responseReceivedAtPerformanceMs - requestStartedAtPerformanceMs;
  return {
    serverEpochMsAtSync: serverEpochMs + roundTripMs / 2,
    performanceMsAtSync: responseReceivedAtPerformanceMs,
  };
}

export function getEstimatedServerEpochMs(
  sync: ServerClockSync,
  performanceNowMs: number
): number {
  if (!Number.isFinite(performanceNowMs)) return sync.serverEpochMsAtSync;
  return sync.serverEpochMsAtSync + Math.max(0, performanceNowMs - sync.performanceMsAtSync);
}

export function formatServerEpochPartsInWib(epochMs: number) {
  const instant = new Date(epochMs);
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = dateParts.find((p) => p.type === 'year')?.value ?? '';
  const month = dateParts.find((p) => p.type === 'month')?.value ?? '';
  const day = dateParts.find((p) => p.type === 'day')?.value ?? '';
  const dateWib = year && month && day ? `${year}-${month}-${day}` : '';
  const yearMonthWib = year && month ? `${year}-${month}` : '';

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const rawHour = timeParts.find((p) => p.type === 'hour')?.value ?? '00';
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = timeParts.find((p) => p.type === 'minute')?.value ?? '00';
  const second = timeParts.find((p) => p.type === 'second')?.value ?? '00';
  const timeWib = `${hour}:${minute}:${second}`;
  const hmWib = `${hour}:${minute}`;

  const dateLabelWib = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(instant);

  const dateTimeLabelWib = `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(instant)}, ${timeWib} WIB`;

  return {
    dateWib,
    yearMonthWib,
    timeWib,
    hmWib,
    dateLabelWib,
    dateTimeLabelWib,
  };
}
