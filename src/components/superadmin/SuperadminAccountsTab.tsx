import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Edit3,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  apiFetch,
  getAuthorizedRegistrationAvatarUrl,
} from '../../lib/api';
import {
  exportEmployeeDirectoryPng,
  printEmployeeDirectoryPdf,
} from '../../lib/employee-directory-export';
import { getServerWibDateString } from '../../lib/server-clock-client';
import type {
  AuthUser,
  BidangKerja,
  CakupanLokasiAbsensi,
  Kantor,
  ManagedAccount,
  PendaftaranAkun,
  Role,
  SystemSettings,
  WilayahOperasional,
} from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import {
  EmployeePlacementSection,
  type EmployeePlacementValue,
} from '../EmployeePlacementSection';
import { StatusBadge } from '../StatusBadge';
import { UserAvatar } from '../UserAvatar';

interface SuperadminAccountsTabProps {
  currentUser: AuthUser;
  settings?: SystemSettings | null;
  onCurrentUserUpdated: (user: AuthUser) => void;
  onPendingCountChange?: (count: number) => void;
}

function getRoleDisplayLabel(role: Role): string {
  if (role === 'SUPERADMIN') return 'SUPERADMIN';
  if (role === 'ADMIN') return 'OPERATOR';
  return 'KARYAWAN';
}

function RoleBadge({ role }: { role: Role }) {
  if (role === 'SUPERADMIN') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
        SUPERADMIN
      </span>
    );
  }
  if (role === 'ADMIN') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide bg-indigo-100 text-indigo-900 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800">
        OPERATOR
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
      KARYAWAN
    </span>
  );
}

export function SuperadminAccountsTab({
  currentUser,
  settings = null,
  onCurrentUserUpdated,
  onPendingCountChange,
}: SuperadminAccountsTabProps) {
  const [subtab, setSubtab] = useState<'registrations' | 'employees' | 'accounts'>('registrations');
  const [regStatusFilter, setRegStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [bidangFilter, setBidangFilter] = useState<string>('');
  const [officeFilter, setOfficeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'AKTIF' | 'KELUAR' | 'ALL'>('AKTIF');
  const [exportingDir, setExportingDir] = useState(false);

  // Dedicated Karyawan Directory Filters
  const [empStatusFilter, setEmpStatusFilter] = useState<'AKTIF' | 'KELUAR' | 'ALL'>('AKTIF');
  const [empOfficeFilter, setEmpOfficeFilter] = useState<string>('');
  const [empBidangFilter, setEmpBidangFilter] = useState<string>('');
  const [empRegionFilter, setEmpRegionFilter] = useState<string>('');

  const [registrations, setRegistrations] = useState<PendaftaranAkun[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [regions, setRegions] = useState<WilayahOperasional[]>([]);
  const [bidangList, setBidangList] = useState<Pick<BidangKerja, 'id' | 'kode' | 'nama'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Bulk Placement Modal
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkSelectedEmpIds, setBulkSelectedEmpIds] = useState<number[]>([]);
  const [bulkPlacement, setBulkPlacement] = useState<EmployeePlacementValue>({
    wilayah_penempatan_id: '',
    cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
    kantor_izin_ids: [],
  });

  // Approve modal state
  const [approveTarget, setApproveTarget] = useState<PendaftaranAkun | null>(null);
  const [approveForm, setApproveForm] = useState({
    nik: '',
    role: 'KARYAWAN' as 'KARYAWAN' | 'ADMIN',
    kantor_id: 1,
    bidang_id: 1,
    alasan_keputusan: 'Disetujui Superadmin — akun aktif digunakan',
    wilayah_penempatan_id: '',
    cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH' as CakupanLokasiAbsensi,
    kantor_izin_ids: [] as number[],
  });

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<PendaftaranAkun | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Account Create/Edit modal state
  const [accountModal, setAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ManagedAccount | null>(null);
  const [accountForm, setAccountForm] = useState({
    nik: '',
    nama_lengkap: '',
    username: '',
    email: '',
    no_hp: '',
    role: 'KARYAWAN' as Role,
    kantor_id: 1,
    bidang_id: 1,
    password: '',
    aktif: 1,
    fotoBase64: null as string | null,
    removePhoto: false,
    wilayah_penempatan_id: '',
    cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH' as CakupanLokasiAbsensi,
    kantor_izin_ids: [] as number[],
  });

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<ManagedAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Offboarding (Tandai Keluar / Nonaktif) modal state
  const [resignTarget, setResignTarget] = useState<ManagedAccount | null>(null);
  const [resignDate, setResignDate] = useState('');
  const [resignReason, setResignReason] = useState('');

  // Permanent Delete Account modal state
  const [deleteTarget, setDeleteTarget] = useState<ManagedAccount | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [modalErr, setModalErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [regRes, accRes] = await Promise.all([
        apiFetch<{ items: PendaftaranAkun[] }>('/api/v1/superadmin/registrations'),
        apiFetch<{
          items: ManagedAccount[];
          offices: Kantor[];
          regions?: WilayahOperasional[];
          bidangList: Pick<BidangKerja, 'id' | 'kode' | 'nama'>[];
        }>('/api/v1/superadmin/accounts'),
      ]);
      setRegistrations(regRes.items);
      setAccounts(accRes.items);
      setOffices(accRes.offices);
      setRegions(accRes.regions || []);
      setBidangList(accRes.bidangList);
      const pendingCount = regRes.items.filter((r) => r.status === 'PENDING').length;
      onPendingCountChange?.(pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data akun.');
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const isAccountActive = (a: ManagedAccount) =>
    a.user_aktif === 1 && (a.karyawan_id === null || a.karyawan_aktif === 1);

  const pendingRegsCount = registrations.filter((r) => r.status === 'PENDING').length;
  const employeeAccounts = accounts.filter((a) => a.role === 'KARYAWAN');
  const activeEmployeeCount = employeeAccounts.filter(isAccountActive).length;
  const resignedEmployeeCount = employeeAccounts.length - activeEmployeeCount;
  const incompletePlacementCount = employeeAccounts.filter(
    (a) =>
      isAccountActive(a) &&
      a.status_penempatan &&
      a.status_penempatan !== 'LENGKAP' &&
      a.status_penempatan !== 'TIDAK_DIPERLUKAN'
  ).length;

  const filteredRegs =
    regStatusFilter === 'ALL'
      ? registrations
      : registrations.filter((r) => r.status === regStatusFilter);

  const filteredEmployees = employeeAccounts.filter((a) => {
    const active = isAccountActive(a);
    if (empStatusFilter === 'AKTIF' && !active) return false;
    if (empStatusFilter === 'KELUAR' && active) return false;
    if (empOfficeFilter && String(a.kantor_id) !== empOfficeFilter) return false;
    if (empBidangFilter && String(a.bidang_id) !== empBidangFilter) return false;
    if (empRegionFilter === 'BELUM_LENGKAP') {
      if (
        !a.status_penempatan ||
        a.status_penempatan === 'LENGKAP' ||
        a.status_penempatan === 'TIDAK_DIPERLUKAN'
      ) {
        return false;
      }
    } else if (empRegionFilter && String(a.wilayah_penempatan_id || '') !== empRegionFilter) {
      return false;
    }
    return true;
  });

  const filteredAccounts = accounts.filter((a) => {
    const active = isAccountActive(a);
    if (statusFilter === 'AKTIF' && !active) return false;
    if (statusFilter === 'KELUAR' && active) return false;
    if (roleFilter && a.role !== roleFilter) return false;
    if (officeFilter && String(a.kantor_id) !== officeFilter) return false;
    if (bidangFilter) {
      if (a.role !== 'KARYAWAN') return false;
      if (String(a.bidang_id) !== bidangFilter) return false;
    }
    return true;
  });

  const getEmployeeExportPayload = () => {
    const statusLabel =
      empStatusFilter === 'AKTIF'
        ? 'Karyawan Aktif'
        : empStatusFilter === 'KELUAR'
        ? 'Karyawan Keluar / Nonaktif'
        : 'Semua Status Karyawan';
    const officeLabel = empOfficeFilter
      ? offices.find((o) => String(o.id) === empOfficeFilter)?.nama || 'Kantor Terpilih'
      : 'Semua Kantor';
    const bidangLabel = empBidangFilter
      ? bidangList.find((b) => String(b.id) === empBidangFilter)?.nama || 'Bidang Terpilih'
      : 'Semua Bidang Kerja';
    return {
      items: filteredEmployees.map((a) => ({
        nik: a.nik || '—',
        nama_lengkap: a.nama_lengkap,
        username: a.username,
        email: a.email,
        no_hp: a.no_hp,
        kantor_nama: a.kantor_nama || '-',
        bidang_nama: a.bidang_nama || '-',
        tanggal_masuk: a.tanggal_masuk || '-',
        tanggal_keluar: a.tanggal_keluar ?? null,
        alasan_keluar: a.alasan_keluar ?? '',
        aktif: isAccountActive(a) ? 1 : 0,
      })),
      settings,
      printedByName: currentUser.nama_lengkap,
      printedByRoleLabel: 'Superadmin / Owner',
      statusLabel,
      officeLabel,
      bidangLabel,
    };
  };

  const handleExportEmployeePng = async () => {
    if (exportingDir || filteredEmployees.length === 0) return;
    setExportingDir(true);
    setError(null);
    try {
      await exportEmployeeDirectoryPng(getEmployeeExportPayload());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengekspor PNG daftar karyawan.');
    } finally {
      setExportingDir(false);
    }
  };

  const handleExportEmployeePdf = () => {
    if (filteredEmployees.length === 0) return;
    printEmployeeDirectoryPdf(getEmployeeExportPayload());
  };

  const openApproveModal = (r: PendaftaranAkun) => {
    setApproveTarget(r);
    const linkedOffice = offices.find((o) => o.id === r.kantor_id);
    setApproveForm({
      nik: '',
      role: r.role_diminta,
      kantor_id: r.kantor_id,
      bidang_id: r.bidang_id || bidangList[0]?.id || 1,
      alasan_keputusan: 'Disetujui Superadmin — akun aktif digunakan',
      wilayah_penempatan_id: linkedOffice?.wilayah_id ? String(linkedOffice.wilayah_id) : '',
      cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
      kantor_izin_ids: [],
    });
    setModalErr(null);
  };

  const submitApprove = async (e: FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    if (
      approveForm.role === 'KARYAWAN' &&
      approveForm.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' &&
      approveForm.wilayah_penempatan_id &&
      approveForm.kantor_izin_ids.length === 0
    ) {
      setModalErr('Pilih minimal satu kantor yang diizinkan untuk mode Kantor Tertentu.');
      return;
    }
    setSaving(true);
    setModalErr(null);
    try {
      const res = await apiFetch<{ nik: string }>(
        `/api/v1/superadmin/registrations/${approveTarget.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            nik: approveForm.nik,
            role: approveForm.role,
            kantor_id: approveForm.kantor_id,
            bidang_id: approveForm.role === 'KARYAWAN' ? approveForm.bidang_id : undefined,
            alasan_keputusan: approveForm.alasan_keputusan,
            wilayah_penempatan_id:
              approveForm.role === 'KARYAWAN' && approveForm.wilayah_penempatan_id
                ? Number(approveForm.wilayah_penempatan_id)
                : null,
            cakupan_lokasi_absensi:
              approveForm.role === 'KARYAWAN' ? approveForm.cakupan_lokasi_absensi : null,
            kantor_izin_ids:
              approveForm.role === 'KARYAWAN' &&
              approveForm.cakupan_lokasi_absensi === 'KANTOR_TERTENTU'
                ? approveForm.kantor_izin_ids
                : [],
          }),
        }
      );
      setApproveTarget(null);
      setBannerMsg(
        `Akun @${approveTarget.username} (${getRoleDisplayLabel(approveForm.role)}) telah di-ACC dengan NIK ${res.nik}.`
      );
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal menyetujui pendaftaran.');
    } finally {
      setSaving(false);
    }
  };

  const submitReject = async (e: FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setSaving(true);
    setModalErr(null);
    try {
      await apiFetch(`/api/v1/superadmin/registrations/${rejectTarget.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ alasan_keputusan: rejectReason }),
      });
      setRejectTarget(null);
      setRejectReason('');
      setBannerMsg(`Pendaftaran @${rejectTarget.username} telah ditolak.`);
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal menolak pendaftaran.');
    } finally {
      setSaving(false);
    }
  };

  const openBulkPlacementModal = (onlyIncomplete = true) => {
    const activeKaryawan = employeeAccounts.filter(
      (a) => isAccountActive(a) && a.karyawan_id !== null
    );
    const defaultIds = onlyIncomplete
      ? activeKaryawan
          .filter((a) => a.status_penempatan && a.status_penempatan !== 'LENGKAP')
          .map((a) => a.karyawan_id as number)
      : activeKaryawan.map((a) => a.karyawan_id as number);
    setBulkSelectedEmpIds(defaultIds);
    setBulkPlacement({
      wilayah_penempatan_id: '',
      cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
      kantor_izin_ids: [],
    });
    setModalErr(null);
    setBulkModal(true);
  };

  const submitBulkPlacement = async (e: FormEvent) => {
    e.preventDefault();
    if (bulkSelectedEmpIds.length === 0) {
      setModalErr('Pilih minimal satu karyawan untuk diatur penempatannya.');
      return;
    }
    if (!bulkPlacement.wilayah_penempatan_id) {
      setModalErr('Pilih Wilayah Penempatan terlebih dahulu.');
      return;
    }
    if (
      bulkPlacement.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' &&
      bulkPlacement.kantor_izin_ids.length === 0
    ) {
      setModalErr('Pilih minimal satu kantor yang diizinkan untuk mode Kantor Tertentu.');
      return;
    }
    setSaving(true);
    setModalErr(null);
    try {
      const resp = await apiFetch<{ ok: boolean; updatedCount: number; wilayahNama: string }>(
        '/api/v1/master/employees/bulk-placement',
        {
          method: 'POST',
          body: JSON.stringify({
            karyawan_ids: bulkSelectedEmpIds,
            wilayah_penempatan_id: Number(bulkPlacement.wilayah_penempatan_id),
            cakupan_lokasi_absensi: bulkPlacement.cakupan_lokasi_absensi,
            kantor_izin_ids: bulkPlacement.kantor_izin_ids,
          }),
        }
      );
      setBulkModal(false);
      setBannerMsg(
        `Penempatan ${resp.updatedCount} karyawan berhasil diperbarui ke wilayah "${resp.wilayahNama}".`
      );
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal memperbarui penempatan massal.');
    } finally {
      setSaving(false);
    }
  };

  const openCreateAccount = () => {
    setEditingAccount(null);
    const defaultOffice = offices[0];
    setAccountForm({
      nik: '',
      nama_lengkap: '',
      username: '',
      email: '',
      no_hp: '',
      role: 'KARYAWAN',
      kantor_id: defaultOffice?.id ?? 1,
      bidang_id: bidangList[0]?.id ?? 1,
      password: '',
      aktif: 1,
      fotoBase64: null,
      removePhoto: false,
      wilayah_penempatan_id: defaultOffice?.wilayah_id ? String(defaultOffice.wilayah_id) : '',
      cakupan_lokasi_absensi: 'SEMUA_KANTOR_DALAM_WILAYAH',
      kantor_izin_ids: [],
    });
    setModalErr(null);
    setAccountModal(true);
  };

  const openEditAccount = (acc: ManagedAccount) => {
    setEditingAccount(acc);
    setAccountForm({
      nik: acc.nik || '',
      nama_lengkap: acc.nama_lengkap,
      username: acc.username,
      email: acc.email,
      no_hp: acc.no_hp,
      role: acc.role,
      kantor_id: acc.kantor_id ?? offices[0]?.id ?? 1,
      bidang_id: acc.bidang_id ?? bidangList[0]?.id ?? 1,
      password: '',
      aktif: acc.user_aktif,
      fotoBase64: null,
      removePhoto: false,
      wilayah_penempatan_id: acc.wilayah_penempatan_id ? String(acc.wilayah_penempatan_id) : '',
      cakupan_lokasi_absensi: acc.cakupan_lokasi_absensi || 'SEMUA_KANTOR_DALAM_WILAYAH',
      kantor_izin_ids: Array.isArray(acc.kantor_izin_ids) ? acc.kantor_izin_ids : [],
    });
    setModalErr(null);
    setAccountModal(true);
  };

  const handleAccountPhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setModalErr('Ukuran foto profil maksimal 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAccountForm((prev) => ({
          ...prev,
          fotoBase64: reader.result as string,
          removePhoto: false,
        }));
        setModalErr(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const submitAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingAccount && accountForm.role !== 'SUPERADMIN' && !accountForm.fotoBase64) {
      setModalErr('Foto profil wajib diunggah untuk membuat akun Karyawan maupun Operator.');
      return;
    }
    if (
      accountForm.role === 'KARYAWAN' &&
      accountForm.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' &&
      accountForm.wilayah_penempatan_id &&
      accountForm.kantor_izin_ids.length === 0
    ) {
      setModalErr('Pilih minimal satu kantor yang diizinkan untuk mode Kantor Tertentu.');
      return;
    }
    setSaving(true);
    setModalErr(null);
    const placementPayload =
      accountForm.role === 'KARYAWAN'
        ? {
            wilayah_penempatan_id: accountForm.wilayah_penempatan_id
              ? Number(accountForm.wilayah_penempatan_id)
              : null,
            cakupan_lokasi_absensi: accountForm.cakupan_lokasi_absensi,
            kantor_izin_ids:
              accountForm.cakupan_lokasi_absensi === 'KANTOR_TERTENTU'
                ? accountForm.kantor_izin_ids
                : [],
          }
        : {
            wilayah_penempatan_id: null,
            cakupan_lokasi_absensi: null,
            kantor_izin_ids: [],
          };
    try {
      if (editingAccount) {
        await apiFetch(`/api/v1/superadmin/accounts/${editingAccount.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nama_lengkap: accountForm.nama_lengkap,
            username: accountForm.username,
            email: accountForm.email,
            no_hp: accountForm.no_hp,
            role: accountForm.role,
            kantor_id: accountForm.role === 'KARYAWAN' ? accountForm.kantor_id : undefined,
            bidang_id: accountForm.role === 'KARYAWAN' ? accountForm.bidang_id : undefined,
            aktif: accountForm.aktif,
            fotoBase64: accountForm.fotoBase64,
            removePhoto: accountForm.removePhoto,
            ...placementPayload,
          }),
        });
        if (editingAccount.user_id === currentUser.id) {
          const me = await apiFetch<{ user: AuthUser }>('/api/v1/auth/me');
          onCurrentUserUpdated(me.user);
        }
        setBannerMsg(
          `Data akun @${accountForm.username} (${getRoleDisplayLabel(accountForm.role)}) berhasil diperbarui.`
        );
      } else {
        const res = await apiFetch<{ nik?: string }>('/api/v1/superadmin/accounts', {
          method: 'POST',
          body: JSON.stringify({
            ...accountForm,
            kantor_id: accountForm.role === 'KARYAWAN' ? accountForm.kantor_id : undefined,
            bidang_id: accountForm.role === 'KARYAWAN' ? accountForm.bidang_id : undefined,
            ...placementPayload,
          }),
        });
        setBannerMsg(
          accountForm.role === 'SUPERADMIN'
            ? `Akun SUPERADMIN @${accountForm.username} berhasil dibuat sebagai akun pemilik tanpa profil pegawai.`
            : `Akun @${accountForm.username} (${getRoleDisplayLabel(accountForm.role)}) berhasil dibuat dengan NIK ${res.nik}.`
        );
      }
      setAccountModal(false);
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal menyimpan data akun.');
    } finally {
      setSaving(false);
    }
  };

  const submitResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setSaving(true);
    setModalErr(null);
    try {
      await apiFetch(`/api/v1/superadmin/accounts/${resetTarget.user_id}/reset-password`, {
        method: 'PUT',
        body: JSON.stringify({ newPassword }),
      });
      setBannerMsg(`Kata sandi akun @${resetTarget.username} berhasil direset.`);
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal mereset kata sandi.');
    } finally {
      setSaving(false);
    }
  };

  const openResignModal = (acc: ManagedAccount) => {
    setResignTarget(acc);
    setResignDate(getServerWibDateString());
    setResignReason('');
    setModalErr(null);
  };

  const submitResignAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!resignTarget) return;
    setSaving(true);
    setModalErr(null);
    try {
      if (resignTarget.role === 'KARYAWAN' && resignTarget.karyawan_id) {
        await apiFetch(`/api/v1/master/employees/${resignTarget.karyawan_id}/status`, {
          method: 'POST',
          body: JSON.stringify({
            aktif: 0,
            tanggal_keluar: resignDate,
            alasan_keluar: resignReason,
          }),
        });
      } else {
        await apiFetch(`/api/v1/superadmin/accounts/${resignTarget.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            aktif: 0,
            tanggal_keluar: resignDate,
            alasan_keluar: resignReason,
          }),
        });
      }
      setBannerMsg(
        `${resignTarget.nama_lengkap} (@${resignTarget.username}) ditandai KELUAR per ${resignDate}. Sesi login diputus & riwayat tetap tersimpan.`
      );
      setResignTarget(null);
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal menandai akun keluar.');
    } finally {
      setSaving(false);
    }
  };

  const handleReactivateAccount = async (acc: ManagedAccount) => {
    setSaving(true);
    setError(null);
    try {
      if (acc.role === 'KARYAWAN' && acc.karyawan_id) {
        await apiFetch(`/api/v1/master/employees/${acc.karyawan_id}/status`, {
          method: 'POST',
          body: JSON.stringify({
            aktif: 1,
            alasan_keluar: 'Diaktifkan kembali oleh Superadmin',
          }),
        });
      } else {
        await apiFetch(`/api/v1/superadmin/accounts/${acc.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({ aktif: 1, tanggal_keluar: null, alasan_keluar: '' }),
        });
      }
      setBannerMsg(`Akun ${acc.nama_lengkap} (@${acc.username}) berhasil diaktifkan kembali.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengaktifkan kembali akun.');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteAccountModal = (acc: ManagedAccount) => {
    setDeleteTarget(acc);
    setDeleteReason('');
    setDeleteConfirmText('');
    setModalErr(null);
  };

  const submitDeleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setModalErr('Ketik kata HAPUS pada kolom konfirmasi untuk menghapus permanen.');
      return;
    }
    setSaving(true);
    setModalErr(null);
    try {
      await apiFetch(`/api/v1/superadmin/accounts/${deleteTarget.user_id}`, {
        method: 'DELETE',
        body: JSON.stringify({ alasan: deleteReason }),
      });
      setBannerMsg(
        `Akun ${deleteTarget.nama_lengkap} (@${deleteTarget.username}) telah dihapus permanen dan dicatat di Audit Trail.`
      );
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Gagal menghapus akun secara permanen.');
    } finally {
      setSaving(false);
    }
  };

  const regCols: ColumnDef<PendaftaranAkun>[] = [
    {
      key: 'pemohon',
      header: 'Pendaftar & Foto',
      sortValue: (r) => r.nama_lengkap,
      render: (r) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            name={r.nama_lengkap}
            role={r.role_diminta}
            subtitle={
              r.role_diminta === 'KARYAWAN'
                ? [r.bidang_nama, r.kantor_nama?.split('(')[0].trim()].filter(Boolean).join(' · ')
                : `Calon Operator · ${r.kantor_nama?.split('(')[0].trim() || ''}`
            }
            srcOverride={getAuthorizedRegistrationAvatarUrl(r.id)}
            size="md"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {r.nama_lengkap}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              @{r.username} · {r.email}
            </p>
            {r.no_hp && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{r.no_hp}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role Diminta',
      sortValue: (r) => r.role_diminta,
      render: (r) => (
        <div className="space-y-1 text-xs">
          <RoleBadge role={r.role_diminta} />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {r.role_diminta === 'ADMIN' ? 'Pengelola & approval' : 'Absensi harian'}
          </p>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Kantor & Bidang Kerja',
      render: (r) => (
        <div className="text-xs space-y-0.5">
          <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
          {r.role_diminta === 'KARYAWAN' ? (
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              Bidang: {r.bidang_nama}
            </p>
          ) : (
            <p className="text-slate-400 dark:text-slate-500 italic">
              Tanpa bidang kerja (Operator)
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status ACC',
      sortValue: (r) => r.status,
      render: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.status} />
          {r.nik_diberikan && (
            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
              NIK: {r.nik_diberikan}
            </p>
          )}
          {r.alasan_keputusan && r.status !== 'PENDING' && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs truncate">
              {r.alasan_keputusan}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'aksi',
      header: 'Keputusan Superadmin',
      align: 'right',
      render: (r) =>
        r.status === 'PENDING' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openApproveModal(r)}
              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              ACC Akun
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectTarget(r);
                setRejectReason('');
                setModalErr(null);
              }}
              className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-800 dark:text-red-300 text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <XCircle className="w-3.5 h-3.5" />
              Tolak
            </button>
          </div>
        ) : (
          <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
            {r.diproses_pada ? r.diproses_pada.slice(0, 10) : 'Selesai'}
          </span>
        ),
    },
  ];

  const accountCols: ColumnDef<ManagedAccount>[] = [
    {
      key: 'user',
      header: 'Foto & Identitas Akun',
      sortValue: (r) => r.nama_lengkap,
      render: (r) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            karyawanId={r.karyawan_id}
            userId={r.user_id}
            name={r.nama_lengkap}
            role={r.role}
            subtitle={
              r.role === 'SUPERADMIN'
                ? 'Pemilik Sistem'
                : r.role === 'ADMIN'
                ? `Operator · ${r.kantor_nama?.split('(')[0].trim() || ''}`
                : [r.nik, r.bidang_nama, r.kantor_nama?.split('(')[0].trim()].filter(Boolean).join(' · ')
            }
            version={r.foto_profil_updated_at}
            size="md"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {r.nama_lengkap}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {r.nik ? (
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">NIK {r.nik}</span>
              ) : (
                <span className="font-semibold text-amber-700 dark:text-amber-300">Akun sistem · Non-Pegawai</span>
              )}{' '}· @{r.username} · {r.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (r) => r.role,
      render: (r) => (
        <div className="space-y-1 text-xs">
          <RoleBadge role={r.role} />
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {r.role === 'SUPERADMIN'
              ? 'Pemilik sistem'
              : r.role === 'ADMIN'
              ? 'Pengelola absensi & payroll'
              : 'Karyawan absensi harian'}
          </p>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Kantor & Bidang Kerja',
      sortValue: (r) => `${r.kantor_nama || ''} ${r.role === 'KARYAWAN' ? r.bidang_nama || '' : ''}`,
      render: (r) => (
        <div className="text-xs space-y-0.5">
          {r.role === 'SUPERADMIN' ? (
            <>
              <p className="font-medium text-amber-700 dark:text-amber-300">Akun Pemilik Sistem</p>
              <p className="text-slate-500 dark:text-slate-400">Non-pegawai</p>
            </>
          ) : r.role === 'ADMIN' ? (
            <>
              <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
              <p className="text-slate-400 dark:text-slate-500 italic">Tanpa bidang kerja (Operator)</p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                Bidang: {r.bidang_nama}
              </p>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status Akun',
      sortValue: (r) => (isAccountActive(r) ? 1 : 0),
      render: (r) => {
        const active = isAccountActive(r);
        return (
          <div className="text-xs space-y-0.5">
            {active ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                AKTIF
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-900 border border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800">
                KELUAR / NONAKTIF
              </span>
            )}
            {r.tanggal_masuk && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Masuk: {r.tanggal_masuk}
              </p>
            )}
            {!active && r.tanggal_keluar && (
              <p className="text-[11px] font-mono text-red-700 dark:text-red-400">
                Keluar: {r.tanggal_keluar}
              </p>
            )}
            {!active && r.alasan_keluar && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[160px] truncate" title={r.alasan_keluar}>
                {r.alasan_keluar}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'aksi',
      header: 'Kelola',
      align: 'right',
      render: (r) => {
        const active = isAccountActive(r);
        const isSelf = r.user_id === currentUser.id;
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEditAccount(r)}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Kelola
            </button>
            <button
              type="button"
              onClick={() => {
                setResetTarget(r);
                setNewPassword('');
                setModalErr(null);
              }}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-amber-800 dark:text-amber-300"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Sandi
            </button>
            {!isSelf &&
              (active ? (
                <button
                  type="button"
                  onClick={() => openResignModal(r)}
                  title="Tandai keluar / nonaktifkan akun (riwayat absensi tetap aman)"
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-xs font-semibold text-amber-800 dark:text-amber-300"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  Keluar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleReactivateAccount(r)}
                  title="Aktifkan kembali akun ini"
                  className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold text-emerald-800 dark:text-emerald-300 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Aktifkan
                </button>
              ))}
            {!isSelf && (
              <button
                type="button"
                onClick={() => openDeleteAccountModal(r)}
                title="Hapus permanen akun dan seluruh data terkaitnya"
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Hapus
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const employeeDirectoryCols: ColumnDef<ManagedAccount>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik || '',
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
          {r.nik || '—'}
        </span>
      ),
    },
    {
      key: 'nama',
      header: 'Nama & Kontak',
      sortValue: (r) => r.nama_lengkap,
      render: (r) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            karyawanId={r.karyawan_id}
            userId={r.user_id}
            name={r.nama_lengkap}
            role={r.role}
            subtitle={[r.nik, r.bidang_nama, r.kantor_nama?.split('(')[0].trim()].filter(Boolean).join(' · ')}
            version={r.foto_profil_updated_at}
            size="sm"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {r.nama_lengkap}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              @{r.username} · {r.no_hp || r.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Kantor & Bidang Kerja',
      sortValue: (r) => `${r.kantor_nama || ''} ${r.bidang_nama || ''}`,
      render: (r) => (
        <div className="text-xs space-y-0.5">
          <p className="font-medium text-slate-800 dark:text-slate-200">
            {(r.kantor_nama || '').split('(')[0].trim()}
          </p>
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">
            Bidang: {r.bidang_nama}
          </p>
        </div>
      ),
    },
    {
      key: 'wilayah',
      header: 'Penempatan & Cakupan',
      sortValue: (r) => `${r.wilayah_penempatan_nama || 'ZZZ'} ${r.cakupan_lokasi_absensi || ''}`,
      render: (r) => {
        if (r.status_penempatan === 'WILAYAH_BELUM_DIISI' || !r.wilayah_penempatan_id) {
          return (
            <div className="space-y-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                <AlertTriangle className="w-3 h-3" />
                Penempatan Belum Diisi
              </span>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Tanpa pengecualian luar wilayah
              </p>
            </div>
          );
        }
        const isSpecific = r.cakupan_lokasi_absensi === 'KANTOR_TERTENTU';
        const allowedCount = r.kantor_izin_ids?.length || 0;
        return (
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
              <Globe className="w-3 h-3 text-brand-600 dark:text-brand-400 shrink-0" />
              <span>{r.wilayah_penempatan_nama}</span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isSpecific
                ? `Kantor Tertentu (${allowedCount})`
                : 'Semua Kantor dalam Wilayah'}
            </p>
            {r.status_penempatan === 'POLYGON_WILAYAH_BELUM_LENGKAP' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                Polygon belum lengkap
              </span>
            )}
            {r.status_penempatan === 'KANTOR_TERTENTU_KOSONG' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-300">
                Daftar kantor belum dipilih
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status & Masa Kerja',
      sortValue: (r) => `${isAccountActive(r) ? '1' : '0'}_${r.tanggal_masuk || ''}`,
      render: (r) => {
        const active = isAccountActive(r);
        return (
          <div className="text-xs space-y-0.5">
            {active ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                AKTIF
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-900 border border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800">
                KELUAR
              </span>
            )}
            {r.tanggal_masuk && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Masuk: {r.tanggal_masuk}
              </p>
            )}
            {!active && r.tanggal_keluar && (
              <p className="text-[11px] font-mono text-red-700 dark:text-red-400">
                Keluar: {r.tanggal_keluar}
              </p>
            )}
            {!active && r.alasan_keluar && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate" title={r.alasan_keluar}>
                {r.alasan_keluar}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'aksi',
      header: 'Aksi',
      align: 'right',
      render: (r) => {
        const active = isAccountActive(r);
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => openEditAccount(r)}
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </button>
            {active ? (
              <button
                type="button"
                onClick={() => openResignModal(r)}
                title="Tandai karyawan keluar / resign (riwayat absensi tetap aman)"
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-xs font-semibold text-amber-800 dark:text-amber-300"
              >
                <UserMinus className="w-3.5 h-3.5" />
                Keluar
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleReactivateAccount(r)}
                title="Aktifkan kembali akun karyawan ini"
                className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold text-emerald-800 dark:text-emerald-300 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Aktifkan
              </button>
            )}
            <button
              type="button"
              onClick={() => openDeleteAccountModal(r)}
              title="Hapus permanen data karyawan beserta akunnya"
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-xs font-semibold text-red-700 dark:text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Hapus
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Manajemen Akun, Daftar Karyawan & Persetujuan (ACC)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Setujui pendaftaran baru, kelola karyawan aktif/keluar, export daftar untuk Direktur, dan kelola seluruh akun sistem.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {subtab === 'employees' && (
            <>
              <button
                type="button"
                disabled={loading || activeEmployeeCount === 0}
                onClick={() => openBulkPlacementModal(incompletePlacementCount > 0)}
                title="Atur wilayah penempatan dan cakupan lokasi absensi untuk banyak karyawan sekaligus"
                className="min-h-[40px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Layers className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                Atur Penempatan Massal
              </button>
              <button
                type="button"
                disabled={loading || exportingDir || filteredEmployees.length === 0}
                onClick={() => void handleExportEmployeePng()}
                title="Unduh daftar karyawan sesuai filter aktif dalam format gambar PNG HD (siap kirim ke Direktur)"
                className="min-h-[40px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <ImageIcon className="w-4 h-4" />
                {exportingDir ? 'Membuat PNG...' : 'Export PNG'}
              </button>
              <button
                type="button"
                disabled={loading || filteredEmployees.length === 0}
                onClick={handleExportEmployeePdf}
                title="Cetak atau simpan daftar karyawan sebagai dokumen PDF resmi untuk Direktur"
                className="min-h-[40px] px-3.5 bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                Cetak / PDF
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openCreateAccount}
            className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            Buat Akun Langsung
          </button>
        </div>
      </div>

      {bannerMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-900 dark:text-emerald-300 font-medium flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            {bannerMsg}
          </span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <X className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </button>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-navy-900 text-white rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-brand-200 font-medium">MENUNGGU ACC</p>
          <p className="font-mono text-2xl font-bold tabular-nums mt-1">{pendingRegsCount}</p>
          <p className="text-[11px] text-slate-300 mt-1">Pendaftaran baru</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            KARYAWAN AKTIF
          </p>
          <p className="font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
            {activeEmployeeCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {resignedEmployeeCount > 0 ? `${resignedEmployeeCount} keluar / nonaktif` : 'Semua karyawan aktif'}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            OPERATOR
          </p>
          <p className="font-mono text-2xl font-bold text-indigo-700 dark:text-indigo-400 tabular-nums mt-1">
            {accounts.filter((a) => a.role === 'ADMIN' && isAccountActive(a)).length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Pengelola approval & payroll
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            TOTAL AKUN AKTIF
          </p>
          <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
            {accounts.filter(isAccountActive).length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Dari {accounts.length} akun terdaftar
          </p>
        </div>
      </div>

      {/* Subtab Switcher */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex p-1 bg-slate-200/75 dark:bg-slate-800 rounded-lg gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setSubtab('registrations')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              subtab === 'registrations'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Antrean ACC Pendaftaran ({pendingRegsCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubtab('employees')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              subtab === 'employees'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>
              Daftar Karyawan ({activeEmployeeCount} Aktif
              {resignedEmployeeCount > 0 ? ` · ${resignedEmployeeCount} Keluar` : ''})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSubtab('accounts')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              subtab === 'accounts'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Seluruh Akun ({accounts.length})</span>
          </button>
        </div>
      </div>

      {subtab === 'registrations' ? (
        <DataTable
          data={filteredRegs}
          columns={regCols}
          getRowId={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={loadAll}
          emptyTitle="Tidak ada pengajuan pendaftaran"
          emptyDescription="Pendaftaran baru dari halaman login akan muncul di sini untuk di-ACC Superadmin."
          searchPlaceholder="Cari nama, username, email, role, atau bidang kerja..."
          searchFilter={(r, q) =>
            r.nama_lengkap.toLowerCase().includes(q) ||
            r.username.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            getRoleDisplayLabel(r.role_diminta).toLowerCase().includes(q) ||
            (r.role_diminta === 'KARYAWAN' ? (r.bidang_nama || '').toLowerCase().includes(q) : false)
          }
          filterToolbar={
            <select
              value={regStatusFilter}
              onChange={(e) =>
                setRegStatusFilter(e.target.value as 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL')
              }
              className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg w-full sm:w-auto"
            >
              <option value="PENDING">Menunggu ACC ({pendingRegsCount})</option>
              <option value="APPROVED">Sudah Disetujui</option>
              <option value="REJECTED">Ditolak</option>
              <option value="ALL">Semua Riwayat</option>
            </select>
          }
        />
      ) : subtab === 'employees' ? (
        <div className="space-y-4">
          {incompletePlacementCount > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/90 dark:bg-amber-950/35 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">
                    {incompletePlacementCount} karyawan aktif belum memiliki konfigurasi wilayah penempatan yang lengkap.
                  </p>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                    Karyawan yang belum dikonfigurasi tidak mendapat pengecualian geofence luar wilayah otomatis. Lengkapi secara massal atau per akun.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEmpRegionFilter('BELUM_LENGKAP')}
                  className="min-h-[36px] px-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-white/80 dark:bg-slate-900/60 text-amber-900 dark:text-amber-200 text-xs font-semibold"
                >
                  Tampilkan ({incompletePlacementCount})
                </button>
                <button
                  type="button"
                  onClick={() => openBulkPlacementModal(true)}
                  className="min-h-[36px] px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                >
                  Lengkapi Massal
                </button>
              </div>
            </div>
          )}

          <DataTable
            data={filteredEmployees}
            columns={employeeDirectoryCols}
            getRowId={(r) => r.user_id}
            loading={loading}
            error={error}
            onRetry={loadAll}
            emptyTitle={
              empStatusFilter === 'KELUAR'
                ? 'Belum ada karyawan berstatus keluar / nonaktif'
                : 'Tidak ada karyawan sesuai filter'
            }
            emptyDescription="Ubah filter status, wilayah, kantor, atau bidang kerja untuk melihat data lainnya."
            searchPlaceholder="Cari NIK, nama, no. HP, email, wilayah, kantor, atau bidang kerja..."
            searchFilter={(r, q) =>
              r.nama_lengkap.toLowerCase().includes(q) ||
              (r.nik || '').toLowerCase().includes(q) ||
              r.username.toLowerCase().includes(q) ||
              r.email.toLowerCase().includes(q) ||
              (r.no_hp || '').toLowerCase().includes(q) ||
              (r.wilayah_penempatan_nama || '').toLowerCase().includes(q) ||
              (r.kantor_nama || '').toLowerCase().includes(q) ||
              (r.bidang_nama || '').toLowerCase().includes(q)
            }
            filterToolbar={
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <select
                  value={empStatusFilter}
                  onChange={(e) => setEmpStatusFilter(e.target.value as 'AKTIF' | 'KELUAR' | 'ALL')}
                  className="h-11 sm:h-9 px-2.5 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="AKTIF">Aktif ({activeEmployeeCount})</option>
                  <option value="KELUAR">Keluar / Nonaktif ({resignedEmployeeCount})</option>
                  <option value="ALL">Semua ({employeeAccounts.length})</option>
                </select>
                <select
                  value={empRegionFilter}
                  onChange={(e) => setEmpRegionFilter(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="">Semua Wilayah</option>
                  <option value="BELUM_LENGKAP">
                    Penempatan Belum Lengkap ({incompletePlacementCount})
                  </option>
                  {regions.map((reg) => (
                    <option key={reg.id} value={String(reg.id)}>
                      Wilayah: {reg.nama}
                    </option>
                  ))}
                </select>
                <select
                  value={empOfficeFilter}
                  onChange={(e) => setEmpOfficeFilter(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="">Semua Kantor</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nama.split('(')[0].trim()}
                    </option>
                  ))}
                </select>
                <select
                  value={empBidangFilter}
                  onChange={(e) => setEmpBidangFilter(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="">Semua Bidang Kerja</option>
                  {bidangList.map((b) => (
                    <option key={b.id} value={b.id}>
                      Bidang: {b.nama}
                    </option>
                  ))}
                </select>
              </div>
            }
          />
        </div>
      ) : (
        <DataTable
          data={filteredAccounts}
          columns={accountCols}
          getRowId={(r) => r.user_id}
          loading={loading}
          error={error}
          onRetry={loadAll}
          searchPlaceholder="Cari NIK, nama, username, email, atau bidang kerja..."
          searchFilter={(r, q) =>
            r.nama_lengkap.toLowerCase().includes(q) ||
            (r.nik || '').toLowerCase().includes(q) ||
            r.username.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            getRoleDisplayLabel(r.role).toLowerCase().includes(q) ||
            (r.role === 'KARYAWAN' ? (r.bidang_nama || '').toLowerCase().includes(q) : false)
          }
          filterToolbar={
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'AKTIF' | 'KELUAR' | 'ALL')}
                className="h-11 sm:h-9 px-2.5 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
              >
                <option value="AKTIF">Aktif ({accounts.filter(isAccountActive).length})</option>
                <option value="KELUAR">Keluar / Nonaktif ({accounts.filter((a) => !isAccountActive(a)).length})</option>
                <option value="ALL">Semua Status ({accounts.length})</option>
              </select>
              <select
                value={roleFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setRoleFilter(next);
                  if (next === 'ADMIN' || next === 'SUPERADMIN') {
                    setBidangFilter('');
                  }
                }}
                className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
              >
                <option value="">Semua Role</option>
                <option value="KARYAWAN">KARYAWAN</option>
                <option value="ADMIN">OPERATOR</option>
                <option value="SUPERADMIN">SUPERADMIN</option>
              </select>
              {roleFilter !== 'SUPERADMIN' && (
                <select
                  value={officeFilter}
                  onChange={(e) => setOfficeFilter(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="">Semua Kantor</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nama.split('(')[0].trim()}
                    </option>
                  ))}
                </select>
              )}
              {roleFilter !== 'ADMIN' && roleFilter !== 'SUPERADMIN' && (
                <select
                  value={bidangFilter}
                  onChange={(e) => setBidangFilter(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg flex-1 sm:flex-none"
                >
                  <option value="">Semua Bidang Kerja</option>
                  {bidangList.map((b) => (
                    <option key={b.id} value={b.id}>
                      Bidang: {b.nama}
                    </option>
                  ))}
                </select>
              )}
            </div>
          }
        />
      )}

      {/* Modal ACC Pendaftaran */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Setujui (ACC) & Aktifkan Akun
              </h2>
              <button
                type="button"
                onClick={() => setApproveTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitApprove} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}

              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <UserAvatar
                  name={approveTarget.nama_lengkap}
                  role={approveTarget.role_diminta}
                  srcOverride={getAuthorizedRegistrationAvatarUrl(approveTarget.id)}
                  size="lg"
                />
                <div className="text-xs min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                      {approveTarget.nama_lengkap}
                    </p>
                    <RoleBadge role={approveTarget.role_diminta} />
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 truncate">
                    @{approveTarget.username} · {approveTarget.email}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Kantor: <strong>{approveTarget.kantor_nama}</strong>
                    {approveTarget.role_diminta === 'KARYAWAN' ? (
                      <>
                        {' '}· Bidang: <strong>{approveTarget.bidang_nama}</strong>
                      </>
                    ) : (
                      <> · <span className="italic text-slate-500">Tanpa bidang kerja</span></>
                    )}
                  </p>
                </div>
              </div>

              {approveTarget.role_diminta === 'ADMIN' && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                  <strong>Verifikasi Role:</strong> Pendaftar memilih <strong>OPERATOR</strong>. Jika sebenarnya karyawan absensi harian, ubah <strong>Role Disetujui</strong> di bawah ke <strong>Karyawan</strong> lalu pilih <strong>Bidang Kerja</strong>-nya.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    NIK (Opsional)
                  </label>
                  <input
                    type="text"
                    value={approveForm.nik}
                    onChange={(e) => setApproveForm({ ...approveForm, nik: e.target.value })}
                    placeholder="Otomatis jika dikosongkan"
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Role Disetujui
                  </label>
                  <select
                    value={approveForm.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as 'KARYAWAN' | 'ADMIN';
                      setApproveForm({
                        ...approveForm,
                        role: nextRole,
                        bidang_id:
                          nextRole === 'KARYAWAN'
                            ? approveForm.bidang_id || bidangList[0]?.id || 1
                            : approveForm.bidang_id,
                      });
                    }}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="KARYAWAN">Karyawan (Absensi Harian)</option>
                    <option value="ADMIN">Operator (Pengelola Sistem)</option>
                  </select>
                </div>
              </div>

              {approveForm.role === 'KARYAWAN' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Penempatan Kantor
                    </label>
                    <select
                      value={approveForm.kantor_id}
                      onChange={(e) =>
                        setApproveForm({ ...approveForm, kantor_id: Number(e.target.value) })
                      }
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Bidang Kerja
                    </label>
                    <select
                      value={approveForm.bidang_id}
                      onChange={(e) =>
                        setApproveForm({ ...approveForm, bidang_id: Number(e.target.value) })
                      }
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      {bidangList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-indigo-800 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900 rounded-lg px-3 py-2">
                  Akun <strong>Operator</strong> tidak memerlukan pemilihan kantor, wilayah penempatan, maupun bidang kerja karena tidak melakukan absensi harian.
                </p>
              )}

              {approveForm.role === 'KARYAWAN' && (
                <EmployeePlacementSection
                  regions={regions}
                  offices={offices}
                  value={{
                    wilayah_penempatan_id: approveForm.wilayah_penempatan_id,
                    cakupan_lokasi_absensi: approveForm.cakupan_lokasi_absensi,
                    kantor_izin_ids: approveForm.kantor_izin_ids,
                  }}
                  onChange={(next) =>
                    setApproveForm((prev) => ({
                      ...prev,
                      wilayah_penempatan_id: next.wilayah_penempatan_id,
                      cakupan_lokasi_absensi: next.cakupan_lokasi_absensi,
                      kantor_izin_ids: next.kantor_izin_ids,
                    }))
                  }
                />
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Persetujuan
                </label>
                <input
                  type="text"
                  value={approveForm.alasan_keputusan}
                  onChange={(e) =>
                    setApproveForm({ ...approveForm, alasan_keputusan: e.target.value })
                  }
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setApproveTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
                >
                  {saving ? 'Memproses...' : 'ACC & Aktifkan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tolak Pendaftaran */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Tolak Pendaftaran Akun
              </h2>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitReject} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Tolak pengajuan akun <strong>{rejectTarget.nama_lengkap}</strong> (@
                {rejectTarget.username})? Pendaftar akan melihat alasan penolakan jika mencoba masuk.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Penolakan (Wajib)
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Contoh: Data cabang penempatan tidak sesuai dengan surat tugas."
                  className="w-full p-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-red-700 hover:bg-red-800 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Tolak Pendaftaran'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Seluruh Akun */}
      {accountModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {editingAccount
                  ? `Kelola Akun ${editingAccount.nik ? `${editingAccount.nik} · ` : ''}(@${editingAccount.username})`
                  : 'Buat Akun Baru (Superadmin)'}
              </h2>
              <button
                type="button"
                onClick={() => setAccountModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitAccount} className="p-5 space-y-3.5 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}

              {/* Foto Profil Control hanya untuk akun yang terhubung ke karyawan */}
              {accountForm.role !== 'SUPERADMIN' && (
              <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <UserAvatar
                  karyawanId={editingAccount?.karyawan_id}
                  name={accountForm.nama_lengkap || 'BG'}
                  role={accountForm.role}
                  version={editingAccount?.foto_profil_updated_at}
                  srcOverride={
                    accountForm.removePhoto
                      ? undefined
                      : accountForm.fotoBase64 || undefined
                  }
                  size="lg"
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Foto Profil Akun
                    </p>
                    {!editingAccount && (
                      accountForm.fotoBase64 ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/70 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                          Foto siap
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-950/70 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                          Wajib
                        </span>
                      )
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {!editingAccount
                      ? 'Wajib untuk Karyawan maupun Operator. PNG, JPG, atau WEBP maks. 10 MB.'
                      : 'PNG, JPG, atau WEBP maksimal 10 MB.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      <span>Unggah Foto</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          handleAccountPhotoFile(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {(editingAccount?.has_foto_profil || accountForm.fotoBase64) &&
                      !accountForm.removePhoto && (
                        <button
                          type="button"
                          onClick={() =>
                            setAccountForm((prev) => ({
                              ...prev,
                              fotoBase64: null,
                              removePhoto: true,
                            }))
                          }
                          className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          Reset Default
                        </button>
                      )}
                  </div>
                </div>
              </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editingAccount && accountForm.role !== 'SUPERADMIN' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      NIK (Opsional)
                    </label>
                    <input
                      type="text"
                      value={accountForm.nik}
                      onChange={(e) => setAccountForm({ ...accountForm, nik: e.target.value })}
                      placeholder="Otomatis jika kosong"
                      className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>
                )}
                <div className={editingAccount ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Role Sistem
                  </label>
                  <select
                    value={accountForm.role}
                    disabled={Boolean(editingAccount && editingAccount.role === 'SUPERADMIN')}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, role: e.target.value as Role })
                    }
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    <option value="KARYAWAN">KARYAWAN (Absensi Harian)</option>
                    <option value="ADMIN">OPERATOR (Pengelola Sistem)</option>
                    <option value="SUPERADMIN" disabled={Boolean(editingAccount && editingAccount.role !== 'SUPERADMIN')}>SUPERADMIN (Pemilik Sistem)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={accountForm.nama_lengkap}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, nama_lengkap: e.target.value })
                  }
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={accountForm.username}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, username: e.target.value.toLowerCase() })
                    }
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={accountForm.email}
                    onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              </div>

              {accountForm.role !== 'SUPERADMIN' && (
              <>
              {accountForm.role === 'KARYAWAN' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Penempatan Kantor
                    </label>
                    <select
                      value={accountForm.kantor_id}
                      onChange={(e) =>
                        setAccountForm({ ...accountForm, kantor_id: Number(e.target.value) })
                      }
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Bidang Kerja
                    </label>
                    <select
                      value={accountForm.bidang_id}
                      onChange={(e) =>
                        setAccountForm({ ...accountForm, bidang_id: Number(e.target.value) })
                      }
                      className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      {bidangList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {accountForm.role === 'ADMIN' && (
                <p className="text-[11px] text-indigo-800 dark:text-indigo-300 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900 rounded-lg px-3 py-2">
                  Akun <strong>Operator</strong> tidak memilih kantor, bidang kerja, wilayah penempatan, maupun cakupan lokasi absensi karena tidak melakukan absensi harian.
                </p>
              )}

              {accountForm.role === 'KARYAWAN' && (
                <EmployeePlacementSection
                  regions={regions}
                  offices={offices}
                  value={{
                    wilayah_penempatan_id: accountForm.wilayah_penempatan_id,
                    cakupan_lokasi_absensi: accountForm.cakupan_lokasi_absensi,
                    kantor_izin_ids: accountForm.kantor_izin_ids,
                  }}
                  onChange={(next) =>
                    setAccountForm((prev) => ({
                      ...prev,
                      wilayah_penempatan_id: next.wilayah_penempatan_id,
                      cakupan_lokasi_absensi: next.cakupan_lokasi_absensi,
                      kantor_izin_ids: next.kantor_izin_ids,
                    }))
                  }
                  required={!editingAccount}
                  showRegionChangeNotice={Boolean(editingAccount)}
                  previousWilayahId={editingAccount?.wilayah_penempatan_id ?? null}
                />
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  No. HP / WA
                </label>
                <input
                  type="text"
                  value={accountForm.no_hp}
                  onChange={(e) => setAccountForm({ ...accountForm, no_hp: e.target.value })}
                  className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              </>
              )}

              {accountForm.role === 'SUPERADMIN' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">No. HP / WA (Opsional)</label>
                  <input
                    type="text"
                    value={accountForm.no_hp}
                    onChange={(e) => setAccountForm({ ...accountForm, no_hp: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              )}

              {!editingAccount ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kata Sandi Awal (Min. 6 karakter)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={accountForm.password}
                    onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              ) : (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 pt-1 min-h-[32px]">
                  <input
                    type="checkbox"
                    checked={Boolean(accountForm.aktif)}
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, aktif: e.target.checked ? 1 : 0 })
                    }
                    className="w-4 h-4 accent-navy-900 dark:accent-brand-500"
                  />
                  Status Akun Aktif (dapat login & beroperasional)
                </label>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAccountModal(false)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Penempatan Massal Karyawan */}
      {bulkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                Atur Penempatan &amp; Cakupan Lokasi Massal
              </h2>
              <button
                type="button"
                onClick={() => setBulkModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center shrink-0"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitBulkPlacement} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}

              <EmployeePlacementSection
                regions={regions}
                offices={offices}
                value={bulkPlacement}
                onChange={setBulkPlacement}
                required
              />

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Pilih Karyawan Aktif ({bulkSelectedEmpIds.length} dipilih)
                  </label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setBulkSelectedEmpIds(
                          employeeAccounts
                            .filter(
                              (a) =>
                                isAccountActive(a) &&
                                a.karyawan_id !== null &&
                                a.status_penempatan &&
                                a.status_penempatan !== 'LENGKAP'
                            )
                            .map((a) => a.karyawan_id as number)
                        )
                      }
                      className="text-amber-700 dark:text-amber-400 font-semibold hover:underline"
                    >
                      Pilih Belum Lengkap
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkSelectedEmpIds(
                          employeeAccounts
                            .filter((a) => isAccountActive(a) && a.karyawan_id !== null)
                            .map((a) => a.karyawan_id as number)
                        )
                      }
                      className="text-brand-600 dark:text-brand-400 font-semibold hover:underline"
                    >
                      Pilih Semua Aktif
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setBulkSelectedEmpIds([])}
                      className="text-slate-500 hover:underline"
                    >
                      Kosongkan
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {employeeAccounts
                    .filter((a) => isAccountActive(a) && a.karyawan_id !== null)
                    .map((acc) => {
                      const empId = acc.karyawan_id as number;
                      const checked = bulkSelectedEmpIds.includes(empId);
                      const isIncomplete =
                        acc.status_penempatan && acc.status_penempatan !== 'LENGKAP';
                      return (
                        <label
                          key={acc.user_id}
                          className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer text-xs ${
                            checked
                              ? 'bg-brand-50/50 dark:bg-brand-950/25'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setBulkSelectedEmpIds((prev) =>
                                  prev.includes(empId)
                                    ? prev.filter((id) => id !== empId)
                                    : [...prev, empId]
                                )
                              }
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {acc.nama_lengkap}{' '}
                                <span className="font-mono text-[11px] font-normal text-slate-500">
                                  ({acc.nik})
                                </span>
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {(acc.kantor_nama || '').split('(')[0].trim()} · {acc.bidang_nama}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${
                              isIncomplete
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {acc.wilayah_penempatan_nama || 'Belum diisi'}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBulkModal(false)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || bulkSelectedEmpIds.length === 0}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : `Terapkan ke ${bulkSelectedEmpIds.length} Karyawan`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Sandi */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-sm w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Reset Kata Sandi @{resetTarget.username}
              </h2>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitResetPassword} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kata Sandi Baru (Min. 6 karakter)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Sandi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tandai Keluar / Nonaktifkan Akun */}
      {resignTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <UserMinus className="w-4 h-4 text-amber-600" />
                Tandai Keluar / Nonaktifkan Akun
              </h2>
              <button
                type="button"
                onClick={() => setResignTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitResignAccount} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                <strong>Arsip Aman (Direkomendasikan):</strong> Akun{' '}
                <strong>{resignTarget.nama_lengkap}</strong> (@{resignTarget.username} ·{' '}
                {getRoleDisplayLabel(resignTarget.role)}) akan langsung dinonaktifkan, sesi login diputus, dan dikeluarkan dari daftar aktif — sambil tetap menjaga riwayat absensi & payroll.
              </div>
              {resignTarget.karyawan_id !== null && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Efektif Keluar
                  </label>
                  <input
                    type="date"
                    required
                    value={resignDate}
                    onChange={(e) => setResignDate(e.target.value)}
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Keluar / Nonaktif (Wajib)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={resignReason}
                  onChange={(e) => setResignReason(e.target.value)}
                  placeholder="Contoh: Mengundurkan diri (Resign) / Habis kontrak"
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResignTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Konfirmasi Keluar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Hapus Permanen Akun */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-red-200 dark:border-red-900/70 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/40 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-red-900 dark:text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                Hapus Permanen Akun
              </h2>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-red-700 dark:text-red-300" />
              </button>
            </div>
            <form onSubmit={submitDeleteAccount} className="p-5 space-y-4 overflow-y-auto">
              {modalErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {modalErr}
                </div>
              )}
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-900 dark:text-red-200 space-y-1.5 leading-relaxed">
                <p>
                  Anda akan menghapus permanen akun{' '}
                  <strong>{deleteTarget.nama_lengkap}</strong> (@{deleteTarget.username} ·{' '}
                  {getRoleDisplayLabel(deleteTarget.role)}).
                </p>
                {deleteTarget.karyawan_id !== null && (
                  <p className="font-mono text-[11px]">
                    Data terkait yang ikut terhapus:{' '}
                    <strong>{deleteTarget.jumlah_absensi ?? 0} sesi absensi</strong> ·{' '}
                    <strong>{deleteTarget.jumlah_pengajuan ?? 0} pengajuan</strong> · foto profil & bukti absensi.
                  </p>
                )}
                {(deleteTarget.jumlah_absensi ?? 0) > 0 && isAccountActive(deleteTarget) && (
                  <p className="pt-1 font-semibold text-amber-900 dark:text-amber-300">
                    Tips: Jika hanya resign dan riwayat payroll masih dibutuhkan, gunakan tombol &ldquo;Keluar&rdquo; agar data absensi tetap tersimpan.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Penghapusan (Wajib tercatat di Audit Trail)
                </label>
                <input
                  type="text"
                  required
                  minLength={5}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Contoh: Karyawan sudah keluar / akun duplikat salah daftar"
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ketik <span className="font-mono text-red-700 dark:text-red-400">HAPUS</span> untuk konfirmasi
                </label>
                <input
                  type="text"
                  required
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="HAPUS"
                  className="w-full h-11 sm:h-10 px-3 text-sm font-mono uppercase border border-red-200 dark:border-red-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || deleteConfirmText.trim().toUpperCase() !== 'HAPUS'}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-red-700 hover:bg-red-800 text-white rounded-lg disabled:opacity-40"
                >
                  {saving ? 'Menghapus...' : 'Hapus Permanen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
