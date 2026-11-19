export type Role = 'KARYAWAN' | 'ADMIN' | 'SUPERADMIN';

export type PolicyLevel = 'DEFAULT' | 'BIDANG' | 'KARYAWAN';
export type AttendanceLocationRule = 'SESI_PERTAMA_KANTOR' | 'SEMUA_SESI_KANTOR' | 'BEBAS_LOKASI';

export type DayStatusType = 'HARI_KERJA' | 'HARI_LIBUR' | 'KERJA_KHUSUS' | 'OFF_PENGGANTI';

export type OperationalStatus =
  | 'HADIR'
  | 'TIDAK_HADIR'
  | 'HARI_LIBUR'
  | 'OFF_PENGGANTI'
  | 'CUTI'
  | 'IZIN'
  | 'SAKIT'
  | 'OFF'
  | 'BELUM_SELESAI';

export type PayrollStatus = 'DIHITUNG_MASUK' | 'TIDAK_DIHITUNG_MASUK';

export type RequestType = 'CUTI' | 'OFF' | 'OFF_PENGGANTI' | 'IZIN' | 'SAKIT' | 'KERJA_HARI_LIBUR';

export type RequestStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export type GeofenceMode = 'CATAT_DENGAN_FLAG' | 'TOLAK_LUAR_RADIUS';

export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Kantor {
  id: number;
  kode: string;
  nama: string;
  alamat: string;
  lat: number;
  lng: number;
  radius_meter: number;
  geofence_mode: GeofenceMode;
  zona_waktu: string;
  aktif: number;
  can_delete?: boolean;
  jumlah_karyawan?: number;
  jumlah_pendaftaran?: number;
  jumlah_hari_libur?: number;
  jumlah_periode_payroll?: number;
  jumlah_kalender?: number;
}

export interface BidangKerja {
  id: number;
  kode: string;
  nama: string;
  deskripsi: string;
  can_delete?: boolean;
  jumlah_karyawan?: number;
  jumlah_kebijakan?: number;
  jumlah_pendaftaran?: number;
}

export interface Karyawan {
  id: number;
  nik: string;
  nama_lengkap: string;
  email: string;
  no_hp: string;
  kantor_id: number;
  bidang_id: number;
  jabatan: string;
  tanggal_masuk: string;
  aktif: number;
  kantor_nama?: string;
  kantor_kode?: string;
  bidang_nama?: string;
  role?: Role;
  username?: string;
  has_foto_profil?: boolean;
  foto_profil_updated_at?: string | null;
  is_system_archive?: number;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  no_hp?: string;
  role: Role;
  karyawan_id: number | null;
  nama_lengkap: string;
  nik: string;
  jabatan: string;
  kantor_id: number;
  kantor_nama: string;
  kantor_lat: number;
  kantor_lng: number;
  kantor_radius: number;
  kantor_geofence_mode: GeofenceMode;
  bidang_id: number;
  bidang_nama: string;
  has_foto_profil?: boolean;
  foto_profil_updated_at?: string | null;
}

export interface PendaftaranAkun {
  id: number;
  nama_lengkap: string;
  username: string;
  email: string;
  no_hp: string;
  role_diminta: 'KARYAWAN' | 'ADMIN';
  jabatan: string;
  kantor_id: number;
  kantor_nama?: string;
  bidang_id: number;
  bidang_nama?: string;
  has_foto_profil: boolean;
  catatan_pendaftar: string;
  status: RegistrationStatus;
  nik_diberikan: string | null;
  alasan_keputusan: string | null;
  diproses_oleh: number | null;
  diproses_oleh_nama?: string | null;
  diproses_pada: string | null;
  created_at: string;
}

export interface ManagedAccount {
  user_id: number;
  karyawan_id: number | null;
  nik: string | null;
  username: string;
  email: string;
  nama_lengkap: string;
  no_hp: string;
  jabatan: string;
  role: Role;
  kantor_id: number | null;
  kantor_nama: string | null;
  bidang_id: number | null;
  bidang_nama: string | null;
  tanggal_masuk: string | null;
  user_aktif: number;
  karyawan_aktif: number | null;
  has_foto_profil: boolean;
  foto_profil_updated_at: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: number;
  nama_aplikasi: string;
  subjudul_login: string;
  judul_hero_login: string;
  deskripsi_login: string;
  judul_form_login: string;
  pengumuman_login: string;
  footer_login: string;
  has_custom_logo: boolean;
  logo_updated_at: string | null;
  has_custom_favicon: boolean;
  favicon_updated_at: string | null;
  retensi_foto_hari: number;
  wajib_gps_absensi: number;
  izin_demo_login: number;
  updated_at: string;
}

export interface SesiConfig {
  id?: number;
  kebijakan_id?: number;
  urutan: number;
  nama: string;
  jam_mulai: string;
  jam_selesai: string;
  wajib_foto: number;
  wajib_aktivitas: number;
  aktif: number;
}

export interface KebijakanAbsensi {
  id: number;
  level: PolicyLevel;
  bidang_id: number | null;
  karyawan_id: number | null;
  nama: string;
  jumlah_sesi: number;
  min_sesi_hadir: number;
  toleransi_terlambat_menit: number;
  aturan_lokasi: AttendanceLocationRule;
  wajib_foto_semua_sesi: number;
  wajib_aktivitas_sesi_lanjut: number;
  libur_dihitung_masuk: number;
  off_pengganti_dihitung_masuk: number;
  izin_dihitung_masuk: number;
  sakit_dihitung_masuk: number;
  cuti_dihitung_masuk: number;
  berlaku_mulai: string;
  aktif: number;
  created_at: string;
  bidang_nama?: string;
  karyawan_nama?: string;
  sesi?: SesiConfig[];
}

export interface KalenderKerja {
  id: number;
  kantor_id: number;
  hari_minggu: number; // 0 = Minggu ... 6 = Sabtu
  status_hari: 'HARI_KERJA' | 'HARI_LIBUR';
  jumlah_sesi_khusus: number | null;
  keterangan: string;
  kantor_nama?: string;
}

export interface HariLibur {
  id: number;
  tanggal: string;
  nama: string;
  kantor_id: number | null;
  kantor_nama?: string;
  dihitung_masuk: number;
  keterangan: string;
  created_by: number;
  created_at: string;
}

export interface KerjaKhusus {
  id: number;
  karyawan_id: number;
  karyawan_nama?: string;
  nik?: string;
  bidang_nama?: string;
  kantor_nama?: string;
  tanggal: string;
  nama_project: string;
  keterangan: string;
  jumlah_sesi: number;
  min_sesi_hadir: number;
  berhak_off_pengganti: number;
  status: 'AKTIF' | 'SELESAI' | 'DIBATALKAN';
  created_by: number;
  created_at: string;
}

export interface HakOffPengganti {
  id: number;
  karyawan_id: number;
  karyawan_nama?: string;
  kerja_khusus_id: number;
  tanggal_kerja_sumber: string;
  nama_project: string;
  status: 'TERSEDIA' | 'DIPAKAI' | 'HANGUS';
  kadaluarsa_pada: string | null;
  created_at: string;
}

export interface AbsensiSesiRecord {
  id: number;
  karyawan_id: number;
  tanggal: string;
  urutan_sesi: number;
  nama_sesi: string;
  waktu_server: string;
  status_ketepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
  keterlambatan_menit: number;
  lat: number | null;
  lng: number | null;
  accuracy_meter: number | null;
  jarak_kantor_meter: number | null;
  dalam_geofence: number;
  lokasi_alamat?: string | null;
  ip_address: string | null;
  user_agent: string | null;
  tipe_aktivitas: 'CHECK_IN' | 'AKTIVITAS' | 'STANDBY';
  deskripsi_aktivitas: string;
  foto_path: string | null;
  foto_checksum: string | null;
  has_foto?: boolean;
  policy_snapshot_json: string;
  created_at: string;
}

export interface Pengajuan {
  id: number;
  karyawan_id: number;
  karyawan_nama?: string;
  nik?: string;
  bidang_nama?: string;
  kantor_nama?: string;
  jenis: RequestType;
  tanggal_mulai: string;
  tanggal_akhir: string;
  alasan: string;
  catatan: string;
  lampiran_nama: string | null;
  hak_off_id: number | null;
  tanggal_kerja_sumber?: string | null;
  nama_project_sumber?: string | null;
  status: RequestStatus;
  diproses_oleh: number | null;
  diproses_oleh_nama?: string | null;
  diproses_pada: string | null;
  alasan_keputusan: string | null;
  created_at: string;
  updated_at: string;
  attendanceProofs?: {
    id: number;
    urutan_sesi: number;
    nama_sesi: string;
    waktu_server: string;
    status_ketepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
    jarak_kantor_meter: number | null;
    dalam_geofence: number;
    lokasi_alamat: string | null;
    deskripsi_aktivitas: string;
    has_foto: boolean;
  }[];
}

export interface OverrideKehadiran {
  id: number;
  karyawan_id: number;
  karyawan_nama?: string;
  tanggal: string;
  hasil_awal: string;
  hasil_override: PayrollStatus;
  alasan: string;
  admin_id: number;
  admin_nama?: string;
  created_at: string;
  aktif: number;
}

export interface ResolvedDay {
  tanggal: string;
  karyawanId: number;
  dayType: DayStatusType;
  dayLabel: string;
  operationalStatus: OperationalStatus;
  payrollStatus: PayrollStatus;
  payrollSource:
    | 'ABSENSI'
    | 'LIBUR_DIBAYAR'
    | 'LIBUR_TIDAK_DIBAYAR'
    | 'OFF_PENGGANTI'
    | 'CUTI'
    | 'IZIN'
    | 'SAKIT'
    | 'OFF'
    | 'OVERRIDE'
    | 'TIDAK_HADIR'
    | 'BELUM_SELESAI';
  isOverridden: boolean;
  overrideInfo: OverrideKehadiran | null;
  holidayInfo: { nama: string; dihitung_masuk: number; keterangan: string } | null;
  kerjaKhususInfo: KerjaKhusus | null;
  offPenggantiInfo: {
    pengajuanId: number;
    tanggalKerjaSumber: string;
    namaProject: string;
  } | null;
  pengajuanInfo: Pengajuan | null;
  policySnapshot: {
    policyId: number | null;
    policyName: string;
    level: PolicyLevel | 'KERJA_KHUSUS' | 'KALENDER_KHUSUS';
    jumlahSesi: number;
    minSesiHadir: number;
    toleransiTerlambatMenit: number;
    wajibFotoSemuaSesi: boolean;
    wajibAktivitasSesiLanjut: boolean;
    aturanLokasi: AttendanceLocationRule;
    sesiList: SesiConfig[];
  };
  sessionsCompleted: number;
  sessionsRequired: number;
  sessionRecords: AbsensiSesiRecord[];
  mustCheckIn: boolean;
  canStartHolidayWork?: boolean;
  holidayEmergencyRequest?: Pengajuan | null;
  checkinOverride?: {
    id: number;
    active: boolean;
    urutanSesi: number;
    namaSesi: string;
    alasan: string;
    berlakuSampai: string;
    adminNama: string;
  } | null;
}

export interface MonthlySummary {
  bulan: string;
  karyawanId: number;
  karyawanNama: string;
  nik: string;
  bidangNama: string;
  kantorNama: string;
  hariMasuk: number;
  tidakHadir: number;
  rincian: {
    hariKerja: number;
    hariLibur: number;
    kerjaKhusus: number;
    offPengganti: number;
    hadirAbsensi: number;
    liburDihitungMasuk: number;
    offDihitungMasuk: number;
    izin: number;
    sakit: number;
    cuti: number;
    offBiasa: number;
    terlambat: number;
    overrideMasuk: number;
    overrideTidakMasuk: number;
    totalOverride: number;
  };
  days: ResolvedDay[];
}

export interface WorkforceMember {
  karyawanId: number;
  nik: string;
  namaLengkap: string;
  jabatan: string;
  bidangId: number;
  bidangNama: string;
  kantorId: number;
  kantorNama: string;
  dayType: DayStatusType;
  operationalStatus: OperationalStatus;
  sessionsCompleted: number;
  sessionsTotal: number;
  lastSessionTime: string | null;
  isWorkingToday: boolean;
  sesi1Time: string | null;
  sesi1Terlambat: boolean;
  noHp?: string;
}

export interface AttendanceFeedPost {
  id: number;
  karyawanId: number;
  nik: string;
  namaLengkap: string;
  jabatan: string;
  role: Role;
  fotoProfilUpdatedAt: string | null;
  bidangId: number;
  bidangNama: string;
  kantorId: number;
  kantorNama: string;
  kantorAlamat: string;
  lokasiAktualAlamat: string | null;
  tanggal: string;
  urutanSesi: number;
  namaSesi: string;
  waktuServer: string;
  jamWib: string;
  statusKetepatan: 'TEPAT_WAKTU' | 'TERLAMBAT';
  keterlambatanMenit: number;
  jarakKantorMeter: number | null;
  dalamGeofence: boolean;
  lat: number | null;
  lng: number | null;
  tipeAktivitas: 'CHECK_IN' | 'AKTIVITAS' | 'STANDBY';
  deskripsiAktivitas: string;
  hasFoto: boolean;
  sessionsCompletedToday: number;
  sessionsTotalToday: number;
  operationalStatusToday: OperationalStatus;
}

export interface AttendanceFeedRosterItem extends WorkforceMember {
  role: Role;
  fotoProfilUpdatedAt: string | null;
}

export interface PeriodePayroll {
  id: number;
  bulan: string;
  kantor_id: number | null;
  kantor_nama?: string;
  status: 'OPEN' | 'CLOSED';
  ditutup_oleh: number | null;
  ditutup_oleh_nama?: string | null;
  ditutup_pada: string | null;
  catatan_closing: string | null;
  snapshot_json: string | null;
}

export interface AuditLog {
  id: number;
  actor_id: number;
  actor_name: string;
  actor_role: Role;
  waktu_server: string;
  ip_address: string | null;
  user_agent: string | null;
  modul: string;
  aksi: string;
  target_entity: string;
  target_id: string;
  karyawan_id: number | null;
  karyawan_nama?: string | null;
  tanggal_terdampak: string | null;
  before_json: string | null;
  after_json: string | null;
  alasan: string | null;
  ref_audit_id: number | null;
}
