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
