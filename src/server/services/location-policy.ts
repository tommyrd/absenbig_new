import type { DatabaseSync } from 'node:sqlite';
import {
  isGpsAccuracyAcceptable,
  isWithinVerifiedGeofence,
  MAX_GPS_ACCURACY_METERS,
  requiresOfficeGeofence,
} from '../../shared/geofence.ts';
import {
  isPointInRegionGeometry,
  validateRegionPolygonGeoJson,
} from '../../shared/region-geometry.ts';
import type {
  AttendanceLocationRule,
  CakupanLokasiAbsensi,
  Karyawan,
  StatusPenempatanKaryawan,
  StatusWilayahAbsensi,
} from '../../shared/types.ts';
import { haversineMeters } from './resolver.ts';

interface RegionRow {
  id: number;
  kode: string;
  nama: string;
  kota_kabupaten: string;
  provinsi: string;
  aktif: number;
  polygon_geojson: string | null;
}

interface OfficeRow {
  id: number;
  kode: string;
  nama: string;
  alamat: string;
  lat: number;
  lng: number;
  radius_meter: number;
  aktif: number;
  wilayah_id: number | null;
}

export interface AllowedOfficeEvaluation {
  id: number;
  kode: string;
  nama: string;
  radius_meter: number;
  jarak_meter: number | null;
  dalam_geofence: boolean;
}

export interface AttendanceLocationEvaluation {
  allowed: boolean;
  errorMessage: string | null;
  statusWilayah: StatusWilayahAbsensi;
  dalamGeofence: boolean;
  geofenceExempted: boolean;
  alasanPengecualianGeofence: string | null;
  wajibDiKantor: boolean;
  jarakKantorMeter: number | null;
  wilayahPenempatanId: number | null;
  wilayahPenempatanNama: string | null;
  wilayahTerdeteksiId: number | null;
  wilayahTerdeteksiNama: string | null;
  cakupanLokasi: CakupanLokasiAbsensi | null;
  kantorValidasiId: number | null;
  kantorValidasiNama: string | null;
  kantorValidasiRadius: number | null;
  allowedOffices: AllowedOfficeEvaluation[];
  configWarning: string | null;
  lokasiAnomaliCatatan: string | null;
  snapshotJson: string;
}

export function getEmployeeAllowedOfficeIds(db: DatabaseSync, karyawanId: number): number[] {
  const rows = db
    .prepare(
      `SELECT kki.kantor_id
       FROM karyawan_kantor_izin kki
       JOIN kantor kt ON kt.id = kki.kantor_id
       WHERE kki.karyawan_id = ?
       ORDER BY kt.id ASC`
    )
    .all(karyawanId) as { kantor_id: number }[];
  return rows.map((r) => Number(r.kantor_id));
}

export function computeEmployeePlacementStatus(params: {
  role?: string | null;
  wilayah_penempatan_id?: number | null;
  wilayah_aktif?: number | null;
  wilayah_polygon_geojson?: string | null;
  cakupan_lokasi_absensi?: CakupanLokasiAbsensi | string | null;
  valid_allowed_office_count?: number;
}): StatusPenempatanKaryawan {
  if (params.role === 'ADMIN' || params.role === 'SUPERADMIN') {
    return 'TIDAK_DIPERLUKAN';
  }
  if (!params.wilayah_penempatan_id) {
    return 'WILAYAH_BELUM_DIISI';
  }
  if (Number(params.wilayah_aktif ?? 0) !== 1) {
    return 'POLYGON_WILAYAH_BELUM_LENGKAP';
  }
  const poly = validateRegionPolygonGeoJson(params.wilayah_polygon_geojson);
  if (!poly.valid) {
    return 'POLYGON_WILAYAH_BELUM_LENGKAP';
  }
  if (params.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' && (params.valid_allowed_office_count ?? 0) === 0) {
    return 'KANTOR_TERTENTU_KOSONG';
  }
  return 'LENGKAP';
}

export function evaluateAttendanceLocation(
  db: DatabaseSync,
  params: {
    employee: Karyawan;
    lat: number | null | undefined;
    lng: number | null | undefined;
    accuracyMeter: number | null | undefined;
    sessionNumber: number;
    aturanLokasi: AttendanceLocationRule;
    wajibGpsAbsensi: boolean;
  }
): AttendanceLocationEvaluation {
  const { employee, lat, lng, accuracyMeter, sessionNumber, aturanLokasi, wajibGpsAbsensi } = params;

  const hasValidCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  const hasValidAccuracy =
    typeof accuracyMeter === 'number' &&
    Number.isFinite(accuracyMeter) &&
    accuracyMeter >= 0;

  const accuracyAcceptable = hasValidAccuracy ? isGpsAccuracyAcceptable(accuracyMeter!) : false;
  const wajibDiKantor =
    wajibGpsAbsensi && requiresOfficeGeofence(aturanLokasi, sessionNumber);

  const primaryOffice = db
    .prepare(`SELECT id, kode, nama, alamat, lat, lng, radius_meter, aktif, wilayah_id FROM kantor WHERE id = ?`)
    .get(employee.kantor_id) as OfficeRow | undefined;

  const placementRegionId = employee.wilayah_penempatan_id ? Number(employee.wilayah_penempatan_id) : null;
  const placementRegion = placementRegionId
    ? (db
        .prepare(
          `SELECT id, kode, nama, kota_kabupaten, provinsi, aktif, polygon_geojson
           FROM wilayah_operasional WHERE id = ?`
        )
        .get(placementRegionId) as RegionRow | undefined)
    : undefined;

  const cakupan: CakupanLokasiAbsensi | null =
    employee.cakupan_lokasi_absensi === 'KANTOR_TERTENTU'
      ? 'KANTOR_TERTENTU'
      : placementRegionId
        ? 'SEMUA_KANTOR_DALAM_WILAYAH'
        : null;

  // Detect any anomaly indicators honestly (without claiming absolute anti-fake-GPS)
  const anomalyNotes: string[] = [];
  if (hasValidCoords && lat === 0 && lng === 0) {
    anomalyNotes.push('Koordinat GPS berada di titik nol (0, 0).');
  }
  if (hasValidAccuracy && accuracyMeter! > 500) {
    anomalyNotes.push(`Akurasi GPS rendah (±${Math.ceil(accuracyMeter!)}m).`);
  }
  const lokasiAnomaliCatatan = anomalyNotes.length > 0 ? anomalyNotes.join(' ') : null;

  const buildResult = (partial: Omit<AttendanceLocationEvaluation, 'snapshotJson' | 'lokasiAnomaliCatatan'>): AttendanceLocationEvaluation => {
    const snapshotObj = {
      statusWilayah: partial.statusWilayah,
      wilayahPenempatanId: partial.wilayahPenempatanId,
      wilayahPenempatanNama: partial.wilayahPenempatanNama,
      wilayahTerdeteksiId: partial.wilayahTerdeteksiId,
      wilayahTerdeteksiNama: partial.wilayahTerdeteksiNama,
      cakupanLokasi: partial.cakupanLokasi,
      kantorValidasiId: partial.kantorValidasiId,
      kantorValidasiNama: partial.kantorValidasiNama,
      kantorValidasiRadius: partial.kantorValidasiRadius,
      dalamGeofence: partial.dalamGeofence,
      geofenceExempted: partial.geofenceExempted,
      alasanPengecualianGeofence: partial.alasanPengecualianGeofence,
      wajibDiKantor: partial.wajibDiKantor,
      jarakKantorMeter: partial.jarakKantorMeter,
      aturanLokasi,
      lokasiAnomaliCatatan,
    };
    return {
      ...partial,
      lokasiAnomaliCatatan,
      snapshotJson: JSON.stringify(snapshotObj),
    };
  };

  // Missing GPS coordinates or accuracy when GPS is mandatory
  if (wajibGpsAbsensi && !hasValidCoords) {
    return buildResult({
      allowed: false,
      errorMessage: 'Lokasi GPS wajib tersedia dan valid. Absensi tidak dapat dilakukan tanpa koordinat GPS.',
      statusWilayah: 'GPS_TIDAK_TERSEDIA',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor,
      jarakKantorMeter: null,
      wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
      wilayahPenempatanNama: placementRegion?.nama ?? null,
      wilayahTerdeteksiId: null,
      wilayahTerdeteksiNama: null,
      cakupanLokasi: cakupan,
      kantorValidasiId: null,
      kantorValidasiNama: null,
      kantorValidasiRadius: null,
      allowedOffices: [],
      configWarning: null,
    });
  }

  if (wajibGpsAbsensi && !hasValidAccuracy) {
    return buildResult({
      allowed: false,
      errorMessage: 'Informasi akurasi lokasi tidak tersedia. Aktifkan layanan lokasi perangkat dan coba kembali.',
      statusWilayah: 'GPS_TIDAK_TERSEDIA',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor,
      jarakKantorMeter: null,
      wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
      wilayahPenempatanNama: placementRegion?.nama ?? null,
      wilayahTerdeteksiId: null,
      wilayahTerdeteksiNama: null,
      cakupanLokasi: cakupan,
      kantorValidasiId: null,
      kantorValidasiNama: null,
      kantorValidasiRadius: null,
      allowedOffices: [],
      configWarning: null,
    });
  }

  if (!hasValidCoords) {
    // GPS not required by global system setting and no coordinates provided
    return buildResult({
      allowed: true,
      errorMessage: null,
      statusWilayah: 'GPS_TIDAK_TERSEDIA',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor: false,
      jarakKantorMeter: null,
      wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
      wilayahPenempatanNama: placementRegion?.nama ?? null,
      wilayahTerdeteksiId: null,
      wilayahTerdeteksiNama: null,
      cakupanLokasi: cakupan,
      kantorValidasiId: null,
      kantorValidasiNama: null,
      kantorValidasiRadius: null,
      allowedOffices: [],
      configWarning: null,
    });
  }

  // Detect active operational region containing the GPS point
  const activeRegions = db
    .prepare(
      `SELECT id, kode, nama, kota_kabupaten, provinsi, aktif, polygon_geojson
       FROM wilayah_operasional
       WHERE aktif = 1 AND polygon_geojson IS NOT NULL`
    )
    .all() as unknown as RegionRow[];

  let detectedRegion: RegionRow | null = null;
  for (const reg of activeRegions) {
    const val = validateRegionPolygonGeoJson(reg.polygon_geojson);
    if (val.valid && val.geometry && isPointInRegionGeometry(lat!, lng!, val.geometry)) {
      detectedRegion = reg;
      if (placementRegion && reg.id === placementRegion.id) {
        break; // Prefer employee's placement region if polygons overlap
      }
    }
  }

  // Helper to evaluate a list of candidate offices
  const evaluateOffices = (offices: OfficeRow[]) => {
    const evaluations: AllowedOfficeEvaluation[] = offices.map((o) => {
      const dist = haversineMeters(lat!, lng!, o.lat, o.lng);
      const inGeo =
        accuracyAcceptable &&
        isWithinVerifiedGeofence(dist, accuracyMeter!, o.radius_meter);
      return {
        id: o.id,
        kode: o.kode,
        nama: o.nama,
        radius_meter: o.radius_meter,
        jarak_meter: dist,
        dalam_geofence: inGeo,
      };
    });
    evaluations.sort((a, b) => (a.jarak_meter ?? Infinity) - (b.jarak_meter ?? Infinity));
    const matched = evaluations.find((e) => e.dalam_geofence) ?? null;
    const nearest = evaluations[0] ?? null;
    return { evaluations, matched, nearest };
  };

  // CASE A: Placement region missing OR inactive OR polygon missing/invalid
  // CRITICAL: NEVER grant automatic out-of-region geofence exemption!
  const placementPolyCheck = placementRegion && placementRegion.aktif === 1
    ? validateRegionPolygonGeoJson(placementRegion.polygon_geojson)
    : null;

  if (!placementRegionId || !placementRegion || placementRegion.aktif !== 1 || !placementPolyCheck?.valid || !placementPolyCheck.geometry) {
    const statusWilayah: StatusWilayahAbsensi = !placementRegionId
      ? 'BELUM_TERKONFIGURASI'
      : 'POLYGON_BELUM_LENGKAP';

    const configWarning = !placementRegionId
      ? 'Wilayah penempatan akun Anda belum dikonfigurasi oleh Admin. Pengecualian geofence luar wilayah tidak aktif; absensi tetap divalidasi terhadap kantor terdaftar.'
      : placementRegion && placementRegion.aktif !== 1
        ? `Wilayah penempatan (${placementRegion.nama}) sedang nonaktif. Pengecualian geofence luar wilayah tidak aktif; absensi divalidasi terhadap kantor terdaftar.`
        : `Batas wilayah operasional (${placementRegion?.nama || 'Wilayah'}) belum lengkap/valid. Pengecualian geofence luar wilayah tidak aktif; absensi divalidasi terhadap kantor terdaftar.`;

    if (!primaryOffice) {
      return buildResult({
        allowed: false,
        errorMessage: 'Lokasi kantor karyawan tidak ditemukan. Hubungi Admin.',
        statusWilayah,
        dalamGeofence: false,
        geofenceExempted: false,
        alasanPengecualianGeofence: null,
        wajibDiKantor,
        jarakKantorMeter: null,
        wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
        wilayahPenempatanNama: placementRegion?.nama ?? null,
        wilayahTerdeteksiId: detectedRegion?.id ?? null,
        wilayahTerdeteksiNama: detectedRegion?.nama ?? null,
        cakupanLokasi: cakupan,
        kantorValidasiId: null,
        kantorValidasiNama: null,
        kantorValidasiRadius: null,
        allowedOffices: [],
        configWarning,
      });
    }

    const { evaluations, matched, nearest } = evaluateOffices([primaryOffice]);
    if (wajibDiKantor && !accuracyAcceptable) {
      return buildResult({
        allowed: false,
        errorMessage: `Sesi ini wajib dilakukan di kantor. Akurasi GPS harus maksimal ±${MAX_GPS_ACCURACY_METERS}m; hasil saat ini ±${Math.ceil(accuracyMeter!)}m. Aktifkan lokasi presisi atau gunakan perangkat GPS yang lebih akurat.`,
        statusWilayah,
        dalamGeofence: false,
        geofenceExempted: false,
        alasanPengecualianGeofence: null,
        wajibDiKantor,
        jarakKantorMeter: nearest?.jarak_meter ?? null,
        wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
        wilayahPenempatanNama: placementRegion?.nama ?? null,
        wilayahTerdeteksiId: detectedRegion?.id ?? null,
        wilayahTerdeteksiNama: detectedRegion?.nama ?? null,
        cakupanLokasi: cakupan,
        kantorValidasiId: primaryOffice.id,
        kantorValidasiNama: primaryOffice.nama,
        kantorValidasiRadius: primaryOffice.radius_meter,
        allowedOffices: evaluations,
        configWarning,
      });
    }

    if (wajibDiKantor && !matched) {
      return buildResult({
        allowed: false,
        errorMessage: `Absensi ditolak. Sesi ${sessionNumber} wajib berada di kantor (${primaryOffice.nama}). Jarak titik GPS ${nearest?.jarak_meter ?? 0}m dengan estimasi akurasi ±${Math.ceil(accuracyMeter!)}m belum dapat dipastikan di dalam radius kantor ${primaryOffice.radius_meter}m.`,
        statusWilayah,
        dalamGeofence: false,
        geofenceExempted: false,
        alasanPengecualianGeofence: null,
        wajibDiKantor,
        jarakKantorMeter: nearest?.jarak_meter ?? null,
        wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
        wilayahPenempatanNama: placementRegion?.nama ?? null,
        wilayahTerdeteksiId: detectedRegion?.id ?? null,
        wilayahTerdeteksiNama: detectedRegion?.nama ?? null,
        cakupanLokasi: cakupan,
        kantorValidasiId: primaryOffice.id,
        kantorValidasiNama: primaryOffice.nama,
        kantorValidasiRadius: primaryOffice.radius_meter,
        allowedOffices: evaluations,
        configWarning,
      });
    }

    return buildResult({
      allowed: true,
      errorMessage: null,
      statusWilayah,
      dalamGeofence: Boolean(matched),
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor,
      jarakKantorMeter: nearest?.jarak_meter ?? null,
      wilayahPenempatanId: placementRegion?.id ?? placementRegionId,
      wilayahPenempatanNama: placementRegion?.nama ?? null,
      wilayahTerdeteksiId: detectedRegion?.id ?? null,
      wilayahTerdeteksiNama: detectedRegion?.nama ?? null,
      cakupanLokasi: cakupan,
      kantorValidasiId: matched ? matched.id : primaryOffice.id,
      kantorValidasiNama: matched ? matched.nama : primaryOffice.nama,
      kantorValidasiRadius: matched ? matched.radius_meter : primaryOffice.radius_meter,
      allowedOffices: evaluations,
      configWarning,
    });
  }

  // CASE B: Valid placement region with valid polygon -> check Point-in-Polygon
  const isInsidePlacementRegion = isPointInRegionGeometry(lat!, lng!, placementPolyCheck.geometry);

  if (!isInsidePlacementRegion) {
    // AUTOMATIC GEOFENCE EXEMPTION (OUTSIDE PLACEMENT REGION)
    // GPS, selfie, server time, session window, and activity rules remain strictly enforced by caller.
    const refDistance = primaryOffice
      ? haversineMeters(lat!, lng!, primaryOffice.lat, primaryOffice.lng)
      : null;

    const reason = detectedRegion
      ? `Lokasi berada di luar wilayah operasional penempatan (${placementRegion.nama}), terdeteksi di wilayah ${detectedRegion.nama}. Geofence kantor tidak diwajibkan secara otomatis.`
      : `Lokasi berada di luar wilayah operasional penempatan (${placementRegion.nama}). Geofence kantor tidak diwajibkan secara otomatis.`;

    return buildResult({
      allowed: true,
      errorMessage: null,
      statusWilayah: 'DI_LUAR_WILAYAH',
      dalamGeofence: false,
      geofenceExempted: true,
      alasanPengecualianGeofence: reason,
      wajibDiKantor: false,
      jarakKantorMeter: refDistance,
      wilayahPenempatanId: placementRegion.id,
      wilayahPenempatanNama: placementRegion.nama,
      wilayahTerdeteksiId: detectedRegion?.id ?? null,
      wilayahTerdeteksiNama: detectedRegion?.nama ?? null,
      cakupanLokasi: cakupan,
      kantorValidasiId: null,
      kantorValidasiNama: null,
      kantorValidasiRadius: null,
      allowedOffices: [],
      configWarning: null,
    });
  }

  // CASE C: INSIDE placement region -> enforce office coverage mode (SEMUA_KANTOR_DALAM_WILAYAH vs KANTOR_TERTENTU)
  const effectiveCakupan: CakupanLokasiAbsensi = cakupan || 'SEMUA_KANTOR_DALAM_WILAYAH';
  let candidateOffices: OfficeRow[] = [];

  if (effectiveCakupan === 'KANTOR_TERTENTU') {
    candidateOffices = db
      .prepare(
        `SELECT kt.id, kt.kode, kt.nama, kt.alamat, kt.lat, kt.lng, kt.radius_meter, kt.aktif, kt.wilayah_id
         FROM karyawan_kantor_izin kki
         JOIN kantor kt ON kt.id = kki.kantor_id
         WHERE kki.karyawan_id = ? AND kt.aktif = 1 AND kt.wilayah_id = ?
         ORDER BY kt.id ASC`
      )
      .all(employee.id, placementRegion.id) as unknown as OfficeRow[];
  } else {
    candidateOffices = db
      .prepare(
        `SELECT id, kode, nama, alamat, lat, lng, radius_meter, aktif, wilayah_id
         FROM kantor
         WHERE aktif = 1 AND wilayah_id = ?
         ORDER BY id ASC`
      )
      .all(placementRegion.id) as unknown as OfficeRow[];
  }

  if (candidateOffices.length === 0) {
    const emptyMsg =
      effectiveCakupan === 'KANTOR_TERTENTU'
        ? `Konfigurasi cakupan kantor tertentu untuk akun Anda di wilayah ${placementRegion.nama} belum lengkap (belum ada kantor aktif yang diizinkan). Hubungi Admin.`
        : `Belum ada kantor aktif yang terdaftar di wilayah operasional ${placementRegion.nama}. Hubungi Admin.`;

    if (wajibDiKantor) {
      return buildResult({
        allowed: false,
        errorMessage: emptyMsg,
        statusWilayah: 'DI_DALAM_WILAYAH',
        dalamGeofence: false,
        geofenceExempted: false,
        alasanPengecualianGeofence: null,
        wajibDiKantor,
        jarakKantorMeter: primaryOffice ? haversineMeters(lat!, lng!, primaryOffice.lat, primaryOffice.lng) : null,
        wilayahPenempatanId: placementRegion.id,
        wilayahPenempatanNama: placementRegion.nama,
        wilayahTerdeteksiId: detectedRegion?.id ?? placementRegion.id,
        wilayahTerdeteksiNama: detectedRegion?.nama ?? placementRegion.nama,
        cakupanLokasi: effectiveCakupan,
        kantorValidasiId: null,
        kantorValidasiNama: null,
        kantorValidasiRadius: null,
        allowedOffices: [],
        configWarning: emptyMsg,
      });
    }

    return buildResult({
      allowed: true,
      errorMessage: null,
      statusWilayah: 'DI_DALAM_WILAYAH',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor: false,
      jarakKantorMeter: primaryOffice ? haversineMeters(lat!, lng!, primaryOffice.lat, primaryOffice.lng) : null,
      wilayahPenempatanId: placementRegion.id,
      wilayahPenempatanNama: placementRegion.nama,
      wilayahTerdeteksiId: detectedRegion?.id ?? placementRegion.id,
      wilayahTerdeteksiNama: detectedRegion?.nama ?? placementRegion.nama,
      cakupanLokasi: effectiveCakupan,
      kantorValidasiId: null,
      kantorValidasiNama: null,
      kantorValidasiRadius: null,
      allowedOffices: [],
      configWarning: emptyMsg,
    });
  }

  const { evaluations, matched, nearest } = evaluateOffices(candidateOffices);

  if (wajibDiKantor && !accuracyAcceptable) {
    return buildResult({
      allowed: false,
      errorMessage: `Anda berada di dalam wilayah operasional ${placementRegion.nama}. Sesi ini wajib dilakukan di kantor yang diizinkan dengan akurasi GPS maksimal ±${MAX_GPS_ACCURACY_METERS}m (hasil saat ini ±${Math.ceil(accuracyMeter!)}m).`,
      statusWilayah: 'DI_DALAM_WILAYAH',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor,
      jarakKantorMeter: nearest?.jarak_meter ?? null,
      wilayahPenempatanId: placementRegion.id,
      wilayahPenempatanNama: placementRegion.nama,
      wilayahTerdeteksiId: detectedRegion?.id ?? placementRegion.id,
      wilayahTerdeteksiNama: detectedRegion?.nama ?? placementRegion.nama,
      cakupanLokasi: effectiveCakupan,
      kantorValidasiId: nearest?.id ?? null,
      kantorValidasiNama: nearest?.nama ?? null,
      kantorValidasiRadius: nearest?.radius_meter ?? null,
      allowedOffices: evaluations,
      configWarning: null,
    });
  }

  if (wajibDiKantor && !matched) {
    const scopeLabel =
      effectiveCakupan === 'KANTOR_TERTENTU'
        ? `kantor yang diizinkan (${candidateOffices.map((o) => o.nama).join(', ')})`
        : `kantor aktif di wilayah ${placementRegion.nama}`;
    return buildResult({
      allowed: false,
      errorMessage: `Absensi ditolak. Anda berada di dalam wilayah ${placementRegion.nama}, sehingga Sesi ${sessionNumber} wajib berada di dalam radius ${scopeLabel}. Kantor terdekat yang diizinkan: ${nearest?.nama ?? '-'} (jarak ${nearest?.jarak_meter ?? 0}m, akurasi ±${Math.ceil(accuracyMeter!)}m, batas radius ${nearest?.radius_meter ?? 0}m).`,
      statusWilayah: 'DI_DALAM_WILAYAH',
      dalamGeofence: false,
      geofenceExempted: false,
      alasanPengecualianGeofence: null,
      wajibDiKantor,
      jarakKantorMeter: nearest?.jarak_meter ?? null,
      wilayahPenempatanId: placementRegion.id,
      wilayahPenempatanNama: placementRegion.nama,
      wilayahTerdeteksiId: detectedRegion?.id ?? placementRegion.id,
      wilayahTerdeteksiNama: detectedRegion?.nama ?? placementRegion.nama,
      cakupanLokasi: effectiveCakupan,
      kantorValidasiId: nearest?.id ?? null,
      kantorValidasiNama: nearest?.nama ?? null,
      kantorValidasiRadius: nearest?.radius_meter ?? null,
      allowedOffices: evaluations,
      configWarning: null,
    });
  }

  return buildResult({
    allowed: true,
    errorMessage: null,
    statusWilayah: 'DI_DALAM_WILAYAH',
    dalamGeofence: Boolean(matched),
    geofenceExempted: false,
    alasanPengecualianGeofence: null,
    wajibDiKantor,
    jarakKantorMeter: matched ? matched.jarak_meter : nearest?.jarak_meter ?? null,
    wilayahPenempatanId: placementRegion.id,
    wilayahPenempatanNama: placementRegion.nama,
    wilayahTerdeteksiId: detectedRegion?.id ?? placementRegion.id,
    wilayahTerdeteksiNama: detectedRegion?.nama ?? placementRegion.nama,
    cakupanLokasi: effectiveCakupan,
    kantorValidasiId: matched ? matched.id : null,
    kantorValidasiNama: matched ? matched.nama : null,
    kantorValidasiRadius: matched ? matched.radius_meter : null,
    allowedOffices: evaluations,
    configWarning: null,
  });
}
