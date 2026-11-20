import type { SystemSettings } from '../shared/types';
import { apiFetch } from './api';
import { formatIndonesianDate } from './attendance-share';
import {
  ensureServerClockSynced,
  formatServerWibDateTime,
  getServerWibDateString,
  getServerWibTimeString,
  getServerWibYearMonth,
} from './server-clock-client';

export interface EmployeeDirectoryItem {
  nik: string;
  nama_lengkap: string;
  username?: string;
  email: string;
  no_hp: string;
  kantor_nama: string;
  bidang_nama: string;
  tanggal_masuk: string;
  tanggal_keluar?: string | null;
  alasan_keluar?: string;
  aktif: number;
}

export interface EmployeeDirectoryExportOptions {
  items: EmployeeDirectoryItem[];
  settings: SystemSettings | null;
  printedByName?: string;
  printedByRoleLabel?: string;
  statusLabel?: string;
  officeLabel?: string;
  bidangLabel?: string;
  documentTitle?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortOfficeName(name: string): string {
  return (name || '-').split('(')[0].trim() || '-';
}

function formatDateShort(ymd?: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '—';
  const [y, m, d] = ymd.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return ymd;
  return `${d} ${months[idx]} ${y}`;
}

function computeDirectoryBreakdown(items: EmployeeDirectoryItem[]) {
  const total = items.length;
  const aktifCount = items.filter((i) => i.aktif === 1).length;
  const keluarCount = total - aktifCount;

  const byOffice = new Map<string, number>();
  const byBidang = new Map<string, number>();
  for (const item of items) {
    const office = shortOfficeName(item.kantor_nama);
    const bidang = item.bidang_nama || 'Tanpa Bidang';
    byOffice.set(office, (byOffice.get(office) || 0) + 1);
    byBidang.set(bidang, (byBidang.get(bidang) || 0) + 1);
  }

  return {
    total,
    aktifCount,
    keluarCount,
    officeCounts: Array.from(byOffice.entries()).sort((a, b) => b[1] - a[1]),
    bidangCounts: Array.from(byBidang.entries()).sort((a, b) => b[1] - a[1]),
  };
}

function logDirectoryExport(format: 'PDF' | 'PNG', count: number, filterSummary: string) {
  void apiFetch('/api/v1/payroll/export-log', {
    method: 'POST',
    body: JSON.stringify({
      format,
      bulan: getServerWibYearMonth(),
      deskripsi: `Export ${format} daftar karyawan (${count} orang · ${filterSummary})`,
    }),
  }).catch(() => {});
}

/**
 * Generates an official, Director-ready printable / Save-as-PDF Employee Directory
 * rendered inside a hidden iframe (no window.open / popup blockers).
 */
export function printEmployeeDirectoryPdf(options: EmployeeDirectoryExportOptions): void {
  const {
    items,
    settings,
    printedByName = 'Operator Operasional',
    printedByRoleLabel = 'Operator / Admin',
    statusLabel = 'Karyawan Aktif',
    officeLabel = 'Semua Kantor',
    bidangLabel = 'Semua Bidang Kerja',
    documentTitle = 'DAFTAR KARYAWAN PERUSAHAAN',
  } = options;

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const subtitle = settings?.subjudul_login || 'Sistem Kehadiran & Rekap Payroll Terpadu';
  const logoUrl = `${window.location.origin}/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;
  const printedDate = getServerWibDateString();
  const printedDateLong = formatIndonesianDate(printedDate, 'long');
  const printedTime = getServerWibTimeString();
  const breakdown = computeDirectoryBreakdown(items);
  const filterSummary = `${statusLabel} · ${officeLabel} · ${bidangLabel}`;

  const rowsHtml = items
    .map((item, idx) => {
      const statusHtml = item.aktif
        ? `<span class="badge-aktif">AKTIF</span>`
        : `<span class="badge-keluar">KELUAR</span>${
            item.tanggal_keluar
              ? `<div class="sub-keluar">Per ${escapeHtml(formatDateShort(item.tanggal_keluar))}</div>`
              : ''
          }${
            item.alasan_keluar
              ? `<div class="sub-keluar">${escapeHtml(item.alasan_keluar)}</div>`
              : ''
          }`;

      return `
      <tr>
        <td class="c mono">${idx + 1}</td>
        <td class="mono bold">${escapeHtml(item.nik || '—')}</td>
        <td>
          <strong>${escapeHtml(item.nama_lengkap)}</strong>
          ${item.username ? `<div class="sub">@${escapeHtml(item.username)}</div>` : ''}
        </td>
        <td>${escapeHtml(shortOfficeName(item.kantor_nama))}</td>
        <td><span class="bidang-tag">${escapeHtml(item.bidang_nama || '—')}</span></td>
        <td>
          <div class="mono">${escapeHtml(item.no_hp || '—')}</div>
          <div class="sub">${escapeHtml(item.email || '—')}</div>
        </td>
        <td class="c mono">${escapeHtml(formatDateShort(item.tanggal_masuk))}</td>
        <td class="c">${statusHtml}</td>
      </tr>`;
    })
    .join('');

  const bidangBreakdownHtml = breakdown.bidangCounts
    .map(
      ([name, count]) =>
        `<span class="chip">${escapeHtml(name)}: <strong>${count}</strong></span>`
    )
    .join('');

  const officeBreakdownHtml = breakdown.officeCounts
    .map(
      ([name, count]) =>
        `<span class="chip">${escapeHtml(name)}: <strong>${count}</strong></span>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(documentTitle)} — ${escapeHtml(appName)} (${escapeHtml(printedDate)})</title>
  <style>
    @page { size: A4 landscape; margin: 12mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 0;
      font-size: 10.5px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #8c261c;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand img {
      width: 44px;
      height: 44px;
      object-fit: contain;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px;
      background: #fff;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .brand-sub {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
    }
    .doc-meta {
      text-align: right;
    }
    .doc-title {
      font-size: 13px;
      font-weight: 800;
      color: #8c261c;
      letter-spacing: 0.03em;
    }
    .doc-sub {
      font-size: 10px;
      color: #475569;
      margin-top: 2px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }
    .kpi-card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      background: #f8fafc;
    }
    .kpi-card.primary {
      background: #8c261c;
      border-color: #8c261c;
      color: #ffffff;
    }
    .kpi-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }
    .kpi-card.primary .kpi-label { color: #fad2ce; }
    .kpi-value {
      font-size: 18px;
      font-weight: 800;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      margin-top: 2px;
    }
    .kpi-card.green .kpi-value { color: #15803d; }
    .kpi-card.rose .kpi-value { color: #b91c1c; }
    .breakdown {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 7px 10px;
      margin-bottom: 12px;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .breakdown-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 9.5px;
    }
    .breakdown-label {
      font-weight: 700;
      color: #334155;
      min-width: 112px;
    }
    .chip {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 4px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    thead th {
      background: #1e293b;
      color: #ffffff;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 7px 8px;
      text-align: left;
      border: 1px solid #1e293b;
    }
    tbody td {
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      vertical-align: top;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .c { text-align: center; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; }
    .bold { font-weight: 700; }
    .sub { font-size: 9px; color: #64748b; margin-top: 1px; }
    .sub-keluar { font-size: 8.5px; color: #991b1b; margin-top: 2px; max-width: 150px; margin-left: auto; margin-right: auto; }
    .bidang-tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
      font-weight: 600;
      font-size: 9.5px;
    }
    .badge-aktif {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      background: #dcfce7;
      color: #166534;
      font-weight: 700;
      font-size: 9px;
      letter-spacing: 0.03em;
    }
    .badge-keluar {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      background: #fee2e2;
      color: #991b1b;
      font-weight: 700;
      font-size: 9px;
      letter-spacing: 0.03em;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 22px;
      page-break-inside: avoid;
    }
    .sig-box {
      text-align: center;
      font-size: 10.5px;
    }
    .sig-space {
      height: 54px;
    }
    .sig-line {
      width: 200px;
      margin: 0 auto 4px;
      border-bottom: 1px solid #334155;
    }
    .footer-note {
      margin-top: 14px;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      font-size: 9px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="${logoUrl}" alt="Logo" onerror="this.style.display='none'" />
      <div>
        <div class="brand-title">${escapeHtml(appName)}</div>
        <div class="brand-sub">${escapeHtml(subtitle)}</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">${escapeHtml(documentTitle)}</div>
      <div class="doc-sub">Filter: ${escapeHtml(filterSummary)}</div>
      <div class="doc-sub">Dicetak: ${escapeHtml(printedDateLong)} · ${escapeHtml(printedTime)} WIB</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card primary">
      <div class="kpi-label">Total Karyawan Tercantum</div>
      <div class="kpi-value">${breakdown.total} orang</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">Status Aktif</div>
      <div class="kpi-value">${breakdown.aktifCount} orang</div>
    </div>
    <div class="kpi-card rose">
      <div class="kpi-label">Keluar / Nonaktif</div>
      <div class="kpi-value">${breakdown.keluarCount} orang</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Sebaran Unit</div>
      <div class="kpi-value">${breakdown.officeCounts.length} Kantor · ${breakdown.bidangCounts.length} Bidang</div>
    </div>
  </div>

  <div class="breakdown">
    <div class="breakdown-row">
      <span class="breakdown-label">Per Bidang Kerja:</span>
      ${bidangBreakdownHtml || '<span class="sub">—</span>'}
    </div>
    <div class="breakdown-row">
      <span class="breakdown-label">Per Kantor:</span>
      ${officeBreakdownHtml || '<span class="sub">—</span>'}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 34px; text-align: center;">No</th>
        <th style="width: 92px;">NIK</th>
        <th style="width: 185px;">Nama Karyawan</th>
        <th style="width: 145px;">Penempatan Kantor</th>
        <th style="width: 135px;">Bidang Kerja</th>
        <th style="width: 185px;">Kontak (HP & Email)</th>
        <th style="width: 88px; text-align: center;">Tgl Masuk</th>
        <th style="width: 130px; text-align: center;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="8" class="c">Tidak ada data karyawan sesuai filter.</td></tr>'}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-box">
      <div>Disiapkan Oleh (${escapeHtml(printedByRoleLabel)}),</div>
      <div class="sig-space"></div>
      <div class="sig-line"></div>
      <div class="bold">${escapeHtml(printedByName)}</div>
    </div>
    <div class="sig-box">
      <div>Mengetahui,</div>
      <div class="sig-space"></div>
      <div class="sig-line"></div>
      <div class="bold">Direktur / Pimpinan Perusahaan</div>
    </div>
  </div>

  <div class="footer-note">
    <span>Dokumen resmi daftar karyawan dihasilkan otomatis dari ${escapeHtml(appName)}</span>
    <span>Waktu Server WIB: ${escapeHtml(printedDate)} ${escapeHtml(printedTime)}</span>
  </div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1200);
  };

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      cleanup();
    }
  }, 350);

  logDirectoryExport('PDF', items.length, filterSummary);
}

function loadImageWithTimeout(src: string, timeoutMs = 2000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(img);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    };
    img.src = src;
  });
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/**
 * Generates a crisp 2x high-DPI PNG image of the Employee Directory ready to send
 * directly via WhatsApp / email to the Director.
 */
export async function exportEmployeeDirectoryPng(
  options: EmployeeDirectoryExportOptions
): Promise<void> {
  await ensureServerClockSynced();

  const {
    items,
    settings,
    printedByName = 'Operator Operasional',
    statusLabel = 'Karyawan Aktif',
    officeLabel = 'Semua Kantor',
    bidangLabel = 'Semua Bidang Kerja',
    documentTitle = 'DAFTAR KARYAWAN PERUSAHAAN',
  } = options;

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const printedDate = getServerWibDateString();
  const printedDateTime = formatServerWibDateTime();
  const breakdown = computeDirectoryBreakdown(items);
  const filterSummary = `${statusLabel} · ${officeLabel} · ${bidangLabel}`;

  const logoUrl = `${window.location.origin}/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;
  const logoImg = await loadImageWithTimeout(logoUrl, 1800);

  const width = 1400;
  const padX = 32;
  const headerH = 126;
  const kpiH = 92;
  const breakdownH = 48;
  const tableHeaderH = 44;
  const rowH = 54;
  const footerH = 62;

  // Cap rows safely for browser canvas limits (14,400px max at 2x scale => ~7200 logical px)
  const maxRows = 120;
  const renderItems = items.slice(0, maxRows);
  const overflowCount = Math.max(0, items.length - renderItems.length);
  const overflowNoticeH = overflowCount > 0 ? 34 : 0;

  const totalHeight =
    headerH +
    18 +
    kpiH +
    14 +
    breakdownH +
    18 +
    tableHeaderH +
    Math.max(renderItems.length, 1) * rowH +
    overflowNoticeH +
    footerH;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = totalHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  const FONT_SANS = '"Plus Jakarta Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
  const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, totalHeight);

  // Branded Header Band
  const headerGrad = ctx.createLinearGradient(0, 0, width, headerH);
  headerGrad.addColorStop(0, '#5c140e');
  headerGrad.addColorStop(0.55, '#8c261c');
  headerGrad.addColorStop(1, '#3d0c07');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, width, headerH);

  let titleStartX = padX;
  if (logoImg) {
    drawRoundedRect(ctx, padX, 26, 72, 72, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.drawImage(logoImg, padX + 8, 34, 56, 56);
    titleStartX = padX + 90;
  }

  ctx.fillStyle = '#fad2ce';
  ctx.font = `700 12px ${FONT_SANS}`;
  ctx.fillText(appName.toUpperCase(), titleStartX, 46);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 26px ${FONT_SANS}`;
  ctx.fillText(documentTitle, titleStartX, 78);

  ctx.fillStyle = '#fde8e6';
  ctx.font = `500 13px ${FONT_SANS}`;
  ctx.fillText(`Filter: ${filterSummary}`, titleStartX, 102);

  // Right timestamp in header
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fad2ce';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.fillText('WAKTU SERVER (WIB)', width - padX, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 14px ${FONT_MONO}`;
  ctx.fillText(printedDateTime, width - padX, 70);
  ctx.fillStyle = '#fde8e6';
  ctx.font = `500 12px ${FONT_SANS}`;
  ctx.fillText(`Disiapkan oleh: ${printedByName}`, width - padX, 94);
  ctx.textAlign = 'left';

  // KPI Cards
  const kpiY = headerH + 18;
  const kpiGap = 16;
  const kpiW = (width - padX * 2 - kpiGap * 3) / 4;
  const kpiCards = [
    {
      label: 'TOTAL KARYAWAN',
      value: `${breakdown.total} orang`,
      sub: 'Sesuai filter aktif',
      bg: '#0f172a',
      border: '#0f172a',
      labelColor: '#cbd5e1',
      valueColor: '#ffffff',
      subColor: '#94a3b8',
    },
    {
      label: 'STATUS AKTIF',
      value: `${breakdown.aktifCount} orang`,
      sub: 'Aktif bekerja & absensi',
      bg: '#ecfdf5',
      border: '#a7f3d0',
      labelColor: '#047857',
      valueColor: '#065f46',
      subColor: '#047857',
    },
    {
      label: 'KELUAR / NONAKTIF',
      value: `${breakdown.keluarCount} orang`,
      sub: 'Arsip resign / keluar',
      bg: '#fef2f2',
      border: '#fecaca',
      labelColor: '#b91c1c',
      valueColor: '#991b1b',
      subColor: '#b91c1c',
    },
    {
      label: 'DISTRIBUSI UNIT',
      value: `${breakdown.officeCounts.length} Kantor · ${breakdown.bidangCounts.length} Bidang`,
      sub: 'Penempatan perusahaan',
      bg: '#f8fafc',
      border: '#cbd5e1',
      labelColor: '#475569',
      valueColor: '#0f172a',
      subColor: '#64748b',
    },
  ];

  kpiCards.forEach((c, idx) => {
    const x = padX + idx * (kpiW + kpiGap);
    drawRoundedRect(ctx, x, kpiY, kpiW, kpiH, 12);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = c.labelColor;
    ctx.font = `700 11px ${FONT_SANS}`;
    ctx.fillText(c.label, x + 16, kpiY + 25);

    ctx.fillStyle = c.valueColor;
    ctx.font = `800 22px ${FONT_MONO}`;
    ctx.fillText(truncateText(ctx, c.value, kpiW - 32), x + 16, kpiY + 56);

    ctx.fillStyle = c.subColor;
    ctx.font = `500 11px ${FONT_SANS}`;
    ctx.fillText(c.sub, x + 16, kpiY + 77);
  });

  // Breakdown Strip (Per Bidang Kerja)
  const bdY = kpiY + kpiH + 14;
  drawRoundedRect(ctx, padX, bdY, width - padX * 2, breakdownH, 10);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  const bidangSummaryText =
    breakdown.bidangCounts.length > 0
      ? breakdown.bidangCounts.map(([name, cnt]) => `${name} (${cnt})`).join('   ·   ')
      : 'Belum ada data bidang kerja';
  ctx.fillStyle = '#334155';
  ctx.font = `700 12px ${FONT_SANS}`;
  ctx.fillText('Rekap Per Bidang Kerja:', padX + 16, bdY + 29);
  ctx.fillStyle = '#0f172a';
  ctx.font = `600 12px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, bidangSummaryText, width - padX * 2 - 200), padX + 185, bdY + 29);

  // Table Header
  const tableY = bdY + breakdownH + 18;
  const tableW = width - padX * 2;
  drawRoundedRect(ctx, padX, tableY, tableW, tableHeaderH, 8);
  ctx.fillStyle = '#1e293b';
  ctx.fill();

  const col = {
    no: padX + 16,
    nik: padX + 62,
    nama: padX + 178,
    kantor: padX + 465,
    bidang: padX + 690,
    kontak: padX + 890,
    masuk: padX + 1110,
    status: padX + 1225,
  };

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 11.5px ${FONT_SANS}`;
  ctx.fillText('NO', col.no, tableY + 27);
  ctx.fillText('NIK', col.nik, tableY + 27);
  ctx.fillText('NAMA KARYAWAN', col.nama, tableY + 27);
  ctx.fillText('PENEMPATAN KANTOR', col.kantor, tableY + 27);
  ctx.fillText('BIDANG KERJA', col.bidang, tableY + 27);
  ctx.fillText('KONTAK (HP / EMAIL)', col.kontak, tableY + 27);
  ctx.fillText('TGL MASUK', col.masuk, tableY + 27);
  ctx.fillText('STATUS', col.status, tableY + 27);

  // Table Rows
  if (renderItems.length === 0) {
    const y = tableY + tableHeaderH;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(padX, y, tableW, rowH);
    ctx.fillStyle = '#64748b';
    ctx.font = `500 13px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('Tidak ada data karyawan sesuai filter yang dipilih.', width / 2, y + 32);
    ctx.textAlign = 'left';
  } else {
    renderItems.forEach((item, i) => {
      const y = tableY + tableHeaderH + i * rowH;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(padX, y, tableW, rowH);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, y + rowH);
      ctx.lineTo(padX + tableW, y + rowH);
      ctx.stroke();

      // No & NIK
      ctx.fillStyle = '#64748b';
      ctx.font = `600 12px ${FONT_MONO}`;
      ctx.fillText(String(i + 1), col.no, y + 32);

      ctx.fillStyle = '#0f172a';
      ctx.font = `700 12.5px ${FONT_MONO}`;
      ctx.fillText(truncateText(ctx, item.nik || '—', 108), col.nik, y + 32);

      // Nama & Username
      ctx.fillStyle = '#0f172a';
      ctx.font = `700 13.5px ${FONT_SANS}`;
      ctx.fillText(truncateText(ctx, item.nama_lengkap, 272), col.nama, y + 25);
      if (item.username) {
        ctx.fillStyle = '#64748b';
        ctx.font = `500 11px ${FONT_SANS}`;
        ctx.fillText(truncateText(ctx, `@${item.username}`, 272), col.nama, y + 42);
      }

      // Kantor
      ctx.fillStyle = '#1e293b';
      ctx.font = `600 12.5px ${FONT_SANS}`;
      ctx.fillText(truncateText(ctx, shortOfficeName(item.kantor_nama), 212), col.kantor, y + 32);

      // Bidang Kerja Badge
      const bidangText = truncateText(ctx, item.bidang_nama || '—', 175);
      ctx.font = `700 11.5px ${FONT_SANS}`;
      const bW = Math.min(186, ctx.measureText(bidangText).width + 18);
      drawRoundedRect(ctx, col.bidang, y + 14, bW, 26, 6);
      ctx.fillStyle = '#ecfdf5';
      ctx.fill();
      ctx.strokeStyle = '#a7f3d0';
      ctx.stroke();
      ctx.fillStyle = '#065f46';
      ctx.fillText(bidangText, col.bidang + 9, y + 31);

      // Kontak
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 12px ${FONT_MONO}`;
      ctx.fillText(truncateText(ctx, item.no_hp || '—', 208), col.kontak, y + 25);
      ctx.fillStyle = '#64748b';
      ctx.font = `500 11px ${FONT_SANS}`;
      ctx.fillText(truncateText(ctx, item.email || '—', 208), col.kontak, y + 42);

      // Tgl Masuk
      ctx.fillStyle = '#334155';
      ctx.font = `600 12px ${FONT_MONO}`;
      ctx.fillText(formatDateShort(item.tanggal_masuk), col.masuk, y + 32);

      // Status
      if (item.aktif) {
        drawRoundedRect(ctx, col.status, y + 15, 76, 24, 6);
        ctx.fillStyle = '#dcfce7';
        ctx.fill();
        ctx.fillStyle = '#166534';
        ctx.font = `800 11px ${FONT_SANS}`;
        ctx.fillText('AKTIF', col.status + 19, y + 31);
      } else {
        drawRoundedRect(ctx, col.status, y + 9, 86, 22, 6);
        ctx.fillStyle = '#fee2e2';
        ctx.fill();
        ctx.fillStyle = '#991b1b';
        ctx.font = `800 10.5px ${FONT_SANS}`;
        ctx.fillText('KELUAR', col.status + 19, y + 24);
        if (item.tanggal_keluar) {
          ctx.fillStyle = '#991b1b';
          ctx.font = `600 10px ${FONT_MONO}`;
          ctx.fillText(formatDateShort(item.tanggal_keluar), col.status, y + 44);
        }
      }
    });
  }

  // Overflow Notice if > 120 rows
  if (overflowCount > 0) {
    const oy = tableY + tableHeaderH + renderItems.length * rowH;
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(padX, oy, tableW, overflowNoticeH);
    ctx.fillStyle = '#92400e';
    ctx.font = `600 12px ${FONT_SANS}`;
    ctx.fillText(
      `+${overflowCount} karyawan lainnya tidak ditampilkan pada PNG ini. Gunakan tombol Cetak / PDF untuk dokumen lengkap multi-halaman.`,
      padX + 16,
      oy + 21
    );
  }

  // Footer
  const fy = totalHeight - footerH;
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(padX, fy + 10);
  ctx.lineTo(width - padX, fy + 10);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = `600 12px ${FONT_SANS}`;
  ctx.fillText(
    `${appName} · Daftar Karyawan Resmi (Siap Diserahkan ke Direktur)`,
    padX,
    fy + 38
  );
  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748b';
  ctx.font = `500 11.5px ${FONT_MONO}`;
  ctx.fillText(`Server WIB: ${printedDateTime}`, width - padX, fy + 38);
  ctx.textAlign = 'left';

  const safeSlug = appName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'BIGNET';
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `Daftar_Karyawan_${safeSlug}_${printedDate}.png`;
  a.click();

  logDirectoryExport('PNG', items.length, filterSummary);
}
