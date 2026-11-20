import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CheckCircle2,
  AlertTriangle,
  Undo2,
  Trash2,
  Maximize2,
  Code2,
} from 'lucide-react';
import type { Kantor } from '../shared/types';
import {
  buildGeoJsonFromLeafletVertices,
  extractLeafletPolygons,
  validateRegionPolygonGeoJson,
} from '../shared/region-geometry';

interface RegionPolygonMapProps {
  polygonGeoJson: string;
  onChange?: (nextGeoJson: string) => void;
  linkedOffices?: Kantor[];
  interactive?: boolean;
  heightClass?: string;
}

function createVertexIcon(index: number) {
  return L.divIcon({
    className: 'bignet-region-vertex',
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:#c0392b;color:#fff;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:grab;">${index + 1}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function createOfficeDotIcon(name: string) {
  return L.divIcon({
    className: 'bignet-region-office',
    html: `<div title="${name.replace(/"/g, '&quot;')}" style="width:14px;height:14px;border-radius:9999px;background:#0f766e;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function RegionPolygonMap({
  polygonGeoJson,
  onChange,
  linkedOffices = [],
  interactive = true,
  heightClass = 'h-72',
}: RegionPolygonMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const shapeLayerRef = useRef<L.LayerGroup | null>(null);
  const officeLayerRef = useRef<L.LayerGroup | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [draftVertices, setDraftVertices] = useState<[number, number][]>([]);
  const [showGeoJsonInput, setShowGeoJsonInput] = useState(false);

  const validation = useMemo(
    () => validateRegionPolygonGeoJson(polygonGeoJson),
    [polygonGeoJson]
  );

  // Sync draftVertices when polygonGeoJson changes externally (e.g. opening modal or pasting GeoJSON)
  const extractedPolys = useMemo(
    () => extractLeafletPolygons(polygonGeoJson),
    [polygonGeoJson]
  );

  const isSimpleSinglePolygon =
    validation.valid &&
    validation.geometry?.type === 'Polygon' &&
    validation.geometry.coordinates.length === 1;

  // Keep draftVertices synced when polygonGeoJson is valid simple polygon or cleared
  useEffect(() => {
    if (!polygonGeoJson.trim()) {
      setDraftVertices([]);
      return;
    }
    if (isSimpleSinglePolygon && extractedPolys.length === 1 && extractedPolys[0].length === 1) {
      setDraftVertices(extractedPolys[0][0]);
    }
  }, [polygonGeoJson, isSimpleSinglePolygon, extractedPolys]);

  const draftVerticesRef = useRef(draftVertices);
  draftVerticesRef.current = draftVertices;

  const isMultiOrComplex = validation.valid && !isSimpleSinglePolygon;

  const commitVertices = (next: [number, number][]) => {
    setDraftVertices(next);
    if (next.length >= 3) {
      const geoJson = buildGeoJsonFromLeafletVertices(next);
      if (geoJson) {
        onChangeRef.current?.(geoJson);
      }
    } else {
      onChangeRef.current?.('');
    }
  };

  // Initialize Leaflet map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Default neutral view over Indonesia/Kalimantan when no polygon/office exists yet
    const firstOffice = linkedOffices.find(
      (o) => Number.isFinite(o.lat) && Number.isFinite(o.lng)
    );
    const initialCenter: [number, number] = firstOffice
      ? [firstOffice.lat, firstOffice.lng]
      : [-0.0263, 109.3425];

    const map = L.map(el, {
      center: initialCenter,
      zoom: firstOffice ? 12 : 6,
      zoomControl: true,
      scrollWheelZoom: interactive,
      dragging: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const shapeLayer = L.layerGroup().addTo(map);
    const officeLayer = L.layerGroup().addTo(map);

    mapRef.current = map;
    shapeLayerRef.current = shapeLayer;
    officeLayerRef.current = officeLayer;

    if (interactive) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        const next: [number, number][] = [...draftVerticesRef.current, [lat, lng]];
        commitVertices(next);
      });
    }

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      shapeLayerRef.current = null;
      officeLayerRef.current = null;
    };
  }, [interactive]);

  // Render polygon & vertex markers
  useEffect(() => {
    const shapeLayer = shapeLayerRef.current;
    if (!shapeLayer) return;
    shapeLayer.clearLayers();

    if (validation.valid && extractedPolys.length > 0) {
      for (const polyRings of extractedPolys) {
        L.polygon(polyRings, {
          color: '#c0392b',
          weight: 2.5,
          fillColor: '#c0392b',
          fillOpacity: 0.14,
        }).addTo(shapeLayer);
      }
    } else if (draftVertices.length >= 2) {
      L.polyline(draftVertices, {
        color: '#c0392b',
        weight: 2,
        dashArray: '6 4',
      }).addTo(shapeLayer);
    }

    if (interactive && !isMultiOrComplex) {
      draftVertices.forEach((pt, idx) => {
        const marker = L.marker(pt, {
          draggable: true,
          icon: createVertexIcon(idx),
        }).addTo(shapeLayer);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          const updated = draftVerticesRef.current.map((v, i) =>
            i === idx
              ? ([Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))] as [number, number])
              : v
          );
          commitVertices(updated);
        });
      });
    }
  }, [validation.valid, extractedPolys, draftVertices, interactive, isMultiOrComplex]);

  // Render linked office markers & geofence circles
  useEffect(() => {
    const officeLayer = officeLayerRef.current;
    if (!officeLayer) return;
    officeLayer.clearLayers();

    for (const office of linkedOffices) {
      if (!Number.isFinite(office.lat) || !Number.isFinite(office.lng)) continue;
      L.circle([office.lat, office.lng], {
        radius: Math.max(20, Number(office.radius_meter || 200)),
        color: '#0f766e',
        weight: 1.5,
        fillColor: '#0f766e',
        fillOpacity: 0.12,
      }).addTo(officeLayer);

      L.marker([office.lat, office.lng], {
        icon: createOfficeDotIcon(office.nama),
      })
        .bindTooltip(`${office.nama} (r=${office.radius_meter}m)`, {
          direction: 'top',
          offset: [0, -8],
        })
        .addTo(officeLayer);
    }
  }, [linkedOffices]);

  const handleFitBounds = () => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = L.latLngBounds([]);
    if (validation.bbox) {
      bounds.extend([validation.bbox[0], validation.bbox[1]]);
      bounds.extend([validation.bbox[2], validation.bbox[3]]);
    } else if (draftVertices.length > 0) {
      draftVertices.forEach((pt) => bounds.extend(pt));
    }
    linkedOffices.forEach((o) => {
      if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
        bounds.extend([o.lat, o.lng]);
      }
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    }
  };

  // Auto-fit once when initial valid polygon or offices load
  const fittedKeyRef = useRef<string>('');
  useEffect(() => {
    const key = validation.bbox ? validation.bbox.join(',') : `off-${linkedOffices.length}`;
    if (fittedKeyRef.current === key) return;
    const timer = window.setTimeout(() => {
      if (validation.bbox || linkedOffices.length > 0) {
        handleFitBounds();
        fittedKeyRef.current = key;
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [validation.bbox, linkedOffices.length]);

  const handleUndoVertex = () => {
    if (draftVertices.length === 0) return;
    commitVertices(draftVertices.slice(0, -1));
  };

  const handleClearPolygon = () => {
    setDraftVertices([]);
    onChangeRef.current?.('');
  };

  return (
    <div className="space-y-2.5">
      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
        <div ref={containerRef} className={`w-full ${heightClass} z-0`} />

        <div className="absolute top-2.5 right-2.5 z-[400] flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleFitBounds}
            className="px-2 py-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 hover:bg-white text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm text-[11px] font-semibold inline-flex items-center gap-1"
            title="Pusatkan tampilan peta ke batas polygon dan kantor"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fokus</span>
          </button>

          {interactive && !isMultiOrComplex && draftVertices.length > 0 && (
            <button
              type="button"
              onClick={handleUndoVertex}
              className="px-2 py-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 hover:bg-white text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm text-[11px] font-semibold inline-flex items-center gap-1"
              title="Hapus titik terakhir"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
          )}

          {interactive && (draftVertices.length > 0 || polygonGeoJson.trim().length > 0) && (
            <button
              type="button"
              onClick={handleClearPolygon}
              className="px-2 py-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 hover:bg-red-50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 shadow-sm text-[11px] font-semibold inline-flex items-center gap-1"
              title="Hapus seluruh polygon"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus</span>
            </button>
          )}
        </div>
      </div>

      {/* Validation Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        {validation.valid ? (
          <div className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Polygon valid · {validation.polygonCount} bidang · {validation.vertexCount} titik sudut
            </span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-medium">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              {draftVertices.length > 0 && draftVertices.length < 3
                ? `Baru ${draftVertices.length} titik — klik minimal ${3 - draftVertices.length} titik lagi pada peta untuk membentuk polygon tertutup.`
                : validation.error || 'Polygon wilayah belum dikonfigurasi.'}
            </span>
          </div>
        )}

        {interactive && (
          <button
            type="button"
            onClick={() => setShowGeoJsonInput((v) => !v)}
            className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 font-semibold"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{showGeoJsonInput ? 'Sembunyikan GeoJSON' : 'Impor / Edit GeoJSON'}</span>
          </button>
        )}
      </div>

      {interactive && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {isMultiOrComplex
            ? 'Geometri MultiPolygon/kompleks aktif. Gunakan editor GeoJSON di bawah untuk mengubah koordinat, atau klik Hapus untuk menggambar ulang dari peta.'
            : 'Klik beberapa titik mengelilingi wilayah operasional pada peta (minimal 3 titik), lalu seret nomor titik untuk menyesuaikan batas. Titik hijau menandai kantor dalam wilayah ini.'}
        </p>
      )}

      {interactive && showGeoJsonInput && (
        <div className="space-y-1.5 pt-1">
          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
            GeoJSON Polygon / MultiPolygon (Format Koordinat: [longitude, latitude])
          </label>
          <textarea
            value={polygonGeoJson}
            onChange={(e) => onChangeRef.current?.(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder='{"type":"Polygon","coordinates":[[[lng1,lat1],[lng2,lat2],[lng3,lat3],[lng1,lat1]]]}'
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
      )}
    </div>
  );
}
