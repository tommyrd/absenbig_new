import type { WorkforceMember } from '../shared/types';

/**
 * Normalizes an Indonesian phone number to international wa.me digits (62...).
 * Returns null if no valid phone digits are present.
 */
export function normalizeIndonesianWaPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export function buildIndividualWaReminderUrl(
  member: WorkforceMember,
  tanggal: string,
  serverTimeWib: string
): string | null {
  const phone = normalizeIndonesianWaPhone(member.noHp);
  if (!phone) return null;
  const office = member.kantorNama.split('(')[0].trim();
  const timeLabel = serverTimeWib ? serverTimeWib.slice(0, 5) : '--:--';
  const text = [
    `Halo ${member.namaLengkap},`,
    `Pengingat absensi masuk hari ini (${tanggal}, pukul ${timeLabel} WIB) untuk penempatan ${office}.`,
    `Status saat ini tercatat belum melakukan absensi Sesi 1. Mohon segera melakukan check-in melalui aplikasi Absensi BIGNET atau konfirmasi jika berhalangan.`,
    `Terima kasih.`,
  ].join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function buildGroupMissingCheckInMessage(
  missingMembers: WorkforceMember[],
  tanggal: string,
  serverTimeWib: string
): string {
  const timeLabel = serverTimeWib ? serverTimeWib.slice(0, 5) : '--:--';
  if (missingMembers.length === 0) {
    return `Monitoring Absensi (${tanggal} · ${timeLabel} WIB): Seluruh karyawan wajib kerja hari ini sudah melakukan absensi Sesi 1.`;
  }

  const byOffice = new Map<string, WorkforceMember[]>();
  for (const m of missingMembers) {
    const office = m.kantorNama.split('(')[0].trim();
    const list = byOffice.get(office) || [];
    list.push(m);
    byOffice.set(office, list);
  }

  const lines: string[] = [
    `*PENGINGAT ABSENSI MASUK (SESI 1)*`,
    `Tanggal: ${tanggal} · Update ${timeLabel} WIB`,
    `Total belum absen: ${missingMembers.length} karyawan`,
    '',
  ];

  for (const [office, list] of byOffice.entries()) {
    lines.push(`*${office} (${list.length} orang):*`);
    list.forEach((m, i) => {
      const statusTag = m.operationalStatus === 'TIDAK_HADIR' ? ' _(Tidak Masuk)_' : '';
      lines.push(`${i + 1}. ${m.namaLengkap} — ${m.bidangNama}${statusTag}`);
    });
    lines.push('');
  }

  lines.push('Mohon segera melakukan absensi masuk di aplikasi atau konfirmasi ke Admin Operasional.');
  return lines.join('\n').trim();
}
