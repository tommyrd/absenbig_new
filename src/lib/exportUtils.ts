import * as XLSX from 'xlsx';
import type { MonthlySummary } from '../shared/types';
import { apiFetch } from './api';

export async function exportPayrollToExcel(bulan: string, items: MonthlySummary[]) {
  const rows = items.map((s, idx) => ({
    'No.': idx + 1,
    NIK: s.nik,
    'Nama Karyawan': s.karyawanNama,
    Kantor: s.kantorNama,
    'Bidang Kerja': s.bidangNama,
    'HARI MASUK': s.hariMasuk,
    'TIDAK HADIR': s.tidakHadir,
    'Hari Kerja': s.rincian.hariKerja,
    'Hari Libur': s.rincian.hariLibur,
    'Libur Dibayar': s.rincian.liburDihitungMasuk,
    'Kerja Khusus': s.rincian.kerjaKhusus,
    'Off Pengganti': s.rincian.offPengganti,
    Izin: s.rincian.izin,
    Sakit: s.rincian.sakit,
    Cuti: s.rincian.cuti,
    Terlambat: s.rincian.terlambat,
    'Total Override': s.rincian.totalOverride,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 10 },
    { wch: 24 },
    { wch: 26 },
    { wch: 24 },
    { wch: 13 },
    { wch: 13 },
    { wch: 11 },
    { wch: 11 },
    { wch: 14 },
    { wch: 13 },
    { wch: 14 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 11 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, `Rekap_${bulan}`);
  XLSX.writeFile(wb, `Rekap_Absensi_BIGNET_${bulan}.xlsx`);

  await apiFetch('/api/v1/payroll/export-log', {
    method: 'POST',
    body: JSON.stringify({
      format: 'EXCEL',
      bulan,
      deskripsi: `Export Excel rekap payroll bulan ${bulan} (${items.length} karyawan)`,
    }),
  }).catch(() => {});
}

export async function exportPayrollToImage(
  bulan: string,
  items: MonthlySummary[],
  format: 'png' | 'jpeg'
) {
  const rowH = 38;
  const headerH = 140;
  const tableHeaderH = 42;
  const footerH = 48;
  const width = 1180;
  const height = headerH + tableHeaderH + Math.max(items.length, 1) * rowH + footerH;

  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Dark Navy Header Band
  ctx.fillStyle = '#0b1528';
  ctx.fillRect(0, 0, width, 112);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ABSENSI BIGNET — REKAP KEHADIRAN PAYROLL', 32, 46);

  ctx.fillStyle = '#93c5fd';
  ctx.font = '500 14px "DM Sans", sans-serif';
  ctx.fillText(`Periode Bulan: ${bulan}   ·   Total Karyawan: ${items.length}   ·   Sumber: Server BIGNET`, 32, 76);

  const totalMasuk = items.reduce((a, b) => a + b.hariMasuk, 0);
  const totalTidakHadir = items.reduce((a, b) => a + b.tidakHadir, 0);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`TOTAL HARI MASUK: ${totalMasuk}   |   TIDAK HADIR: ${totalTidakHadir}`, width - 32, 62);
  ctx.textAlign = 'left';

  // Table Header
  const y0 = headerH;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(24, y0, width - 48, tableHeaderH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(24, y0, width - 48, tableHeaderH);

  const cols = [
    { label: 'NO', x: 38 },
    { label: 'NIK', x: 78 },
    { label: 'NAMA KARYAWAN', x: 160 },
    { label: 'KANTOR / BIDANG', x: 390 },
    { label: 'HARI MASUK', x: 700 },
    { label: 'TIDAK HADIR', x: 825 },
    { label: 'LIBUR / OFF', x: 950 },
    { label: 'OVERRIDE', x: 1065 },
  ];

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 11px "DM Sans", sans-serif';
  for (const c of cols) {
    ctx.fillText(c.label, c.x, y0 + 25);
  }

  // Rows
  items.forEach((s, i) => {
    const y = y0 + tableHeaderH + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(24, y, width - 48, rowH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(24, y + rowH);
    ctx.lineTo(width - 24, y + rowH);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(String(i + 1), 38, y + 23);
    ctx.fillText(s.nik, 78, y + 23);

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 13px "DM Sans", sans-serif';
    ctx.fillText(s.karyawanNama.slice(0, 26), 160, y + 23);

    ctx.fillStyle = '#475569';
    ctx.font = '12px "DM Sans", sans-serif';
    ctx.fillText(`${s.kantorNama.split('(')[0].trim()} · ${s.bidangNama}`.slice(0, 38), 390, y + 23);

    ctx.fillStyle = '#15803d';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillText(`${s.hariMasuk} hari`, 700, y + 23);

    ctx.fillStyle = s.tidakHadir > 0 ? '#b91c1c' : '#64748b';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillText(`${s.tidakHadir} hari`, 825, y + 23);

    ctx.fillStyle = '#334155';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`${s.rincian.liburDihitungMasuk + s.rincian.offDihitungMasuk} hari`, 950, y + 23);

    ctx.fillStyle = s.rincian.totalOverride > 0 ? '#b45309' : '#94a3b8';
    ctx.fillText(String(s.rincian.totalOverride), 1065, y + 23);
  });

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '11px "DM Sans", sans-serif';
  ctx.fillText(
    `Dicetak dari Sistem Absensi BIGNET · ${new Date().toLocaleString('id-ID')}`,
    32,
    height - 18
  );

  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const url = canvas.toDataURL(mime, 0.95);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap_Absensi_BIGNET_${bulan}.${ext}`;
  a.click();

  await apiFetch('/api/v1/payroll/export-log', {
    method: 'POST',
    body: JSON.stringify({
      format: ext.toUpperCase(),
      bulan,
      deskripsi: `Export ${ext.toUpperCase()} rekap payroll bulan ${bulan} (${items.length} karyawan)`,
    }),
  }).catch(() => {});
}
