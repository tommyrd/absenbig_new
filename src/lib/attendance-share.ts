import { getAuthorizedPhotoUrl } from './api';
import type { AttendanceFeedPost } from '../shared/types';

const WIDTH = 1080;
const HEIGHT = 1440;
const PADDING = 68;

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

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let line = '';
  let lines = 0;
  for (let index = 0; index < words.length; index += 1) {
    const candidate = line ? `${line} ${words[index]}` : words[index];
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = words[index];
      if (lines >= maxLines - 1) {
        let last = line;
        while (
          index + 1 < words.length &&
          ctx.measureText(`${last}…`).width < maxWidth
        ) {
          index += 1;
          last += ` ${words[index]}`;
        }
        ctx.fillText(`${last}…`, x, y + lines * lineHeight);
        return y + (lines + 1) * lineHeight;
      }
    } else {
      line = candidate;
    }
  }
  if (line && lines < maxLines) {
    ctx.fillText(line, x, y + lines * lineHeight);
    lines += 1;
  }
  return y + lines * lineHeight;
}

async function loadAttendancePhoto(sessionId: number): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(getAuthorizedPhotoUrl(sessionId), {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function drawPhoto(
  ctx: CanvasRenderingContext2D,
  photo: ImageBitmap | null,
  x: number,
  y: number,
  width: number,
  height: number
) {
  roundedRect(ctx, x, y, width, height, 28);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#e8edf5';
  ctx.fillRect(x, y, width, height);

  if (photo) {
    const scale = Math.min(width / photo.width, height / photo.height);
    const drawWidth = photo.width * scale;
    const drawHeight = photo.height * scale;
    ctx.drawImage(
      photo,
      x + (width - drawWidth) / 2,
      y + (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
  } else {
    ctx.fillStyle = '#64748b';
    ctx.font = '600 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Foto bukti tidak tersedia', x + width / 2, y + height / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function formatDistance(meters: number | null): string {
  if (meters === null) return 'Tidak tersedia';
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
    : `${Math.round(meters).toLocaleString('id-ID')} m`;
}

/** Build a self-contained 4:5 PNG attendance card for WhatsApp/Telegram sharing. */
export async function createAttendanceShareImage(post: AttendanceFeedPost): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pembuatan gambar kartu absensi.');

  const photo = post.hasFoto ? await loadAttendancePhoto(post.id) : null;
  ctx.fillStyle = '#edf2f8';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Main paper card.
  roundedRect(ctx, 38, 38, WIDTH - 76, HEIGHT - 76, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Navy brand header.
  ctx.save();
  roundedRect(ctx, 38, 38, WIDTH - 76, 205, 36);
  ctx.clip();
  ctx.fillStyle = '#0b1528';
  ctx.fillRect(38, 38, WIDTH - 76, 205);
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(38, 222, WIDTH - 76, 21);
  ctx.restore();

  ctx.fillStyle = '#93c5fd';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText('ABSENSI BIGNET', PADDING, 100);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px Arial, sans-serif';
  ctx.fillText('BUKTI KEHADIRAN', PADDING, 166);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText('Catatan absensi resmi dari sistem BIGNET', PADDING, 210);

  // Employee and session identity.
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 42px Arial, sans-serif';
  const nameY = drawWrappedText(ctx, post.namaLengkap, PADDING, 310, WIDTH - PADDING * 2, 52, 2);
  ctx.fillStyle = '#64748b';
  ctx.font = '26px Arial, sans-serif';
  ctx.fillText(`${post.jabatan} · ${post.bidangNama}`, PADDING, nameY + 8);

  roundedRect(ctx, PADDING, nameY + 38, 430, 62, 18);
  ctx.fillStyle = '#eff6ff';
  ctx.fill();
  ctx.fillStyle = '#1d4ed8';
  ctx.font = '700 24px Arial, sans-serif';
  ctx.fillText(`${post.namaSesi} · Sesi ${post.urutanSesi}`, PADDING + 20, nameY + 78);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 28px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${post.jamWib} WIB`, WIDTH - PADDING, nameY + 61);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748b';
  ctx.font = '22px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(post.tanggal, WIDTH - PADDING, nameY + 94);
  ctx.textAlign = 'left';

  // Photo proof.
  const photoY = nameY + 130;
  const photoHeight = 500;
  drawPhoto(ctx, photo, PADDING, photoY, WIDTH - PADDING * 2, photoHeight);

  // Activity block.
  const activityY = photoY + photoHeight + 36;
  roundedRect(ctx, PADDING, activityY, WIDTH - PADDING * 2, 150, 22);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText(post.tipeAktivitas === 'CHECK_IN' ? 'ABSEN MASUK' : 'AKTIVITAS PEKERJAAN', PADDING + 26, activityY + 40);
  ctx.fillStyle = '#0f172a';
  ctx.font = '26px Arial, sans-serif';
  drawWrappedText(
    ctx,
    post.deskripsiAktivitas.trim() || 'Tidak ada keterangan aktivitas.',
    PADDING + 26,
    activityY + 82,
    WIDTH - PADDING * 2 - 52,
    34,
    2
  );

  // Actual GPS location and office-distance verification.
  const detailsY = activityY + 198;
  ctx.fillStyle = '#64748b';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('LOKASI SAAT ABSEN', PADDING, detailsY);
  ctx.fillStyle = '#0f172a';
  ctx.font = '26px Arial, sans-serif';
  const addressEnd = drawWrappedText(
    ctx,
    post.lokasiAktualAlamat || 'Alamat lokasi tidak tersedia; koordinat GPS tetap tercatat.',
    PADDING,
    detailsY + 43,
    WIDTH - PADDING * 2,
    34,
    2
  );

  ctx.fillStyle = '#64748b';
  ctx.font = '22px Arial, sans-serif';
  ctx.fillText(
    post.lat !== null && post.lng !== null
      ? `GPS: ${post.lat.toFixed(6)}, ${post.lng.toFixed(6)}`
      : 'GPS: Tidak tersedia',
    PADDING,
    addressEnd + 8
  );
  ctx.fillText(`Jarak aktual ke kantor: ${formatDistance(post.jarakKantorMeter)}`, PADDING, addressEnd + 44);

  const isLate = post.statusKetepatan === 'TERLAMBAT';
  const badgeText = isLate ? `TERLAMBAT ${post.keterlambatanMenit} MENIT` : 'TEPAT WAKTU';
  roundedRect(ctx, PADDING, HEIGHT - 175, 310, 58, 18);
  ctx.fillStyle = isLate ? '#fff7ed' : '#ecfdf5';
  ctx.fill();
  ctx.fillStyle = isLate ? '#9a3412' : '#047857';
  ctx.font = '700 22px Arial, sans-serif';
  ctx.fillText(badgeText, PADDING + 20, HEIGHT - 138);

  const geoText = post.jarakKantorMeter === null
    ? 'STATUS LOKASI TIDAK TERSEDIA'
    : post.dalamGeofence ? 'DALAM RADIUS KANTOR' : 'DI LUAR RADIUS KANTOR';
  ctx.fillStyle = '#64748b';
  ctx.font = '700 18px Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(geoText, WIDTH - PADDING, HEIGHT - 138);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#94a3b8';
  ctx.font = '18px Arial, sans-serif';
  ctx.fillText('Alamat perkiraan dari GPS · Geoapify / OpenStreetMap', PADDING, HEIGHT - 83);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Gagal membuat gambar kartu absensi.'));
    }, 'image/png');
  });

  photo?.close();
  const safeName = post.namaLengkap
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'karyawan';
  return new File([blob], `absensi-bignet-${safeName}-${post.tanggal}.png`, {
    type: 'image/png',
  });
}
