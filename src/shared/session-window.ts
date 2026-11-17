export type SessionWindowState = 'NOT_STARTED' | 'OPEN' | 'EXPIRED' | 'INVALID';

export function getSessionWindowState(
  nowMinutes: number,
  startTime: string,
  endTime: string
): SessionWindowState {
  const parse = (value: string): number | null => {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const start = parse(startTime);
  const end = parse(endTime);
  if (
    start === null ||
    end === null ||
    !Number.isFinite(nowMinutes) ||
    nowMinutes < 0 ||
    nowMinutes > 1439 ||
    end < start
  ) {
    return 'INVALID';
  }
  if (nowMinutes < start) return 'NOT_STARTED';
  if (nowMinutes > end) return 'EXPIRED';
  return 'OPEN';
}
