import { getSessionWindowState } from './session-window';

interface EmployeeEntryDay {
  mustCheckIn: boolean;
  sessionsCompleted: number;
  checkinOverride?: { active: boolean } | null;
  holidayEmergencyRequest?: { status: string } | null;
  policySnapshot: {
    jumlahSesi: number;
    minSesiHadir?: number;
    sesiList: { jam_mulai: string; jam_selesai: string }[];
  };
}

/**
 * Open the attendance tab on first login only when the employee's next
 * incomplete session is currently inside its server-defined WIB window.
 * For emergency holiday work, once the minimum 1 session is recorded,
 * session 2 (finish check-out) is optional and must not lock the employee out of Beranda.
 */
export function shouldOpenAttendanceOnEntry(
  day: EmployeeEntryDay,
  serverTime: string
): boolean {
  if (
    !day.mustCheckIn ||
    day.sessionsCompleted >= day.policySnapshot.jumlahSesi
  ) {
    return false;
  }

  if (
    day.holidayEmergencyRequest &&
    (day.holidayEmergencyRequest.status === 'PENDING' ||
      day.holidayEmergencyRequest.status === 'APPROVED') &&
    day.sessionsCompleted >= (day.policySnapshot.minSesiHadir ?? 1)
  ) {
    return false;
  }

  // An active, Admin-issued one-time permission also opens the attendance page
  // after the ordinary session window has expired.
  if (day.checkinOverride?.active) return true;

  const nextSession = day.policySnapshot.sesiList[day.sessionsCompleted];
  if (!nextSession || !/^([01]\d|2[0-3]):[0-5]\d/.test(serverTime)) {
    return false;
  }

  const [hours, minutes] = serverTime.slice(0, 5).split(':').map(Number);
  const nowMinutes = hours * 60 + minutes;

  return (
    getSessionWindowState(
      nowMinutes,
      nextSession.jam_mulai,
      nextSession.jam_selesai
    ) === 'OPEN'
  );
}
