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
  filterLabel: string; // e.g., "Semua Kantor · Semua Bidang"
  rows: MonitoringCheckInRow[];
}

const WIDTH = 1080;
const CARD_X = 32;
const CARD_Y = 32;
const CARD_W = WIDTH - CARD_X * 2;
const CONTENT_X = 68;
const CONTENT_W = WIDTH - CONTENT_X * 2;
const ROW_H = 82;

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
    default:
      return status.replace(/_/g, ' ');
  }
}

/**
 * Sort employees for a morning check-in report:
 * 1. Checked-in employees first, ordered by earliest check-in time (Jam Masuk)
 * 2. Working employees who haven't checked in yet ("Belum Absen")
 * 3. Non-working employees (Cuti, Izin, Sakit, Libur, Off)
 */
export function sortMonitoringCheckInRows(rows: MonitoringCheckInRow[]): MonitoringCheckInRow[] {
  return [...rows].sort((a, b) => {
    const groupOf = (r: MonitoringCheckInRow) => {
      if (r.sesi1Time) return 0;
      if (r.isWorkingToday) return 1;
      return 2;
    };
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0 && a.sesi1Time && b.sesi1Time) {
      const cmp = a.sesi1Time.localeCompare(b.sesi1Time);
      if (cmp !== 0) return cmp;
    }
    return a.namaLengkap.localeCompare(b.namaLengkap);
  });
}

export function computeMonitoringCheckInStats(rows: MonitoringCheckInRow[]) {
  const workingRows = rows.filter((r) => r.isWorkingToday);
  const checkedInRows = rows.filter((r) => Boolean(r.sesi1Time));
  const onTimeCount = checkedInRows.filter((r) => !r.sesi1Terlambat).length;
  const lateCount = checkedInRows.filter((r) => r.sesi1Terlambat).length;
  const notCheckedInCount = workingRows.filter((r) => !r.sesi1Time).length;
  const nonWorkingCount = rows.filter((r) => !r.isWorkingToday && !r.sesi1Time).length;

  return {
    totalKaryawan: rows.length,
    totalWajibKerja: workingRows.length,
    sudahMasuk: checkedInRows.length,
    tepatWaktu: onTimeCount,
    terlambat: lateCount,
    belumAbsen: notCheckedInCount,
    tidakWajibKerja: nonWorkingCount,
  };
}

/**
 * Build a clean WhatsApp/Telegram-ready morning attendance report caption
 * highlighting each employee's Sesi 1 check-in time (Jam Masuk).
 */
export function buildMonitoringCheckInCaption(input: MonitoringSnapshotInput): string {
  const sorted = sortMonitoringCheckInRows(input.rows);
  const stats = computeMonitoringCheckInStats(sorted);
  const dateLabel = formatIndonesianDate(input.tanggal, 'long');
  const updateHm = input.serverTimeWib.slice(0, 5) || '--:--';

  const lines: string[] = [
    '*LAPORAN JAM MASUK HARIAN — ABSENSI BIGNET*',
    `Tanggal: ${dateLabel}`,
    `Update Server: ${updateHm} WIB`,
    `Filter: ${input.filterLabel}`,
    '',
    `Ringkasan: ${stats.sudahMasuk}/${stats.totalWajibKerja} Sudah Masuk · ${stats.tepatWaktu} Tepat Waktu · ${stats.terlambat} Terlambat · ${stats.belumAbsen} Belum Absen`,
    '',
    '*Daftar Jam Masuk (Sesi 1):*',
  ];

  if (sorted.length === 0) {
    lines.push('Belum ada data karyawan pada filter ini.');
  } else {
    sorted.forEach((row, index) => {
      const no = String(index + 1).padStart(2, '0');
      if (row.sesi1Time) {
        const statusText = row.sesi1Terlambat
          ? row.keterlambatanMenit > 0
            ? `Terlambat ${row.keterlambatanMenit} mnt`
            : 'Terlambat'
          : 'Tepat Waktu';
        lines.push(`${no}. *${row.sesi1Time} WIB* — ${row.namaLengkap} (${statusText})`);
      } else if (row.isWorkingToday) {
        lines.push(`${no}. *Belum Absen* — ${row.namaLengkap} (${row.bidangNama})`);
      } else {
        lines.push(`${no}. [${nonWorkingLabel(row.operationalStatus)}] — ${row.namaLengkap}`);
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
 * Generate a crisp, high-resolution PNG snapshot of the daily Monitoring Hari Ini table
 * with prominent visual emphasis on Jam Masuk (Sesi 1) for morning sharing by Admin Operasional.
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

  const sortedRows = sortMonitoringCheckInRows(input.rows);
  const stats = computeMonitoringCheckInStats(sortedRows);
  const displayRows = sortedRows;
  const rowCount = Math.max(1, displayRows.length);

  // Compute dynamic height cleanly so every employee row fits with zero clipping.
  const headerH = 138;
  const kpiTopGap = 24;
  const kpiH = 98;
  const tableTopGap = 26;
  const tableHeaderH = 48;
  const rowsH = rowCount * ROW_H;
  const footerGap = 24;
  const footerH = 62;
  const cardBottomPad = 14;

  const cardH =
    headerH +
    kpiTopGap +
    kpiH +
    tableTopGap +
    tableHeaderH +
    rowsH +
    footerGap +
    footerH +
    cardBottomPad;
  const height = cardH + CARD_Y * 2;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pembuatan gambar laporan monitoring.');

  const logo = await loadImageFromUrl(buildApiUrl('/api/v1/assets/logo'));

  // 1. Soft slate canvas background.
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, height);
  bgGrad.addColorStop(0, '#f8fafc');
  bgGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, height);

  // Main rounded white card with elevation shadow.
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

  // Header right pills (Server Update Time & Filter).
  const updateHm = input.serverTimeWib.slice(0, 5) || '--:--';
  const timeBadgeText = `UPDATE ${updateHm} WIB`;
  ctx.font = `700 18px ${FONT_MONO}`;
  const timeBadgeW = Math.ceil(ctx.measureText(timeBadgeText).width) + 34;
  const timeBadgeX = CONTENT_X + CONTENT_W - timeBadgeW;
  roundedRect(ctx, timeBadgeX, CARD_Y + 32, timeBadgeW, 38, 19);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(timeBadgeText, timeBadgeX + 17, CARD_Y + 57);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fde2df';
  ctx.font = `600 16px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, input.filterLabel, 340), CONTENT_X + CONTENT_W, CARD_Y + 102);
  ctx.textAlign = 'left';

  // Header left title & Indonesian date.
  const titleX = logoX + logoSize + 18;
  const maxHeaderTitleW = timeBadgeX - titleX - 24;
  ctx.fillStyle = '#fde2df';
  ctx.font = `700 15px ${FONT_SANS}`;
  ctx.fillText('ABSENSI BIGNET · MONITORING HARIAN', titleX, CARD_Y + 46);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 30px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, 'LAPORAN JAM MASUK', maxHeaderTitleW), titleX, CARD_Y + 84);

  ctx.fillStyle = '#fce7e5';
  ctx.font = `500 18px ${FONT_SANS}`;
  ctx.fillText(
    truncateText(ctx, formatIndonesianDate(input.tanggal, 'long'), maxHeaderTitleW),
    titleX,
    CARD_Y + 114
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
      label: 'BELUM ABSEN',
      value: `${stats.belumAbsen}`,
      sub: stats.tidakWajibKerja > 0 ? `+ ${stats.tidakWajibKerja} libur/izin` : 'menunggu sesi 1',
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
    ctx.font = `700 14px ${FONT_SANS}`;
    ctx.fillText(kpi.label, x + 18, kpiY + 26);

    ctx.fillStyle = kpi.valueColor;
    ctx.font = `800 36px ${FONT_MONO}`;
    ctx.fillText(kpi.value, x + 18, kpiY + 67);

    ctx.fillStyle = '#64748b';
    ctx.font = `500 13px ${FONT_SANS}`;
    ctx.fillText(truncateText(ctx, kpi.sub, kpiCardW - 32), x + 18, kpiY + 87);
  });

  // 4. Employee Check-In Table (HERO FOCUS: JAM MASUK).
  const tableY = kpiY + kpiH + tableTopGap;
  const tableTotalH = tableHeaderH + rowsH;

  // Outer table container.
  ctx.save();
  roundedRect(ctx, CONTENT_X, tableY, CONTENT_W, tableTotalH, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();

  // Table column X layout (total CONTENT_W = 944):
  // Col 1 (No): 0..56
  // Col 2 (Karyawan & Penempatan): 56..494 (w = 438)
  // Col 3 (JAM MASUK — HERO): 494..704 (w = 210, centered)
  // Col 4 (Ketepatan & Progres): 704..944 (w = 240, right-aligned)
  const colNoX = CONTENT_X + 20;
  const colEmpX = CONTENT_X + 64;
  const colEmpMaxW = 418;
  const colJamCenterX = CONTENT_X + 598;
  const colStatusRightX = CONTENT_X + CONTENT_W - 22;

  // Table header bar.
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(CONTENT_X, tableY, CONTENT_W, tableHeaderH);

  // Subtle highlight strip on JAM MASUK header column.
  ctx.fillStyle = '#fef2f2';
  ctx.fillRect(CONTENT_X + 492, tableY, 212, tableHeaderH);

  ctx.fillStyle = '#475569';
  ctx.font = `700 14px ${FONT_SANS}`;
  ctx.fillText('NO', colNoX, tableY + 30);
  ctx.fillText('KARYAWAN & PENEMPATAN', colEmpX, tableY + 30);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#c0392b';
  ctx.font = `800 15px ${FONT_SANS}`;
  ctx.fillText('JAM MASUK', colJamCenterX, tableY + 30);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#475569';
  ctx.font = `700 14px ${FONT_SANS}`;
  ctx.fillText('STATUS & PROGRES', colStatusRightX, tableY + 30);
  ctx.textAlign = 'left';

  // Header bottom border.
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, tableY + tableHeaderH);
  ctx.lineTo(CONTENT_X + CONTENT_W, tableY + tableHeaderH);
  ctx.stroke();

  if (displayRows.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = `600 20px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      'Tidak ada data karyawan pada filter yang dipilih.',
      CONTENT_X + CONTENT_W / 2,
      tableY + tableHeaderH + ROW_H / 2 + 6
    );
    ctx.textAlign = 'left';
  } else {
    displayRows.forEach((row, idx) => {
      const y = tableY + tableHeaderH + idx * ROW_H;
      const isPendingAbsen = row.isWorkingToday && !row.sesi1Time;
      const isNonWorking = !row.isWorkingToday && !row.sesi1Time;

      // Row background zebra / pending highlight.
      if (isPendingAbsen) {
        ctx.fillStyle = '#fff5f5';
      } else if (idx % 2 === 1) {
        ctx.fillStyle = '#fafbfd';
      } else {
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillRect(CONTENT_X, y, CONTENT_W, ROW_H);

      // Subtle vertical tint behind the highlighted JAM MASUK column.
      if (!isPendingAbsen) {
        ctx.fillStyle = idx % 2 === 1 ? 'rgba(248, 250, 252, 0.85)' : 'rgba(255, 250, 250, 0.55)';
        ctx.fillRect(CONTENT_X + 492, y, 212, ROW_H);
      }

      // Row divider.
      if (idx > 0) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(CONTENT_X, y);
        ctx.lineTo(CONTENT_X + CONTENT_W, y);
        ctx.stroke();
      }

      // Col 1: Index number.
      ctx.fillStyle = '#94a3b8';
      ctx.font = `700 17px ${FONT_MONO}`;
      ctx.fillText(String(idx + 1).padStart(2, '0'), colNoX, y + 48);

      // Col 2: Employee Name + Bidang · Kantor.
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 21px ${FONT_SANS}`;
      ctx.fillText(truncateText(ctx, row.namaLengkap, colEmpMaxW), colEmpX, y + 36);

      const metaLine = `${row.bidangNama} · ${shortOfficeName(row.kantorNama)}`;
      ctx.fillStyle = '#64748b';
      ctx.font = `500 15px ${FONT_SANS}`;
      ctx.fillText(truncateText(ctx, metaLine, colEmpMaxW), colEmpX, y + 61);

      // Col 3: HERO HIGHLIGHT — JAM MASUK Pill.
      if (row.sesi1Time) {
        const pillW = 178;
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
      } else if (isPendingAbsen) {
        const pillW = 166;
        const pillH = 40;
        const pillX = colJamCenterX - pillW / 2;
        const pillY = y + (ROW_H - pillH) / 2;

        roundedRect(ctx, pillX, pillY, pillW, pillH, 12);
        ctx.fillStyle = '#fee2e2';
        ctx.fill();
        ctx.strokeStyle = '#fca5a5';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#b91c1c';
        ctx.font = `800 16px ${FONT_SANS}`;
        ctx.fillText('BELUM ABSEN', colJamCenterX, pillY + 26);
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.font = `700 20px ${FONT_MONO}`;
        ctx.fillText('--:--', colJamCenterX, y + 48);
        ctx.textAlign = 'left';
      }

      // Col 4: Ketepatan Status & Session Progress.
      ctx.textAlign = 'right';
      if (row.sesi1Time) {
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
      } else if (isPendingAbsen) {
        ctx.fillStyle = '#be123c';
        ctx.font = `700 16px ${FONT_SANS}`;
        ctx.fillText('Menunggu Sesi 1', colStatusRightX, y + 36);
        ctx.fillStyle = '#64748b';
        ctx.font = `600 14px ${FONT_MONO}`;
        ctx.fillText(`0/${row.sessionsTotal} sesi`, colStatusRightX, y + 60);
      } else if (isNonWorking) {
        const badgeText = nonWorkingLabel(row.operationalStatus);
        ctx.font = `700 14px ${FONT_SANS}`;
        const bw = Math.ceil(ctx.measureText(badgeText).width) + 24;
        const bx = colStatusRightX - bw;
        const by = y + (ROW_H - 32) / 2;
        roundedRect(ctx, bx, by, bw, 32, 10);
        ctx.fillStyle = '#e0f2fe';
        ctx.fill();
        ctx.fillStyle = '#0369a1';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, bx + bw / 2, by + 21);
      }
      ctx.textAlign = 'left';
    });
  }
  ctx.restore();

  // Outer table border.
  ctx.save();
  roundedRect(ctx, CONTENT_X, tableY, CONTENT_W, tableTotalH, 18);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 5. Footer Strip.
  const footerY = tableY + tableTotalH + footerGap;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, footerY);
  ctx.lineTo(CONTENT_X + CONTENT_W, footerY);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = `600 16px ${FONT_SANS}`;
  ctx.fillText(
    'Sumber Data: Waktu Server WIB Resmi · Sistem Absensi BIGNET',
    CONTENT_X,
    footerY + 38
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 16px ${FONT_SANS}`;
  ctx.fillText(
    `Total ${stats.totalKaryawan} Karyawan · ${stats.sudahMasuk}/${stats.totalWajibKerja} Masuk`,
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
