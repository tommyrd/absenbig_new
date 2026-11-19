import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, Loader2, MapPin, Navigation, RefreshCw, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface MapOffice {
  id: number;
  kode: string;
  nama: string;
  alamat: string;
  lat: number;
  lng: number;
  radiusMeter: number;
}

interface MapPoint {
  sessionId: number;
  karyawanId: number;
  nik: string;
  namaLengkap: string;
  jabatan: string;
  kantorId: number;
  kantorNama: string;
  bidangNama: string;
  urutanSesi: number;
  namaSesi: string;
  jamWib: string;
  statusKetepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
  keterlambatanMenit: number;
  lat: number;
  lng: number;
  accuracyMeter: number | null;
  jarakKantorMeter: number | null;
  dalamGeofence: boolean;
  tipeAktivitas: string;
  deskripsiAktivitas: string;
  lokasiAlamat: string | null;
}

interface TodayMapPayload {
  tanggal: string;
  serverTime: string;
  offices: MapOffice[];
  points: MapPoint[];
}

interface AdminMonitoringMapModalProps {
  open: boolean;
  onClose: () => void;
  initialOfficeId?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDistance(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return '—';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function AdminMonitoringMapModal({
  open,
  onClose,
  initialOfficeId = '',
}: AdminMonitoringMapModalProps) {
  const [data, setData] = useState<TodayMapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [officeFilter, setOfficeFilter] = useState(initialOfficeId);
  const [sessionFilter, setSessionFilter] = useState<'ALL' | 'S1' | 'S2PLUS'>('ALL');
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const markerMapRef = useRef<Map<number, L.Marker>>(new Map());

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TodayMapPayload>('/api/v1/workforce/today-map');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat peta sebaran absensi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setOfficeFilter(initialOfficeId);
    void loadMapData();
  }, [open, initialOfficeId, loadMapData]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const visibleOffices = useMemo(() => {
    if (!data) return [];
    if (!officeFilter) return data.offices;
    return data.offices.filter((o) => String(o.id) === officeFilter);
  }, [data, officeFilter]);

  const visiblePoints = useMemo(() => {
    if (!data) return [];
    return data.points.filter((p) => {
      if (officeFilter && String(p.kantorId) !== officeFilter) return false;
      if (sessionFilter === 'S1' && p.urutanSesi !== 1) return false;
      if (sessionFilter === 'S2PLUS' && p.urutanSesi < 2) return false;
      return true;
    });
  }, [data, officeFilter, sessionFilter]);

  // Initialize Leaflet map when modal opens
  useEffect(() => {
    if (!open || !mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-6.2088, 106.8456],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    window.setTimeout(() => map.invalidateSize(), 180);

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      markerMapRef.current.clear();
    };
  }, [open]);

  // Render offices, geofences, and employee check-in markers
  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!open || !map || !group || !data) return;

    group.clearLayers();
    markerMapRef.current.clear();

    const bounds: [number, number][] = [];

    for (const off of visibleOffices) {
      bounds.push([off.lat, off.lng]);
      L.circle([off.lat, off.lng], {
        radius: off.radiusMeter,
        color: '#c0392b',
        fillColor: '#c0392b',
        fillOpacity: 0.11,
        weight: 2,
      }).addTo(group);

      const officeIcon = L.divIcon({
        className: 'bignet-office-pin',
        html: `<div style="width:26px;height:26px;border-radius:8px;background:#c0392b;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:11px;">K</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      L.marker([off.lat, off.lng], { icon: officeIcon })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.4;"><strong>${escapeHtml(off.nama)}</strong><br/>Radius Geofence: <b>${off.radiusMeter}m</b><br/><span style="color:#64748b;">${escapeHtml(off.alamat)}</span></div>`
        )
        .addTo(group);
    }

    for (const pt of visiblePoints) {
      bounds.push([pt.lat, pt.lng]);
      const pinColor = pt.dalamGeofence ? '#10b981' : '#f59e0b';
      const empIcon = L.divIcon({
        className: 'bignet-emp-pin',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:${pinColor};border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px;">S${pt.urutanSesi}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const popupHtml = `
        <div style="font-size:12px;line-height:1.45;min-width:190px;">
          <div style="font-weight:700;color:#0f172a;">${escapeHtml(pt.namaLengkap)}</div>
          <div style="font-size:11px;color:#475569;">${escapeHtml(pt.nik)} · ${escapeHtml(pt.bidangNama)}</div>
          <div style="margin-top:4px;font-weight:600;color:${pt.statusKetepatan === 'TERLAMBAT' ? '#b45309' : '#047857'};">
            ${escapeHtml(pt.namaSesi)} · ${escapeHtml(pt.jamWib)} WIB
            ${pt.statusKetepatan === 'TERLAMBAT' ? `(+${pt.keterlambatanMenit}m)` : '(Tepat)'}
          </div>
          <div style="font-size:11px;margin-top:3px;color:#334155;">
            Jarak kantor: <b>${formatDistance(pt.jarakKantorMeter)}</b> (${pt.dalamGeofence ? 'Dalam Radius' : 'Lokasi Lapangan'})
          </div>
          ${pt.lokasiAlamat ? `<div style="font-size:10.5px;color:#64748b;margin-top:3px;">${escapeHtml(pt.lokasiAlamat)}</div>` : ''}
          ${pt.deskripsiAktivitas ? `<div style="font-size:10.5px;color:#0f172a;margin-top:3px;font-style:italic;">"${escapeHtml(pt.deskripsiAktivitas)}"</div>` : ''}
        </div>
      `;

      const marker = L.marker([pt.lat, pt.lng], { icon: empIcon })
        .bindPopup(popupHtml)
        .on('click', () => setSelectedPointId(pt.sessionId))
        .addTo(group);

      markerMapRef.current.set(pt.sessionId, marker);
    }

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    }
    window.setTimeout(() => map.invalidateSize(), 120);
  }, [open, data, visibleOffices, visiblePoints]);

  const focusPoint = (pt: MapPoint) => {
    setSelectedPointId(pt.sessionId);
    const map = mapRef.current;
    const marker = markerMapRef.current.get(pt.sessionId);
    if (map && marker) {
      map.flyTo([pt.lat, pt.lng], 16, { duration: 0.5 });
      marker.openPopup();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-5xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[94vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#c0392b] dark:text-brand-400 shrink-0" />
              <span className="truncate">Peta Sebaran Lokasi Absensi Hari Ini</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {data ? `${data.tanggal} · Update ${data.serverTime} WIB · ${visiblePoints.length} titik terekam` : 'Memuat koordinat...'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadMapData()}
              className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup peta"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter & Legend Bar */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={officeFilter}
              onChange={(e) => setOfficeFilter(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200"
            >
              <option value="">Semua Kantor</option>
              {(data?.offices || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama.split('(')[0].trim()}
                </option>
              ))}
            </select>
            <div className="inline-flex p-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              {[
                { id: 'ALL', label: 'Semua Sesi' },
                { id: 'S1', label: 'Sesi 1 (Masuk)' },
                { id: 'S2PLUS', label: 'Sesi 2+ (Lapangan)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSessionFilter(opt.id as 'ALL' | 'S1' | 'S2PLUS')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold ${
                    sessionFilter === opt.id
                      ? 'bg-[#c0392b] text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#c0392b]" />
              Kantor & Radius
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Dalam Radius Kantor
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              Lokasi Lapangan (Sesi 2+)
            </span>
          </div>
        </div>

        {/* Map + Side List */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
          <div className="lg:col-span-2 relative min-h-[300px] sm:min-h-[380px] bg-slate-100 dark:bg-slate-950">
            <div ref={mapContainerRef} className="w-full h-full min-h-[300px] sm:min-h-[420px] z-0" />
            {loading && (
              <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70 flex items-center justify-center z-10">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3.5 py-2 rounded-xl shadow">
                  <Loader2 className="w-4 h-4 animate-spin text-[#c0392b]" />
                  Memuat peta lokasi...
                </span>
              </div>
            )}
            {error && (
              <div className="absolute top-3 left-3 right-3 z-10 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                {error}
              </div>
            )}
          </div>

          <div className="border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 overflow-y-auto max-h-64 lg:max-h-none divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {visiblePoints.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Belum ada titik GPS absensi yang cocok dengan filter hari ini.
              </div>
            ) : (
              visiblePoints.map((pt) => {
                const active = selectedPointId === pt.sessionId;
                return (
                  <button
                    key={pt.sessionId}
                    type="button"
                    onClick={() => focusPoint(pt)}
                    className={`w-full text-left p-3 transition-colors ${
                      active
                        ? 'bg-brand-50/70 dark:bg-brand-950/35'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {pt.namaLengkap}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {pt.namaSesi} · {pt.bidangNama}
                        </p>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          pt.dalamGeofence
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {pt.jamWib}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Building2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">{pt.kantorNama.split('(')[0].trim()}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono shrink-0">
                        <Navigation className="w-3 h-3" />
                        {formatDistance(pt.jarakKantorMeter)}
                      </span>
                    </div>
                    {pt.lokasiAlamat && (
                      <p className="mt-1 text-[10.5px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {pt.lokasiAlamat}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
