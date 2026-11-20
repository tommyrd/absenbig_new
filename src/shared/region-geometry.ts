export type GeoJsonPosition = [number, number]; // [lng, lat]
export type GeoJsonRing = GeoJsonPosition[];

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: GeoJsonRing[];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoJsonRing[][];
}

export type RegionGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface PolygonValidationResult {
  valid: boolean;
  error?: string;
  geometry?: RegionGeometry;
  normalizedJson?: string;
  vertexCount: number;
  ringCount: number;
  polygonCount: number;
  bbox?: [number, number, number, number]; // [minLat, minLng, maxLat, maxLng]
}

const EPSILON = 1e-10;

function isValidLngLat(pos: unknown): pos is GeoJsonPosition {
  if (!Array.isArray(pos) || pos.length < 2) return false;
  const lng = Number(pos[0]);
  const lat = Number(pos[1]);
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function ringSignedArea(ring: GeoJsonRing): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function normalizeAndValidateRing(rawRing: unknown, ringLabel: string): { ring?: GeoJsonRing; error?: string } {
  if (!Array.isArray(rawRing) || rawRing.length < 3) {
    return { error: `${ringLabel} harus memiliki minimal 3 titik koordinat.` };
  }

  const pts: GeoJsonRing = [];
  for (let i = 0; i < rawRing.length; i++) {
    if (!isValidLngLat(rawRing[i])) {
      return {
        error: `${ringLabel} memuat koordinat tidak valid pada titik ke-${i + 1} (format wajib [longitude, latitude] dalam rentang bumi).`,
      };
    }
    const lng = Number((rawRing[i] as number[])[0]);
    const lat = Number((rawRing[i] as number[])[1]);
    // Skip consecutive duplicates
    const prev = pts[pts.length - 1];
    if (!prev || Math.abs(prev[0] - lng) > EPSILON || Math.abs(prev[1] - lat) > EPSILON) {
      pts.push([lng, lat]);
    }
  }

  if (pts.length < 3) {
    return { error: `${ringLabel} harus memiliki minimal 3 titik koordinat yang berbeda.` };
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const isClosed = Math.abs(first[0] - last[0]) <= EPSILON && Math.abs(first[1] - last[1]) <= EPSILON;
  if (!isClosed) {
    pts.push([first[0], first[1]]);
  }

  const distinctCount = pts.length - 1;
  if (distinctCount < 3) {
    return { error: `${ringLabel} harus membentuk bidang tertutup dengan minimal 3 sudut berbeda.` };
  }

  const area = Math.abs(ringSignedArea(pts));
  if (area <= 1e-12) {
    return { error: `${ringLabel} tidak membentuk area polygon yang valid (luas nol atau titik segaris).` };
  }

  return { ring: pts };
}

export function validateRegionPolygonGeoJson(raw: string | null | undefined): PolygonValidationResult {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return {
      valid: false,
      error: 'Polygon batas wilayah operasional belum dikonfigurasi.',
      vertexCount: 0,
      ringCount: 0,
      polygonCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      error: 'Format GeoJSON tidak valid (gagal parsing JSON).',
      vertexCount: 0,
      ringCount: 0,
      polygonCount: 0,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      error: 'GeoJSON wilayah harus berupa objek GeoJSON Polygon atau MultiPolygon.',
      vertexCount: 0,
      ringCount: 0,
      polygonCount: 0,
    };
  }

  // Allow Feature or FeatureCollection (single feature) wrapper seamlessly
  let geomObj = parsed as Record<string, unknown>;
  if (geomObj.type === 'Feature' && geomObj.geometry && typeof geomObj.geometry === 'object') {
    geomObj = geomObj.geometry as Record<string, unknown>;
  } else if (
    geomObj.type === 'FeatureCollection' &&
    Array.isArray(geomObj.features) &&
    geomObj.features.length === 1 &&
    geomObj.features[0] &&
    typeof (geomObj.features[0] as Record<string, unknown>).geometry === 'object'
  ) {
    geomObj = (geomObj.features[0] as Record<string, unknown>).geometry as Record<string, unknown>;
  }

  const type = geomObj.type;
  if (type !== 'Polygon' && type !== 'MultiPolygon') {
    return {
      valid: false,
      error: 'Tipe geometri harus GeoJSON Polygon atau MultiPolygon.',
      vertexCount: 0,
      ringCount: 0,
      polygonCount: 0,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let vertexCount = 0;
  let ringCount = 0;

  const updateBounds = (ring: GeoJsonRing) => {
    vertexCount += Math.max(0, ring.length - 1);
    ringCount += 1;
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  };

  if (type === 'Polygon') {
    const rawCoords = geomObj.coordinates;
    if (!Array.isArray(rawCoords) || rawCoords.length === 0) {
      return {
        valid: false,
        error: 'Polygon wajib memiliki minimal satu ring batas luar.',
        vertexCount: 0,
        ringCount: 0,
        polygonCount: 0,
      };
    }

    const normalizedRings: GeoJsonRing[] = [];
    for (let r = 0; r < rawCoords.length; r++) {
      const check = normalizeAndValidateRing(rawCoords[r], r === 0 ? 'Ring luar polygon' : `Ring lubang ke-${r}`);
      if (!check.ring) {
        return { valid: false, error: check.error, vertexCount: 0, ringCount: 0, polygonCount: 0 };
      }
      normalizedRings.push(check.ring);
      updateBounds(check.ring);
    }

    const geometry: GeoJsonPolygon = { type: 'Polygon', coordinates: normalizedRings };
    return {
      valid: true,
      geometry,
      normalizedJson: JSON.stringify(geometry),
      vertexCount,
      ringCount,
      polygonCount: 1,
      bbox: [minLat, minLng, maxLat, maxLng],
    };
  }

  // MultiPolygon
  const rawPolys = geomObj.coordinates;
  if (!Array.isArray(rawPolys) || rawPolys.length === 0) {
    return {
      valid: false,
      error: 'MultiPolygon wajib memiliki minimal satu polygon.',
      vertexCount: 0,
      ringCount: 0,
      polygonCount: 0,
    };
  }

  const normalizedPolys: GeoJsonRing[][] = [];
  for (let p = 0; p < rawPolys.length; p++) {
    const rawPoly = rawPolys[p];
    if (!Array.isArray(rawPoly) || rawPoly.length === 0) {
      return {
        valid: false,
        error: `Polygon ke-${p + 1} pada MultiPolygon kosong.`,
        vertexCount: 0,
        ringCount: 0,
        polygonCount: 0,
      };
    }
    const normalizedRings: GeoJsonRing[] = [];
    for (let r = 0; r < rawPoly.length; r++) {
      const check = normalizeAndValidateRing(
        rawPoly[r],
        r === 0 ? `Polygon ke-${p + 1} ring luar` : `Polygon ke-${p + 1} lubang ke-${r}`
      );
      if (!check.ring) {
        return { valid: false, error: check.error, vertexCount: 0, ringCount: 0, polygonCount: 0 };
      }
      normalizedRings.push(check.ring);
      updateBounds(check.ring);
    }
    normalizedPolys.push(normalizedRings);
  }

  const geometry: GeoJsonMultiPolygon = { type: 'MultiPolygon', coordinates: normalizedPolys };
  return {
    valid: true,
    geometry,
    normalizedJson: JSON.stringify(geometry),
    vertexCount,
    ringCount,
    polygonCount: normalizedPolys.length,
    bbox: [minLat, minLng, maxLat, maxLng],
  };
}

function isPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const sqLen = dx * dx + dy * dy;
  if (sqLen <= 1e-18) {
    // Degenerate zero-length edge (e.g. closing vertex ring[0] === ring[last])
    return Math.hypot(px - x1, py - y1) <= 1e-9;
  }
  const cross = (py - y1) * dx - (px - x1) * dy;
  const perpDist = Math.abs(cross) / Math.sqrt(sqLen);
  if (perpDist > 1e-9) return false;
  const dot = (px - x1) * dx + (py - y1) * dy;
  if (dot < -1e-9) return false;
  return dot <= sqLen + 1e-9;
}

/**
 * Ray-casting point-in-ring test (x = lng, y = lat). Boundary-inclusive.
 */
function isPointInRing(lng: number, lat: number, ring: GeoJsonRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    if (isPointOnSegment(lng, lat, xi, yi, xj, yj)) {
      return true;
    }

    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygonRings(lng: number, lat: number, rings: GeoJsonRing[]): boolean {
  if (rings.length === 0) return false;
  if (!isPointInRing(lng, lat, rings[0])) return false;
  // Exclude interior holes
  for (let i = 1; i < rings.length; i++) {
    if (isPointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

export function isPointInRegionGeometry(lat: number, lng: number, geometry: RegionGeometry): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (geometry.type === 'Polygon') {
    return isPointInPolygonRings(lng, lat, geometry.coordinates);
  }
  return geometry.coordinates.some((polyRings) => isPointInPolygonRings(lng, lat, polyRings));
}

export function isPointInRegionGeoJson(lat: number, lng: number, rawGeoJson: string | null | undefined): boolean {
  const validated = validateRegionPolygonGeoJson(rawGeoJson);
  if (!validated.valid || !validated.geometry) return false;
  return isPointInRegionGeometry(lat, lng, validated.geometry);
}

/**
 * Extracts polygons in Leaflet [lat, lng] format for display/editing.
 */
export function extractLeafletPolygons(rawGeoJson: string | null | undefined): [number, number][][][] {
  const validated = validateRegionPolygonGeoJson(rawGeoJson);
  if (!validated.valid || !validated.geometry) return [];
  if (validated.geometry.type === 'Polygon') {
    return [
      validated.geometry.coordinates.map((ring) =>
        ring.slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number])
      ),
    ];
  }
  return validated.geometry.coordinates.map((poly) =>
    poly.map((ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number]))
  );
}

export function buildGeoJsonFromLeafletVertices(vertices: [number, number][]): string | null {
  if (vertices.length < 3) return null;
  const ring: GeoJsonRing = vertices.map(([lat, lng]) => [
    Number(lng.toFixed(6)),
    Number(lat.toFixed(6)),
  ]);
  ring.push([ring[0][0], ring[0][1]]);
  const polygon: GeoJsonPolygon = {
    type: 'Polygon',
    coordinates: [ring],
  };
  return JSON.stringify(polygon);
}
