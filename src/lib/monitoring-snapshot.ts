import { buildApiUrl } from './api';
import { formatIndonesianDate } from './attendance-share';
import type { OperationalStatus, WorkforceMember } from '../shared/types';

export interface EarlyReportRow {
  karyawan_id: number;
  nik: string;
  nama_lengkap: string;
  kantor_nama: string;
  bidang_nama: string;
  sesi1_waktu: string | null;
  status_ketepatan: string | null;
  keterlambatan_menit: number | null;
  dalam_geofence: number | null;
}

export interface MonitoringCheckInRow {
  karyawanId: number;
  nik: string;
  namaLengkap: string;
  jabatan: string;
  kantorId?: number;
  kantorNama: string;
  bidangNama: string;
  isWorkingToday: boolean;
  operationalStatus: OperationalStatus;
  sessionsCompleted: number;
  sessionsTotal: number;
  sesi1Time: string | null; // HH:mm
  sesi1Terlambat: boolean;
  keterlambatanMenit: number;
  dalamGeofence: boolean | null;
}

export function buildMonitoringCheckInRows(
  workforce: WorkforceMember[],
  earlyRows: EarlyReportRow[]
): MonitoringCheckInRow[] {
  const earlyByEmp = new Map<number, EarlyReportRow>();
  for (const r of earlyRows) {
    earlyByEmp.set(r.karyawan_id, r);
  }
  return workforce.map((w) => {
    const early = earlyByEmp.get(w.karyawanId);
    const sesi1Time =
      w.sesi1Time || (early?.sesi1_waktu ? early.sesi1_waktu.slice(11, 16) : null);
    const sesi1Terlambat = w.sesi1Terlambat || early?.status_ketepatan === 'TERLAMBAT';
    const keterlambatanMenit = early?.keterlambatan_menit ?? 0;
    const dalamGeofence =
      early && early.dalam_geofence !== null ? Boolean(early.dalam_geofence) : null;

    return {
      karyawanId: w.karyawanId,
      nik: w.nik,
      namaLengkap: w.namaLengkap,
      jabatan: w.jabatan,
      kantorId: w.kantorId,
      kantorNama: w.kantorNama,
      bidangNama: w.bidangNama,
      isWorkingToday: w.isWorkingToday,
      operationalStatus: w.operationalStatus,
      sessionsCompleted: w.sessionsCompleted,
      sessionsTotal: w.sessionsTotal,
      sesi1Time,
      sesi1Terlambat,
      keterlambatanMenit,
      dalamGeofence,
    };
  });
}

export interface MonitoringSnapshotInput {
  tanggal: string; // YYYY-MM-DD (server WIB)
  serverTimeWib: string; // HH:mm or HH:mm:ss (server WIB)
  filterLabel: string; // e.g., "Semua Karyawan · Semua Kantor"
  rows: MonitoringCheckInRow[];
}

export interface OfficeMonitoringGroup {
  officeKey: string;
  officeId: number;
  officeName: string;
  rows: MonitoringCheckInRow[];
  totalKaryawan: number;
  totalWajibKerja: number;
  sudahMasuk: number;
  tepatWaktu: number;
  terlambat: number;
  belumAtauTidakMasuk: number;
  izinAtauLibur: number;
}

const WIDTH = 1080;
const CARD_X = 32;
const CARD_Y = 32;
const CARD_W = WIDTH - CARD_X * 2;
const CONTENT_X = 68;
const CONTENT_W = WIDTH - CONTENT_X * 2;
const ROW_H = 84;
const OFFICE_HEADER_H = 54;
// Safe maximum pixel height across desktop & mobile browsers (including iOS Safari).
const MAX_SAFE_CANVAS_HEIGHT = 14400;

const FONT_SANS =
  '"Plus Jakarta Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const FONT_MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const clean = text.trim();
  if (!clean) return '';
  if (ctx.measureText(clean).width <= maxWidth) return clean;
  let result = clean;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}…`;
}

function shortOfficeName(name: string): string {
  return name.split('(')[0].trim() || name;
}

function formatServerTimeWib(rawTime: string): string {
  const clean = (rawTime || '').trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(clean)) return `${clean} WIB`;
  if (/^\d{2}:\d{2}/.test(clean)) return `${clean.slice(0, 5)} WIB`;
  return '--:-- WIB';
}

function formatNumericShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function drawPinIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 7, Math.PI, 0, false);
  ctx.lineTo(cx, cy + 9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function nonWorkingLabel(status: OperationalStatus): string {
  switch (status) {
    case 'HARI_LIBUR':
      return 'HARI LIBUR';
    case 'OFF_PENGGANTI':
      return 'OFF PENGGANTI';
    case 'CUTI':
      return 'CUTI';
    case 'IZIN':
      return 'IZIN';
    case 'SAKIT':
      return 'SAKIT';
    case 'OFF':
      return 'OFF';
    case 'TIDAK_HADIR':
      return 'TIDAK MASUK';
    default:
      return status.replace(/_/g, ' ');
  }
}

export type EmployeeCheckInCategory =
  | 'CHECKED_IN'
  | 'TIDAK_MASUK'
  | 'BELUM_ABSEN'
  | 'NON_WORKING';

export function classifyCheckInRow(row: MonitoringCheckInRow): EmployeeCheckInCategory {
  if (row.sesi1Time) return 'CHECKED_IN';
  if (row.operationalStatus === 'TIDAK_HADIR') return 'TIDAK_MASUK';
  if (row.isWorkingToday || row.operationalStatus === 'BELUM_SELESAI') return 'BELUM_ABSEN';
  return 'NON_WORKING';
}

/**
 * Sort employees within a group (or globally):
 * 1. Checked-in employees first, ordered by earliest Jam Masuk (Sesi 1)
 * 2. Working employees who haven't checked in yet ("Belum Absen")
 * 3. Absent employees ("Tidak Masuk" / TIDAK_HADIR)
 * 4. Excused / Non-working employees (Sakit, Izin, Cuti, Off, Hari Libur)
 */
export function sortMonitoringCheckInRows(rows: MonitoringCheckInRow[]): MonitoringCheckInRow[] {
  const rankOf = (r: MonitoringCheckInRow) => {
    const cat = classifyCheckInRow(r);
    if (cat === 'CHECKED_IN') return 0;
    if (cat === 'BELUM_ABSEN') return 1;
    if (cat === 'TIDAK_MASUK') return 2;
    return 3;
  };

  return [...rows].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0 && a.sesi1Time && b.sesi1Time) {
      const cmp = a.sesi1Time.localeCompare(b.sesi1Time);
      if (cmp !== 0) return cmp;
    }
    return a.namaLengkap.localeCompare(b.namaLengkap);
  });
}

export function computeMonitoringCheckInStats(rows: MonitoringCheckInRow[]) {
  let totalWajibKerja = 0;
  let sudahMasuk = 0;
  let tepatWaktu = 0;
  let terlambat = 0;
  let belumAbsen = 0;
  let tidakMasuk = 0;
  let tidakWajibKerja = 0;

  for (const r of rows) {
    const cat = classifyCheckInRow(r);
    if (cat === 'CHECKED_IN') {
      totalWajibKerja += 1;
      sudahMasuk += 1;
      if (r.sesi1Terlambat) terlambat += 1;
      else tepatWaktu += 1;
    } else if (cat === 'BELUM_ABSEN') {
      totalWajibKerja += 1;
      belumAbsen += 1;
    } else if (cat === 'TIDAK_MASUK') {
      totalWajibKerja += 1;
      tidakMasuk += 1;
    } else {
      tidakWajibKerja += 1;
    }
  }

  return {
    totalKaryawan: rows.length,
    totalWajibKerja,
    sudahMasuk,
    tepatWaktu,
    terlambat,
    belumAbsen: belumAbsen + tidakMasuk,
    belumAbsenSaja: belumAbsen,
    tidakMasukSaja: tidakMasuk,
    tidakWajibKerja,
  };
}

/**
 * Group ALL employees strictly by office location (Kantor), keeping every single
 * employee — including those who checked in, haven't checked in Sesi 1, did not attend,
 * or are on Sakit/Izin/Cuti/Libur/Off — cleanly organized under their office.
 */
export function groupMonitoringRowsByOffice(
  rows: MonitoringCheckInRow[]
): OfficeMonitoringGroup[] {
  const byOffice = new Map<
    string,
    { officeId: number; officeName: string; rows: MonitoringCheckInRow[] }
  >();

  for (const row of rows) {
    const cleanName = shortOfficeName(row.kantorNama || 'Kantor Lainnya');
    const key =
      typeof row.kantorId === 'number'
        ? `id:${row.kantorId}`
        : `name:${cleanName.toLowerCase()}`;
    const existing = byOffice.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      byOffice.set(key, {
        officeId: row.kantorId ?? Number.MAX_SAFE_INTEGER,
        officeName: cleanName,
        rows: [row],
      });
    }
  }

  const groups: OfficeMonitoringGroup[] = [];
  for (const [officeKey, entry] of byOffice.entries()) {
    const sorted = sortMonitoringCheckInRows(entry.rows);
    const stats = computeMonitoringCheckInStats(sorted);
    groups.push({
      officeKey,
      officeId: entry.officeId,
      officeName: entry.officeName,
      rows: sorted,
      totalKaryawan: stats.totalKaryawan,
      totalWajibKerja: stats.totalWajibKerja,
      sudahMasuk: stats.sudahMasuk,
      tepatWaktu: stats.tepatWaktu,
      terlambat: stats.terlambat,
      belumAtauTidakMasuk: stats.belumAbsen,
      izinAtauLibur: stats.tidakWajibKerja,
    });
  }

  return groups.sort((a, b) => {
    if (a.officeId !== b.officeId) return a.officeId - b.officeId;
    return a.officeName.localeCompare(b.officeName);
  });
}

/**
 * Build a complete WhatsApp/Telegram-ready morning attendance report caption
 * grouped by Office Location (Kantor), capturing EVERY employee including
 * those who have not checked in Sesi 1, Tidak Masuk, or Izin/Sakit/Cuti/Libur.
 */
export function buildMonitoringCheckInCaption(input: MonitoringSnapshotInput): string {
  const groups = groupMonitoringRowsByOffice(input.rows);
  const stats = computeMonitoringCheckInStats(input.rows);
  const dateLabel = formatIndonesianDate(input.tanggal, 'long');
  const timeLabel = formatServerTimeWib(input.serverTimeWib);

  const lines: string[] = [
    '*LAPORAN JAM MASUK HARIAN — ABSENSI BIGNET*',
    `Tanggal: ${dateLabel}`,
    `Waktu Snapshot: ${timeLabel}`,
    `Cakupan: ${input.filterLabel} (${stats.totalKaryawan} karyawan)`,
    '',
    `Ringkasan: ${stats.sudahMasuk}/${stats.totalWajibKerja} Masuk · ${stats.tepatWaktu} Tepat Waktu · ${stats.terlambat} Terlambat · ${stats.belumAbsen} Belum/Tidak Masuk${
      stats.tidakWajibKerja > 0 ? ` · ${stats.tidakWajibKerja} Izin/Libur` : ''
    }`,
  ];

  if (groups.length === 0) {
    lines.push('', 'Belum ada data karyawan pada cakupan ini.');
    return lines.join('\n');
  }

  for (const group of groups) {
    const officeSummaryParts = [`${group.sudahMasuk}/${group.totalWajibKerja} Masuk`];
    if (group.belumAtauTidakMasuk > 0) {
      officeSummaryParts.push(`${group.belumAtauTidakMasuk} Belum/Tdk Masuk`);
    }
    if (group.izinAtauLibur > 0) {
      officeSummaryParts.push(`${group.izinAtauLibur} Izin/Libur`);
    }

    lines.push('', `*📍 ${group.officeName}* (${officeSummaryParts.join(' · ')})`);

    group.rows.forEach((row, index) => {
      const no = String(index + 1).padStart(2, '0');
      const cat = classifyCheckInRow(row);
      if (cat === 'CHECKED_IN' && row.sesi1Time) {
        const statusText = row.sesi1Terlambat
          ? row.keterlambatanMenit > 0
            ? `Terlambat ${row.keterlambatanMenit} mnt`
            : 'Terlambat'
          : 'Tepat Waktu';
        lines.push(`${no}. *${row.sesi1Time} WIB* — ${row.namaLengkap} (${statusText})`);
      } else if (cat === 'TIDAK_MASUK') {
        lines.push(`${no}. *Tidak Masuk* — ${row.namaLengkap} (${row.bidangNama} · Tidak absen sesi 1)`);
      } else if (cat === 'BELUM_ABSEN') {
        lines.push(`${no}. *Belum Absen* — ${row.namaLengkap} (${row.bidangNama} · Belum absen sesi 1)`);
      } else {
        lines.push(
          `${no}. *${nonWorkingLabel(row.operationalStatus)}* — ${row.namaLengkap} (${row.bidangNama})`
        );
      }
    });
  }

  return lines.join('\n');
}

async function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * Generate a complete, tall-friendly high-resolution PNG snapshot of Monitoring Hari Ini
 * grouped BY OFFICE LOCATION (Kantor), capturing EVERY employee — checked-in, Belum Absen
 * Sesi 1, Tidak Masuk, and Sakit/Izin/Cuti/Libur — top-to-bottom with zero truncation.
 */
export async function createMonitoringCheckInImage(
  input: MonitoringSnapshotInput
): Promise<File> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } catch {
      // Safe fallback to system fonts.
    }
  }

  const officeGroups = groupMonitoringRowsByOffice(input.rows);
  const stats = computeMonitoringCheckInStats(input.rows);

  // Compute exact dynamic vertical height so ALL offices & ALL employees fit with zero clipping.
  const headerH = 138;
  const kpiTopGap = 24;
  const kpiH = 98;
  const tableTopGap = 26;
  const tableHeaderH = 48;
  const officeGap = 18;
  const officesBlockH =
    officeGroups.length === 0
      ? tableHeaderH + ROW_H
      : officeGroups.reduce(
          (sum, g, idx) =>
            sum +
            (idx > 0 ? officeGap : 0) +
            OFFICE_HEADER_H +
            tableHeaderH +
            g.rows.length * ROW_H,
          0
        );
  const footerGap = 24;
  const footerH = 62;
  const cardBottomPad = 14;

  const cardH =
    headerH +
    kpiTopGap +
    kpiH +
    tableTopGap +
    officesBlockH +
    footerGap +
    footerH +
    cardBottomPad;
  const logicalHeight = cardH + CARD_Y * 2;

  const renderScale =
    logicalHeight > MAX_SAFE_CANVAS_HEIGHT ? MAX_SAFE_CANVAS_HEIGHT / logicalHeight : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WIDTH * renderScale);
  canvas.height = Math.round(logicalHeight * renderScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pembuatan gambar laporan monitoring.');

  if (renderScale !== 1) {
    ctx.scale(renderScale, renderScale);
  }

  const logo = await loadImageFromUrl(buildApiUrl('/api/v1/assets/logo'));

  // 1. Soft slate canvas background.
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, logicalHeight);
  bgGrad.addColorStop(0, '#f8fafc');
  bgGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, logicalHeight);

  // Main rounded white card with subtle elevation shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, cardH, 30);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, cardH, 30);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 2. Crimson Brand Header Strip.
  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, cardH, 30);
  ctx.clip();
  const headerGrad = ctx.createLinearGradient(CARD_X, CARD_Y, CARD_X + CARD_W, CARD_Y + headerH);
  headerGrad.addColorStop(0, '#c0392b');
  headerGrad.addColorStop(0.55, '#a93226');
  headerGrad.addColorStop(1, '#7b241c');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(CARD_X, CARD_Y, CARD_W, headerH);
  ctx.restore();

  // Logo badge.
  const logoSize = 62;
  const logoX = CONTENT_X;
  const logoY = CARD_Y + 38;
  roundedRect(ctx, logoX, logoY, logoSize, logoSize, 15);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const pad = 7;
    const avail = logoSize - pad * 2;
    const s = Math.min(avail / logo.naturalWidth, avail / logo.naturalHeight);
    const lw = logo.naturalWidth * s;
    const lh = logo.naturalHeight * s;
    ctx.drawImage(logo, logoX + (logoSize - lw) / 2, logoY + (logoSize - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = '#c0392b';
    ctx.font = `800 32px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', logoX + logoSize / 2, logoY + logoSize / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Header right prominent Tanggal & Jam Snapshot box.
  const fullTimeLabel = formatServerTimeWib(input.serverTimeWib);
  const shortDateBadge = formatNumericShortDate(input.tanggal);
  const longDateLabel = formatIndonesianDate(input.tanggal, 'long');

  const stampBoxW = 290;
  const stampBoxH = 92;
  const stampBoxX = CONTENT_X + CONTENT_W - stampBoxW;
  const stampBoxY = CARD_Y + 23;
  roundedRect(ctx, stampBoxX, stampBoxY, stampBoxW, stampBoxH, 16);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fde2df';
  ctx.font = `700 12px ${FONT_SANS}`;
  ctx.fillText('TANGGAL & JAM SNAPSHOT', stampBoxX + stampBoxW - 18, stampBoxY + 24);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 26px ${FONT_MONO}`;
  ctx.fillText(fullTimeLabel, stampBoxX + stampBoxW - 18, stampBoxY + 55);

  ctx.fillStyle = '#fff1f0';
  ctx.font = `600 15px ${FONT_SANS}`;
  ctx.fillText(
    truncateText(ctx, `${shortDateBadge} · ${officeGroups.length} Kantor`, stampBoxW - 32),
    stampBoxX + stampBoxW - 18,
    stampBoxY + 79
  );
  ctx.textAlign = 'left';

  // Header left title & full Indonesian date.
  const titleX = logoX + logoSize + 18;
  const maxHeaderTitleW = stampBoxX - titleX - 24;
  ctx.fillStyle = '#fde2df';
  ctx.font = `700 15px ${FONT_SANS}`;
  ctx.fillText('ABSENSI BIGNET · PER LOKASI KANTOR', titleX, CARD_Y + 44);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 30px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, 'LAPORAN JAM MASUK', maxHeaderTitleW), titleX, CARD_Y + 82);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 18px ${FONT_SANS}`;
  ctx.fillText(
    truncateText(ctx, `${longDateLabel}`, maxHeaderTitleW),
    titleX,
    CARD_Y + 112
  );

  // 3. 4 Summary KPI Cards.
  const kpiY = CARD_Y + headerH + kpiTopGap;
  const kpiGap = 16;
  const kpiCardW = (CONTENT_W - kpiGap * 3) / 4;

  const kpiItems: {
    label: string;
    value: string;
    sub: string;
    bg: string;
    border: string;
    valueColor: string;
    labelColor: string;
  }[] = [
    {
      label: 'SUDAH MASUK',
      value: `${stats.sudahMasuk}`,
      sub: `dari ${stats.totalWajibKerja} wajib kerja`,
      bg: '#f8fafc',
      border: '#cbd5e1',
      valueColor: '#0f172a',
      labelColor: '#475569',
    },
    {
      label: 'TEPAT WAKTU',
      value: `${stats.tepatWaktu}`,
      sub: 'sesuai jadwal sesi 1',
      bg: '#ecfdf5',
      border: '#a7f3d0',
      valueColor: '#047857',
      labelColor: '#065f46',
    },
    {
      label: 'TERLAMBAT',
      value: `${stats.terlambat}`,
      sub: 'melewati toleransi',
      bg: '#fffbeb',
      border: '#fde68a',
      valueColor: '#b45309',
      labelColor: '#92400e',
    },
    {
      label: 'BELUM / TDK MASUK',
      value: `${stats.belumAbsen}`,
      sub:
        stats.tidakWajibKerja > 0
          ? `+ ${stats.tidakWajibKerja} izin/cuti/libur`
          : 'belum absen sesi 1',
      bg: stats.belumAbsen > 0 ? '#fef2f2' : '#f8fafc',
      border: stats.belumAbsen > 0 ? '#fecaca' : '#e2e8f0',
      valueColor: stats.belumAbsen > 0 ? '#c0392b' : '#475569',
      labelColor: stats.belumAbsen > 0 ? '#991b1b' : '#64748b',
    },
  ];

  kpiItems.forEach((kpi, idx) => {
    const x = CONTENT_X + idx * (kpiCardW + kpiGap);
    roundedRect(ctx, x, kpiY, kpiCardW, kpiH, 16);
    ctx.fillStyle = kpi.bg;
    ctx.fill();
    ctx.strokeStyle = kpi.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = kpi.labelColor;
    ctx.font = `700 13px ${FONT_SANS}`;
    ctx.fillText(kpi.label, x + 16, kpiY + 26);

    ctx.fillStyle = kpi.valueColor;
    ctx.font = `800 36px ${FONT_MONO}`;
    ctx.fillText(kpi.value, x + 16, kpiY + 67);

    ctx.fillStyle = '#64748b';
    ctx.font = `500 13px ${FONT_SANS}`;
    ctx.fillText(truncateText(ctx, kpi.sub, kpiCardW - 28), x + 16, kpiY + 87);
  });

  // 4. Office-Grouped Employee Tables (EVERY office, EVERY employee, HERO FOCUS: JAM MASUK).
  let cursorY = kpiY + kpiH + tableTopGap;

  const colNoX = CONTENT_X + 20;
  const colEmpX = CONTENT_X + 64;
  const colEmpMaxW = 418;
  const colJamCenterX = CONTENT_X + 598;
  const colStatusRightX = CONTENT_X + CONTENT_W - 22;

  if (officeGroups.length === 0) {
    const emptyH = tableHeaderH + ROW_H;
    roundedRect(ctx, CONTENT_X, cursorY, CONTENT_W, emptyH, 18);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = `600 20px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      'Tidak ada data karyawan pada cakupan yang dipilih.',
      CONTENT_X + CONTENT_W / 2,
      cursorY + emptyH / 2 + 6
    );
    ctx.textAlign = 'left';
    cursorY += emptyH;
  } else {
    officeGroups.forEach((group, groupIdx) => {
      if (groupIdx > 0) cursorY += officeGap;
      const boxStartY = cursorY;
      const boxH = OFFICE_HEADER_H + tableHeaderH + group.rows.length * ROW_H;

      ctx.save();
      roundedRect(ctx, CONTENT_X, boxStartY, CONTENT_W, boxH, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.clip();

      // 4a. Office Location Header Strip.
      const officeBarGrad = ctx.createLinearGradient(
        CONTENT_X,
        boxStartY,
        CONTENT_X + CONTENT_W,
        boxStartY
      );
      officeBarGrad.addColorStop(0, '#1e293b');
      officeBarGrad.addColorStop(1, '#334155');
      ctx.fillStyle = officeBarGrad;
      ctx.fillRect(CONTENT_X, boxStartY, CONTENT_W, OFFICE_HEADER_H);

      // Crimson left accent inside office header.
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(CONTENT_X, boxStartY, 8, OFFICE_HEADER_H);

      // Pin icon + Office Name.
      drawPinIcon(ctx, CONTENT_X + 30, boxStartY + OFFICE_HEADER_H / 2, '#f87171');

      const summaryParts = [`${group.sudahMasuk}/${group.totalWajibKerja} Masuk`];
      if (group.belumAtauTidakMasuk > 0) {
        summaryParts.push(`${group.belumAtauTidakMasuk} Belum/Tdk Masuk`);
      }
      if (group.izinAtauLibur > 0) {
        summaryParts.push(`${group.izinAtauLibur} Izin/Libur`);
      }
      const officeSummaryText = summaryParts.join(' · ');

      ctx.font = `700 14px ${FONT_SANS}`;
      const summaryPillW = Math.ceil(ctx.measureText(officeSummaryText).width) + 28;
      const summaryPillX = CONTENT_X + CONTENT_W - 18 - summaryPillW;
      roundedRect(ctx, summaryPillX, boxStartY + 11, summaryPillW, 32, 16);
      ctx.fillStyle =
        group.belumAtauTidakMasuk > 0
          ? 'rgba(239, 68, 68, 0.25)'
          : 'rgba(16, 185, 129, 0.24)';
      ctx.fill();
      ctx.strokeStyle =
        group.belumAtauTidakMasuk > 0
          ? 'rgba(252, 165, 165, 0.45)'
          : 'rgba(110, 231, 183, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(officeSummaryText, summaryPillX + 14, boxStartY + 32);

      const maxOfficeNameW = summaryPillX - (CONTENT_X + 50) - 16;
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 20px ${FONT_SANS}`;
      ctx.fillText(
        truncateText(ctx, group.officeName.toUpperCase(), maxOfficeNameW),
        CONTENT_X + 48,
        boxStartY + 34
      );

      // 4b. Column Header Bar inside each office card.
      const colHeaderY = boxStartY + OFFICE_HEADER_H;
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(CONTENT_X, colHeaderY, CONTENT_W, tableHeaderH);

      // Subtle highlight strip on JAM MASUK header column.
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(CONTENT_X + 492, colHeaderY, 212, tableHeaderH);

      ctx.fillStyle = '#475569';
      ctx.font = `700 14px ${FONT_SANS}`;
      ctx.fillText('NO', colNoX, colHeaderY + 30);
      ctx.fillText('KARYAWAN & BIDANG', colEmpX, colHeaderY + 30);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#c0392b';
      ctx.font = `800 15px ${FONT_SANS}`;
      ctx.fillText('JAM MASUK', colJamCenterX, colHeaderY + 30);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#475569';
      ctx.font = `700 14px ${FONT_SANS}`;
      ctx.fillText('STATUS & PROGRES', colStatusRightX, colHeaderY + 30);
      ctx.textAlign = 'left';

      // 4c. Every Employee Row in this Office.
      group.rows.forEach((row, rowIdx) => {
        const y = colHeaderY + tableHeaderH + rowIdx * ROW_H;
        const cat = classifyCheckInRow(row);
        const isAbsentOrPending = cat === 'BELUM_ABSEN' || cat === 'TIDAK_MASUK';

        if (isAbsentOrPending) {
          ctx.fillStyle = rowIdx % 2 === 1 ? '#fff1f2' : '#fff8f8';
        } else if (cat === 'NON_WORKING') {
          ctx.fillStyle = '#f8fafc';
        } else if (rowIdx % 2 === 1) {
          ctx.fillStyle = '#fafbfd';
        } else {
          ctx.fillStyle = '#ffffff';
        }
        ctx.fillRect(CONTENT_X, y, CONTENT_W, ROW_H);

        // Subtle column guide tint behind JAM MASUK column.
        if (cat === 'CHECKED_IN') {
          ctx.fillStyle =
            rowIdx % 2 === 1 ? 'rgba(248, 250, 252, 0.85)' : 'rgba(255, 250, 250, 0.55)';
          ctx.fillRect(CONTENT_X + 492, y, 212, ROW_H);
        }

        // Top row separator.
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CONTENT_X, y);
        ctx.lineTo(CONTENT_X + CONTENT_W, y);
        ctx.stroke();

        // Col 1: Office-local employee index (01..M).
        ctx.fillStyle = '#94a3b8';
        ctx.font = `700 17px ${FONT_MONO}`;
        ctx.fillText(String(rowIdx + 1).padStart(2, '0'), colNoX, y + 48);

        // Col 2: Employee Name + Bidang · Jabatan · NIK.
        ctx.fillStyle = '#0f172a';
        ctx.font = `700 21px ${FONT_SANS}`;
        ctx.fillText(truncateText(ctx, row.namaLengkap, colEmpMaxW), colEmpX, y + 36);

        const metaLine = [row.bidangNama, row.jabatan, row.nik].filter(Boolean).join(' · ');
        ctx.fillStyle = '#64748b';
        ctx.font = `500 15px ${FONT_SANS}`;
        ctx.fillText(truncateText(ctx, metaLine, colEmpMaxW), colEmpX, y + 61);

        // Col 3: HERO HIGHLIGHT — JAM MASUK / TIDAK MASUK / BELUM ABSEN / IZIN-LIBUR Pill.
        if (cat === 'CHECKED_IN' && row.sesi1Time) {
          const pillW = 182;
          const pillH = 48;
          const pillX = colJamCenterX - pillW / 2;
          const pillY = y + (ROW_H - pillH) / 2;

          roundedRect(ctx, pillX, pillY, pillW, pillH, 14);
          ctx.fillStyle = row.sesi1Terlambat ? '#fef3c7' : '#d1fae5';
          ctx.fill();
          ctx.strokeStyle = row.sesi1Terlambat ? '#f59e0b' : '#10b981';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.fillStyle = row.sesi1Terlambat ? '#92400e' : '#065f46';
          ctx.font = `800 24px ${FONT_MONO}`;
          ctx.fillText(`${row.sesi1Time} WIB`, colJamCenterX, pillY + 33);
          ctx.textAlign = 'left';
        } else if (cat === 'TIDAK_MASUK') {
          const pillW = 176;
          const pillH = 42;
          const pillX = colJamCenterX - pillW / 2;
          const pillY = y + (ROW_H - pillH) / 2;

          roundedRect(ctx, pillX, pillY, pillW, pillH, 12);
          ctx.fillStyle = '#c0392b';
          ctx.fill();

          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffffff';
          ctx.font = `800 16px ${FONT_SANS}`;
          ctx.fillText('TIDAK MASUK', colJamCenterX, pillY + 27);
          ctx.textAlign = 'left';
        } else if (cat === 'BELUM_ABSEN') {
          const pillW = 176;
          const pillH = 42;
          const pillX = colJamCenterX - pillW / 2;
          const pillY = y + (ROW_H - pillH) / 2;

          roundedRect(ctx, pillX, pillY, pillW, pillH, 12);
          ctx.fillStyle = '#fee2e2';
          ctx.fill();
          ctx.strokeStyle = '#f87171';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.fillStyle = '#b91c1c';
          ctx.font = `800 16px ${FONT_SANS}`;
          ctx.fillText('BELUM ABSEN', colJamCenterX, pillY + 27);
          ctx.textAlign = 'left';
        } else {
          const label = nonWorkingLabel(row.operationalStatus);
          const pillW = 176;
          const pillH = 40;
          const pillX = colJamCenterX - pillW / 2;
          const pillY = y + (ROW_H - pillH) / 2;

          roundedRect(ctx, pillX, pillY, pillW, pillH, 12);
          ctx.fillStyle = '#e0f2fe';
          ctx.fill();
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.fillStyle = '#0369a1';
          ctx.font = `800 15px ${FONT_SANS}`;
          ctx.fillText(truncateText(ctx, label, pillW - 18), colJamCenterX, pillY + 26);
          ctx.textAlign = 'left';
        }

        // Col 4: Ketepatan Status & Session Progress.
        ctx.textAlign = 'right';
        if (cat === 'CHECKED_IN') {
          if (row.sesi1Terlambat) {
            ctx.fillStyle = '#b45309';
            ctx.font = `700 17px ${FONT_SANS}`;
            const lateLabel =
              row.keterlambatanMenit > 0
                ? `Terlambat ${row.keterlambatanMenit} mnt`
                : 'Terlambat Sesi 1';
            ctx.fillText(lateLabel, colStatusRightX, y + 36);
          } else {
            ctx.fillStyle = '#047857';
            ctx.font = `700 17px ${FONT_SANS}`;
            ctx.fillText('✓ Tepat Waktu', colStatusRightX, y + 36);
          }

          ctx.fillStyle = '#64748b';
          ctx.font = `600 14px ${FONT_MONO}`;
          ctx.fillText(
            `${row.sessionsCompleted}/${row.sessionsTotal} sesi`,
            colStatusRightX,
            y + 60
          );
        } else if (cat === 'TIDAK_MASUK') {
          ctx.fillStyle = '#991b1b';
          ctx.font = `700 16px ${FONT_SANS}`;
          ctx.fillText('Tidak Absen Sesi 1', colStatusRightX, y + 36);
          ctx.fillStyle = '#64748b';
          ctx.font = `600 14px ${FONT_MONO}`;
          ctx.fillText(`0/${row.sessionsTotal} sesi`, colStatusRightX, y + 60);
        } else if (cat === 'BELUM_ABSEN') {
          ctx.fillStyle = '#be123c';
          ctx.font = `700 16px ${FONT_SANS}`;
          ctx.fillText('Belum Absen Sesi 1', colStatusRightX, y + 36);
          ctx.fillStyle = '#64748b';
          ctx.font = `600 14px ${FONT_MONO}`;
          ctx.fillText(`0/${row.sessionsTotal} sesi`, colStatusRightX, y + 60);
        } else {
          ctx.fillStyle = '#0369a1';
          ctx.font = `700 16px ${FONT_SANS}`;
          ctx.fillText('Tidak Wajib Absen', colStatusRightX, y + 36);
          ctx.fillStyle = '#64748b';
          ctx.font = `500 14px ${FONT_SANS}`;
          ctx.fillText(nonWorkingLabel(row.operationalStatus), colStatusRightX, y + 60);
        }
        ctx.textAlign = 'left';
      });

      ctx.restore();

      // Crisp outer border around each office card.
      ctx.save();
      roundedRect(ctx, CONTENT_X, boxStartY, CONTENT_W, boxH, 18);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      cursorY = boxStartY + boxH;
    });
  }

  // 5. Footer Strip with Explicit Snapshot Date & Time (Server WIB).
  const footerY = cursorY + footerGap;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, footerY);
  ctx.lineTo(CONTENT_X + CONTENT_W, footerY);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = `600 15px ${FONT_SANS}`;
  ctx.fillText(
    `Snapshot: ${longDateLabel} · ${fullTimeLabel}`,
    CONTENT_X,
    footerY + 38
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 15px ${FONT_SANS}`;
  ctx.fillText(
    `${officeGroups.length} Kantor · ${stats.totalKaryawan} Karyawan (${stats.sudahMasuk} Masuk, ${stats.belumAbsen} Belum/Tdk Masuk)`,
    CONTENT_X + CONTENT_W,
    footerY + 38
  );
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Gagal membuat file gambar laporan jam masuk.'));
    }, 'image/png');
  });

  return new File([blob], `laporan-jam-masuk-bignet-${input.tanggal}.png`, {
    type: 'image/png',
  });
}
