import type { OperationalStatus, PayrollStatus, ResolvedDay } from './types';

export type HistoryCalendarStatus =
  | OperationalStatus
  | 'OVERRIDE_MASUK'
  | 'OVERRIDE_TIDAK_MASUK';

/**
 * Calendar colors represent the effective daily attendance/payroll outcome.
 * Admin Override takes precedence for calendar presentation but the underlying
 * operational status remains available in the day detail and audit trail.
 */
export function getHistoryCalendarStatus(
  day: Pick<ResolvedDay, 'operationalStatus' | 'isOverridden' | 'payrollStatus'>
): HistoryCalendarStatus {
  if (day.isOverridden) {
    return day.payrollStatus === 'DIHITUNG_MASUK'
      ? 'OVERRIDE_MASUK'
      : 'OVERRIDE_TIDAK_MASUK';
  }
  return day.operationalStatus;
}
