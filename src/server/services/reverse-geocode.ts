export interface ReverseGeocodeResult {
  address: string | null;
  configured: boolean;
}

interface CacheEntry {
  address: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();
let lastRequestAt = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 100;
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Resolve a GPS coordinate to a display-only address.
 * The browser GPS coordinate remains the only source used for geofence checks.
 * Returns null when the optional Geoapify key is not configured.
 */
export async function getGeoapifyAddress(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) return { address: null, configured: false };

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { address: cached.address, configured: true };
  }
  if (cached) cache.delete(cacheKey);

  // If the employee refreshed GPS moments before submitting, reuse the
  // in-flight or cached lookup rather than spending another Geoapify credit.
  const pending = inFlight.get(cacheKey);
  if (pending) {
    return { address: await pending, configured: true };
  }

  const now = Date.now();
  if (now - lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
    const error = new Error('Permintaan reverse geocoding terlalu cepat.');
    error.name = 'GeoapifyRateLimitError';
    throw error;
  }
  lastRequestAt = now;

  const request = (async () => {
    const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('lang', 'id');
    url.searchParams.set('limit', '1');

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Geoapify reverse geocoding returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      results?: { formatted?: string }[];
    };
    const address =
      typeof payload.results?.[0]?.formatted === 'string'
        ? payload.results[0].formatted.trim()
        : null;

    if (address) {
      cache.set(cacheKey, {
        address,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      if (cache.size > 1000) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
    }
    return address;
  })();
  inFlight.set(cacheKey, request);
  try {
    return { address: await request, configured: true };
  } finally {
    inFlight.delete(cacheKey);
  }
}
