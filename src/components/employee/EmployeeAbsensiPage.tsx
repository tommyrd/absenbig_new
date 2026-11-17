import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarOff,
  Camera,
  CheckCircle2,
  Clock,
  FileCheck2,
  Lock,
  MapPin,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { apiFetch, getAuthorizedPhotoUrl } from '../../lib/api';
import type { AuthUser, Karyawan, ResolvedDay } from '../../shared/types';
import { isGpsAccuracyAcceptable, isWithinVerifiedGeofence, MAX_GPS_ACCURACY_METERS } from '../../shared/geofence';
import { getSessionWindowState } from '../../shared/session-window';
import { StatusBadge } from '../StatusBadge';

interface TodayResponse {
  serverDate: string;
  serverTime: string;
  serverEpochMs?: number;
  karyawan: Karyawan;
  day: ResolvedDay;
}

interface EmployeeAbsensiPageProps {
  user: AuthUser;
  onSessionSubmitted: () => void;
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

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function getWibHmFromEpoch(epochMs: number): string {
  const safeMs = Number.isFinite(epochMs) ? epochMs : Date.now();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(safeMs));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function formatDurationMinutes(diffMin: number): string {
  if (diffMin <= 0) return 'kurang dari 1 menit';
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours > 0 && mins > 0) return `${hours} jam ${mins} menit`;
  if (hours > 0) return `${hours} jam`;
  return `${mins} menit`;
}

export function EmployeeAbsensiPage({ user, onSessionSubmitted }: EmployeeAbsensiPageProps) {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [liveWibHm, setLiveWibHm] = useState(() => getWibHmFromEpoch(Date.now()));

  // GPS State
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);

  const readCurrentGps = useCallback(
    () =>
      new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Browser tidak mendukung Geolocation.'));
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
                  ? 'Izin lokasi ditolak oleh browser. Aktifkan izin lokasi untuk melakukan absensi.'
                  : 'Tidak dapat membaca GPS perangkat. Periksa sinyal dan izin lokasi, lalu coba lagi.'
              )
            );
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }),
    []
  );

  // Camera & Photo State (Browser Camera ONLY — no file upload allowed)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  // Activity & Submission State
  const [tipeAktivitas, setTipeAktivitas] = useState<'AKTIVITAS' | 'STANDBY'>('AKTIVITAS');
  const [deskripsiAktivitas, setDeskripsiAktivitas] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TodayResponse>('/api/v1/attendance/today');
      setData(res);
      if (typeof res.serverEpochMs === 'number' && Number.isFinite(res.serverEpochMs)) {
        const offset = res.serverEpochMs - Date.now();
        setClockOffsetMs(offset);
        setLiveWibHm(getWibHmFromEpoch(Date.now() + offset));
      } else if (res.serverTime) {
        setLiveWibHm(res.serverTime.slice(0, 5));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status absensi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveWibHm(getWibHmFromEpoch(Date.now() + clockOffsetMs));
    }, 10000);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Automatically close the camera when the server-synchronized session window expires.
  useEffect(() => {
    if (!data) return;
    const next = data.day.policySnapshot.sesiList[data.day.sessionsCompleted];
    if (next && parseHm(liveWibHm) > parseHm(next.jam_selesai)) {
      stopCamera();
      setPhotoDataUrl(null);
    }
  }, [data, liveWibHm, stopCamera]);

  const requestGps = useCallback(() => {
    stopCamera();
    setPhotoDataUrl(null);
    setGpsStatus('loading');
    setGpsError(null);
    setCoords(null);
    readCurrentGps()
      .then((position) => {
        setCoords(position);
        setGpsStatus('ok');
      })
      .catch((err) => {
        setCoords(null);
        setGpsStatus('error');
        setGpsError(err instanceof Error ? err.message : 'Gagal membaca lokasi GPS.');
      });
  }, [readCurrentGps, stopCamera]);

  useEffect(() => {
    requestGps();
  }, [requestGps]);

  const startCamera = async (requestedFacing: 'user' | 'environment' = facingMode) => {
    setCameraError(null);
    stopCamera();

    const next = data?.day.policySnapshot.sesiList[data.day.sessionsCompleted];
    const currentMinute = parseHm(liveWibHm);
    if (!next || currentMinute < parseHm(next.jam_mulai) || currentMinute > parseHm(next.jam_selesai)) {
      setCameraError(
        next
          ? `Waktu absensi hanya ${next.jam_mulai}–${next.jam_selesai} WIB. Sesi belum dibuka atau sudah dikunci.`
          : 'Tidak ada sesi absensi berikutnya.'
      );
      return;
    }

    if (gpsStatus !== 'ok' || !coords) {
      setCameraError(gpsError || 'Lokasi GPS wajib terbaca sebelum kamera absensi dapat dibuka.');
      return;
    }
    if (!isGpsAccuracyAcceptable(coords.accuracy)) {
      setCameraError(
        `Akurasi GPS ±${coords.accuracy}m belum memenuhi batas maksimal ±${MAX_GPS_ACCURACY_METERS}m. Aktifkan lokasi presisi dan perbarui GPS di area terbuka.`
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
        `Kamera dikunci. Jarak ke kantor ${currentDistance}m dengan estimasi akurasi ±${coords.accuracy}m belum dapat dipastikan berada dalam radius ${user.kantor_radius}m.`
      );
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Browser Anda tidak mendukung akses kamera langsung (getUserMedia). Gunakan browser modern dengan izin kamera aktif.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: requestedFacing, width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(requestedFacing);
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError(
        'Akses kamera browser ditolak atau perangkat kamera tidak tersedia. Absensi wajib menggunakan kamera browser secara langsung (unggah foto dari galeri dinonaktifkan).'
      );
    }
  };

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    if (cameraActive) {
      startCamera(nextMode);
    } else {
      setFacingMode(nextMode);
    }
  };

  const captureFromVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Stamp server date, live WIB time & employee name watermark on capture
    ctx.fillStyle = 'rgba(11, 21, 40, 0.8)';
    ctx.fillRect(0, canvas.height - 46, canvas.width, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(
      `${user.nama_lengkap} · ${data?.serverDate || ''} ${liveWibHm} WIB · ${user.kantor_nama.split('(')[0].trim()}`,
      14,
      canvas.height - 17
    );
    setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.86));
    stopCamera();
  };

  const handleSubmitSession = async () => {
    if (!data) return;
    const nextUrutan = data.day.sessionsCompleted + 1;
    const nextSesiCfg = data.day.policySnapshot.sesiList[data.day.sessionsCompleted];
    const currentMinute = parseHm(liveWibHm);
    if (nextSesiCfg && currentMinute < parseHm(nextSesiCfg.jam_mulai)) {
      setSubmitMsg({
        type: 'err',
        text: `Absensi ${nextSesiCfg.nama} belum dimulai. Sesi baru dapat diisi mulai pukul ${nextSesiCfg.jam_mulai} WIB.`,
      });
      return;
    }
    if (nextSesiCfg && currentMinute > parseHm(nextSesiCfg.jam_selesai)) {
      stopCamera();
      setPhotoDataUrl(null);
      setSubmitMsg({
        type: 'err',
        text: `Waktu absensi ${nextSesiCfg.nama} sudah berakhir pukul ${nextSesiCfg.jam_selesai} WIB. Hubungi Admin bila ada kendala perangkat untuk Admin Override payroll.`,
      });
      return;
    }

    setSubmitting(true);
    setSubmitMsg(null);
    try {
      // Re-read GPS at the moment of submission; do not trust a stale page-load coordinate.
      setGpsStatus('loading');
      let freshCoords: { lat: number; lng: number; accuracy: number };
      try {
        freshCoords = await readCurrentGps();
      } catch (gpsErr) {
        const message =
          gpsErr instanceof Error ? gpsErr.message : 'Gagal membaca lokasi GPS.';
        stopCamera();
        setPhotoDataUrl(null);
        setCoords(null);
        setGpsStatus('error');
        setGpsError(message);
        setSubmitMsg({ type: 'err', text: message });
        return;
      }
      setCoords(freshCoords);
      setGpsStatus('ok');
      setGpsError(null);

      if (!isGpsAccuracyAcceptable(freshCoords.accuracy)) {
        stopCamera();
        setPhotoDataUrl(null);
        setSubmitMsg({
          type: 'err',
          text: `Akurasi GPS ±${freshCoords.accuracy}m belum memenuhi batas maksimal ±${MAX_GPS_ACCURACY_METERS}m. Perbarui lokasi di area terbuka atau hubungi Admin.`,
        });
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
        setPhotoDataUrl(null);
        setSubmitMsg({
          type: 'err',
          text: `Absensi ditolak. Jarak titik GPS ${freshDistance}m dengan estimasi akurasi ±${freshCoords.accuracy}m belum dapat dipastikan berada dalam radius kantor ${user.kantor_radius}m. Dekati bagian tengah kantor dan perbarui GPS.`,
        });
        return;
      }

      await apiFetch('/api/v1/attendance/session', {
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
      setPhotoDataUrl(null);
      setDeskripsiAktivitas('');
      setSubmitMsg({
        type: 'ok',
        text: `Sesi ${nextUrutan} berhasil dicatat dengan waktu server WIB dan tampil di Beranda.`,
      });
      await loadToday();
      onSessionSubmitted();
    } catch (err) {
      setSubmitMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal mengirim absensi sesi.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {error || 'Data tidak tersedia'}
        </p>
        <button
          type="button"
          onClick={loadToday}
          className="mt-3 min-h-[44px] sm:min-h-[36px] px-4 py-2 text-xs font-medium bg-navy-900 dark:bg-blue-600 text-white rounded-lg"
        >
          Muat Ulang
        </button>
      </div>
    );
  }

  const { day } = data;
  const nextSessionIndex = day.sessionsCompleted; // 0-based index of next session
  const nextSesi = day.policySnapshot.sesiList[nextSessionIndex];
  const allSessionsDone = day.sessionsCompleted >= day.policySnapshot.jumlahSesi;
  const nowMin = parseHm(liveWibHm);
  const nextStartMin = nextSesi ? parseHm(nextSesi.jam_mulai) : 0;
  const nextWindowState = nextSesi
    ? getSessionWindowState(nowMin, nextSesi.jam_mulai, nextSesi.jam_selesai)
    : 'INVALID';
  const nextSessionExpired = nextWindowState === 'EXPIRED';
  const nextSessionStarted = nextWindowState === 'OPEN';
  const minutesUntilStart = nextSesi ? Math.max(0, nextStartMin - nowMin) : 0;

  const distanceMeters = coords
    ? haversineClient(coords.lat, coords.lng, user.kantor_lat, user.kantor_lng)
    : null;
  const withinRadius = distanceMeters !== null ? distanceMeters <= user.kantor_radius : false;
  const gpsAccuracyOk = coords !== null && isGpsAccuracyAcceptable(coords.accuracy);
  const verifiedWithinRadius =
    distanceMeters !== null &&
    coords !== null &&
    isWithinVerifiedGeofence(distanceMeters, coords.accuracy, user.kantor_radius);
  const canCheckInByLocation = gpsStatus === 'ok' && coords !== null && gpsAccuracyOk && verifiedWithinRadius;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header Summary Card */}
      <div className="bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-slate-800 text-white rounded-2xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-blue-300 font-medium">
              {user.kantor_nama} · {user.bidang_nama}
            </p>
            <h1 className="font-display text-lg sm:text-2xl font-bold mt-1">
              {day.dayLabel}
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              Kebijakan aktif: {day.policySnapshot.policyName} (Min. {day.policySnapshot.minSesiHadir} dari{' '}
              {day.policySnapshot.jumlahSesi} sesi)
            </p>
          </div>
          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-2">
            <StatusBadge status={day.operationalStatus} size="md" />
            <span className="font-mono text-xs text-slate-300 tabular-nums">
              Progres: {day.sessionsCompleted} / {day.policySnapshot.jumlahSesi} sesi · {liveWibHm} WIB
            </span>
          </div>
        </div>
      </div>

      {/* Special Day Banners: HARI_LIBUR / OFF_PENGGANTI / CUTI / IZIN / SAKIT */}
      {day.dayType === 'HARI_LIBUR' && (
        <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 rounded-xl p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/70 text-sky-800 dark:text-sky-200 flex items-center justify-center shrink-0">
            <CalendarOff className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-sky-950 dark:text-sky-100">
              HARI LIBUR — Tidak Perlu Absensi
            </h2>
            <p className="text-sm text-sky-900 dark:text-sky-200 mt-1">
              {day.holidayInfo
                ? `${day.holidayInfo.nama}. ${day.holidayInfo.keterangan}`
                : 'Hari ini adalah hari libur sesuai kalender kantor Anda.'}
            </p>
            <p className="text-xs text-sky-800 dark:text-sky-300 mt-2 font-medium">
              Status Payroll: {day.payrollStatus === 'DIHITUNG_MASUK' ? 'Dihitung Masuk Payroll' : 'Hari Libur Reguler (Bukan Tidak Hadir)'}
            </p>
          </div>
        </div>
      )}

      {day.dayType === 'OFF_PENGGANTI' && day.offPenggantiInfo && (
        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/70 rounded-xl p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200 flex items-center justify-center shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-indigo-950 dark:text-indigo-100">
              OFF PENGGANTI — Tidak Perlu Absensi
            </h2>
            <p className="text-sm text-indigo-900 dark:text-indigo-200 mt-1">
              Anda sedang menggunakan hak Off Pengganti dari kerja khusus{' '}
              <strong>{day.offPenggantiInfo.namaProject}</strong> pada tanggal{' '}
              <span className="font-mono">{day.offPenggantiInfo.tanggalKerjaSumber}</span>.
            </p>
            <p className="text-xs text-indigo-800 dark:text-indigo-300 mt-2 font-medium">
              Status Payroll: {day.payrollStatus === 'DIHITUNG_MASUK' ? 'Dihitung Masuk Payroll' : 'Mengikuti kebijakan off'}
            </p>
          </div>
        </div>
      )}

      {day.pengajuanInfo && day.dayType !== 'OFF_PENGGANTI' && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-xl p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200 flex items-center justify-center shrink-0">
            <CalendarOff className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-amber-950 dark:text-amber-100">
              Pengajuan {day.pengajuanInfo.jenis} Disetujui
            </h2>
            <p className="text-sm text-amber-900 dark:text-amber-200 mt-1">
              Rentang tanggal: <span className="font-mono">{day.pengajuanInfo.tanggal_mulai}</span> s/d{' '}
              <span className="font-mono">{day.pengajuanInfo.tanggal_akhir}</span>. Alasan:{' '}
              {day.pengajuanInfo.alasan}.
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
              Tidak perlu absensi hari ini. Jika ada perubahan dan Anda tetap bekerja, hubungi Admin untuk pembatalan tercatat.
            </p>
          </div>
        </div>
      )}

      {day.dayType === 'KERJA_KHUSUS' && day.kerjaKhususInfo && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-xl p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200 flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-amber-950 dark:text-amber-100">
              KERJA KHUSUS — {day.kerjaKhususInfo.nama_project}
            </h2>
            <p className="text-sm text-amber-900 dark:text-amber-200 mt-1">
              {day.kerjaKhususInfo.keterangan || 'Penugasan kerja khusus pada hari libur/off.'}
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1.5 font-medium">
              Target sesi: {day.kerjaKhususInfo.min_sesi_hadir} dari {day.kerjaKhususInfo.jumlah_sesi} sesi ·{' '}
              {day.kerjaKhususInfo.berhak_off_pengganti
                ? 'Berhak mendapatkan hak Off Pengganti'
                : 'Tanpa hak Off Pengganti'}
            </p>
          </div>
        </div>
      )}

      {/* Session Stepper & Check-In Form (only when mustCheckIn) */}
      {day.mustCheckIn && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Left: Session Stepper */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mb-4">
              Urutan Sesi Hari Ini
            </h2>
            <div className="space-y-3">
              {day.policySnapshot.sesiList.map((sesi, idx) => {
                const record = day.sessionRecords.find((r) => r.urutan_sesi === sesi.urutan);
                const isNext = !record && idx === day.sessionsCompleted;
                const sesiWindowState = getSessionWindowState(
                  nowMin,
                  sesi.jam_mulai,
                  sesi.jam_selesai
                );
                const sesiExpired = sesiWindowState === 'EXPIRED';
                const sesiStarted = sesiWindowState === 'OPEN';

                return (
                  <div
                    key={sesi.urutan}
                    className={`p-3.5 rounded-xl border transition-colors ${
                      record
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70'
                        : isNext && sesiStarted
                        ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-600 dark:border-blue-500'
                        : isNext
                        ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/70'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {sesi.nama}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                          Jadwal: {sesi.jam_mulai} – {sesi.jam_selesai} WIB
                        </p>
                      </div>
                      {record ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          {record.waktu_server.slice(11, 16)}
                        </span>
                      ) : isNext && sesiStarted ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
                          <Clock className="w-4 h-4" />
                          Sesi Dibuka
                        </span>
                      ) : isNext && sesiExpired ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400">
                          <Lock className="w-4 h-4" />
                          Waktu Berakhir
                        </span>
                      ) : isNext ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                          <Lock className="w-3.5 h-3.5" />
                          Buka {sesi.jam_mulai}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Lock className="w-3.5 h-3.5" />
                          Terkunci
                        </span>
                      )}
                    </div>

                    {record && (
                      <div className="mt-2.5 pt-2.5 border-t border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-700 dark:text-slate-300 min-w-0">
                          <span className="font-medium">{record.tipe_aktivitas}</span>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="truncate">{record.deskripsi_aktivitas}</span>
                        </div>
                        {record.has_foto && (
                          <img
                            src={getAuthorizedPhotoUrl(record.id)}
                            alt={`Bukti ${sesi.nama}`}
                            className="w-10 h-10 rounded-md object-cover border border-emerald-200 dark:border-emerald-800 shrink-0"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Active Session Capture Form */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-6">
            {submitMsg && (
              <div
                className={`mb-4 p-3.5 rounded-lg border text-xs font-medium ${
                  submitMsg.type === 'ok'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                }`}
              >
                {submitMsg.text}
              </div>
            )}

            {allSessionsDone ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Seluruh Sesi Hari Ini Selesai
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Anda telah menyelesaikan {day.sessionsCompleted} dari {day.policySnapshot.jumlahSesi} sesi. Status hari ini tercatat <strong>HADIR</strong>.
                </p>
              </div>
            ) : (
              nextSesi && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                        Sesi Berikutnya ({nextSesi.urutan} dari {day.policySnapshot.jumlahSesi})
                      </p>
                      <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                        {nextSesi.nama}
                      </h2>
                    </div>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {nextSesi.jam_mulai} – {nextSesi.jam_selesai} WIB
                    </span>
                  </div>

                  {/* Session time-window notice */}
                  {nextSessionExpired ? (
                    <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 flex items-start gap-3">
                      <Lock className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-red-950 dark:text-red-100">
                          Waktu Absensi Sesi Telah Berakhir
                        </p>
                        <p className="text-red-900 dark:text-red-200 leading-relaxed">
                          Sesi {nextSesi.nama} ditutup pukul <span className="font-mono font-semibold">{nextSesi.jam_selesai} WIB</span>.
                          Absensi mandiri dikunci. Bila HP rusak, GPS bermasalah, atau ada keadaan khusus,
                          hubungi Admin untuk Admin Override payroll dengan alasan dan audit trail.
                        </p>
                      </div>
                    </div>
                  ) : !nextSessionStarted ? (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-start gap-3">
                      <Lock className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-amber-950 dark:text-amber-100">
                          Belum Memasuki Jam Mulai Sesi ({nextSesi.jam_mulai} WIB)
                        </p>
                        <p className="text-amber-900 dark:text-amber-200 leading-relaxed">
                          Absensi hanya dapat dilakukan setelah jam sesi dimulai. Waktu server saat ini{' '}
                          <span className="font-mono font-semibold">{liveWibHm} WIB</span> (sesi dibuka dalam{' '}
                          <span className="font-semibold">{formatDurationMinutes(minutesUntilStart)}</span>).
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {/* Step 1: GPS & Geofence */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                        Lokasi & Geofence ({user.kantor_nama})
                      </span>
                      <button
                        type="button"
                        onClick={requestGps}
                        className="min-h-[36px] px-2 text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${gpsStatus === 'loading' ? 'animate-spin' : ''}`} />
                        Perbarui Lokasi
                      </button>
                    </div>

                    {gpsStatus === 'ok' && coords ? (
                      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                        <p className="font-mono tabular-nums">
                          Koordinat: {coords.lat}, {coords.lng} (Akurasi ±{coords.accuracy}m)
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 font-medium">
                          <span>Jarak ke kantor:</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{distanceMeters} m</span>
                          <span className="text-slate-400">·</span>
                          <span className={canCheckInByLocation ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                            {canCheckInByLocation
                              ? `Dalam radius terverifikasi (${user.kantor_radius}m) · Absensi tersedia`
                              : !gpsAccuracyOk
                              ? `Akurasi GPS harus maksimal ±${MAX_GPS_ACCURACY_METERS}m`
                              : `Di luar / belum pasti dalam radius ${user.kantor_radius}m · Absensi ditolak`}
                          </span>
                        </p>
                      </div>
                    ) : gpsStatus === 'loading' ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Membaca koordinat GPS browser...</p>
                    ) : (
                      <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{gpsError || 'Lokasi belum tersedia.'}</span>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Browser Camera ONLY (Upload from gallery disabled) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Kamera Browser Langsung {nextSesi.wajib_foto ? '(Wajib)' : '(Opsional)'}
                        </label>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Foto diambil langsung dari kamera browser (unggah file/galeri dinonaktifkan).
                        </p>
                      </div>
                      {photoDataUrl && (
                        <button
                          type="button"
                          onClick={() => setPhotoDataUrl(null)}
                          className="min-h-[36px] px-2 text-xs font-medium text-red-700 dark:text-red-400 hover:underline shrink-0"
                        >
                          Hapus & Ulangi Foto
                        </button>
                      )}
                    </div>

                    {photoDataUrl ? (
                      <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 max-h-72 flex items-center justify-center">
                        <img
                          src={photoDataUrl}
                          alt="Preview foto absensi"
                          className="max-h-72 w-full object-contain"
                        />
                      </div>
                    ) : cameraActive && nextSessionStarted && canCheckInByLocation ? (
                      <div className="space-y-3">
                        <div className="rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-black">
                          <video
                            ref={videoRef}
                            playsInline
                            muted
                            className="w-full max-h-72 object-cover"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={captureFromVideo}
                            className="flex-1 min-h-[44px] h-11 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2"
                          >
                            <Camera className="w-4 h-4" />
                            Ambil Foto Sekarang
                          </button>
                          <button
                            type="button"
                            onClick={toggleFacingMode}
                            className="min-h-[44px] h-11 px-3.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                            title="Ganti kamera depan/belakang"
                          >
                            <SwitchCamera className="w-4 h-4" />
                            {facingMode === 'user' ? 'Depan' : 'Belakang'}
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="min-h-[44px] h-11 px-4 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 sm:p-5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 text-center space-y-3">
                        {cameraError && (
                          <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-left">
                            {cameraError}
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation}
                            onClick={() => startCamera(facingMode)}
                            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Camera className="w-4 h-4" />
                            {!canCheckInByLocation ? 'Lokasi wajib dalam radius kantor' : nextSessionStarted ? 'Buka Kamera Browser' : `Menunggu Pukul ${nextSesi.jam_mulai} WIB`}
                          </button>
                          <button
                            type="button"
                            disabled={!nextSessionStarted || !canCheckInByLocation}
                            onClick={toggleFacingMode}
                            className="w-full sm:w-auto min-h-[44px] px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <SwitchCamera className="w-4 h-4" />
                            Mode: {facingMode === 'user' ? 'Kamera Depan' : 'Kamera Belakang'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 3: Activity / Standby for Session >= 2 */}
                  {nextSesi.urutan >= 2 && (
                    <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Status Pekerjaan Sesi {nextSesi.urutan}
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={!nextSessionStarted}
                          onClick={() => setTipeAktivitas('AKTIVITAS')}
                          className={`min-h-[44px] sm:h-10 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                            tipeAktivitas === 'AKTIVITAS'
                              ? 'bg-navy-900 dark:bg-blue-600 text-white border-navy-900 dark:border-blue-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          Aktivitas Pekerjaan
                        </button>
                        <button
                          type="button"
                          disabled={!nextSessionStarted}
                          onClick={() => setTipeAktivitas('STANDBY')}
                          className={`min-h-[44px] sm:h-10 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                            tipeAktivitas === 'STANDBY'
                              ? 'bg-navy-900 dark:bg-blue-600 text-white border-navy-900 dark:border-blue-600'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          Standby / Siaga
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        disabled={!nextSessionStarted}
                        value={deskripsiAktivitas}
                        onChange={(e) => setDeskripsiAktivitas(e.target.value)}
                        placeholder={
                          tipeAktivitas === 'STANDBY'
                            ? 'Tuliskan status standby (mis. Standby monitoring node & tiket NOC)...'
                            : 'Tuliskan aktivitas pekerjaan yang sedang/telah dilakukan...'
                        }
                        className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-700 dark:focus:border-blue-500 disabled:opacity-60"
                      />
                    </div>
                  )}

                  {/* Submit CTA */}
                  <button
                    type="button"
                    disabled={submitting || !nextSessionStarted || !canCheckInByLocation}
                    onClick={handleSubmitSession}
                    className="w-full h-12 bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {submitting
                        ? 'Menyimpan ke Server...'
                        : !canCheckInByLocation
                        ? 'Absensi terkunci · wajib dalam radius kantor'
                        : !nextSessionStarted
                        ? `Terkunci hingga ${nextSesi.jam_mulai} WIB`
                        : `Kirim Absensi ${nextSesi.nama}`}
                    </span>
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
