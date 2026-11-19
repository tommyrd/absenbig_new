import { buildApiUrl, getAuthorizedAvatarUrl, getAuthorizedPhotoUrl } from './api';
import type { AttendanceFeedPost } from '../shared/types';

const WIDTH = 1080;
const HEIGHT = 1350;
const CARD_X = 36;
const CARD_Y = 36;
const CARD_W = WIDTH - CARD_X * 2;
const CARD_H = HEIGHT - CARD_Y * 2;
const CONTENT_X = 72;
const CONTENT_W = WIDTH - CONTENT_X * 2;

const FONT_SANS = '"Plus Jakarta Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

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

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return y;

  const paragraphs = normalized.split('\n');
  const renderedLines: string[] = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx += 1) {
    const words = paragraphs[pIdx].trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let currentLine = '';
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else if (!currentLine) {
        renderedLines.push(truncateText(ctx, word, maxWidth));
        if (renderedLines.length >= maxLines) break;
      } else {
        renderedLines.push(currentLine);
        if (renderedLines.length >= maxLines - 1) {
          const remaining = words.slice(i).join(' ');
          renderedLines.push(truncateText(ctx, remaining, maxWidth));
          currentLine = '';
          break;
        }
        currentLine = word;
      }
    }
    if (currentLine && renderedLines.length < maxLines) {
      const hasMoreParagraphs = pIdx < paragraphs.length - 1;
      const suffix = hasMoreParagraphs && renderedLines.length === maxLines - 1 ? '…' : '';
      renderedLines.push(truncateText(ctx, `${currentLine}${suffix}`, maxWidth));
    }
    if (renderedLines.length >= maxLines) break;
  }

  const finalLines = renderedLines.slice(0, maxLines);
  finalLines.forEach((line, idx) => {
    ctx.fillText(line, x, y + idx * lineHeight);
  });

  return y + finalLines.length * lineHeight;
}

export function formatDistance(meters: number | null): string {
  if (meters === null) return 'Tidak tersedia';
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
    : `${Math.round(meters).toLocaleString('id-ID')} m`;
}

export function formatIndonesianDate(ymd: string, style: 'long' | 'short' = 'long'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function getActivityTypeLabel(tipe: AttendanceFeedPost['tipeAktivitas']): string {
  switch (tipe) {
    case 'CHECK_IN':
      return 'Absen Masuk';
    case 'STANDBY':
      return 'Standby / Siaga';
    default:
      return 'Aktivitas Pekerjaan';
  }
}

export function getPostCaptionText(post: AttendanceFeedPost): string {
  const clean = (post.deskripsiAktivitas || '').trim();
  if (clean) return clean;
  if (post.tipeAktivitas === 'CHECK_IN') return 'Absensi masuk kerja.';
  if (post.tipeAktivitas === 'STANDBY') return 'Standby / siaga operasional.';
  return 'Melanjutkan aktivitas pekerjaan.';
}

/**
 * Build a clean, structured caption for sharing via WhatsApp, Telegram, or Web Share API.
 * Mirrors every verified data point rendered on the PNG snapshot card.
 */
export function buildAttendanceShareCaption(post: AttendanceFeedPost): string {
  const isLate = post.statusKetepatan === 'TERLAMBAT' && post.keterlambatanMenit > 0;
  const punctuality = isLate
    ? `Terlambat ${post.keterlambatanMenit} menit`
    : 'Tepat Waktu';
  const activityLabel = getActivityTypeLabel(post.tipeAktivitas);
  const captionBody = getPostCaptionText(post);
  const formattedDate = formatIndonesianDate(post.tanggal, 'long');
  const locationText =
    (post.lokasiAktualAlamat || '').trim() ||
    (post.kantorAlamat || '').trim() ||
    post.kantorNama;
  const geofenceInfo =
    post.jarakKantorMeter !== null
      ? ` (${post.dalamGeofence ? 'Dalam Radius' : 'Luar Radius'} · ${formatDistance(post.jarakKantorMeter)})`
      : '';
  const nikSuffix = post.nik ? ` (${post.nik})` : '';

  const lines = [
    '*BUKTI KEHADIRAN — ABSENSI BIGNET*',
    `Nama: ${post.namaLengkap}${nikSuffix}`,
    `Jabatan: ${post.jabatan} · ${post.bidangNama}`,
    `Sesi: Sesi ${post.urutanSesi}/${post.sessionsTotalToday} — ${post.namaSesi}`,
    `Waktu Server: ${formattedDate} · ${post.jamWib} WIB`,
    `Status: ${punctuality}`,
    '',
    `*Caption (${activityLabel}):*`,
    captionBody,
    '',
    `Lokasi: ${locationText}`,
    `Kantor: ${post.kantorNama}${geofenceInfo}`,
  ];

  if (post.lat !== null && post.lng !== null) {
    lines.push(`Koordinat GPS: ${post.lat.toFixed(6)}, ${post.lng.toFixed(6)}`);
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
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.decoding = 'async';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image decode failed'));
        el.src = objectUrl;
      });
      return img;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'BG';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function drawPinIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 7.5, Math.PI, 0, false);
  ctx.lineTo(cx, cy + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  avatar: HTMLImageElement | null,
  name: string,
  x: number,
  y: number,
  size: number
) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const outerR = size / 2;

  // Instagram-style brand gradient ring.
  const ringGrad = ctx.createLinearGradient(x, y + size, x + size, y);
  ringGrad.addColorStop(0, '#f59e0b');
  ringGrad.addColorStop(0.5, '#e1306c');
  ringGrad.addColorStop(1, '#c0392b');

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();

  // White inner gap ring.
  ctx.beginPath();
  ctx.arc(cx, cy, outerR - 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Clipped avatar photo or crisp crimson initials.
  const innerR = outerR - 6.5;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.clip();

  if (avatar && avatar.naturalWidth > 0 && avatar.naturalHeight > 0) {
    const d = innerR * 2;
    const scale = Math.max(d / avatar.naturalWidth, d / avatar.naturalHeight);
    const dw = avatar.naturalWidth * scale;
    const dh = avatar.naturalHeight * scale;
    ctx.drawImage(avatar, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = '#7b241c';
    ctx.fillRect(cx - innerR, cy - innerR, innerR * 2, innerR * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 22px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getInitials(name), cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawPhotoFrame(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
  namaSesi: string,
  isLate: boolean,
  lateMinutes: number
) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 22);
  ctx.clip();

  if (photo && photo.naturalWidth > 0 && photo.naturalHeight > 0) {
    // Soft blurred backdrop so any portrait/landscape/4:3 aspect fills the frame cleanly
    // without cropping the employee's face or the camera timestamp bar.
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, y, width, height);
    const coverScale = Math.max(width / photo.naturalWidth, height / photo.naturalHeight) * 1.08;
    const coverW = photo.naturalWidth * coverScale;
    const coverH = photo.naturalHeight * coverScale;
    ctx.filter = 'blur(22px) brightness(0.62)';
    ctx.drawImage(photo, x + (width - coverW) / 2, y + (height - coverH) / 2, coverW, coverH);
    ctx.restore();

    // Sharp full photo centered cleanly inside frame.
    const containScale = Math.min(width / photo.naturalWidth, height / photo.naturalHeight);
    const drawW = photo.naturalWidth * containScale;
    const drawH = photo.naturalHeight * containScale;
    ctx.drawImage(photo, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);

    // Subtle top scrim for crisp badge readability.
    const topGrad = ctx.createLinearGradient(x, y, x, y + 100);
    topGrad.addColorStop(0, 'rgba(15, 23, 42, 0.42)');
    topGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, width, 100);
  } else {
    const emptyGrad = ctx.createLinearGradient(x, y, x + width, y + height);
    emptyGrad.addColorStop(0, '#f8fafc');
    emptyGrad.addColorStop(1, '#e2e8f0');
    ctx.fillStyle = emptyGrad;
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#64748b';
    ctx.font = `700 26px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('Absensi Tanpa Lampiran Foto', x + width / 2, y + height / 2 - 4);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `500 20px ${FONT_SANS}`;
    ctx.fillText('Tercatat resmi melalui sistem Absensi BIGNET', x + width / 2, y + height / 2 + 30);
    ctx.textAlign = 'left';
  }

  // Top-left floating badge: Session Name.
  const badgePaddingX = 20;
  const badgeH = 44;
  ctx.font = `700 19px ${FONT_SANS}`;
  const sesiText = truncateText(ctx, namaSesi, 390);
  const sesiW = Math.ceil(ctx.measureText(sesiText).width) + badgePaddingX * 2;
  roundedRect(ctx, x + 20, y + 20, sesiW, badgeH, 22);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sesiText, x + 20 + badgePaddingX, y + 48);

  // Top-right floating badge: Punctuality status.
  const statusText = isLate ? `TERLAMBAT ${lateMinutes} MENIT` : 'TEPAT WAKTU';
  const statusW = Math.ceil(ctx.measureText(statusText).width) + badgePaddingX * 2 + 18;
  const statusX = x + width - 20 - statusW;
  roundedRect(ctx, statusX, y + 20, statusW, badgeH, 22);
  ctx.fillStyle = isLate ? 'rgba(217, 119, 6, 0.94)' : 'rgba(5, 150, 105, 0.94)';
  ctx.fill();
  // Small crisp indicator dot.
  ctx.beginPath();
  ctx.arc(statusX + 22, y + 42, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(statusText, statusX + 36, y + 48);

  ctx.restore();

  // Crisp subtle border around photo frame.
  ctx.save();
  roundedRect(ctx, x, y, width, height, 22);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Build a crisp 1080x1350 (4:5 portrait) PNG attendance snapshot card
 * complete with branding, employee info, photo proof, caption, and verified location.
 */
export async function createAttendanceShareImage(post: AttendanceFeedPost): Promise<File> {
  // Wait briefly for web fonts if supported so typography renders cleanly.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } catch {
      // Fallback safely to system fonts.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pembuatan gambar kartu absensi.');

  const [photo, logo, avatar] = await Promise.all([
    post.hasFoto ? loadImageFromUrl(getAuthorizedPhotoUrl(post.id)) : Promise.resolve(null),
    loadImageFromUrl(buildApiUrl('/api/v1/assets/logo')),
    post.fotoProfilUpdatedAt
      ? loadImageFromUrl(getAuthorizedAvatarUrl(post.karyawanId, post.fotoProfilUpdatedAt))
      : Promise.resolve(null),
  ]);

  // 1. Clean warm-slate backdrop.
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bgGrad.addColorStop(0, '#f8fafc');
  bgGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Main paper card with soft elevation shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 34);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  // Subtle card outline.
  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 34);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // 2. Crimson Brand Header Strip (clipped cleanly to card top corners).
  const headerH = 114;
  ctx.save();
  roundedRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 34);
  ctx.clip();
  const headerGrad = ctx.createLinearGradient(CARD_X, CARD_Y, CARD_X + CARD_W, CARD_Y + headerH);
  headerGrad.addColorStop(0, '#c0392b');
  headerGrad.addColorStop(0.6, '#a93226');
  headerGrad.addColorStop(1, '#7b241c');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(CARD_X, CARD_Y, CARD_W, headerH);
  ctx.restore();

  // Logo badge inside header.
  const logoBoxX = CONTENT_X;
  const logoBoxY = CARD_Y + 27;
  const logoBoxSize = 60;
  roundedRect(ctx, logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, 15);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const pad = 7;
    const avail = logoBoxSize - pad * 2;
    const s = Math.min(avail / logo.naturalWidth, avail / logo.naturalHeight);
    const lw = logo.naturalWidth * s;
    const lh = logo.naturalHeight * s;
    ctx.drawImage(
      logo,
      logoBoxX + (logoBoxSize - lw) / 2,
      logoBoxY + (logoBoxSize - lh) / 2,
      lw,
      lh
    );
  } else {
    ctx.fillStyle = '#c0392b';
    ctx.font = `800 30px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', logoBoxX + logoBoxSize / 2, logoBoxY + logoBoxSize / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Brand title & subtitle.
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 28px ${FONT_SANS}`;
  ctx.fillText('ABSENSI BIGNET', logoBoxX + logoBoxSize + 18, CARD_Y + 56);
  ctx.fillStyle = '#fde2df';
  ctx.font = `500 18px ${FONT_SANS}`;
  ctx.fillText('Bukti Kehadiran Resmi · Waktu Server WIB', logoBoxX + logoBoxSize + 18, CARD_Y + 84);

  // Right-side session badge inside header.
  const sessionPillText = `SESI ${post.urutanSesi} / ${post.sessionsTotalToday}`;
  ctx.font = `700 20px ${FONT_MONO}`;
  const sessionPillW = Math.ceil(ctx.measureText(sessionPillText).width) + 36;
  const sessionPillX = CONTENT_X + CONTENT_W - sessionPillW;
  roundedRect(ctx, sessionPillX, CARD_Y + 35, sessionPillW, 44, 22);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sessionPillText, sessionPillX + 18, CARD_Y + 64);

  // 3. Employee Identity & Server Timestamp Row.
  const identityY = CARD_Y + headerH + 24;
  const avatarSize = 74;
  drawAvatar(ctx, avatar, post.namaLengkap, CONTENT_X, identityY, avatarSize);

  // Measure right-side timestamp width so employee name never collides.
  const timeText = `${post.jamWib} WIB`;
  const shortDateText = formatIndonesianDate(post.tanggal, 'short');
  ctx.font = `700 30px ${FONT_MONO}`;
  const timeW = ctx.measureText(timeText).width;
  ctx.font = `500 19px ${FONT_SANS}`;
  const dateW = ctx.measureText(shortDateText).width;
  const rightColW = Math.max(timeW, dateW) + 28;

  const nameX = CONTENT_X + avatarSize + 18;
  const maxNameW = CONTENT_W - avatarSize - 18 - rightColW;

  ctx.fillStyle = '#0f172a';
  ctx.font = `800 31px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, post.namaLengkap, maxNameW), nameX, identityY + 32);

  const subtitleParts = [post.jabatan, post.bidangNama, post.nik ? `NIK ${post.nik}` : '']
    .filter(Boolean)
    .join(' · ');
  ctx.fillStyle = '#64748b';
  ctx.font = `500 19px ${FONT_SANS}`;
  ctx.fillText(truncateText(ctx, subtitleParts, maxNameW), nameX, identityY + 62);

  // Right-aligned authoritative WIB time & date.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 30px ${FONT_MONO}`;
  ctx.fillText(timeText, CONTENT_X + CONTENT_W, identityY + 32);
  ctx.fillStyle = '#64748b';
  ctx.font = `500 19px ${FONT_SANS}`;
  ctx.fillText(shortDateText, CONTENT_X + CONTENT_W, identityY + 62);
  ctx.textAlign = 'left';

  // 4. Hero Photo Frame (Instagram-style blurred-edge, zero cropping).
  const isLate = post.statusKetepatan === 'TERLAMBAT' && post.keterlambatanMenit > 0;
  const photoY = identityY + avatarSize + 22;
  const photoH = 540;
  drawPhotoFrame(
    ctx,
    photo,
    CONTENT_X,
    photoY,
    CONTENT_W,
    photoH,
    post.namaSesi,
    isLate,
    post.keterlambatanMenit
  );

  // 5. Caption & Aktivitas Card (with signature crimson accent bar).
  const captionY = photoY + photoH + 22;
  const captionH = 188;
  ctx.save();
  roundedRect(ctx, CONTENT_X, captionY, CONTENT_W, captionH, 20);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(CONTENT_X, captionY, 8, captionH);
  ctx.restore();

  const activityLabel = getActivityTypeLabel(post.tipeAktivitas).toUpperCase();
  ctx.fillStyle = '#c0392b';
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.fillText(`CAPTION · ${activityLabel}`, CONTENT_X + 28, captionY + 36);

  // Instagram-style bold username + caption text wrapped cleanly up to 3 lines.
  const captionText = `${post.namaLengkap}: ${getPostCaptionText(post)}`;
  ctx.fillStyle = '#1e293b';
  ctx.font = `500 24px ${FONT_SANS}`;
  drawWrappedText(
    ctx,
    captionText,
    CONTENT_X + 28,
    captionY + 74,
    CONTENT_W - 56,
    34,
    3
  );

  // 6. Verified Location & Office Details Box.
  const locY = captionY + captionH + 20;
  const locH = 190;
  ctx.save();
  roundedRect(ctx, CONTENT_X, locY, CONTENT_W, locH, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Top row inside location box: Pin icon + label (left) | Geofence badge (right).
  drawPinIcon(ctx, CONTENT_X + 34, locY + 34, '#c0392b');
  ctx.fillStyle = '#64748b';
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.fillText('LOKASI TERVERIFIKASI', CONTENT_X + 52, locY + 40);

  const hasGeo = post.jarakKantorMeter !== null;
  const geoBadgeText = !hasGeo
    ? 'TANPA GPS'
    : post.dalamGeofence
      ? `DALAM RADIUS · ${formatDistance(post.jarakKantorMeter)}`
      : `LUAR RADIUS · ${formatDistance(post.jarakKantorMeter)}`;
  ctx.font = `700 16px ${FONT_SANS}`;
  const geoBadgeW = Math.ceil(ctx.measureText(geoBadgeText).width) + 28;
  const geoBadgeX = CONTENT_X + CONTENT_W - 22 - geoBadgeW;
  roundedRect(ctx, geoBadgeX, locY + 18, geoBadgeW, 32, 16);
  ctx.fillStyle = !hasGeo ? '#f1f5f9' : post.dalamGeofence ? '#ecfdf5' : '#fef2f2';
  ctx.fill();
  ctx.fillStyle = !hasGeo ? '#475569' : post.dalamGeofence ? '#047857' : '#b91c1c';
  ctx.fillText(geoBadgeText, geoBadgeX + 14, locY + 39);

  // Resolved address (2 lines max).
  const resolvedLocation =
    (post.lokasiAktualAlamat || '').trim() ||
    (post.kantorAlamat || '').trim() ||
    post.kantorNama;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 22px ${FONT_SANS}`;
  drawWrappedText(
    ctx,
    resolvedLocation,
    CONTENT_X + 26,
    locY + 80,
    CONTENT_W - 52,
    30,
    2
  );

  // Bottom row inside location box: Kantor name (left) | GPS coords (right).
  const gpsText =
    post.lat !== null && post.lng !== null
      ? `GPS ${post.lat.toFixed(5)}, ${post.lng.toFixed(5)}`
      : 'Koordinat tidak tersedia';
  ctx.font = `500 17px ${FONT_MONO}`;
  const gpsW = ctx.measureText(gpsText).width;
  const maxOfficeW = CONTENT_W - 52 - gpsW - 24;

  ctx.fillStyle = '#475569';
  ctx.font = `600 18px ${FONT_SANS}`;
  ctx.fillText(
    truncateText(ctx, `Kantor: ${post.kantorNama}`, Math.max(220, maxOfficeW)),
    CONTENT_X + 26,
    locY + 162
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748b';
  ctx.font = `500 17px ${FONT_MONO}`;
  ctx.fillText(gpsText, CONTENT_X + CONTENT_W - 26, locY + 162);
  ctx.textAlign = 'left';

  // 7. Footer Divider & Verification Summary.
  const dividerY = locY + locH + 22;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CONTENT_X, dividerY);
  ctx.lineTo(CONTENT_X + CONTENT_W, dividerY);
  ctx.stroke();

  const footerTextY = Math.min(CARD_Y + CARD_H - 22, dividerY + 34);
  ctx.fillStyle = '#64748b';
  ctx.font = `600 17px ${FONT_SANS}`;
  ctx.fillText(`Terverifikasi Sistem Absensi BIGNET · ID #${post.id}`, CONTENT_X, footerTextY);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 17px ${FONT_SANS}`;
  ctx.fillText(
    `Progres Hari Ini: ${post.sessionsCompletedToday}/${post.sessionsTotalToday} Sesi`,
    CONTENT_X + CONTENT_W,
    footerTextY
  );
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Gagal membuat gambar kartu absensi.'));
    }, 'image/png');
  });

  const safeName =
    post.namaLengkap
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'karyawan';
  return new File([blob], `absensi-bignet-${safeName}-${post.tanggal}-sesi${post.urutanSesi}.png`, {
    type: 'image/png',
  });
}
