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
