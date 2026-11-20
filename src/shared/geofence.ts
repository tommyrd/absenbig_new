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
 * Validates that the GPS accuracy is acceptable (<= MAX_GPS_ACCURACY_METERS)
 * and that the measured coordinate is within the configured office radius.
 *
 * Note: Indoor mobile GPS routinely reports ±20m–±65m accuracy; adding accuracy
 * on top of distance (`distance + accuracy <= radius`) makes tight radii like
 * 50m unusable even for employees standing right inside the office.
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
    isGpsAccuracyAcceptable(accuracyMeters) &&
    radiusMeters > 0 &&
    distanceMeters <= radiusMeters
  );
}

export type AttendanceLocationRule = 'SESI_PERTAMA_KANTOR' | 'SEMUA_SESI_KANTOR' | 'BEBAS_LOKASI';

/**
 * By default only the first check-in must be inside the office geofence.
 * Admin can tighten a policy so every session must be inside the office.
 * Emergency holiday work uses BEBAS_LOKASI so GPS is still mandatory & logged
 * without rejecting field/customer-site locations.
 * Unknown/legacy values fall back to the safe default: first session only.
 */
export function requiresOfficeGeofence(
  rule: AttendanceLocationRule | string | null | undefined,
  sessionNumber: number
): boolean {
  if (rule === 'BEBAS_LOKASI') return false;
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) return true;
  return sessionNumber === 1 || rule === 'SEMUA_SESI_KANTOR';
}
