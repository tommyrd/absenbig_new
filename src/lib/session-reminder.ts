import { getSessionWindowState } from '../shared/session-window';
import type { ResolvedDay } from '../shared/types';

const REMINDER_ENABLED_KEY = 'bignet_session_reminder_enabled_v1';
const REMINDER_SENT_PREFIX = 'bignet_session_reminder_sent_v1:';

export type ReminderPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): ReminderPermission {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export function isReminderEnabled(): boolean {
  if (!isNotificationSupported()) return false;
  try {
    return (
      Notification.permission === 'granted' &&
      window.localStorage.getItem(REMINDER_ENABLED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function setReminderEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(REMINDER_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage restriction
  }
}

export async function requestNotificationPermission(): Promise<ReminderPermission> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setReminderEnabled(true);
    } else {
      setReminderEnabled(false);
    }
    return result;
  } catch {
    return 'denied';
  }
}

function parseHmToSeconds(hm: string): number | null {
  const parts = hm.trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts.length >= 3 ? Number(parts[2]) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

async function showBrowserNotification(title: string, body: string, tag: string): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag,
        });
        return;
      }
    }
  } catch {
    // Fall back to direct Notification constructor
  }
  try {
    new Notification(title, {
      body,
      icon: '/pwa-192x192.png',
      tag,
    });
  } catch {
    // Browser blocked background notification constructor
  }
}

function wasAlreadySent(dedupeKey: string): boolean {
  try {
    return window.localStorage.getItem(REMINDER_SENT_PREFIX + dedupeKey) === '1';
  } catch {
    return false;
  }
}

function markAsSent(dedupeKey: string): void {
  try {
    window.localStorage.setItem(REMINDER_SENT_PREFIX + dedupeKey, '1');
  } catch {
    // Ignore storage error
  }
}

/**
 * Checks authoritative server WIB time against today's next incomplete session
 * and fires at most one browser/PWA notification per milestone:
 *   - OPEN: session window has opened
 *   - CLOSING_SOON: <= 15 minutes remaining before session closes
 */
export function checkAndDispatchSessionReminder(
  day: ResolvedDay | null,
  serverTimeWib: string | null,
  appName = 'Absensi BIGNET'
): void {
  if (!day || !serverTimeWib || !isReminderEnabled()) return;
  if (!day.mustCheckIn || day.sessionsCompleted >= day.policySnapshot.jumlahSesi) return;

  const nextSesi = day.policySnapshot.sesiList[day.sessionsCompleted];
  if (!nextSesi) return;

  const nowSec = parseHmToSeconds(serverTimeWib);
  const endSec = parseHmToSeconds(nextSesi.jam_selesai);
  if (nowSec === null || endSec === null) return;

  const nowMin = Math.floor(nowSec / 60);
  const state = getSessionWindowState(nowMin, nextSesi.jam_mulai, nextSesi.jam_selesai);
  if (state !== 'OPEN') return;

  const remainingSec = endSec - nowSec;
  if (remainingSec > 0 && remainingSec <= 15 * 60) {
    const minsLeft = Math.max(1, Math.ceil(remainingSec / 60));
    const key = `${day.tanggal}:s${nextSesi.urutan}:closing`;
    if (!wasAlreadySent(key)) {
      markAsSent(key);
      void showBrowserNotification(
        `${appName} · Sesi ${nextSesi.urutan} Segera Ditutup`,
        `${nextSesi.nama} tersisa ±${minsLeft} menit (ditutup pukul ${nextSesi.jam_selesai} WIB). Segera lakukan absensi.`,
        key
      );
    }
    return;
  }

  const openKey = `${day.tanggal}:s${nextSesi.urutan}:open`;
  if (!wasAlreadySent(openKey)) {
    markAsSent(openKey);
    void showBrowserNotification(
      `${appName} · Waktunya Absensi ${nextSesi.nama}`,
      `Jendela ${nextSesi.nama} sudah dibuka (${nextSesi.jam_mulai}–${nextSesi.jam_selesai} WIB).`,
      openKey
    );
  }
}
