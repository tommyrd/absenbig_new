import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Loader2 } from 'lucide-react';

interface OfficeGeofenceMapProps {
  lat: number;
  lng: number;
  radiusMeter: number;
  interactive?: boolean;
  heightClass?: string;
  onLocationChange?: (lat: number, lng: number) => void;
}

function createPinIcon() {
  return L.divIcon({
    className: 'bignet-office-pin',
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:#c0392b;border:3px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.35);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function OfficeGeofenceMap({
  lat,
  lng,
  radiusMeter,
  interactive = true,
  heightClass = 'h-56',
  onLocationChange,
}: OfficeGeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onLocationChange);
  onChangeRef.current = onLocationChange;

  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const safeLat = Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : -6.2088;
  const safeLng = Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : 106.8456;
  const safeRadius = Number.isFinite(radiusMeter) ? Math.max(20, Math.min(50000, radiusMeter)) : 250;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = L.map(el, {
      center: [safeLat, safeLng],
      zoom: 16,
      zoomControl: true,
      scrollWheelZoom: interactive,
      dragging: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const circle = L.circle([safeLat, safeLng], {
      radius: safeRadius,
      color: '#c0392b',
      weight: 2,
      fillColor: '#c0392b',
      fillOpacity: 0.16,
    }).addTo(map);

    const marker = L.marker([safeLat, safeLng], {
      draggable: interactive,
      icon: createPinIcon(),
    }).addTo(map);

    if (interactive) {
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        const nextLat = Number(pos.lat.toFixed(6));
        const nextLng = Number(pos.lng.toFixed(6));
        circle.setLatLng([nextLat, nextLng]);
        onChangeRef.current?.(nextLat, nextLng);
      });

      map.on('click', (e: L.LeafletMouseEvent) => {
        const nextLat = Number(e.latlng.lat.toFixed(6));
        const nextLng = Number(e.latlng.lng.toFixed(6));
        marker.setLatLng([nextLat, nextLng]);
        circle.setLatLng([nextLat, nextLng]);
        onChangeRef.current?.(nextLat, nextLng);
      });
    }

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    // Ensure tiles render cleanly inside animated modals
    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
      try {
        map.fitBounds(circle.getBounds(), { padding: [24, 24], maxZoom: 17 });
      } catch {
        map.setView([safeLat, safeLng], 16);
      }
    }, 120);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;

    const current = marker.getLatLng();
    const moved =
      Math.abs(current.lat - safeLat) > 0.000002 || Math.abs(current.lng - safeLng) > 0.000002;
    if (moved) {
      marker.setLatLng([safeLat, safeLng]);
      circle.setLatLng([safeLat, safeLng]);
      map.panTo([safeLat, safeLng], { animate: true });
    }
    circle.setRadius(safeRadius);
  }, [safeLat, safeLng, safeRadius]);

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation || locating) {
      setLocError('Browser tidak mendukung deteksi lokasi GPS.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(6));
        const nextLng = Number(pos.coords.longitude.toFixed(6));
        onChangeRef.current?.(nextLat, nextLng);
        if (mapRef.current && circleRef.current) {
          mapRef.current.setView([nextLat, nextLng], 17);
        }
        setLocating(false);
      },
      () => {
        setLocError('Gagal membaca GPS perangkat. Pastikan izin lokasi aktif.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
        <div ref={containerRef} className={`w-full ${heightClass} z-0`} />
        {interactive && (
          <button
            type="button"
            disabled={locating}
            onClick={handleUseCurrentGps}
            className="absolute top-2.5 right-2.5 z-[400] px-2.5 py-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 hover:bg-white text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-md text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
            title="Pindahkan pin ke lokasi GPS perangkat saat ini"
          >
            {locating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#c0392b]" />
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-[#c0392b]" />
            )}
            <span>Lokasi Saya</span>
          </button>
        )}
      </div>
      {interactive && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>Klik pada peta atau seret pin merah untuk mengubah titik kantor.</span>
          <span className="font-mono font-semibold text-[#c0392b] dark:text-brand-400 shrink-0">
            r = {safeRadius}m
          </span>
        </div>
      )}
      {locError && (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {locError}
        </p>
      )}
    </div>
  );
}
