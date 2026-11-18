import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../auth.ts';
import { getPhotosDir } from '../paths.ts';
import { getMonthDays, getWibDateString, getWibIsoString } from '../time.ts';

function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

function createSamplePhotoSvgFile(
  fileName: string,
  name: string,
  sesiLabel: string,
  tanggal: string,
  waktu: string,
  lokasi: string
): { filePath: string; checksum: string } {
  const photosDir = getPhotosDir();
  if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });
  const safePath = path.join(photosDir, fileName);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1528"/>
      <stop offset="100%" stop-color="#1d335c"/>
    </linearGradient>
  </defs>
  <rect width="480" height="360" fill="url(#bg)"/>
  <circle cx="240" cy="135" r="46" fill="#334155" stroke="#93c5fd" stroke-width="2"/>
  <path d="M168 258 C168 208 312 208 312 258" fill="#334155" stroke="#93c5fd" stroke-width="2"/>
  <rect x="20" y="278" width="440" height="62" rx="8" fill="rgba(7,14,27,0.82)" stroke="rgba(148,163,184,0.3)"/>
  <text x="34" y="302" font-family="sans-serif" font-size="14" font-weight="700" fill="#f8fafc">${escapeXml(name)} — ${escapeXml(sesiLabel)}</text>
  <text x="34" y="324" font-family="monospace" font-size="12" fill="#cbd5e1">${escapeXml(tanggal)} ${escapeXml(waktu)} WIB · ${escapeXml(lokasi)}</text>
</svg>`;
  fs.writeFileSync(safePath, svg, 'utf8');
  const checksum = crypto.createHash('sha256').update(svg).digest('hex');
  return { filePath: fileName, checksum };
}

export interface ProductionSeedOptions {
  superadminUsername?: string;
  superadminEmail?: string;
  superadminName?: string;
  superadminPassword?: string;
}

export interface ProductionSeedResult {
  seeded: boolean;
  superadminUsername: string;
  generatedPassword?: string;
}

/**
 * Clean baseline seed for fresh production deployments.
 * Does NOT insert demo employees, sample attendance, or demo credentials,
 * and ensures `izin_demo_login = 0`.
 */
export function seedProductionBaseline(
  db: DatabaseSync,
  options: ProductionSeedOptions = {}
): ProductionSeedResult {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM kantor').get() as { c: number };
  if (countRow.c > 0) {
    return { seeded: false, superadminUsername: '' };
  }

  const nowIso = getWibIsoString();
  const today = getWibDateString();

  const username = (
    options.superadminUsername ||
    process.env.BOOTSTRAP_SUPERADMIN_USERNAME ||
    'superadmin'
  )
    .trim()
    .toLowerCase();
  const email = (
    options.superadminEmail ||
    process.env.BOOTSTRAP_SUPERADMIN_EMAIL ||
    'owner@bignet.co.id'
  )
    .trim()
    .toLowerCase();
  const fullName = (
    options.superadminName ||
    process.env.BOOTSTRAP_SUPERADMIN_NAME ||
    'Superadmin PT Borneo Inovasi Gemilang'
  ).trim();

  const configuredPassword =
    options.superadminPassword || process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || '';
  const generatedPassword =
    configuredPassword.length >= 8
      ? undefined
      : crypto.randomBytes(12).toString('base64url');
  const rawPassword = configuredPassword.length >= 8 ? configuredPassword : generatedPassword!;

  db.exec('BEGIN IMMEDIATE');
  try {
    // 1. Default Offices
    db.prepare(`
      INSERT INTO kantor (kode, nama, alamat, lat, lng, radius_meter, geofence_mode, zona_waktu, aktif)
      VALUES
        ('KTR-A', 'Kantor Pusat A (Jakarta)', 'Jl. Jend. Sudirman Kav. 52, Jakarta Selatan', -6.2088, 106.8456, 250, 'TOLAK_LUAR_RADIUS', 'Asia/Jakarta', 1),
        ('KTR-B', 'Kantor Operasional B (Bandung)', 'Jl. Asia Afrika No. 112, Bandung', -6.9218, 107.6071, 250, 'TOLAK_LUAR_RADIUS', 'Asia/Jakarta', 1)
    `).run();

    // 2. Bidang Kerja
    db.prepare(`
      INSERT INTO bidang_kerja (kode, nama, deskripsi) VALUES
        ('TEK', 'Teknisi Lapangan', 'Instalasi fiber optik, troubleshooting BTS, dan pemeliharaan jaringan'),
        ('NOC', 'Operasional & NOC', 'Pemantauan jaringan 24/7 dan respon tiket operasional'),
        ('ADM', 'Administrasi & Keuangan', 'Operasional kantor, HR, dan administrasi keuangan')
    `).run();

    // 3. Superadmin is an owner/system identity, not an employee.
    db.prepare(
      `INSERT INTO pengguna (
         username, email, password_hash, role, karyawan_id, nama_tampilan, no_hp,
         aktif, token_version, created_at
       ) VALUES (?, ?, ?, 'SUPERADMIN', NULL, ?, '', 1, 1, ?)`
    ).run(username, email, hashPassword(rawPassword), fullName, nowIso);

    // 4. Default Attendance Policies & Sessions
    const polInsert = db.prepare(`
      INSERT INTO kebijakan_absensi (
        level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
        toleransi_terlambat_menit, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
        libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
        sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    polInsert.run('DEFAULT', null, null, 'Kebijakan Default Perusahaan (4 Sesi)', 4, 3, 15, 1, 1, 1, 1, 0, 1, 1, today, nowIso);
    polInsert.run('BIDANG', 1, null, 'Kebijakan Teknisi Lapangan (3 Sesi)', 3, 2, 20, 1, 1, 1, 1, 0, 1, 1, today, nowIso);
    polInsert.run('BIDANG', 3, null, 'Kebijakan Administrasi Kantor (2 Sesi)', 2, 2, 10, 1, 0, 1, 1, 0, 1, 1, today, nowIso);

    const sesiInsert = db.prepare(`
      INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    sesiInsert.run(1, 1, 'Sesi 1 · Masuk Pagi', '08:00', '09:30', 1, 0);
    sesiInsert.run(1, 2, 'Sesi 2 · Progres Siang', '11:30', '13:30', 1, 1);
    sesiInsert.run(1, 3, 'Sesi 3 · Progres Sore', '15:00', '16:30', 1, 1);
    sesiInsert.run(1, 4, 'Sesi 4 · Pulang Kerja', '17:00', '20:00', 1, 1);

    sesiInsert.run(2, 1, 'Sesi 1 · Briefing & Berangkat', '08:00', '09:30', 1, 0);
    sesiInsert.run(2, 2, 'Sesi 2 · Lapangan / Standby', '12:00', '14:30', 1, 1);
    sesiInsert.run(2, 3, 'Sesi 3 · Laporan Selesai', '16:30', '19:30', 1, 1);

    sesiInsert.run(3, 1, 'Sesi 1 · Masuk Kantor', '08:00', '09:30', 1, 0);
    sesiInsert.run(3, 2, 'Sesi 2 · Pulang Kantor', '17:00', '19:00', 1, 0);

    // 5. Weekly Working Calendars
    const calInsert = db.prepare(`
      INSERT INTO kalender_kerja (kantor_id, hari_minggu, status_hari, jumlah_sesi_khusus, keterangan)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (let d = 0; d <= 6; d++) {
      calInsert.run(
        1,
        d,
        d === 0 ? 'HARI_LIBUR' : 'HARI_KERJA',
        null,
        d === 0 ? 'Minggu Libur Operasional Kantor A' : 'Hari Kerja Reguler Kantor A'
      );
      calInsert.run(
        2,
        d,
        'HARI_KERJA',
        d === 0 ? 2 : null,
        d === 0 ? 'Minggu Setengah Hari (2 Sesi) Kantor B' : 'Hari Kerja Reguler Kantor B'
      );
    }

    // 6. Enforce Demo Login Disabled on Production Baseline
    db.prepare(`UPDATE pengaturan_aplikasi SET izin_demo_login = 0, updated_at = ? WHERE id = 1`).run(
      nowIso
    );

    db.exec('COMMIT');
    return {
      seeded: true,
      superadminUsername: username,
      generatedPassword,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Rich development/testing demo seeder. Never run automatically in NODE_ENV=production.
 */
export function seedDemoDataset(db: DatabaseSync): boolean {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM kantor').get() as { c: number };
  if (countRow.c > 0) return false;

  const nowIso = getWibIsoString();
  const today = getWibDateString();
  const ym = today.slice(0, 7);
  const monthDays = getMonthDays(ym);
  const pastDays = monthDays.filter((d) => d < today);
  const passwordHash = hashPassword('bignet123');

  db.prepare(`
    INSERT INTO kantor (kode, nama, alamat, lat, lng, radius_meter, geofence_mode, zona_waktu, aktif)
    VALUES
      ('KTR-A', 'Kantor Pusat A (Jakarta)', 'Jl. Jend. Sudirman Kav. 52, Jakarta Selatan', -6.2088, 106.8456, 250, 'TOLAK_LUAR_RADIUS', 'Asia/Jakarta', 1),
      ('KTR-B', 'Kantor Operasional B (Bandung)', 'Jl. Asia Afrika No. 112, Bandung', -6.9218, 107.6071, 250, 'TOLAK_LUAR_RADIUS', 'Asia/Jakarta', 1)
  `).run();

  db.prepare(`
    INSERT INTO bidang_kerja (kode, nama, deskripsi) VALUES
      ('TEK', 'Teknisi Lapangan', 'Instalasi fiber optik, troubleshooting BTS, dan pemeliharaan jaringan'),
      ('NOC', 'Operasional & NOC', 'Pemantauan jaringan 24/7 dan respon tiket operasional'),
      ('ADM', 'Administrasi & Keuangan', 'Operasional kantor, HR, dan administrasi keuangan')
  `).run();

  const empInsert = db.prepare(`
    INSERT INTO karyawan (nik, nama_lengkap, email, no_hp, kantor_id, bidang_id, jabatan, tanggal_masuk, aktif)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  empInsert.run('BG-002', 'Siti Rahmawati', 'admin@bignet.id', '08111000002', 1, 3, 'HR & Operations Admin', '2022-03-01');
  empInsert.run('BG-101', 'Andi Pratama', 'andi@bignet.id', '08121000101', 1, 1, 'Senior Field Technician', '2023-02-15');
  empInsert.run('BG-102', 'Rina Kusuma', 'rina@bignet.id', '08121000102', 1, 3, 'Finance & Payroll Staff', '2023-06-01');
  empInsert.run('BG-103', 'Dimas Nugroho', 'dimas@bignet.id', '08121000103', 2, 1, 'Lead Network Technician', '2022-11-10');
  empInsert.run('BG-104', 'Fajar Hidayat', 'fajar@bignet.id', '08121000104', 2, 2, 'NOC Engineer', '2024-01-15');
  empInsert.run('BG-105', 'Dewi Lestari', 'dewi@bignet.id', '08121000105', 1, 2, 'NOC Analyst', '2024-04-01');
  empInsert.run('BG-106', 'Hendra Wijaya', 'hendra@bignet.id', '08121000106', 1, 1, 'Field Technician', '2024-07-01');

  db.prepare(`
    INSERT INTO pengguna (
      username, email, password_hash, role, karyawan_id, nama_tampilan, no_hp,
      aktif, token_version, created_at
    ) VALUES ('superadmin', 'owner@bignet.id', ?, 'SUPERADMIN', NULL, 'Budi Santoso', '08111000001', 1, 1, ?)
  `).run(passwordHash, nowIso);

  // Keep the legacy demo Admin identity outside the employee master. Its old
  // employee row remains archived so seeded employee IDs and historical examples stay stable.
  db.prepare(`
    UPDATE karyawan
    SET aktif = 0, is_system_archive = 1, jabatan = 'Akun Admin Operasional (Arsip)'
    WHERE id = 1
  `).run();
  db.prepare(`
    INSERT INTO pengguna (
      username, email, password_hash, role, karyawan_id, nama_tampilan, no_hp,
      aktif, token_version, created_at
    ) VALUES ('admin', 'admin@bignet.id', ?, 'ADMIN', NULL, 'Siti Rahmawati', '08111000002', 1, 1, ?)
  `).run(passwordHash, nowIso);

  const userInsert = db.prepare(`
    INSERT INTO pengguna (username, email, password_hash, role, karyawan_id, aktif, token_version, created_at)
    VALUES (?, ?, ?, 'KARYAWAN', ?, 1, 1, ?)
  `);
  userInsert.run('andi', 'andi@bignet.id', passwordHash, 2, nowIso);
  userInsert.run('rina', 'rina@bignet.id', passwordHash, 3, nowIso);
  userInsert.run('dimas', 'dimas@bignet.id', passwordHash, 4, nowIso);
  userInsert.run('fajar', 'fajar@bignet.id', passwordHash, 5, nowIso);
  userInsert.run('dewi', 'dewi@bignet.id', passwordHash, 6, nowIso);
  userInsert.run('hendra', 'hendra@bignet.id', passwordHash, 7, nowIso);

  const polInsert = db.prepare(`
    INSERT INTO kebijakan_absensi (
      level, bidang_id, karyawan_id, nama, jumlah_sesi, min_sesi_hadir,
      toleransi_terlambat_menit, wajib_foto_semua_sesi, wajib_aktivitas_sesi_lanjut,
      libur_dihitung_masuk, off_pengganti_dihitung_masuk, izin_dihitung_masuk,
      sakit_dihitung_masuk, cuti_dihitung_masuk, berlaku_mulai, aktif, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  polInsert.run('DEFAULT', null, null, 'Kebijakan Default Perusahaan (4 Sesi)', 4, 3, 15, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  polInsert.run('BIDANG', 1, null, 'Kebijakan Teknisi Lapangan (3 Sesi)', 3, 2, 20, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  polInsert.run('BIDANG', 3, null, 'Kebijakan Administrasi Kantor (2 Sesi)', 2, 2, 10, 1, 0, 1, 1, 0, 1, 1, '2026-01-01', nowIso);
  polInsert.run('KARYAWAN', null, 4, 'Kebijakan Khusus Lead Teknisi Bandung (4 Sesi)', 4, 3, 15, 1, 1, 1, 1, 0, 1, 1, '2026-01-01', nowIso);

  const sesiInsert = db.prepare(`
    INSERT INTO sesi_absensi (kebijakan_id, urutan, nama, jam_mulai, jam_selesai, wajib_foto, wajib_aktivitas, aktif)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  sesiInsert.run(1, 1, 'Sesi 1 · Masuk Pagi', '08:00', '09:30', 1, 0);
  sesiInsert.run(1, 2, 'Sesi 2 · Progres Siang', '11:30', '13:30', 1, 1);
  sesiInsert.run(1, 3, 'Sesi 3 · Progres Sore', '15:00', '16:30', 1, 1);
  sesiInsert.run(1, 4, 'Sesi 4 · Pulang Kerja', '17:00', '20:00', 1, 1);
  sesiInsert.run(2, 1, 'Sesi 1 · Briefing & Berangkat', '08:00', '09:30', 1, 0);
  sesiInsert.run(2, 2, 'Sesi 2 · Lapangan / Standby', '12:00', '14:30', 1, 1);
  sesiInsert.run(2, 3, 'Sesi 3 · Laporan Selesai', '16:30', '19:30', 1, 1);
  sesiInsert.run(3, 1, 'Sesi 1 · Masuk Kantor', '08:00', '09:30', 1, 0);
  sesiInsert.run(3, 2, 'Sesi 2 · Pulang Kantor', '17:00', '19:00', 1, 0);
  sesiInsert.run(4, 1, 'Sesi 1 · Masuk Pagi', '08:00', '09:30', 1, 0);
  sesiInsert.run(4, 2, 'Sesi 2 · Cek Infrastruktur', '11:30', '13:30', 1, 1);
  sesiInsert.run(4, 3, 'Sesi 3 · Koordinasi Tim', '15:00', '16:30', 1, 1);
  sesiInsert.run(4, 4, 'Sesi 4 · Penutupan Shift', '17:00', '20:00', 1, 1);

  const calInsert = db.prepare(`
    INSERT INTO kalender_kerja (kantor_id, hari_minggu, status_hari, jumlah_sesi_khusus, keterangan)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (let d = 0; d <= 6; d++) {
    calInsert.run(1, d, d === 0 ? 'HARI_LIBUR' : 'HARI_KERJA', null, d === 0 ? 'Minggu Libur Operasional Kantor A' : 'Hari Kerja Reguler Kantor A');
    calInsert.run(2, d, 'HARI_KERJA', d === 0 ? 2 : null, d === 0 ? 'Minggu Setengah Hari (2 Sesi) Kantor B' : 'Hari Kerja Reguler Kantor B');
  }

  const holidayDate = monthDays[9] || `${ym}-10`;
  db.prepare(`
    INSERT INTO hari_libur (tanggal, nama, kantor_id, dihitung_masuk, keterangan, created_by, created_at)
    VALUES (?, 'Hari Pahlawan & Apresiasi BIGNET', NULL, 1, 'Libur perusahaan dibayar sesuai kebijakan payroll', 2, ?)
  `).run(holidayDate, nowIso);

  const firstSundayPast =
    pastDays.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0) ||
    pastDays[0] ||
    `${ym}-01`;

  const kkInfo = db.prepare(`
    INSERT INTO penugasan_kerja_khusus (
      karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir, berhak_off_pengganti, status, created_by, created_at
    ) VALUES (2, ?, 'Migrasi OLT & Fiber Cluster Timur', 'Maintenance inti jaringan pada hari libur', 3, 2, 1, 'SELESAI', 2, ?)
  `).run(firstSundayPast, nowIso);

  db.prepare(`
    INSERT INTO hak_off_pengganti (karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at)
    VALUES (2, ?, ?, 'Migrasi OLT & Fiber Cluster Timur', 'TERSEDIA', ?, ?)
  `).run(Number(kkInfo.lastInsertRowid), firstSundayPast, `${ym}-30`, nowIso);

  const secondDay = pastDays[3] || `${ym}-04`;
  const kkHendra = db.prepare(`
    INSERT INTO penugasan_kerja_khusus (
      karyawan_id, tanggal, nama_project, keterangan, jumlah_sesi, min_sesi_hadir, berhak_off_pengganti, status, created_by, created_at
    ) VALUES (7, ?, 'Backup Power BTS Utara', 'Pemasangan UPS darurat', 3, 2, 1, 'SELESAI', 2, ?)
  `).run(firstSundayPast === secondDay ? (pastDays[1] || `${ym}-02`) : secondDay, nowIso);

  const hakHendra = db.prepare(`
    INSERT INTO hak_off_pengganti (karyawan_id, kerja_khusus_id, tanggal_kerja_sumber, nama_project, status, kadaluarsa_pada, created_at)
    VALUES (7, ?, ?, 'Backup Power BTS Utara', 'DIPAKAI', ?, ?)
  `).run(Number(kkHendra.lastInsertRowid), firstSundayPast === secondDay ? (pastDays[1] || `${ym}-02`) : secondDay, `${ym}-30`, nowIso);

  const reqHendra = db.prepare(`
    INSERT INTO pengajuan (
      karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, hak_off_id, status, diproses_oleh, diproses_pada, alasan_keputusan, created_at, updated_at
    ) VALUES (7, 'OFF_PENGGANTI', ?, ?, 'Mengambil hak off pengganti kerja hari Minggu', 'Disetujui koordinator lapangan', ?, 'APPROVED', 2, ?, 'Hak off valid dan beban kerja lapangan aman', ?, ?)
  `).run(today, today, Number(hakHendra.lastInsertRowid), nowIso, nowIso, nowIso);

  db.prepare(`
    INSERT INTO penggunaan_off_pengganti (hak_off_id, pengajuan_id, karyawan_id, tanggal_off, status, created_at)
    VALUES (?, ?, 7, ?, 'APPROVED', ?)
  `).run(Number(hakHendra.lastInsertRowid), Number(reqHendra.lastInsertRowid), today, nowIso);

  const futureDay = monthDays.find((d) => d > today) || today;
  db.prepare(`
    INSERT INTO pengajuan (
      karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, status, created_at, updated_at
    ) VALUES (3, 'CUTI', ?, ?, 'Keperluan keluarga di luar kota', 'Serah terima berkas ke Siti sebelum berangkat', 'PENDING', ?, ?)
  `).run(futureDay, futureDay, nowIso, nowIso);

  if (pastDays.length > 5) {
    db.prepare(`
      INSERT INTO pengajuan (
        karyawan_id, jenis, tanggal_mulai, tanggal_akhir, alasan, catatan, status, diproses_oleh, diproses_pada, alasan_keputusan, created_at, updated_at
      ) VALUES (5, 'IZIN', ?, ?, 'Urusan pribadi setengah hari', '', 'REJECTED', 2, ?, 'Jadwal shift NOC sedang padat tanpa pengganti', ?, ?)
    `).run(pastDays[4], pastDays[4], nowIso, nowIso, nowIso);
  }

  const absInsert = db.prepare(`
    INSERT INTO absensi_sesi (
      karyawan_id, tanggal, urutan_sesi, nama_sesi, waktu_server, status_ketepatan, keterlambatan_menit,
      lat, lng, accuracy_meter, jarak_kantor_meter, dalam_geofence, ip_address, user_agent,
      tipe_aktivitas, deskripsi_aktivitas, foto_path, foto_checksum, policy_snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const employeesForSeed = [
    { id: 2, nama: 'Andi Pratama', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 3, policyName: 'Kebijakan Teknisi Lapangan (3 Sesi)' },
    { id: 3, nama: 'Rina Kusuma', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 2, policyName: 'Kebijakan Administrasi Kantor (2 Sesi)' },
    { id: 4, nama: 'Dimas Nugroho', kantorLat: -6.9218, kantorLng: 107.6071, kantorNama: 'Kantor B', sesi: 4, policyName: 'Kebijakan Khusus Lead Teknisi Bandung (4 Sesi)' },
    { id: 5, nama: 'Fajar Hidayat', kantorLat: -6.9218, kantorLng: 107.6071, kantorNama: 'Kantor B', sesi: 4, policyName: 'Kebijakan Default Perusahaan (4 Sesi)' },
    { id: 6, nama: 'Dewi Lestari', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 4, policyName: 'Kebijakan Default Perusahaan (4 Sesi)' },
    { id: 7, nama: 'Hendra Wijaya', kantorLat: -6.2088, kantorLng: 106.8456, kantorNama: 'Kantor A', sesi: 3, policyName: 'Kebijakan Teknisi Lapangan (3 Sesi)' },
  ];

  let missedDayForAndi: string | null = null;
  for (const d of pastDays) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const isHoliday = d === holidayDate;
    for (const emp of employeesForSeed) {
      const isKantorA = emp.kantorNama === 'Kantor A';
      const isKerjaKhususAndi = emp.id === 2 && d === firstSundayPast;
      if (isHoliday && !isKerjaKhususAndi) continue;
      if (isKantorA && dow === 0 && !isKerjaKhususAndi) continue;

      if (emp.id === 2 && !missedDayForAndi && dow >= 1 && dow <= 5 && d !== firstSundayPast) {
        missedDayForAndi = d;
        continue;
      }
      if (emp.id === 5 && dow === 3 && d === pastDays[2]) {
        continue;
      }

      const sessionCount = !isKantorA && dow === 0 ? 2 : emp.sesi;
      const times = sessionCount === 2 ? ['08:05:12', '17:04:33'] : sessionCount === 3 ? ['08:12:40', '12:25:10', '17:05:45'] : ['08:07:19', '11:45:02', '15:14:22', '17:10:08'];
      const late = emp.id === 5 && dow === 1;
      for (let s = 1; s <= sessionCount; s++) {
        const t = s === 1 && late ? '09:32:10' : times[s - 1];
        const fileName = `seed_${emp.id}_${d}_s${s}.svg`;
        const { filePath, checksum } = createSamplePhotoSvgFile(fileName, emp.nama, `Sesi ${s}`, d, t, emp.kantorNama);
        absInsert.run(
          emp.id, d, s, `Sesi ${s}`, `${d}T${t}+07:00`,
          s === 1 && late ? 'TERLAMBAT' : 'TEPAT_WAKTU', s === 1 && late ? 17 : 0,
          emp.kantorLat + 0.0002, emp.kantorLng - 0.0001, 14, 38, 1,
          '10.10.1.24', 'Mozilla/5.0 (Mobile; BIGNET Web)',
          s === 1 ? 'CHECK_IN' : s === 2 && emp.id === 2 ? 'STANDBY' : 'AKTIVITAS',
          s === 1 ? 'Absensi masuk di area kerja' : isKerjaKhususAndi ? 'Migrasi OLT & terminasi fiber cluster timur' : 'Melaksanakan tugas operasional dan pelaporan rutin',
          filePath, checksum, JSON.stringify({ policyName: emp.policyName, jumlahSesi: sessionCount }), `${d}T${t}+07:00`
        );
      }
    }
  }

  const todaySeed = [
    { emp: employeesForSeed[0], sessions: 1, times: ['08:09:14'], desc: ['Briefing pagi tim teknisi Jakarta'] },
    { emp: employeesForSeed[1], sessions: 1, times: ['08:03:51'], desc: ['Masuk kantor pusat, verifikasi berkas payroll'] },
    { emp: employeesForSeed[2], sessions: 2, times: ['08:04:10', '11:48:22'], desc: ['Cek perangkat OLT Bandung', 'Standby maintenance node Dago'] },
    { emp: employeesForSeed[4], sessions: 1, times: ['08:19:45'], desc: ['Shift pagi NOC monitoring traffic'] },
  ];

  for (const item of todaySeed) {
    for (let s = 1; s <= item.sessions; s++) {
      const fileName = `seed_${item.emp.id}_${today}_s${s}.svg`;
      const { filePath, checksum } = createSamplePhotoSvgFile(fileName, item.emp.nama, `Sesi ${s}`, today, item.times[s - 1], item.emp.kantorNama);
      absInsert.run(
        item.emp.id, today, s, `Sesi ${s}`, `${today}T${item.times[s - 1]}+07:00`,
        'TEPAT_WAKTU', 0, item.emp.kantorLat + 0.0001, item.emp.kantorLng + 0.0001, 12, 24, 1,
        '10.10.2.15', 'Mozilla/5.0 (Mobile; BIGNET Web)',
        s === 1 ? 'CHECK_IN' : 'STANDBY', item.desc[s - 1],
        filePath, checksum, JSON.stringify({ policyName: item.emp.policyName, jumlahSesi: item.emp.sesi }), `${today}T${item.times[s - 1]}+07:00`
      );
    }
  }

  if (missedDayForAndi) {
    const ovInfo = db.prepare(`
      INSERT INTO override_kehadiran (karyawan_id, tanggal, hasil_awal, hasil_override, alasan, admin_id, created_at, aktif)
      VALUES (2, ?, 'TIDAK_HADIR', 'DIHITUNG_MASUK', 'Penugasan darurat lapangan luar jaringan dengan surat tugas koordinator (HP kehabisan baterai)', 2, ?, 1)
    `).run(missedDayForAndi, nowIso);

    db.prepare(`
      INSERT INTO audit_log (
        actor_id, actor_name, actor_role, waktu_server, ip_address, user_agent,
        modul, aksi, target_entity, target_id, karyawan_id, tanggal_terdampak,
        before_json, after_json, alasan
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      2, 'Siti Rahmawati', 'ADMIN', nowIso, '10.10.1.5', 'Mozilla/5.0 (Desktop; Admin Console)',
      'OVERRIDE_KEHADIRAN', 'CREATE_OVERRIDE', 'override_kehadiran', String(ovInfo.lastInsertRowid),
      2, missedDayForAndi,
      JSON.stringify({ operationalStatus: 'TIDAK_HADIR', payrollStatus: 'TIDAK_DIHITUNG_MASUK', sessionsCompleted: 0 }),
      JSON.stringify({ payrollStatus: 'DIHITUNG_MASUK', buktiAsliDiubah: false }),
      'Penugasan darurat lapangan luar jaringan dengan surat tugas koordinator (HP kehabisan baterai)'
    );
  }

  db.prepare(`
    INSERT INTO audit_log (
      actor_id, actor_name, actor_role, waktu_server, ip_address, user_agent,
      modul, aksi, target_entity, target_id, karyawan_id, tanggal_terdampak,
      before_json, after_json, alasan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    2, 'Siti Rahmawati', 'ADMIN', nowIso, '10.10.1.5', 'Mozilla/5.0 (Desktop; Admin Console)',
    'KALENDER_LIBUR', 'CREATE_HOLIDAY', 'hari_libur', '1', null, holidayDate,
    null, JSON.stringify({ nama: 'Hari Pahlawan & Apresiasi BIGNET', dihitung_masuk: true, kantor: 'Semua Kantor' }),
    'Penetapan hari libur perusahaan dibayar bulan berjalan'
  );

  db.prepare(`
    INSERT INTO pendaftaran_akun (
      nama_lengkap, username, email, no_hp, password_hash, role_diminta, jabatan,
      kantor_id, bidang_id, catatan_pendaftar, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(
    'Rizal Mahendra', 'rizal', 'rizal@bignet.id', '08139000201', passwordHash,
    'KARYAWAN', 'Teknisi Fiber Optik Baru', 1, 1,
    'Pendaftaran teknisi lapangan cabang Jakarta Selatan', nowIso
  );

  return true;
}
