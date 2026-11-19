import type { DatabaseSync } from 'node:sqlite';
import type {
  AbsensiSesiRecord,
  DayStatusType,
  HariLibur,
  KalenderKerja,
  Karyawan,
  KebijakanAbsensi,
  KerjaKhusus,
  MonthlySummary,
  OperationalStatus,
  OverrideKehadiran,
  PayrollStatus,
  Pengajuan,
  PolicyLevel,
  ResolvedDay,
  SesiConfig,
  WorkforceMember,
} from '../../shared/types.ts';
import {
  getDayOfWeekFromYmd,
  getMonthDays,
  getWibDateString,
  getWibMinutesNow,
  parseHmToMinutes,
} from '../time.ts';

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function buildDefaultSessionsForCount(count: number): SesiConfig[] {
  if (count === 2) {
    return [
      { urutan: 1, nama: 'Sesi 1 · Masuk', jam_mulai: '08:00', jam_selesai: '10:30', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
      { urutan: 2, nama: 'Sesi 2 · Pulang', jam_mulai: '10:30', jam_selesai: '13:00', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
    ];
  }
  if (count === 3) {
    return [
      { urutan: 1, nama: 'Sesi 1 · Masuk Pagi', jam_mulai: '08:00', jam_selesai: '09:30', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
      { urutan: 2, nama: 'Sesi 2 · Aktivitas / Standby', jam_mulai: '12:00', jam_selesai: '14:30', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
      { urutan: 3, nama: 'Sesi 3 · Pulang Kerja', jam_mulai: '16:30', jam_selesai: '19:30', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
    ];
  }
  return [
    { urutan: 1, nama: 'Sesi 1 · Masuk Pagi', jam_mulai: '08:00', jam_selesai: '09:30', wajib_foto: 1, wajib_aktivitas: 0, aktif: 1 },
    { urutan: 2, nama: 'Sesi 2 · Progres Siang', jam_mulai: '11:30', jam_selesai: '13:30', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
    { urutan: 3, nama: 'Sesi 3 · Progres Sore', jam_mulai: '15:00', jam_selesai: '16:30', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
    { urutan: 4, nama: 'Sesi 4 · Pulang Kerja', jam_mulai: '17:00', jam_selesai: '20:00', wajib_foto: 1, wajib_aktivitas: 1, aktif: 1 },
  ];
}

export function getEffectivePolicy(
  db: DatabaseSync,
  karyawan: Karyawan,
  tanggal: string
): KebijakanAbsensi & { sesiList: SesiConfig[] } {
  // Priority: KARYAWAN -> BIDANG -> DEFAULT, effective <= tanggal
  const empPolicy = db
    .prepare(
      `SELECT * FROM kebijakan_absensi
       WHERE aktif = 1 AND level = 'KARYAWAN' AND karyawan_id = ? AND berlaku_mulai <= ?
       ORDER BY berlaku_mulai DESC, id DESC LIMIT 1`
    )
    .get(karyawan.id, tanggal) as KebijakanAbsensi | undefined;

  const bidangPolicy = !empPolicy
    ? (db
        .prepare(
          `SELECT * FROM kebijakan_absensi
           WHERE aktif = 1 AND level = 'BIDANG' AND bidang_id = ? AND berlaku_mulai <= ?
           ORDER BY berlaku_mulai DESC, id DESC LIMIT 1`
        )
        .get(karyawan.bidang_id, tanggal) as KebijakanAbsensi | undefined)
    : undefined;

  const defaultPolicy =
    !empPolicy && !bidangPolicy
      ? (db
          .prepare(
            `SELECT * FROM kebijakan_absensi
             WHERE aktif = 1 AND level = 'DEFAULT' AND berlaku_mulai <= ?
             ORDER BY berlaku_mulai DESC, id DESC LIMIT 1`
          )
          .get(tanggal) as KebijakanAbsensi | undefined)
      : undefined;

  const fallbackAny = (empPolicy ||
    bidangPolicy ||
    defaultPolicy ||
    db.prepare(`SELECT * FROM kebijakan_absensi WHERE aktif = 1 ORDER BY id ASC LIMIT 1`).get()) as unknown as KebijakanAbsensi;

  const sesiList = db
    .prepare(
      `SELECT * FROM sesi_absensi WHERE kebijakan_id = ? AND aktif = 1 ORDER BY urutan ASC`
    )
    .all(fallbackAny.id) as unknown as SesiConfig[];

  return {
    ...fallbackAny,
    sesiList: sesiList.length > 0 ? sesiList : buildDefaultSessionsForCount(fallbackAny.jumlah_sesi),
  };
}

export function resolveDayForEmployee(
  db: DatabaseSync,
  karyawan: Karyawan,
  tanggal: string
): ResolvedDay {
  const today = getWibDateString();
  const dow = getDayOfWeekFromYmd(tanggal);
  const basePolicy = getEffectivePolicy(db, karyawan, tanggal);

  // Check Special Work
  const kerjaKhusus = db
    .prepare(
      `SELECT * FROM penugasan_kerja_khusus
       WHERE karyawan_id = ? AND tanggal = ? AND status != 'DIBATALKAN' LIMIT 1`
    )
    .get(karyawan.id, tanggal) as KerjaKhusus | undefined;

  // Check Office Calendar for day of week
  const calDay = db
    .prepare(`SELECT * FROM kalender_kerja WHERE kantor_id = ? AND hari_minggu = ? LIMIT 1`)
    .get(karyawan.kantor_id, dow) as KalenderKerja | undefined;

  // Check Company Holiday (specific office OR all offices)
  const holiday = db
    .prepare(
      `SELECT * FROM hari_libur
       WHERE tanggal = ? AND (kantor_id = ? OR kantor_id IS NULL)
       ORDER BY kantor_id DESC LIMIT 1`
    )
    .get(tanggal, karyawan.kantor_id) as HariLibur | undefined;

  // Check Approved Request overlapping this date
  const approvedRequest = db
    .prepare(
      `SELECT p.*, hop.tanggal_kerja_sumber, hop.nama_project as nama_project_sumber
       FROM pengajuan p
       LEFT JOIN hak_off_pengganti hop ON p.hak_off_id = hop.id
       WHERE p.karyawan_id = ? AND p.status = 'APPROVED'
         AND p.tanggal_mulai <= ? AND p.tanggal_akhir >= ?
       ORDER BY p.id DESC LIMIT 1`
    )
    .get(karyawan.id, tanggal, tanggal) as Pengajuan | undefined;

  // Check Active Override
  const override = db
    .prepare(
      `SELECT o.*, u.username as admin_nama
       FROM override_kehadiran o
       LEFT JOIN pengguna u ON o.admin_id = u.id
       WHERE o.karyawan_id = ? AND o.tanggal = ? AND o.aktif = 1
       ORDER BY o.id DESC LIMIT 1`
    )
    .get(karyawan.id, tanggal) as OverrideKehadiran | undefined;

  // Attendance Session Records
  const sessionRows = db
    .prepare(
      `SELECT * FROM absensi_sesi
       WHERE karyawan_id = ? AND tanggal = ?
       ORDER BY urutan_sesi ASC`
    )
    .all(karyawan.id, tanggal) as unknown as AbsensiSesiRecord[];

  const sessionRecords = sessionRows.map((r) => ({
    ...r,
    has_foto: Boolean(r.foto_path),
  }));

  // Determine active policy snapshot for this specific day
  let jumlahSesi = basePolicy.jumlah_sesi;
  let minSesiHadir = basePolicy.min_sesi_hadir;
  let policyLevel: PolicyLevel | 'KERJA_KHUSUS' | 'KALENDER_KHUSUS' = basePolicy.level;
  let policyName = basePolicy.nama;
  let sesiList = basePolicy.sesiList;

  if (kerjaKhusus) {
    jumlahSesi = kerjaKhusus.jumlah_sesi;
    minSesiHadir = kerjaKhusus.min_sesi_hadir;
    policyLevel = 'KERJA_KHUSUS';
    policyName = `Kerja Khusus: ${kerjaKhusus.nama_project}`;
    sesiList = buildDefaultSessionsForCount(kerjaKhusus.jumlah_sesi);
  } else if (calDay?.jumlah_sesi_khusus && calDay.status_hari === 'HARI_KERJA') {
    jumlahSesi = calDay.jumlah_sesi_khusus;
    minSesiHadir = Math.min(minSesiHadir, calDay.jumlah_sesi_khusus);
    policyLevel = 'KALENDER_KHUSUS';
    policyName = calDay.keterangan || `Kalender Khusus (${calDay.jumlah_sesi_khusus} Sesi)`;
    sesiList = buildDefaultSessionsForCount(calDay.jumlah_sesi_khusus);
  }

  const sessionsCompleted = sessionRecords.length;

  // Determine Day Type & Operational Status
  let dayType: DayStatusType = 'HARI_KERJA';
  let dayLabel = 'Hari Kerja';
  let operationalStatus: OperationalStatus = 'BELUM_SELESAI';
  let payrollStatus: PayrollStatus = 'TIDAK_DIHITUNG_MASUK';
  let payrollSource: ResolvedDay['payrollSource'] = 'BELUM_SELESAI';
  let mustCheckIn = true;

  if (approvedRequest && approvedRequest.jenis === 'OFF_PENGGANTI') {
    dayType = 'OFF_PENGGANTI';
    dayLabel = 'Off Pengganti';
    operationalStatus = 'OFF_PENGGANTI';
    mustCheckIn = false;
    if (basePolicy.off_pengganti_dihitung_masuk) {
      payrollStatus = 'DIHITUNG_MASUK';
      payrollSource = 'OFF_PENGGANTI';
    } else {
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'OFF';
    }
  } else if (kerjaKhusus) {
    dayType = 'KERJA_KHUSUS';
    dayLabel = 'Kerja Khusus';
    mustCheckIn = true;
    if (sessionsCompleted >= minSesiHadir) {
      operationalStatus = 'HADIR';
      payrollStatus = 'DIHITUNG_MASUK';
      payrollSource = 'ABSENSI';
    } else if (tanggal === today && !isEvaluationWindowClosed(sesiList)) {
      operationalStatus = 'BELUM_SELESAI';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'BELUM_SELESAI';
    } else if (tanggal > today) {
      operationalStatus = 'BELUM_SELESAI';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'BELUM_SELESAI';
    } else {
      operationalStatus = 'TIDAK_HADIR';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'TIDAK_HADIR';
    }
  } else if (holiday || calDay?.status_hari === 'HARI_LIBUR') {
    dayType = 'HARI_LIBUR';
    dayLabel = holiday ? `Hari Libur · ${holiday.nama}` : 'Hari Libur Kantor';
    operationalStatus = 'HARI_LIBUR';
    mustCheckIn = false;
    // Company holiday pays if configured; weekly Sunday off only pays if explicitly configured or is company holiday
    if (holiday) {
      if (holiday.dihitung_masuk === 1 && basePolicy.libur_dihitung_masuk === 1) {
        payrollStatus = 'DIHITUNG_MASUK';
        payrollSource = 'LIBUR_DIBAYAR';
      } else {
        payrollStatus = 'TIDAK_DIHITUNG_MASUK';
        payrollSource = 'LIBUR_TIDAK_DIBAYAR';
      }
    } else {
      // Weekly calendar day off (e.g. Minggu Kantor A) - never TIDAK HADIR, not counted as workday
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'LIBUR_TIDAK_DIBAYAR';
    }
  } else if (approvedRequest) {
    dayType = 'HARI_KERJA';
    dayLabel = `Hari Kerja · ${approvedRequest.jenis}`;
    operationalStatus = approvedRequest.jenis as OperationalStatus;
    mustCheckIn = false;
    if (approvedRequest.jenis === 'CUTI') {
      payrollStatus = basePolicy.cuti_dihitung_masuk ? 'DIHITUNG_MASUK' : 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'CUTI';
    } else if (approvedRequest.jenis === 'SAKIT') {
      payrollStatus = basePolicy.sakit_dihitung_masuk ? 'DIHITUNG_MASUK' : 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'SAKIT';
    } else if (approvedRequest.jenis === 'IZIN') {
      payrollStatus = basePolicy.izin_dihitung_masuk ? 'DIHITUNG_MASUK' : 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'IZIN';
    } else {
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'OFF';
    }
  } else {
    dayType = 'HARI_KERJA';
    dayLabel = 'Hari Kerja';
    mustCheckIn = true;
    if (sessionsCompleted >= minSesiHadir) {
      operationalStatus = 'HADIR';
      payrollStatus = 'DIHITUNG_MASUK';
      payrollSource = 'ABSENSI';
    } else if (tanggal === today && !isEvaluationWindowClosed(sesiList)) {
      operationalStatus = 'BELUM_SELESAI';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'BELUM_SELESAI';
    } else if (tanggal > today) {
      operationalStatus = 'BELUM_SELESAI';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'BELUM_SELESAI';
    } else {
      operationalStatus = 'TIDAK_HADIR';
      payrollStatus = 'TIDAK_DIHITUNG_MASUK';
      payrollSource = 'TIDAK_HADIR';
    }
  }

  // Apply Admin Override strictly to final Payroll result (never mutates original attendance proof)
  if (override) {
    payrollStatus = override.hasil_override;
    payrollSource = 'OVERRIDE';
  }

  return {
    tanggal,
    karyawanId: karyawan.id,
    dayType,
    dayLabel,
    operationalStatus,
    payrollStatus,
    payrollSource,
    isOverridden: Boolean(override),
    overrideInfo: override ?? null,
    holidayInfo: holiday
      ? { nama: holiday.nama, dihitung_masuk: holiday.dihitung_masuk, keterangan: holiday.keterangan }
      : null,
    kerjaKhususInfo: kerjaKhusus ?? null,
    offPenggantiInfo:
      approvedRequest && approvedRequest.jenis === 'OFF_PENGGANTI'
        ? {
            pengajuanId: approvedRequest.id,
            tanggalKerjaSumber: approvedRequest.tanggal_kerja_sumber || '-',
            namaProject: approvedRequest.nama_project_sumber || 'Kerja Khusus',
          }
        : null,
    pengajuanInfo: approvedRequest ?? null,
    policySnapshot: {
      policyId: basePolicy.id,
      policyName,
      level: policyLevel,
      jumlahSesi,
      minSesiHadir,
      toleransiTerlambatMenit: basePolicy.toleransi_terlambat_menit,
      wajibFotoSemuaSesi: Boolean(basePolicy.wajib_foto_semua_sesi),
      wajibAktivitasSesiLanjut: Boolean(basePolicy.wajib_aktivitas_sesi_lanjut),
      aturanLokasi: basePolicy.aturan_lokasi || 'SESI_PERTAMA_KANTOR',
      sesiList,
    },
    sessionsCompleted,
    sessionsRequired: minSesiHadir,
    sessionRecords,
    mustCheckIn,
  };
}

function isEvaluationWindowClosed(sesiList: SesiConfig[]): boolean {
  if (sesiList.length === 0) return true;
  const lastSesi = sesiList[sesiList.length - 1];
  const nowMinutes = getWibMinutesNow();
  return nowMinutes > parseHmToMinutes(lastSesi.jam_selesai);
}

export function computeMonthlySummary(
  db: DatabaseSync,
  karyawanId: number,
  bulan: string
): MonthlySummary | null {
  const karyawan = db
    .prepare(
      `SELECT k.*, kt.nama as kantor_nama, b.nama as bidang_nama
       FROM karyawan k
       JOIN kantor kt ON k.kantor_id = kt.id
       JOIN bidang_kerja b ON k.bidang_id = b.id
       WHERE k.id = ? AND COALESCE(k.is_system_archive, 0) = 0`
    )
    .get(karyawanId) as Karyawan | undefined;

  if (!karyawan) return null;

  const today = getWibDateString();
  const allDays = getMonthDays(bulan);
  // Evaluate up to today (or entire month if past month)
  const evaluableDays = allDays.filter((d) => d <= today);

  const resolvedDays = evaluableDays.map((d) => resolveDayForEmployee(db, karyawan, d));

  let hariMasuk = 0;
  let tidakHadir = 0;
  let hariKerja = 0;
  let hariLibur = 0;
  let kerjaKhusus = 0;
  let offPengganti = 0;
  let hadirAbsensi = 0;
  let liburDihitungMasuk = 0;
  let offDihitungMasuk = 0;
  let izin = 0;
  let sakit = 0;
  let cuti = 0;
  let offBiasa = 0;
  let terlambat = 0;
  let overrideMasuk = 0;
  let overrideTidakMasuk = 0;

  for (const day of resolvedDays) {
    if (day.dayType === 'HARI_KERJA') hariKerja++;
    if (day.dayType === 'HARI_LIBUR') hariLibur++;
    if (day.dayType === 'KERJA_KHUSUS') kerjaKhusus++;
    if (day.dayType === 'OFF_PENGGANTI') offPengganti++;

    if (day.payrollStatus === 'DIHITUNG_MASUK') {
      hariMasuk++;
    }

    if (day.isOverridden && day.overrideInfo) {
      if (day.overrideInfo.hasil_override === 'DIHITUNG_MASUK') {
        overrideMasuk++;
      } else {
        overrideTidakMasuk++;
        if (day.dayType === 'HARI_KERJA') tidakHadir++;
      }
    } else if (day.operationalStatus === 'TIDAK_HADIR') {
      tidakHadir++;
    }

    if (day.operationalStatus === 'HADIR') hadirAbsensi++;
    if (day.payrollSource === 'LIBUR_DIBAYAR') liburDihitungMasuk++;
    if (day.payrollSource === 'OFF_PENGGANTI') offDihitungMasuk++;
    if (day.operationalStatus === 'IZIN') izin++;
    if (day.operationalStatus === 'SAKIT') sakit++;
    if (day.operationalStatus === 'CUTI') cuti++;
    if (day.operationalStatus === 'OFF') offBiasa++;

    if (day.sessionRecords.some((s) => s.status_ketepatan === 'TERLAMBAT')) {
      terlambat++;
    }
  }

  return {
    bulan,
    karyawanId: karyawan.id,
    karyawanNama: karyawan.nama_lengkap,
    nik: karyawan.nik,
    bidangNama: karyawan.bidang_nama || '',
    kantorNama: karyawan.kantor_nama || '',
    hariMasuk,
    tidakHadir,
    rincian: {
      hariKerja,
      hariLibur,
      kerjaKhusus,
      offPengganti,
      hadirAbsensi,
      liburDihitungMasuk,
      offDihitungMasuk,
      izin,
      sakit,
      cuti,
      offBiasa,
      terlambat,
      overrideMasuk,
      overrideTidakMasuk,
      totalOverride: overrideMasuk + overrideTidakMasuk,
    },
    days: resolvedDays,
  };
}

export function getWorkforceToday(
  db: DatabaseSync,
  kantorId?: number,
  bidangId?: number
): WorkforceMember[] {
  const today = getWibDateString();
  let query = `
    SELECT k.*, kt.nama as kantor_nama, b.nama as bidang_nama
    FROM karyawan k
    JOIN kantor kt ON k.kantor_id = kt.id
    JOIN bidang_kerja b ON k.bidang_id = b.id
    WHERE k.aktif = 1
      AND COALESCE(k.is_system_archive, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM pengguna u_role
        WHERE u_role.karyawan_id = k.id
          AND u_role.role IN ('ADMIN', 'SUPERADMIN')
      )
  `;
  const params: (number | string)[] = [];
  if (kantorId) {
    query += ` AND k.kantor_id = ?`;
    params.push(kantorId);
  }
  if (bidangId) {
    query += ` AND k.bidang_id = ?`;
    params.push(bidangId);
  }
  query += ` ORDER BY k.nama_lengkap ASC`;

  const employees = db.prepare(query).all(...params) as unknown as Karyawan[];

  // Strip all sensitive data (no GPS, no photo path, no private request reason!)
  return employees.map((emp) => {
    const day = resolveDayForEmployee(db, emp, today);
    const s1 = day.sessionRecords.find((s) => s.urutan_sesi === 1) ?? day.sessionRecords[0];
    const last = day.sessionRecords[day.sessionRecords.length - 1];
    const isWorkingToday =
      day.mustCheckIn && (day.sessionsCompleted > 0 || day.operationalStatus === 'BELUM_SELESAI' || day.operationalStatus === 'HADIR');

    return {
      karyawanId: emp.id,
      nik: emp.nik,
      namaLengkap: emp.nama_lengkap,
      jabatan: emp.jabatan,
      bidangId: emp.bidang_id,
      bidangNama: emp.bidang_nama || '',
      kantorId: emp.kantor_id,
      kantorNama: emp.kantor_nama || '',
      dayType: day.dayType,
      operationalStatus: day.operationalStatus,
      sessionsCompleted: day.sessionsCompleted,
      sessionsTotal: day.policySnapshot.jumlahSesi,
      lastSessionTime: last ? last.waktu_server.slice(11, 16) : null,
      isWorkingToday,
      sesi1Time: s1 ? s1.waktu_server.slice(11, 16) : null,
      sesi1Terlambat: s1 ? s1.status_ketepatan === 'TERLAMBAT' : false,
    };
  });
}
