export function getServerNow(): Date {
  return new Date();
}

export function getWibDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function getWibTimeString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const min = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const s = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${h}:${min}:${s}`;
}

export function getWibIsoString(date: Date = new Date()): string {
  return `${getWibDateString(date)}T${getWibTimeString(date)}+07:00`;
}

export function getDayOfWeekFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
}

export function getMonthDays(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const result: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    result.push(`${ym}-${String(day).padStart(2, '0')}`);
  }
  return result;
}

export function parseHmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function getWibMinutesNow(date: Date = new Date()): number {
  const t = getWibTimeString(date);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
