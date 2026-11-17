export const MAX_GPS_ACCURACY_METERS = 100;

export function isGpsAccuracyAcceptable(accuracyMeters: unknown): accuracyMeters is number {
  return (
    typeof accuracyMeters === 'number' &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters >= 0 &&
    accuracyMeters <= MAX_GPS_ACCURACY_METERS
  );
}

/**
 * Require the reported accuracy margin to remain fully inside the configured
 * office radius. This intentionally errs on the safe side near the boundary.
 */
export function isWithinVerifiedGeofence(
  distanceMeters: number,
  accuracyMeters: number,
  radiusMeters: number
): boolean {
  return (
    Number.isFinite(distanceMeters) &&
    Number.isFinite(accuracyMeters) &&
    Number.isFinite(radiusMeters) &&
    distanceMeters >= 0 &&
    accuracyMeters >= 0 &&
    radiusMeters > 0 &&
    distanceMeters + accuracyMeters <= radiusMeters
  );
}

export type AttendanceLocationRule = 'SESI_PERTAMA_KANTOR' | 'SEMUA_SESI_KANTOR';

/**
 * By default only the first check-in must be inside the office geofence.
 * Admin can tighten a policy so every session must be inside the office.
 * Unknown/legacy values fall back to the safe default: first session only.
 */
export function requiresOfficeGeofence(
  rule: AttendanceLocationRule | string | null | undefined,
  sessionNumber: number
): boolean {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) return true;
  return sessionNumber === 1 || rule === 'SEMUA_SESI_KANTOR';
}
