import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarOff,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  Loader2,
  Lock,
  MapPin,
  Navigation,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import type { AuthUser, Karyawan, ResolvedDay } from '../../shared/types';
import {
  isGpsAccuracyAcceptable,
  isWithinVerifiedGeofence,
  MAX_GPS_ACCURACY_METERS,
  requiresOfficeGeofence,
} from '../../shared/geofence';
import type { SessionWindowState } from '../../shared/session-window';
import {
  createServerClockSync,
  getEstimatedServerEpochMs,
  type ServerClockSync,
} from '../../shared/server-clock';
import { StatusBadge } from '../StatusBadge';

interface TodayResponse {
  serverDate: string;
  serverTime: string;
  serverEpochMs?: number;
  serverWindowCheckedAt?: string;
  serverWindowState?: SessionWindowState | null;
  serverSessionWindowStates?: SessionWindowState[];
  serverMinutesUntilStart?: number;
  karyawan: Karyawan;
  day: ResolvedDay;
}

export interface AttendanceSubmitResult {
  sessionId: number;
  title: string;
  message: string;
  updatedDay?: ResolvedDay;
  serverTime?: string;
  serverEpochMs?: number;
}

interface EmployeeAbsensiPageProps {
  user: AuthUser;
  onSessionSubmitted: (result: AttendanceSubmitResult) => void;
  onSessionFailed?: (message: string) => void;
}

function haversineClient(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getWibHmsPartsFromEpoch(epochMs: number): { hm: string; secondsOfDay: number } {
  if (!Number.isFinite(epochMs)) return { hm: '--:--', secondsOfDay: 0 };
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const s = parts.find((p) => p.type === 'second')?.value ?? '00';
  return {
    hm: `${h}:${m}`,
    secondsOfDay: Number(h) * 3600 + Number(m) * 60 + Number(s),
  };
}

function getWibHmFromEpoch(epochMs: number): string {
  return getWibHmsPartsFromEpoch(epochMs).hm;
}

function parseHmToSeconds(hm: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hm.trim());
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function formatCountdownHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDurationMinutes(diffMin: number): string {
  if (diffMin <= 0) return 'kurang dari 1 menit';
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours > 0 && mins > 0) return `${hours} jam ${mins} menit`;
  if (hours > 0) return `${hours} jam`;
  return `${mins} menit`;
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
    : `${Math.round(meters).toLocaleString('id-ID')} m`;
}

function isFreshServerWindowSnapshot(
  checkedAt: string | undefined,
  receivedAtPerformanceMs: number | null
): boolean {
  if (!checkedAt || receivedAtPerformanceMs === null) return false;
  const ageMs = performance.now() - receivedAtPerformanceMs;
  return ageMs >= 0 && ageMs <= 10000;
}

export function EmployeeAbsensiPage({
  user,
  onSessionSubmitted,
  onSessionFailed,
}: EmployeeAbsensiPageProps) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serverClockSyncRef = useRef<ServerClockSync | null>(null);
  const serverWindowSyncPerfRef = useRef<number | null>(null);
  const todayRequestIdRef = useRef(0);
  const [serverFreshnessTick, setServerFreshnessTick] = useState(0);
  const [liveWibHm, setLiveWibHm] = useState('--:--');
  const [liveWibSecondsOfDay, setLiveWibSecondsOfDay] = useState<number | null>(null);

  // GPS & Live Address State
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const addressReqIdRef = useRef(0);

  const readCurrentGps = useCallback(
    () =>
      new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
        const localTrustedHosts = ['localhost', '127.0.0.1', '::1'];
        const isTrustedLocalHost = localTrustedHosts.includes(window.location.hostname);
        if (!window.isSecureContext && !isTrustedLocalHost) {
          reject(
            new Error(
              'GPS dan kamera memerlukan koneksi HTTPS. Buka aplikasi melalui HTTPS untuk melakukan absensi.'
            )
          );
          return;
        }

        if (!navigator.geolocation) {
          reject(new Error('Browser tidak mendukung fitur lokasi GPS.'));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              lat: Number(pos.coords.latitude.toFixed(6)),
              lng: Number(pos.coords.longitude.toFixed(6)),
              accuracy: Math.ceil(pos.coords.accuracy),
            }),
          (err) => {
            reject(
              new Error(
                err.code === 1
                  ? 'Izin lokasi ditolak. Aktifkan izin lokasi di browser Anda, lalu coba lagi.'
                  : 'Gagal membaca sinyal GPS. Pastikan lokasi perangkat aktif lalu coba lagi.'
              )
            );
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }),
    []
  );

  // Camera & Photo State (Browser Camera ONLY)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  // Activity & Submission State
  const [tipeAktivitas, setTipeAktivitas] = useState<'AKTIVITAS' | 'STANDBY'>('AKTIVITAS');
  const [deskripsiAktivitas, setDeskripsiAktivitas] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'loading' | 'ok' | 'err'; text: string } | null>(null);

  const loadToday = useCallback(async (silent = false) => {
    const requestId = ++todayRequestIdRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const requestStartedAt = performance.now();
      const res = await apiFetch<TodayResponse>('/api/v1/attendance/today');
      const responseReceivedAt = performance.now();
      if (requestId !== todayRequestIdRef.current) return;
      setData(res);
      const estimatedServerSnapshotReceivedAt =
        requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
      serverWindowSyncPerfRef.current = res.serverWindowCheckedAt
        ? estimatedServerSnapshotReceivedAt
        : null;

      let serverEpochMs = res.serverEpochMs;
      let sync =
        typeof serverEpochMs === 'number'
          ? createServerClockSync(serverEpochMs, requestStartedAt, responseReceivedAt)
          : null;

      if (!sync) {
        const fallbackStartedAt = performance.now();
        const timeRes = await apiFetch<{ epochMs?: number }>('/api/v1/time');
        const fallbackReceivedAt = performance.now();
        if (requestId !== todayRequestIdRef.current) return;
        serverEpochMs = timeRes.epochMs;
        if (typeof serverEpochMs === 'number') {
          sync = createServerClockSync(serverEpochMs, fallbackStartedAt, fallbackReceivedAt);
        }
      }

      if (sync) {
        serverClockSyncRef.current = sync;
        const parts = getWibHmsPartsFromEpoch(getEstimatedServerEpochMs(sync, performance.now()));
        setLiveWibHm(parts.hm);
        setLiveWibSecondsOfDay(parts.secondsOfDay);
      } else if (res.serverTime) {
        setLiveWibHm(res.serverTime.slice(0, 5));
        setLiveWibSecondsOfDay(parseHmToSeconds(res.serverTime));
      }
    } catch (err) {
      if (requestId === todayRequestIdRef.current && !silent) {
        setError(err instanceof Error ? err.message : 'Gagal memuat status absensi.');
      }
    } finally {
      if (requestId === todayRequestIdRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToday();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadToday(true);
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    const refreshId = window.setInterval(() => void loadToday(true), 5000);
    return () => {
      window.clearInterval(refreshId);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadToday]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const sync = serverClockSyncRef.current;
      if (sync) {
        const parts = getWibHmsPartsFromEpoch(getEstimatedServerEpochMs(sync, performance.now()));
        setLiveWibHm(parts.hm);
        setLiveWibSecondsOfDay(parts.secondsOfDay);
      }
      setServerFreshnessTick((tick) => tick + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraLoading(false);
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!cameraActive) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let active = true;
    const videoTrack = stream.getVideoTracks()[0];
    const markReady = () => {
      if (active) {
        setCameraReady(true);
        setCameraError(null);
      }
    };
    const handleTrackEnded = () => {
      if (active) {
        setCameraReady(false);
        setCameraError('Kamera terputus. Buka kembali kamera untuk mengambil foto.');
        setCameraActive(false);
      }
    };
    video.srcObject = stream;
    video.addEventListener('loadeddata', markReady);
    videoTrack?.addEventListener('ended', handleTrackEnded);

    video.play().catch(() => {
      if (active) {
        setCameraReady(false);
        setCameraError('Pratinjau kamera tidak dapat diputar. Tutup aplikasi kamera lain lalu coba lagi.');
      }
    });

    return () => {
      active = false;
      video.removeEventListener('loadeddata', markReady);
      videoTrack?.removeEventListener('ended', handleTrackEnded);
      if (video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [cameraActive]);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (!data) return;
    const nextIndex = data.day.sessionsCompleted;
    const next = data.day.policySnapshot.sesiList[nextIndex];
    const snapshotFresh = isFreshServerWindowSnapshot(
      data.serverWindowCheckedAt,
      serverWindowSyncPerfRef.current
    );
    const windowState = data.serverSessionWindowStates?.[nextIndex] ?? 'INVALID';
    const hasOverride = Boolean(data.day.checkinOverride?.active);
    if (next && !snapshotFresh) {
      stopCamera();
      return;
    }
    if (next && windowState !== 'OPEN' && !hasOverride) {
      stopCamera();
      setPhotoDataUrl(null);
    }
  }, [data, stopCamera, serverFreshnessTick]);

  const fetchAddressPreview = useCallback(async (lat: number, lng: number) => {
    const reqId = ++addressReqIdRef.current;
    setAddressLoading(true);
    try {
      const res = await apiFetch<{ address: string | null }>(
        `/api/v1/location/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
      );
      if (reqId === addressReqIdRef.current) {
        setResolvedAddress(res.address || null);
      }
    } catch {
      if (reqId === addressReqIdRef.current) {
        setResolvedAddress(null);
      }
    } finally {
      if (reqId === addressReqIdRef.current) {
        setAddressLoading(false);
      }
    }
  }, []);

  const requestGps = useCallback(() => {
    stopCamera();
    setSubmitMsg(null);
    setGpsStatus('loading');
    setGpsError(null);
    setCoords(null);
    setResolvedAddress(null);

    readCurrentGps()
      .then((position) => {
        setCoords(position);
        setGpsStatus('ok');
        void loadToday(true);
        void fetchAddressPreview(position.lat, position.lng);
      })
      .catch((err) => {
        setCoords(null);
        setGpsStatus('error');
        setGpsError(err instanceof Error ? err.message : 'Gagal membaca lokasi GPS.');
      });
  }, [readCurrentGps, stopCamera, loadToday, fetchAddressPreview]);

  const startCamera = async (
    requestedFacing: 'user' | 'environment' = facingMode,
    isExplicitSwitch = false
  ) => {
    setCameraError(null);
    stopCamera();
    const requestId = ++cameraRequestIdRef.current;

    const next = data?.day.policySnapshot.sesiList[data.day.sessionsCompleted];
    const windowState = data?.serverWindowState ?? 'INVALID';
    const hasServerWindowSnapshot = isFreshServerWindowSnapshot(
      data?.serverWindowCheckedAt,
      serverWindowSyncPerfRef.current
    );
    const hasOverride = Boolean(hasServerWindowSnapshot && data?.day.checkinOverride?.active);
    if (!next || !hasServerWindowSnapshot || (windowState !== 'OPEN' && !hasOverride)) {
      const message = !next
        ? 'Tidak ada sesi absensi berikutnya.'
        : windowState === 'NOT_STARTED'
          ? `Sesi ${next.nama} baru dibuka pukul ${next.jam_mulai} WIB (waktu server ${data?.serverTime || '--:--'} WIB).`
          : windowState === 'EXPIRED'
            ? `Sesi ${next.nama} sudah berakhir pukul ${next.jam_selesai} WIB. Hubungi Admin bila perlu izin khusus.`
            : 'Menunggu sinkronisasi waktu server. Muat ulang halaman bila perlu.';
      setCameraError(message);
      void loadToday(true);
      return;
    }

    if (gpsStatus !== 'ok' || !coords) {
      setCameraError(gpsError || 'Deteksi lokasi GPS terlebih dahulu sebelum membuka kamera.');
      return;
    }
    const mustBeAtOffice = requiresOfficeGeofence(
      data?.day.policySnapshot.aturanLokasi,
      next.urutan
    );
    if (mustBeAtOffice) {
      if (!isGpsAccuracyAcceptable(coords.accuracy)) {
        setCameraError(
          `Akurasi GPS ±${coords.accuracy}m melebihi batas ±${MAX_GPS_ACCURACY_METERS}m. Coba lagi di area lebih terbuka.`
        );
        return;
      }

      const currentDistance = haversineClient(
        coords.lat,
        coords.lng,
        user.kantor_lat,
        user.kantor_lng
      );
      if (!isWithinVerifiedGeofence(currentDistance, coords.accuracy, user.kantor_radius)) {
        setCameraError(
          `Sesi ${next.urutan} wajib di dalam radius kantor (${user.kantor_radius}m). Posisi Anda saat ini ${formatDistance(currentDistance)} (±${coords.accuracy}m).`
        );
        return;
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Browser Anda tidak mendukung akses kamera langsung.');
      return;
    }

    setCameraLoading(true);
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: requestedFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const actualFacing = stream.getVideoTracks()[0]?.getSettings().facingMode;
      if (isExplicitSwitch && actualFacing && actualFacing !== requestedFacing) {
        stream.getTracks().forEach((track) => track.stop());
        setCameraError(
          requestedFacing === 'environment'
            ? 'Kamera belakang tidak tersedia di perangkat ini. Gunakan kamera depan.'
            : 'Kamera depan tidak tersedia di perangkat ini. Gunakan kamera belakang.'
        );
        return;
      }

      const resolvedFacing: 'user' | 'environment' =
        actualFacing === 'environment' || actualFacing === 'user'
          ? actualFacing
          : requestedFacing;
      streamRef.current = stream;
      setFacingMode(resolvedFacing);
      setCameraActive(true);
    } catch (err) {
      if (requestId !== cameraRequestIdRef.current) return;
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCameraError('Izin kamera ditolak. Izinkan akses kamera di pengaturan browser.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('Kamera tidak ditemukan pada perangkat ini.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setCameraError('Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.');
      } else {
        setCameraError('Kamera gagal dibuka. Periksa izin browser lalu coba lagi.');
      }
    } finally {
      if (requestId === cameraRequestIdRef.current) {
        setCameraLoading(false);
      }
    }
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setCameraError(null);
    if (cameraActive) {
      void startCamera(nextMode, true);
    } else {
      setFacingMode(nextMode);
    }
  };

  const captureFromVideo = () => {
    const video = videoRef.current;
    if (
      !video ||
      !cameraReady ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      setCameraError('Kamera belum siap. Tunggu gambar tampil jelas lalu tekan Ambil Foto.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCameraError('Gagal memproses gambar. Silakan buka kamera kembali.');
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(0, canvas.height - 46, canvas.width, 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(
        `${user.nama_lengkap} · ${data?.serverDate || ''} ${liveWibHm} WIB · ${user.kantor_nama.split('(')[0].trim()}`,
        14,
        canvas.height - 17
      );

      const capturedPhoto = canvas.toDataURL('image/jpeg', 0.86);
      if (!capturedPhoto.startsWith('data:image/jpeg;base64,')) {
        setCameraError('Hasil foto tidak valid. Silakan ambil foto ulang.');
        return;
      }
      setPhotoDataUrl(capturedPhoto);
      stopCamera();
      setCameraError(null);
      setSubmitMsg(null);
    } catch {
      setCameraError('Foto gagal diproses. Silakan coba ambil foto kembali.');
    }
  };

  const retakePhoto = (requestedFacing: 'user' | 'environment' = facingMode) => {
    setPhotoDataUrl(null);
    setCameraError(null);
    setSubmitMsg(null);
    void startCamera(requestedFacing);
  };

  const handleSubmitSession = async () => {
    if (!data || submitting) return;
    const nextUrutan = data.day.sessionsCompleted + 1;
    const nextSesiCfg = data.day.policySnapshot.sesiList[data.day.sessionsCompleted];

    const failSubmit = (message: string) => {
      setSubmitMsg({ type: 'err', text: message });
      onSessionFailed?.(message);
    };

    const requirePhoto = Boolean(
      nextSesiCfg &&
        (data.day.policySnapshot.wajibFotoSemuaSesi || nextSesiCfg.wajib_foto === 1)
    );
    const requireActivity = Boolean(
      nextSesiCfg &&
        nextUrutan >= 2 &&
        (data.day.policySnapshot.wajibAktivitasSesiLanjut || nextSesiCfg.wajib_aktivitas === 1)
    );
    if (requirePhoto && !photoDataUrl) {
      failSubmit('Ambil foto melalui kamera terlebih dahulu.');
      return;
    }
    if (requireActivity && !deskripsiAktivitas.trim()) {
      failSubmit('Isi keterangan aktivitas atau standby terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    setSubmitMsg({
      type: 'loading',
      text: 'Memverifikasi lokasi GPS terbaru...',
    });
    try {
      setGpsStatus('loading');
      let freshCoords: { lat: number; lng: number; accuracy: number };
      try {
        freshCoords = await readCurrentGps();
      } catch (gpsErr) {
        const message =
          gpsErr instanceof Error ? gpsErr.message : 'Gagal membaca lokasi GPS.';
        stopCamera();
        setCoords(null);
        setGpsStatus('error');
        setGpsError(message);
        failSubmit(message);
        return;
      }
      setCoords(freshCoords);
      setGpsStatus('ok');
      setGpsError(null);

      const mustBeAtOffice = requiresOfficeGeofence(
        data.day.policySnapshot.aturanLokasi,
        nextUrutan
      );
      if (mustBeAtOffice) {
        if (!isGpsAccuracyAcceptable(freshCoords.accuracy)) {
          stopCamera();
          failSubmit(
            `Akurasi GPS ±${freshCoords.accuracy}m belum memenuhi batas maksimal ±${MAX_GPS_ACCURACY_METERS}m.`
          );
          return;
        }

        const freshDistance = haversineClient(
          freshCoords.lat,
          freshCoords.lng,
          user.kantor_lat,
          user.kantor_lng
        );
        if (!isWithinVerifiedGeofence(freshDistance, freshCoords.accuracy, user.kantor_radius)) {
          stopCamera();
          failSubmit(
            `Posisi Anda (${formatDistance(freshDistance)}, akurasi ±${freshCoords.accuracy}m) belum berada di dalam radius kantor ${user.kantor_radius}m.`
          );
          return;
        }
      }

      setSubmitMsg({
        type: 'loading',
        text: photoDataUrl
          ? 'Mengunggah foto dan menyimpan absensi...'
          : 'Menyimpan absensi ke server...',
      });
      const submitted = await apiFetch<{
        sessionId: number;
        day?: ResolvedDay;
        urutanSesi?: number;
        namaSesi?: string;
        waktuServer?: string;
        serverTime?: string;
        serverEpochMs?: number;
        statusKetepatan?: 'TEPAT_WAKTU' | 'TERLAMBAT';
        keterlambatanMenit?: number;
      }>('/api/v1/attendance/session', {
        method: 'POST',
        body: JSON.stringify({
          urutanSesi: nextUrutan,
          lat: freshCoords.lat,
          lng: freshCoords.lng,
          accuracyMeter: freshCoords.accuracy,
          tipeAktivitas: nextUrutan === 1 ? 'CHECK_IN' : tipeAktivitas,
          deskripsiAktivitas: deskripsiAktivitas.trim(),
          fotoBase64: photoDataUrl,
          fotoSource: photoDataUrl ? 'BROWSER_CAMERA' : undefined,
        }),
      });

      const namaSesi = submitted.namaSesi || nextSesiCfg?.nama || `Sesi ${nextUrutan}`;
      const waktuHm = submitted.waktuServer
        ? submitted.waktuServer.slice(11, 16)
        : submitted.serverTime
          ? submitted.serverTime.slice(0, 5)
          : liveWibHm;
      const ketepatanLabel =
        submitted.statusKetepatan === 'TERLAMBAT' && (submitted.keterlambatanMenit ?? 0) > 0
          ? `Terlambat ${submitted.keterlambatanMenit} menit`
          : 'Tepat waktu';
      const successTitle = `Absensi ${namaSesi} Berhasil!`;
      const successMessage = `Tercatat pukul ${waktuHm} WIB (${ketepatanLabel}). Kehadiran Anda sudah tampil di Beranda.`;

      stopCamera();
      setPhotoDataUrl(null);
      setDeskripsiAktivitas('');
      setSubmitMsg(null);
      onSessionSubmitted({
        sessionId: submitted.sessionId,
        title: successTitle,
        message: successMessage,
        updatedDay: submitted.day,
        serverTime: submitted.serverTime,
        serverEpochMs: submitted.serverEpochMs,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Gagal mengirim absensi sesi. Silakan coba lagi.';
      failSubmit(errorMessage);
      void loadToday(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl animate-pulse" />
        <div className="h-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {error || 'Data absensi tidak tersedia'}
        </p>
        <button
          type="button"
          onClick={() => void loadToday()}
          className="mt-3 min-h-[40px] px-4 py-2 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl"
        >
          Muat Ulang
        </button>
      </div>
    );
  }

  const { day } = data;
  const nextSessionIndex = day.sessionsCompleted;
  const nextSesi = day.policySnapshot.sesiList[nextSessionIndex];
  const allSessionsDone = day.sessionsCompleted >= day.policySnapshot.jumlahSesi;
  const serverWindowFresh = isFreshServerWindowSnapshot(
    data.serverWindowCheckedAt,
    serverWindowSyncPerfRef.current
  );
  const nextWindowState: SessionWindowState = serverWindowFresh
    ? data.serverWindowState ?? 'INVALID'
    : 'INVALID';
  const hasServerWindowSnapshot = serverWindowFresh;
  const hasActiveCheckinOverride = Boolean(hasServerWindowSnapshot && day.checkinOverride?.active);
  const nextSessionExpired =
    hasServerWindowSnapshot && nextWindowState === 'EXPIRED' && !hasActiveCheckinOverride;
  const nextSessionStarted =
    hasServerWindowSnapshot && (nextWindowState === 'OPEN' || hasActiveCheckinOverride);
  const minutesUntilStart = data.serverMinutesUntilStart ?? 0;

  const photoRequired = Boolean(
    nextSesi && (day.policySnapshot.wajibFotoSemuaSesi || nextSesi.wajib_foto === 1)
  );
  const activityRequired = Boolean(
    nextSesi &&
      nextSesi.urutan >= 2 &&
      (day.policySnapshot.wajibAktivitasSesiLanjut || nextSesi.wajib_aktivitas === 1)
  );

  const distanceMeters = coords
    ? haversineClient(coords.lat, coords.lng, user.kantor_lat, user.kantor_lng)
    : null;
  const sessionRequiresOffice = nextSesi
    ? requiresOfficeGeofence(day.policySnapshot.aturanLokasi, nextSesi.urutan)
    : true;
  const gpsAccuracyOk = coords !== null && isGpsAccuracyAcceptable(coords.accuracy);
  const verifiedWithinRadius =
    distanceMeters !== null &&
    coords !== null &&
    isWithinVerifiedGeofence(distanceMeters, coords.accuracy, user.kantor_radius);
  const canCheckInByLocation =
    gpsStatus === 'ok' &&
    coords !== null &&
    (!sessionRequiresOffice || (gpsAccuracyOk && verifiedWithinRadius));

  const step1Done = canCheckInByLocation;
  const step2Done = !photoRequired || Boolean(photoDataUrl);
  const step3Done = !activityRequired || Boolean(deskripsiAktivitas.trim());
  const canSubmitAttendance =
    !submitting && nextSessionStarted && step1Done && step2Done && step3Done;

  const progressPercent = Math.min(
    100,
    Math.round((day.sessionsCompleted / Math.max(1, day.policySnapshot.jumlahSesi)) * 100)
  );

  // Live server-synced countdown for open or upcoming session
  const sessionStartSec = nextSesi ? parseHmToSeconds(nextSesi.jam_mulai) : null;
  const sessionEndSec = nextSesi ? parseHmToSeconds(nextSesi.jam_selesai) : null;
  const overrideEndSec =
    hasActiveCheckinOverride && day.checkinOverride?.berlakuSampai
      ? parseHmToSeconds(day.checkinOverride.berlakuSampai.slice(11, 19))
      : null;
  const effectiveEndSec = hasActiveCheckinOverride && overrideEndSec !== null ? overrideEndSec : sessionEndSec;

  const secondsUntilOpen =
    liveWibSecondsOfDay !== null && sessionStartSec !== null && nextWindowState === 'NOT_STARTED'
      ? Math.max(0, sessionStartSec - liveWibSecondsOfDay)
      : null;
  const secondsUntilClose =
    liveWibSecondsOfDay !== null && effectiveEndSec !== null && nextSessionStarted
      ? Math.max(0, effectiveEndSec - liveWibSecondsOfDay)
      : null;
  const isClosingSoon = secondsUntilClose !== null && secondsUntilClose > 0 && secondsUntilClose <= 900;

  const isPotentiallyLate = Boolean(
    nextSesi &&
      nextSesi.urutan === 1 &&
      liveWibSecondsOfDay !== null &&
      sessionStartSec !== null &&
      liveWibSecondsOfDay > sessionStartSec + day.policySnapshot.toleransiTerlambatMenit * 60
  );

  const quickContextTags =
    nextSesi?.urutan === 1
      ? isPotentiallyLate
        ? ['Kendala Perjalanan', 'Tugas Lapangan Pagi', 'Koordinasi Klien', 'Kendala Perangkat']
        : ['Masuk Kantor', 'Briefing Pagi', 'Persiapan Lapangan', 'Standby NOC']
      : !sessionRequiresOffice
        ? ['Instalasi Fiber', 'Maintenance Jaringan', 'Kunjungan Klien', 'Standby Monitoring NOC', 'Koordinasi Tim']
        : ['Aktivitas Operasional', 'Monitoring Jaringan', 'Koordinasi Tim', 'Standby Kantor'];

  const applyQuickTag = (tag: string) => {
    setDeskripsiAktivitas((prev) => {
      const trimmed = prev.trim();
      const prefix = `[${tag}]`;
      if (trimmed.startsWith(prefix)) return prev;
      const cleaned = trimmed.replace(/^\[[^\]]+\]\s*/, '');
      return cleaned ? `${prefix} ${cleaned}` : `${prefix} `;
    });
    if (submitMsg?.type === 'err') setSubmitMsg(null);
  };

  return (
    <div className="space-y-5">
      {/* Compact Crimson Summary Banner */}
      <div className="bg-gradient-to-br from-[#c0392b] via-[#a93226] to-[#7b241c] text-white rounded-2xl p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-white/80 truncate">
              {user.kantor_nama} · {user.bidang_nama}
            </p>
            <h1 className="font-display text-lg sm:text-xl font-bold mt-0.5 tracking-tight">
              {day.dayLabel}
            </h1>
            <p className="text-xs text-white/80 mt-0.5">
              {day.policySnapshot.policyName} · Min. {day.policySnapshot.minSesiHadir} dari{' '}
              {day.policySnapshot.jumlahSesi} sesi
            </p>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end justify-between gap-2 shrink-0">
            <StatusBadge status={day.operationalStatus} size="md" />
            <span className="font-mono text-xs text-white/90 tabular-nums">
              {liveWibHm} WIB · {day.sessionsCompleted}/{day.policySnapshot.jumlahSesi} Sesi
            </span>
          </div>
        </div>
        {day.mustCheckIn && (
          <div className="mt-3.5 h-1.5 w-full rounded-full bg-black/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Special Day Notices */}
      {day.dayType === 'HARI_LIBUR' && (
        <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/70 text-sky-700 dark:text-sky-200 flex items-center justify-center shrink-0">
            <CalendarOff className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-sky-950 dark:text-sky-100">
              Hari Libur — Tidak Perlu Absensi
            </h2>
            <p className="text-xs sm:text-sm text-sky-900 dark:text-sky-200 mt-1">
              {day.holidayInfo
                ? `${day.holidayInfo.nama}. ${day.holidayInfo.keterangan}`
                : 'Hari ini adalah hari libur sesuai kalender kantor Anda.'}
            </p>
            <p className="text-xs text-sky-800 dark:text-sky-300 mt-1.5 font-medium">
              Payroll: {day.payrollStatus === 'DIHITUNG_MASUK' ? 'Dihitung Masuk' : 'Hari Libur Reguler'}
            </p>
          </div>
        </div>
      )}

      {day.dayType === 'OFF_PENGGANTI' && day.offPenggantiInfo && (
        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-200 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-indigo-950 dark:text-indigo-100">
              Off Pengganti — Tidak Perlu Absensi
            </h2>
            <p className="text-xs sm:text-sm text-indigo-900 dark:text-indigo-200 mt-1">
              Menggunakan hak Off Pengganti dari <strong>{day.offPenggantiInfo.namaProject}</strong> (
              <span className="font-mono">{day.offPenggantiInfo.tanggalKerjaSumber}</span>).
            </p>
          </div>
        </div>
      )}

      {day.pengajuanInfo && day.dayType !== 'OFF_PENGGANTI' && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/70 text-amber-700 dark:text-amber-200 flex items-center justify-center shrink-0">
            <CalendarOff className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-amber-950 dark:text-amber-100">
              Pengajuan {day.pengajuanInfo.jenis} Disetujui
            </h2>
            <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 mt-1">
              Tanggal <span className="font-mono">{day.pengajuanInfo.tanggal_mulai}</span> s/d{' '}
              <span className="font-mono">{day.pengajuanInfo.tanggal_akhir}</span> — {day.pengajuanInfo.alasan}.
            </p>
          </div>
        </div>
      )}

      {day.dayType === 'KERJA_KHUSUS' && day.kerjaKhususInfo && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/70 text-amber-700 dark:text-amber-200 flex items-center justify-center shrink-0">
            <Briefcase className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <p className="font-bold text-amber-950 dark:text-amber-100">
              Kerja Khusus · {day.kerjaKhususInfo.nama_project}
            </p>
            <p className="text-amber-900 dark:text-amber-200 mt-0.5">
              Target {day.kerjaKhususInfo.min_sesi_hadir} dari {day.kerjaKhususInfo.jumlah_sesi} sesi
              {day.kerjaKhususInfo.berhak_off_pengganti ? ' · Berhak Off Pengganti' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Main Attendance Grid: Active Check-in Card FIRST, Session Schedule Beside/Below */}
      {day.mustCheckIn && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Primary Action Card (Top on Mobile, Left 7 cols on Desktop) */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
            {submitMsg && (
              <div
                role={submitMsg.type === 'err' ? 'alert' : 'status'}
                aria-live="polite"
                className={`mb-4 flex items-start gap-2.5 p-3.5 rounded-xl border text-xs font-medium ${
                  submitMsg.type === 'ok'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : submitMsg.type === 'loading'
                      ? 'bg-brand-50 dark:bg-brand-950/50 border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-200'
                      : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                }`}
              >
                {submitMsg.type === 'loading' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin mt-0.5" />
                ) : submitMsg.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{submitMsg.text}</span>
              </div>
            )}

            {allSessionsDone ? (
              <div className="py-10 text-center space-y-2.5">
                <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Semua Sesi Hari Ini Selesai
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                  Anda telah menyelesaikan {day.sessionsCompleted} dari {day.policySnapshot.jumlahSesi} sesi. Kehadiran hari ini tercatat <strong>HADIR</strong>.
                </p>
              </div>
            ) : (
              nextSesi && (
                <div className="space-y-5">
                  {/* Active Session Header */}
                  <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                          Sesi {nextSesi.urutan} dari {day.policySnapshot.jumlahSesi}
                        </span>
                        {nextSessionStarted ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            · {hasActiveCheckinOverride ? 'Izin Admin Aktif' : 'Dibuka'}
                          </span>
                        ) : nextSessionExpired ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                            · Waktu Berakhir
                          </span>
                        ) : nextWindowState === 'NOT_STARTED' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                            · Buka {nextSesi.jam_mulai} WIB
                          </span>
                        ) : null}
                      </div>
                      <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {nextSesi.nama}
                      </h2>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-xs font-bold tabular-nums text-slate-800 dark:text-slate-100">
                        {nextSesi.jam_mulai}–{nextSesi.jam_selesai}
                      </p>
                      {secondsUntilClose !== null ? (
                        <p
                          className={`mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md ${
                            isClosingSoon
                              ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 animate-pulse'
                              : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          Sisa {formatCountdownHms(secondsUntilClose)}
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-400">WIB</p>
                      )}
                    </div>
                  </div>

                  {/* Session Gate Banners (concise & clear) */}
                  {hasActiveCheckinOverride && (
                    <div className="p-3.5 rounded-xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-800 flex items-start gap-2.5 text-xs">
                      <CheckCircle2 className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-bold text-brand-950 dark:text-brand-100">
                          Izin Check-in Khusus Aktif sampai {day.checkinOverride?.berlakuSampai.slice(11, 16)} WIB
                        </p>
                        <p className="text-brand-800 dark:text-brand-200">
                          Dibuka oleh {day.checkinOverride?.adminNama}: {day.checkinOverride?.alasan}
                        </p>
                      </div>
                    </div>
                  )}

                  {!hasActiveCheckinOverride && nextSessionExpired && (
                    <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-start gap-2.5 text-xs">
                      <Lock className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-red-950 dark:text-red-100">
                          Waktu sesi berakhir pukul {nextSesi.jam_selesai} WIB
                        </p>
                        <p className="text-red-800 dark:text-red-200 mt-0.5">
                          Hubungi Admin bila membutuhkan akses check-in khusus.
                        </p>
                      </div>
                    </div>
                  )}

                  {!hasActiveCheckinOverride && !nextSessionExpired && !serverWindowFresh && (
                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                        <span>Menyinkronkan waktu server...</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadToday(true)}
                        className="font-semibold text-amber-800 dark:text-amber-300 underline shrink-0"
                      >
                        Muat ulang
                      </button>
                    </div>
                  )}

                  {!hasActiveCheckinOverride && serverWindowFresh && nextWindowState === 'NOT_STARTED' && (
                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start justify-between gap-3 text-xs">
                      <div className="flex items-start gap-2.5">
                        <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-950 dark:text-amber-100">
                            Sesi dibuka pukul {nextSesi.jam_mulai} WIB
                          </p>
                          <p className="text-amber-800 dark:text-amber-200 mt-0.5">
                            Tersisa {formatDurationMinutes(minutesUntilStart)} lagi (waktu server {data.serverTime} WIB).
                          </p>
                        </div>
                      </div>
                      {secondsUntilOpen !== null && (
                        <span className="font-mono text-xs font-bold tabular-nums px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 shrink-0">
                          {formatCountdownHms(secondsUntilOpen)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* STEP 1: LOKASI GPS & ALAMAT */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                            step1Done
                              ? 'bg-emerald-600 text-white'
                              : 'bg-brand-600 text-white'
                          }`}
                        >
                          {step1Done ? <Check className="w-3.5 h-3.5" /> : '1'}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            Deteksi Lokasi GPS
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {sessionRequiresOffice
                              ? `Wajib di dalam radius ${user.kantor_radius}m kantor`
                              : 'Sesi fleksibel · Boleh dari lokasi tugas lapangan'}
                          </p>
                        </div>
                      </div>
                      {gpsStatus === 'ok' && coords && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={requestGps}
                          className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1 shrink-0"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Perbarui
                        </button>
                      )}
                    </div>

                    {gpsStatus !== 'ok' || !coords ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={gpsStatus === 'loading' || submitting}
                          onClick={requestGps}
                          className="w-full min-h-[46px] px-4 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-colors"
                        >
                          {gpsStatus === 'loading' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <MapPin className="w-4 h-4" />
                          )}
                          <span>
                            {gpsStatus === 'loading'
                              ? 'Mendeteksi Lokasi GPS...'
                              : gpsStatus === 'error'
                                ? 'Coba Deteksi Lokasi Lagi'
                                : 'Deteksi Lokasi Sekarang'}
                          </span>
                        </button>
                        {gpsStatus === 'error' && gpsError && (
                          <p role="alert" className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{gpsError}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl border p-3.5 space-y-2 ${
                          canCheckInByLocation
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800/70'
                            : 'bg-red-50/60 dark:bg-red-950/25 border-red-200 dark:border-red-800/70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2 min-w-0">
                            <MapPin
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                canCheckInByLocation
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                                {addressLoading
                                  ? 'Mencari nama alamat lokasi...'
                                  : resolvedAddress || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`}
                              </p>
                              <p
                                className={`text-[11px] font-semibold mt-0.5 ${
                                  canCheckInByLocation
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-red-700 dark:text-red-400'
                                }`}
                              >
                                {sessionRequiresOffice
                                  ? canCheckInByLocation
                                    ? `Dalam radius kantor · ${formatDistance(distanceMeters!)} (±${coords.accuracy}m)`
                                    : !gpsAccuracyOk
                                      ? `Akurasi GPS ±${coords.accuracy}m (maks ±${MAX_GPS_ACCURACY_METERS}m)`
                                      : `Di luar radius kantor · ${formatDistance(distanceMeters!)} (maks ${user.kantor_radius}m)`
                                  : `Lokasi tercatat · ${formatDistance(distanceMeters!)} dari kantor (±${coords.accuracy}m)`}
                              </p>
                              <p className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">
                                {coords.lat}, {coords.lng}
                              </p>
                            </div>
                          </div>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-brand-600 inline-flex items-center gap-1 shrink-0"
                          >
                            <Navigation className="w-3 h-3" />
                            Maps
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* STEP 2: FOTO KAMERA LANGSUNG */}
                  <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                          photoDataUrl
                            ? 'bg-emerald-600 text-white'
                            : step1Done && nextSessionStarted
                              ? 'bg-brand-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                        }`}
                      >
                        {photoDataUrl ? <Check className="w-3.5 h-3.5" /> : '2'}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          Ambil Foto Kamera {photoRequired ? '(Wajib)' : '(Opsional)'}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Langsung dari kamera perangkat Anda
                        </p>
                      </div>
                    </div>

                    {photoDataUrl ? (
                      <div className="space-y-2.5">
                        <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950 aspect-[4/3] max-h-72 mx-auto flex items-center justify-center">
                          <img
                            src={photoDataUrl}
                            alt="Pratinjau foto absensi"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation || cameraLoading || submitting}
                            onClick={() => retakePhoto(facingMode)}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Ambil Ulang
                          </button>
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation || cameraLoading || submitting}
                            onClick={() => retakePhoto(facingMode === 'user' ? 'environment' : 'user')}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <SwitchCamera className="w-3.5 h-3.5" />
                            Kamera {facingMode === 'user' ? 'Belakang' : 'Depan'}
                          </button>
                        </div>
                      </div>
                    ) : cameraActive && nextSessionStarted && canCheckInByLocation ? (
                      <div className="space-y-2.5">
                        {cameraError && (
                          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                            {cameraError}
                          </p>
                        )}
                        <div className="rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-black aspect-[4/3] max-h-72 mx-auto">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                          <button
                            type="button"
                            disabled={!cameraReady || cameraLoading}
                            onClick={captureFromVideo}
                            className="min-h-[44px] px-4 bg-brand-600 hover:bg-brand-700 text-white text-xs sm:text-sm font-bold rounded-xl inline-flex items-center justify-center gap-1.5 disabled:opacity-55"
                          >
                            <Camera className="w-4 h-4" />
                            {cameraReady ? 'Ambil Foto' : 'Menyiapkan...'}
                          </button>
                          <button
                            type="button"
                            disabled={cameraLoading}
                            onClick={toggleFacingMode}
                            className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                          >
                            <SwitchCamera className="w-4 h-4" />
                            <span className="hidden sm:inline">{facingMode === 'user' ? 'Belakang' : 'Depan'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {cameraError && (
                          <p role="alert" className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
                            {cameraError}
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation || cameraLoading}
                            onClick={() => void startCamera(facingMode)}
                            className="flex-1 min-h-[44px] px-4 bg-slate-900 hover:bg-slate-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                          >
                            <Camera className="w-4 h-4" />
                            {cameraLoading
                              ? 'Membuka Kamera...'
                              : !canCheckInByLocation
                                ? 'Selesaikan Langkah 1 (Lokasi)'
                                : !nextSessionStarted
                                  ? 'Menunggu Sesi Dibuka'
                                  : `Buka Kamera (${facingMode === 'user' ? 'Depan' : 'Belakang'})`}
                          </button>
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation || cameraLoading}
                            onClick={toggleFacingMode}
                            className="min-h-[44px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-xl inline-flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
                          >
                            <SwitchCamera className="w-4 h-4" />
                            {facingMode === 'user' ? 'Belakang' : 'Depan'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* STEP 3: KETERANGAN & KIRIM */}
                  <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                          step3Done && deskripsiAktivitas.trim()
                            ? 'bg-emerald-600 text-white'
                            : step1Done && step2Done && nextSessionStarted
                              ? 'bg-brand-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                        }`}
                      >
                        {step3Done && deskripsiAktivitas.trim() ? <Check className="w-3.5 h-3.5" /> : '3'}
                      </span>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {nextSesi.urutan === 1 ? 'Catatan Singkat (Opsional)' : 'Keterangan Aktivitas'}
                          {activityRequired && <span className="ml-1 text-red-600">*</span>}
                        </p>
                      </div>
                    </div>

                    {nextSesi.urutan >= 2 && (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!nextSessionStarted || submitting}
                          onClick={() => setTipeAktivitas('AKTIVITAS')}
                          className={`min-h-[40px] rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                            tipeAktivitas === 'AKTIVITAS'
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          Aktivitas Pekerjaan
                        </button>
                        <button
                          type="button"
                          disabled={!nextSessionStarted || submitting}
                          onClick={() => setTipeAktivitas('STANDBY')}
                          className={`min-h-[40px] rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                            tipeAktivitas === 'STANDBY'
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          Standby / Siaga
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">
                          {isPotentiallyLate ? 'Alasan cepat:' : 'Isian cepat:'}
                        </span>
                        {quickContextTags.map((tag) => {
                          const isActiveTag = deskripsiAktivitas.trim().startsWith(`[${tag}]`);
                          return (
                            <button
                              key={tag}
                              type="button"
                              disabled={!nextSessionStarted || submitting}
                              onClick={() => applyQuickTag(tag)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-45 ${
                                isActiveTag
                                  ? 'bg-[#c0392b] text-white border-[#c0392b]'
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-brand-400'
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        rows={2}
                        disabled={!nextSessionStarted || submitting}
                        value={deskripsiAktivitas}
                        maxLength={500}
                        onChange={(e) => {
                          setDeskripsiAktivitas(e.target.value);
                          if (submitMsg?.type === 'err') setSubmitMsg(null);
                        }}
                        placeholder={
                          nextSesi.urutan === 1
                            ? isPotentiallyLate
                              ? 'Tuliskan alasan keterlambatan singkat...'
                              : 'Contoh: Mulai kerja di kantor...'
                            : tipeAktivitas === 'STANDBY'
                              ? 'Contoh: Standby monitoring jaringan & tiket NOC...'
                              : 'Contoh: Instalasi fiber & pengecekan perangkat...'
                        }
                        className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 disabled:opacity-60"
                      />
                    </div>

                    {submitMsg?.type === 'err' && (
                      <div
                        role="alert"
                        aria-live="assertive"
                        className="flex items-start gap-2.5 p-3.5 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-200 text-xs font-medium"
                      >
                        <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-red-900 dark:text-red-100">Absensi Gagal</p>
                          <p className="mt-0.5 leading-relaxed">{submitMsg.text}</p>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={!canSubmitAttendance}
                      onClick={handleSubmitSession}
                      className="w-full min-h-[48px] px-4 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>
                        {submitting
                          ? 'Mengirim Absensi...'
                          : !nextSessionStarted
                            ? nextSessionExpired
                              ? `Sesi Berakhir (${nextSesi.jam_selesai} WIB)`
                              : `Terkunci hingga ${nextSesi.jam_mulai} WIB`
                            : !step1Done
                              ? 'Deteksi Lokasi Terlebih Dahulu'
                              : !step2Done
                                ? 'Ambil Foto Terlebih Dahulu'
                                : !step3Done
                                  ? 'Isi Keterangan Aktivitas'
                                  : `Kirim Absensi ${nextSesi.nama}`}
                      </span>
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Secondary: Today's Session Schedule (Below on Mobile, Right 5 cols on Desktop) */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-2 mb-3.5">
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Jadwal Sesi Hari Ini
              </h2>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {day.sessionsCompleted}/{day.policySnapshot.jumlahSesi} selesai
              </span>
            </div>
            <div className="space-y-2.5">
              {day.policySnapshot.sesiList.map((sesi, idx) => {
                const record = day.sessionRecords.find((r) => r.urutan_sesi === sesi.urutan);
                const isNext = !record && idx === day.sessionsCompleted;
                const sesiWindowState = serverWindowFresh
                  ? data.serverSessionWindowStates?.[idx] ?? 'INVALID'
                  : 'INVALID';
                const sesiExpired = sesiWindowState === 'EXPIRED';
                const sesiStarted = sesiWindowState === 'OPEN';

                return (
                  <div
                    key={sesi.urutan}
                    className={`p-3 rounded-xl border transition-colors ${
                      record
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800/70'
                        : isNext && (sesiStarted || hasActiveCheckinOverride)
                          ? 'bg-brand-50/60 dark:bg-brand-950/35 border-brand-500/80'
                          : isNext
                            ? 'bg-amber-50/50 dark:bg-amber-950/25 border-amber-300/80 dark:border-amber-700/70'
                            : 'bg-slate-50/80 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {sesi.nama}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                          {sesi.jam_mulai} – {sesi.jam_selesai} WIB
                        </p>
                      </div>
                      {record ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {record.waktu_server.slice(11, 16)}
                        </span>
                      ) : isNext && hasActiveCheckinOverride ? (
                        <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400 shrink-0">
                          Izin Admin
                        </span>
                      ) : isNext && sesiStarted ? (
                        <span className="text-[11px] font-bold text-brand-600 dark:text-brand-400 shrink-0">
                          Aktif
                        </span>
                      ) : isNext && sesiExpired ? (
                        <span className="text-[11px] font-semibold text-red-600 dark:text-red-400 shrink-0">
                          Berakhir
                        </span>
                      ) : isNext ? (
                        <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                          Buka {sesi.jam_mulai}
                        </span>
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                    </div>

                    {record && (
                      <div className="mt-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/50 flex items-center justify-between gap-2.5">
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 min-w-0">
                          <p className="truncate">{record.deskripsi_aktivitas}</p>
                          {record.lokasi_alamat && (
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {record.lokasi_alamat}
                            </p>
                          )}
                        </div>
                        {record.has_foto && (
                          <img
                            src={getAuthorizedPhotoUrl(record.id)}
                            alt={`Bukti ${sesi.nama}`}
                            className="w-9 h-9 rounded-lg object-cover border border-emerald-200 dark:border-emerald-800 shrink-0"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
