import type { MonthlySummary } from '../shared/types';
import { getHistoryCalendarStatus } from '../shared/history-calendar';
import { ensureServerClockSynced, formatServerWibDateTime } from './server-clock-client';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function getMonthTitle(bulan: string): string {
  if (!/^\d{4}-\d{2}$/.test(bulan)) return bulan;
  const [y, m] = bulan.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export async function exportEmployeeMonthlySlipPng(summary: MonthlySummary): Promise<void> {
  await ensureServerClockSynced();

  const width = 1080;
  const pad = 40;
  const contentW = width - pad * 2;
  const days = summary.days || [];
  const cols = 7;
  const rowsCount = Math.max(1, Math.ceil(days.length / cols));
  const cellH = 44;
  const cellGap = 8;
  const calendarSectionH = 56 + rowsCount * (cellH + cellGap) + 28;
  const height = 166 + 150 + 216 + calendarSectionH + 74;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Perangkat tidak mendukung pembuatan gambar slip kehadiran.');
  }
  ctx.scale(scale, scale);

  // Page Background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  // Crimson Header Band
  const grad = ctx.createLinearGradient(0, 0, width, 150);
  grad.addColorStop(0, '#c0392b');
  grad.addColorStop(1, '#7b241c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, 146);

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = 'bold 12px "DM Sans", sans-serif';
  ctx.fillText('SLIP RINGKASAN KEHADIRAN PRIBADI · ABSENSI BIGNET', pad, 42);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(summary.karyawanNama, pad, 82);

  ctx.fillStyle = '#fde2df';
  ctx.font = '500 14px "DM Sans", sans-serif';
  ctx.fillText(
    `NIK ${summary.nik}  ·  ${summary.kantorNama.split('(')[0].trim()}  ·  ${summary.bidangNama}`,
    pad,
    112
  );

  // Month Badge on Header Right
  const monthText = getMonthTitle(summary.bulan).toUpperCase();
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  const badgeW = Math.max(180, ctx.measureText(monthText).width + 36);
  drawRoundedRect(ctx, width - pad - badgeW, 50, badgeW, 44, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(monthText, width - pad - badgeW / 2, 77);
  ctx.textAlign = 'left';

  // Section 1: KPI Cards (HARI MASUK & TIDAK HADIR)
  let y = 170;
  const kpiGap = 18;
  const kpiW = (contentW - kpiGap) / 2;
  const kpiH = 116;

  // Hari Masuk Card
  drawRoundedRect(ctx, pad, y, kpiW, kpiH, 16);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.fillStyle = '#fda4af';
  ctx.font = 'bold 12px "DM Sans", sans-serif';
  ctx.fillText('TOTAL HARI MASUK (PAYROLL)', pad + 24, y + 32);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px "JetBrains Mono", monospace';
  ctx.fillText(`${summary.hariMasuk}`, pad + 24, y + 82);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '500 15px "DM Sans", sans-serif';
  ctx.fillText('hari', pad + 24 + ctx.measureText(`${summary.hariMasuk}`).width + 36, y + 80);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px "DM Sans", sans-serif';
  ctx.fillText('Absensi sah, libur dibayar, dan off pengganti sah', pad + 24, y + 102);

  // Tidak Hadir Card
  const kpi2X = pad + kpiW + kpiGap;
  drawRoundedRect(ctx, kpi2X, y, kpiW, kpiH, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 12px "DM Sans", sans-serif';
  ctx.fillText('TIDAK HADIR (ALFA)', kpi2X + 24, y + 32);
  ctx.fillStyle = summary.tidakHadir > 0 ? '#b91c1c' : '#0f172a';
  ctx.font = 'bold 40px "JetBrains Mono", monospace';
  ctx.fillText(`${summary.tidakHadir}`, kpi2X + 24, y + 82);
  ctx.fillStyle = '#64748b';
  ctx.font = '500 15px "DM Sans", sans-serif';
  ctx.fillText('hari', kpi2X + 24 + ctx.measureText(`${summary.tidakHadir}`).width + 36, y + 80);
  ctx.fillStyle = '#64748b';
  ctx.font = '12px "DM Sans", sans-serif';
  ctx.fillText('Hari kerja belum memenuhi minimum sesi tanpa izin', kpi2X + 24, y + 102);

  // Section 2: Rincian Kategori
  y += kpiH + 26;
  drawRoundedRect(ctx, pad, y, contentW, 192, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`Rincian Kategori Bulan ${summary.bulan}`, pad + 22, y + 32);

  const metrics: { label: string; value: number; color: string }[] = [
    { label: 'Hari Kerja', value: summary.rincian.hariKerja, color: '#0f172a' },
    { label: 'Hadir Absensi', value: summary.rincian.hadirAbsensi, color: '#15803d' },
    { label: 'Libur Dibayar', value: summary.rincian.liburDihitungMasuk, color: '#0369a1' },
    { label: 'Off Pengganti', value: summary.rincian.offDihitungMasuk, color: '#4338ca' },
    { label: 'Kerja Khusus', value: summary.rincian.kerjaKhusus, color: '#b45309' },
    { label: 'Cuti', value: summary.rincian.cuti, color: '#6d28d9' },
    { label: 'Izin', value: summary.rincian.izin, color: '#0e7490' },
    { label: 'Sakit', value: summary.rincian.sakit, color: '#c2410c' },
    { label: 'Terlambat Sesi 1', value: summary.rincian.terlambat, color: '#b45309' },
    { label: 'Admin Override', value: summary.rincian.totalOverride, color: '#c0392b' },
  ];

  const mCols = 5;
  const mGap = 12;
  const mW = (contentW - 44 - mGap * (mCols - 1)) / mCols;
  const mH = 60;
  metrics.forEach((m, idx) => {
    const col = idx % mCols;
    const row = Math.floor(idx / mCols);
    const mx = pad + 22 + col * (mW + mGap);
    const my = y + 48 + row * (mH + 10);
    drawRoundedRect(ctx, mx, my, mW, mH, 10);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '500 11px "DM Sans", sans-serif';
    ctx.fillText(m.label, mx + 12, my + 22);
    ctx.fillStyle = m.color;
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.fillText(String(m.value), mx + 12, my + 47);
  });

  // Section 3: Compact Daily Status Matrix
  y += 192 + 24;
  drawRoundedRect(ctx, pad, y, contentW, calendarSectionH, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Ringkasan Status Harian', pad + 22, y + 32);

  const cellW = (contentW - 44 - cellGap * (cols - 1)) / cols;
  const palette: Record<string, { bg: string; border: string; text: string; short: string }> = {
    HADIR: { bg: '#dcfce7', border: '#86efac', text: '#14532d', short: 'HADIR' },
    TIDAK_HADIR: { bg: '#ffe4e6', border: '#fda4af', text: '#881337', short: 'ALFA' },
    BELUM_SELESAI: { bg: '#fef3c7', border: '#fcd34d', text: '#78350f', short: 'PROSES' },
    HARI_LIBUR: { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', short: 'LIBUR' },
    OFF_PENGGANTI: { bg: '#e0e7ff', border: '#a5b4fc', text: '#312e81', short: 'OFF+' },
    CUTI: { bg: '#ede9fe', border: '#c4b5fd', text: '#4c1d95', short: 'CUTI' },
    IZIN: { bg: '#cffafe', border: '#67e8f9', text: '#164e63', short: 'IZIN' },
    SAKIT: { bg: '#ffedd5', border: '#fdba74', text: '#7c2d12', short: 'SAKIT' },
    OFF: { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', short: 'OFF' },
    OVERRIDE_MASUK: { bg: '#bbf7d0', border: '#22c55e', text: '#14532d', short: 'OVR+' },
    OVERRIDE_TIDAK_MASUK: { bg: '#fecdd3', border: '#f43f5e', text: '#881337', short: 'OVR-' },
  };

  days.forEach((day, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cx = pad + 22 + col * (cellW + cellGap);
    const cy = y + 48 + row * (cellH + cellGap);
    const status = getHistoryCalendarStatus(day);
    const p = palette[status] || palette.HARI_LIBUR;

    drawRoundedRect(ctx, cx, cy, cellW, cellH, 8);
    ctx.fillStyle = p.bg;
    ctx.fill();
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.text;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillText(day.tanggal.slice(8, 10), cx + 10, cy + 18);

    ctx.font = 'bold 10px "DM Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(p.short, cx + cellW - 10, cy + 18);
    ctx.textAlign = 'left';

    ctx.fillStyle = p.text;
    ctx.globalAlpha = 0.78;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(
      day.sessionsCompleted > 0
        ? `${day.sessionsCompleted}/${day.policySnapshot.jumlahSesi} sesi`
        : day.payrollStatus === 'DIHITUNG_MASUK'
          ? 'Masuk'
          : '—',
      cx + 10,
      cy + 34
    );
    ctx.globalAlpha = 1;
  });

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '12px "DM Sans", sans-serif';
  ctx.fillText(
    `Dicetak dari Sistem Absensi BIGNET · Waktu Server: ${formatServerWibDateTime()}`,
    pad,
    height - 24
  );
  ctx.textAlign = 'right';
  ctx.fillText('Dokumen Rekap Pribadi Karyawan', width - pad, height - 24);
  ctx.textAlign = 'left';

  const safeNik = summary.nik.replace(/[^a-zA-Z0-9_-]/g, '');
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = `Slip_Kehadiran_${safeNik}_${summary.bulan}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
