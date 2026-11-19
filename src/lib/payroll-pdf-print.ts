import type { MonthlySummary, PeriodePayroll, SystemSettings } from '../shared/types';
import { getServerWibDateString, getServerWibTimeString } from './server-clock-client';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMonthLabelId(ym: string): string {
  const [yearStr, monthStr] = ym.split('-');
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const m = Number(monthStr);
  if (!yearStr || !Number.isInteger(m) || m < 1 || m > 12) return ym;
  return `${months[m - 1]} ${yearStr}`;
}

export interface PayrollPrintOptions {
  bulan: string;
  summaries: MonthlySummary[];
  period: PeriodePayroll | null;
  settings: SystemSettings | null;
  officeLabel?: string;
  bidangLabel?: string;
  printedByName?: string;
}

/**
 * Generates an official, signature-ready printable / Save-as-PDF payroll report
 * rendered inside a hidden iframe (no window.open / popup blockers).
 */
export function printOfficialPayrollReport(options: PayrollPrintOptions): void {
  const {
    bulan,
    summaries,
    period,
    settings,
    officeLabel = 'Semua Kantor',
    bidangLabel = 'Semua Bidang',
    printedByName = 'Admin Operasional',
  } = options;

  const appName = settings?.nama_aplikasi || 'Absensi BIGNET';
  const subtitle = settings?.subjudul_login || 'Sistem Kehadiran & Rekap Payroll Terpadu';
  const logoUrl = `${window.location.origin}/api/v1/assets/logo?v=${encodeURIComponent(
    settings?.logo_updated_at || '1'
  )}`;
  const printedDate = getServerWibDateString();
  const printedTime = getServerWibTimeString();
  const monthLabel = formatMonthLabelId(bulan);

  const totalMasuk = summaries.reduce((acc, s) => acc + s.hariMasuk, 0);
  const totalTidakHadir = summaries.reduce((acc, s) => acc + s.tidakHadir, 0);
  const totalAbsensi = summaries.reduce((acc, s) => acc + s.rincian.hadirAbsensi, 0);
  const totalLibur = summaries.reduce((acc, s) => acc + s.rincian.liburDihitungMasuk, 0);
  const totalOff = summaries.reduce((acc, s) => acc + s.rincian.offDihitungMasuk, 0);
  const totalIsc = summaries.reduce(
    (acc, s) => acc + s.rincian.izin + s.rincian.sakit + s.rincian.cuti,
    0
  );
  const totalOverride = summaries.reduce((acc, s) => acc + s.rincian.totalOverride, 0);

  const rowsHtml = summaries
    .map(
      (s, idx) => `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="mono">${escapeHtml(s.nik)}</td>
        <td>
          <strong>${escapeHtml(s.karyawanNama)}</strong><br/>
          <span class="sub">${escapeHtml(s.kantorNama.split('(')[0].trim())} · ${escapeHtml(s.bidangNama)}</span>
        </td>
        <td class="r bold green">${s.hariMasuk}</td>
        <td class="r bold ${s.tidakHadir > 0 ? 'red' : ''}">${s.tidakHadir}</td>
        <td class="r">${s.rincian.hadirAbsensi}</td>
        <td class="r">${s.rincian.liburDihitungMasuk}</td>
        <td class="r">${s.rincian.offDihitungMasuk}</td>
        <td class="r">${s.rincian.izin + s.rincian.sakit + s.rincian.cuti}</td>
        <td class="c">${s.rincian.totalOverride}</td>
      </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Rekap Payroll Kehadiran — ${escapeHtml(monthLabel)} — ${escapeHtml(appName)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #c0392b;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand img {
      height: 44px;
      max-width: 110px;
      object-fit: contain;
    }
    .brand h1 {
      margin: 0;
      font-size: 17px;
      color: #0f172a;
      letter-spacing: -0.2px;
    }
    .brand p {
      margin: 2px 0 0;
      color: #475569;
      font-size: 10.5px;
    }
    .doc-meta {
      text-align: right;
      font-size: 10px;
      color: #334155;
    }
    .doc-meta .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      background: ${period?.status === 'CLOSED' ? '#ecfdf5' : '#fef3c7'};
      color: ${period?.status === 'CLOSED' ? '#047857' : '#92400e'};
      border: 1px solid ${period?.status === 'CLOSED' ? '#a7f3d0' : '#fde68a'};
      margin-bottom: 4px;
    }
    .title-bar {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .title-bar h2 {
      margin: 0;
      font-size: 13.5px;
      color: #0f172a;
    }
    .title-bar p {
      margin: 2px 0 0;
      font-size: 10.5px;
      color: #475569;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .kpi {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #ffffff;
    }
    .kpi span {
      display: block;
      font-size: 9.5px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 600;
    }
    .kpi strong {
      display: block;
      font-size: 15px;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .green { color: #047857; }
    .red { color: #b91c1c; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
    }
    th {
      background: #c0392b;
      color: #ffffff;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      padding: 7px 6px;
      border: 1px solid #a93226;
      text-align: left;
    }
    td {
      padding: 6px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tfoot td {
      background: #f1f5f9;
      font-weight: 700;
      border-top: 2px solid #94a3b8;
    }
    .c { text-align: center; }
    .r { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
    .bold { font-weight: 700; }
    .sub { font-size: 9.5px; color: #64748b; }
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
      margin-top: 22px;
      page-break-inside: avoid;
    }
    .sig-box {
      text-align: center;
      font-size: 10.5px;
    }
    .sig-space {
      height: 58px;
      border-bottom: 1px solid #334155;
      margin: 8px 16px 6px;
    }
    .footer-note {
      margin-top: 18px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" />
      <div>
        <h1>${escapeHtml(appName)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </div>
    <div class="doc-meta">
      <div class="badge">${period?.status === 'CLOSED' ? 'Periode Ditutup (Final)' : 'Periode Berjalan (Open)'}</div>
      <div>Dicetak: ${escapeHtml(printedDate)} · ${escapeHtml(printedTime)} WIB</div>
      <div>Sumber Waktu: Server Resmi Asia/Jakarta</div>
    </div>
  </div>

  <div class="title-bar">
    <div>
      <h2>LAPORAN REKAP KEHADIRAN &amp; PAYROLL BULANAN</h2>
      <p>Periode: <strong>${escapeHtml(monthLabel)}</strong> · Lokasi: <strong>${escapeHtml(officeLabel)}</strong> · Bidang: <strong>${escapeHtml(bidangLabel)}</strong></p>
    </div>
    <div class="mono">Total: ${summaries.length} Karyawan</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <span>Total Karyawan</span>
      <strong>${summaries.length} orang</strong>
    </div>
    <div class="kpi">
      <span>Total Hari Masuk</span>
      <strong class="green">${totalMasuk} hari</strong>
    </div>
    <div class="kpi">
      <span>Total Tidak Hadir</span>
      <strong class="${totalTidakHadir > 0 ? 'red' : ''}">${totalTidakHadir} hari</strong>
    </div>
    <div class="kpi">
      <span>Admin Override Aktif</span>
      <strong>${totalOverride} kasus</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" style="width:28px;">No</th>
        <th style="width:74px;">NIK</th>
        <th>Nama Karyawan &amp; Penempatan</th>
        <th class="r" style="width:62px;">Masuk</th>
        <th class="r" style="width:62px;">Tdk Hadir</th>
        <th class="r" style="width:48px;">Absen</th>
        <th class="r" style="width:48px;">Libur</th>
        <th class="r" style="width:42px;">Off</th>
        <th class="r" style="width:48px;">I/S/C</th>
        <th class="c" style="width:44px;">Ovr</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">TOTAL KESELURUHAN (${summaries.length} KARYAWAN)</td>
        <td class="r green">${totalMasuk}</td>
        <td class="r ${totalTidakHadir > 0 ? 'red' : ''}">${totalTidakHadir}</td>
        <td class="r">${totalAbsensi}</td>
        <td class="r">${totalLibur}</td>
        <td class="r">${totalOff}</td>
        <td class="r">${totalIsc}</td>
        <td class="c">${totalOverride}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signatures">
    <div class="sig-box">
      <div>Dibuat Oleh,</div>
      <div><strong>Admin Operasional / HRD</strong></div>
      <div class="sig-space"></div>
      <div>${escapeHtml(printedByName)}</div>
    </div>
    <div class="sig-box">
      <div>Diperiksa Oleh,</div>
      <div><strong>Manajer Operasional</strong></div>
      <div class="sig-space"></div>
      <div>( _______________________ )</div>
    </div>
    <div class="sig-box">
      <div>Disetujui Oleh,</div>
      <div><strong>Pimpinan / Owner</strong></div>
      <div class="sig-space"></div>
      <div>( _______________________ )</div>
    </div>
  </div>

  <div class="footer-note">
    <span>Dokumen resmi dihasilkan oleh ${escapeHtml(appName)} berdasarkan audit trail server.</span>
    <span>Keterangan: I/S/C = Izin / Sakit / Cuti · Ovr = Admin Override</span>
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
  if (!doc || !iframe.contentWindow) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 1500);
    }
  };

  // Give logo image a brief moment to load before invoking print dialog
  window.setTimeout(triggerPrint, 350);
}
