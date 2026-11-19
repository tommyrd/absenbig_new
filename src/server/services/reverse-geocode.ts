export type ReverseGeocodeProvider = 'geoapify' | 'nominatim' | 'none';

export interface ReverseGeocodeResult {
  address: string | null;
  configured: boolean;
  provider: ReverseGeocodeProvider;
}

interface CacheEntry {
  address: string | null;
  provider: ReverseGeocodeProvider;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ReverseGeocodeResult>>();
let lastRequestAt = 0;
let rateLimitQueue: Promise<void> = Promise.resolve();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GEOAPIFY_MIN_INTERVAL_MS = 200;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 4000;

function formatNominatimAddress(payload: {
  display_name?: string;
  name?: string;
  address?: Record<string, string | undefined>;
}): string | null {
  const addr = payload.address;
  if (addr) {
    const roadPart = [addr.road || addr.pedestrian || addr.footway || addr.path, addr.house_number]
      .filter(Boolean)
      .join(' ')
      .trim();
    const placePart =
      roadPart ||
      payload.name?.trim() ||
      addr.amenity ||
      addr.building ||
      addr.office ||
      addr.neighbourhood ||
      '';
    const areaPart =
      addr.suburb ||
      addr.village ||
      addr.quarter ||
      addr.hamlet ||
      addr.city_district ||
      '';
    const districtPart =
      addr.city_district && addr.city_district !== areaPart ? addr.city_district : '';
    const cityPart =
      addr.city || addr.town || addr.municipality || addr.county || addr.state || '';

    const parts = [placePart, areaPart, districtPart, cityPart]
      .map((p) => (p || '').trim())
      .filter(Boolean);
    const uniqueParts: string[] = [];
    for (const part of parts) {
      if (!uniqueParts.some((u) => u.toLowerCase() === part.toLowerCase())) {
        uniqueParts.push(part);
      }
    }
    if (uniqueParts.length > 0) {
      return uniqueParts.slice(0, 4).join(', ');
    }
  }
  if (typeof payload.display_name === 'string' && payload.display_name.trim()) {
    return payload.display_name
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
  }
  return null;
}

async function waitForRateLimit(minIntervalMs: number): Promise<void> {
  let releaseTurn: () => void = () => {};
  const previousTurn = rateLimitQueue;
  rateLimitQueue = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  await previousTurn;

  try {
    const waitMs = Math.max(0, lastRequestAt + minIntervalMs - Date.now());
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
  } finally {
    releaseTurn();
  }
}

async function fetchFromGeoapify(lat: number, lng: number, apiKey: string): Promise<string | null> {
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
  const formatted = payload.results?.[0]?.formatted;
  return typeof formatted === 'string' && formatted.trim() ? formatted.trim() : null;
}

async function fetchFromNominatim(lat: number, lng: number): Promise<string | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('accept-language', 'id');
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AbsensiBIGNET/1.0 (https://bignet.co.id)',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Nominatim reverse geocoding returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    display_name?: string;
    name?: string;
    address?: Record<string, string | undefined>;
  };
  return formatNominatimAddress(payload);
}

/**
 * Resolve a GPS coordinate to a display-only street address.
 * Uses Geoapify when GEOAPIFY_API_KEY is configured and automatically falls
 * back to OpenStreetMap Nominatim so location addresses always work out of the box.
 * The browser GPS coordinate remains the only source used for geofence checks.
 */
export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  if (process.env.DISABLE_EXTERNAL_GEOCODE === '1') {
    return { address: null, configured: false, provider: 'none' };
  }

  const apiKey = process.env.GEOAPIFY_API_KEY?.trim() || '';
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { address: cached.address, configured: true, provider: cached.provider };
  }
  if (cached) cache.delete(cacheKey);

  const pending = inFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = (async (): Promise<ReverseGeocodeResult> => {
    await waitForRateLimit(apiKey ? GEOAPIFY_MIN_INTERVAL_MS : NOMINATIM_MIN_INTERVAL_MS);

    const cachedAfterQueue = cache.get(cacheKey);
    if (cachedAfterQueue && cachedAfterQueue.expiresAt > Date.now()) {
      return {
        address: cachedAfterQueue.address,
        configured: true,
        provider: cachedAfterQueue.provider,
      };
    }

    let address: string | null = null;
    let provider: ReverseGeocodeProvider = apiKey ? 'geoapify' : 'nominatim';

    if (apiKey) {
      try {
        address = await fetchFromGeoapify(lat, lng, apiKey);
      } catch {
        // Fallback to Nominatim if Geoapify fails or hits quota
        provider = 'nominatim';
        try {
          address = await fetchFromNominatim(lat, lng);
        } catch {
          address = null;
        }
      }
    } else {
      try {
        address = await fetchFromNominatim(lat, lng);
      } catch {
        address = null;
      }
    }

    // Only cache successful lookups for 6h; cache null briefly (5 min) so transient
    // network hiccups recover quickly without hammering the provider.
    cache.set(cacheKey, {
      address,
      provider: address ? provider : 'none',
      expiresAt: Date.now() + (address ? CACHE_TTL_MS : 5 * 60 * 1000),
    });
    if (cache.size > 1000) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    return {
      address,
      configured: true,
      provider: address ? provider : 'none',
    };
  })();

  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * Backward-compatible alias used by attendance submission.
 */
export async function getGeoapifyAddress(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult> {
  return reverseGeocodeCoordinates(lat, lng);
}
