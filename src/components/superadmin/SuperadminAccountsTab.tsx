import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Camera,
  CheckCircle2,
  Edit3,
  KeyRound,
  Plus,
  UserCheck,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import {
  apiFetch,
  getAuthorizedRegistrationAvatarUrl,
} from '../../lib/api';
import type {
  AuthUser,
  BidangKerja,
  Kantor,
  ManagedAccount,
  PendaftaranAkun,
  Role,
} from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';
import { UserAvatar } from '../UserAvatar';

interface SuperadminAccountsTabProps {
  currentUser: AuthUser;
  onCurrentUserUpdated: (user: AuthUser) => void;
  onPendingCountChange?: (count: number) => void;
}

export function SuperadminAccountsTab({
  currentUser,
  onCurrentUserUpdated,
  onPendingCountChange,
}: SuperadminAccountsTabProps) {
  const [subtab, setSubtab] = useState<'registrations' | 'accounts'>('registrations');
  const [regStatusFilter, setRegStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [roleFilter, setRoleFilter] = useState<string>('');

  const [registrations, setRegistrations] = useState<PendaftaranAkun[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [offices, setOffices] = useState<Pick<Kantor, 'id' | 'kode' | 'nama'>[]>([]);
  const [bidangList, setBidangList] = useState<Pick<BidangKerja, 'id' | 'kode' | 'nama'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  // Approve modal state
  const [approveTarget, setApproveTarget] = useState<PendaftaranAkun | null>(null);
  const [approveForm, setApproveForm] = useState({
    nik: '',
    role: 'KARYAWAN' as 'KARYAWAN' | 'ADMIN',
    kantor_id: 1,
    bidang_id: 1,
    jabatan: '',
    alasan_keputusan: 'Disetujui Superadmin — akun aktif digunakan',
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
    jabatan: '',
    role: 'KARYAWAN' as Role,
    kantor_id: 1,
    bidang_id: 1,
    password: '',
    aktif: 1,
    fotoBase64: null as string | null,
    removePhoto: false,
  });

  // Reset password modal state
  const [resetTarget, setResetTarget] = useState<ManagedAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');

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
          offices: Pick<Kantor, 'id' | 'kode' | 'nama'>[];
          bidangList: Pick<BidangKerja, 'id' | 'kode' | 'nama'>[];
        }>('/api/v1/superadmin/accounts'),
      ]);
      setRegistrations(regRes.items);
      setAccounts(accRes.items);
      setOffices(accRes.offices);
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

  const pendingRegsCount = registrations.filter((r) => r.status === 'PENDING').length;
  const filteredRegs =
    regStatusFilter === 'ALL'
      ? registrations
      : registrations.filter((r) => r.status === regStatusFilter);
  const filteredAccounts = roleFilter
    ? accounts.filter((a) => a.role === roleFilter)
    : accounts;

  const openApproveModal = (r: PendaftaranAkun) => {
    setApproveTarget(r);
    setApproveForm({
      nik: '',
      role: r.role_diminta,
      kantor_id: r.kantor_id,
      bidang_id: r.bidang_id,
      jabatan: r.jabatan,
      alasan_keputusan: 'Disetujui Superadmin — akun aktif digunakan',
    });
    setModalErr(null);
  };

  const submitApprove = async (e: FormEvent) => {
    e.preventDefault();
    if (!approveTarget) return;
    setSaving(true);
    setModalErr(null);
    try {
      const res = await apiFetch<{ nik: string }>(
        `/api/v1/superadmin/registrations/${approveTarget.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify(approveForm),
        }
      );
      setApproveTarget(null);
      setBannerMsg(
        `Akun @${approveTarget.username} (${approveForm.role}) telah di-ACC dengan NIK ${res.nik}.`
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

  const openCreateAccount = () => {
    setEditingAccount(null);
    setAccountForm({
      nik: '',
      nama_lengkap: '',
      username: '',
      email: '',
      no_hp: '',
      jabatan: 'Teknisi Lapangan',
      role: 'KARYAWAN',
      kantor_id: offices[0]?.id ?? 1,
      bidang_id: bidangList[0]?.id ?? 1,
      password: '',
      aktif: 1,
      fotoBase64: null,
      removePhoto: false,
    });
    setModalErr(null);
    setAccountModal(true);
  };

  const openEditAccount = (acc: ManagedAccount) => {
    setEditingAccount(acc);
    setAccountForm({
      nik: acc.nik,
      nama_lengkap: acc.nama_lengkap,
      username: acc.username,
      email: acc.email,
      no_hp: acc.no_hp,
      jabatan: acc.jabatan,
      role: acc.role,
      kantor_id: acc.kantor_id,
      bidang_id: acc.bidang_id,
      password: '',
      aktif: acc.user_aktif,
      fotoBase64: null,
      removePhoto: false,
    });
    setModalErr(null);
    setAccountModal(true);
  };

  const handleAccountPhotoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setModalErr('Ukuran foto profil maksimal 2 MB.');
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
    setSaving(true);
    setModalErr(null);
    try {
      if (editingAccount) {
        await apiFetch(`/api/v1/superadmin/accounts/${editingAccount.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nama_lengkap: accountForm.nama_lengkap,
            username: accountForm.username,
            email: accountForm.email,
            no_hp: accountForm.no_hp,
            jabatan: accountForm.jabatan,
            role: accountForm.role,
            kantor_id: accountForm.kantor_id,
            bidang_id: accountForm.bidang_id,
            aktif: accountForm.aktif,
            fotoBase64: accountForm.fotoBase64,
            removePhoto: accountForm.removePhoto,
          }),
        });
        if (editingAccount.user_id === currentUser.id) {
          const me = await apiFetch<{ user: AuthUser }>('/api/v1/auth/me');
          onCurrentUserUpdated(me.user);
        }
        setBannerMsg(`Data akun @${accountForm.username} berhasil diperbarui.`);
      } else {
        const res = await apiFetch<{ nik: string }>('/api/v1/superadmin/accounts', {
          method: 'POST',
          body: JSON.stringify(accountForm),
        });
        setBannerMsg(
          `Akun @${accountForm.username} (${accountForm.role}) berhasil dibuat dengan NIK ${res.nik}.`
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
        <div className="text-xs">
          <p className="font-bold text-navy-900 dark:text-blue-400">
            {r.role_diminta === 'ADMIN' ? 'Admin Operasional' : 'Teknisi / Karyawan'}
          </p>
          <p className="text-slate-500 dark:text-slate-400">{r.jabatan}</p>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Kantor & Bidang',
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
          <p className="text-slate-500 dark:text-slate-400">{r.bidang_nama}</p>
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
            name={r.nama_lengkap}
            role={r.role}
            version={r.foto_profil_updated_at}
            size="md"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {r.nama_lengkap}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                {r.nik}
              </span>{' '}
              · @{r.username} · {r.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role Sistem',
      sortValue: (r) => r.role,
      render: (r) => (
        <div className="text-xs">
          <p className="font-bold text-navy-900 dark:text-blue-400">{r.role}</p>
          <p className="text-slate-500 dark:text-slate-400">{r.jabatan}</p>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Penempatan',
      sortValue: (r) => r.kantor_nama,
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
          <p className="text-slate-500 dark:text-slate-400">{r.bidang_nama}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status Akun',
      sortValue: (r) => r.user_aktif,
      render: (r) => (
        <span
          className={`text-xs font-semibold ${
            r.user_aktif && r.karyawan_aktif
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-red-700 dark:text-red-400'
          }`}
        >
          {r.user_aktif && r.karyawan_aktif ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'aksi',
      header: 'Kelola',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => openEditAccount(r)}
            className="inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
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
            className="inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-amber-800 dark:text-amber-300"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Sandi
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Manajemen Akun & Persetujuan Pendaftaran (ACC)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Setujui pendaftaran akun Admin & Teknisi baru serta kelola seluruh akun pengguna sistem.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateAccount}
          className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Buat Akun Langsung
        </button>
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
          <p className="text-[11px] sm:text-xs text-blue-300 font-medium">MENUNGGU ACC</p>
          <p className="font-mono text-2xl font-bold tabular-nums mt-1">{pendingRegsCount}</p>
          <p className="text-[11px] text-slate-300 mt-1">Pendaftaran baru</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            TOTAL AKUN AKTIF
          </p>
          <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
            {accounts.filter((a) => a.user_aktif === 1).length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Dari {accounts.length} akun terdaftar
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            ADMIN & SUPERADMIN
          </p>
          <p className="font-mono text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums mt-1">
            {accounts.filter((a) => a.role === 'ADMIN' || a.role === 'SUPERADMIN').length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Akun pengelola & owner
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-semibold">
            TEKNISI / KARYAWAN
          </p>
          <p className="font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
            {accounts.filter((a) => a.role === 'KARYAWAN').length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Akun operasional absensi
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
          searchPlaceholder="Cari nama, username, email, atau jabatan pendaftar..."
          searchFilter={(r, q) =>
            r.nama_lengkap.toLowerCase().includes(q) ||
            r.username.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            r.jabatan.toLowerCase().includes(q)
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
      ) : (
        <DataTable
          data={filteredAccounts}
          columns={accountCols}
          getRowId={(r) => r.user_id}
          loading={loading}
          error={error}
          onRetry={loadAll}
          searchPlaceholder="Cari NIK, nama, username, atau email..."
          searchFilter={(r, q) =>
            r.nama_lengkap.toLowerCase().includes(q) ||
            r.nik.toLowerCase().includes(q) ||
            r.username.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q)
          }
          filterToolbar={
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="h-11 sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg w-full sm:w-auto"
            >
              <option value="">Semua Role</option>
              <option value="KARYAWAN">KARYAWAN / TEKNISI</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERADMIN">SUPERADMIN</option>
            </select>
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

              <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <UserAvatar
                  name={approveTarget.nama_lengkap}
                  role={approveTarget.role_diminta}
                  srcOverride={getAuthorizedRegistrationAvatarUrl(approveTarget.id)}
                  size="lg"
                />
                <div className="text-xs min-w-0">
                  <p className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                    {approveTarget.nama_lengkap}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 truncate">
                    @{approveTarget.username} · {approveTarget.email}
                  </p>
                  {approveTarget.catatan_pendaftar && (
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                      Catatan: "{approveTarget.catatan_pendaftar}"
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    NIK Karyawan (Opsional)
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
                    onChange={(e) =>
                      setApproveForm({
                        ...approveForm,
                        role: e.target.value as 'KARYAWAN' | 'ADMIN',
                      })
                    }
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="KARYAWAN">Teknisi / Karyawan</option>
                    <option value="ADMIN">Admin Operasional</option>
                  </select>
                </div>
              </div>

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

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Jabatan
                </label>
                <input
                  type="text"
                  required
                  value={approveForm.jabatan}
                  onChange={(e) => setApproveForm({ ...approveForm, jabatan: e.target.value })}
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>

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
                  ? `Kelola Akun ${editingAccount.nik} (@${editingAccount.username})`
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

              {/* Foto Profil Control */}
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
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Foto Profil Akun
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      <span>Unggah Foto</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!editingAccount && (
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
                    onChange={(e) =>
                      setAccountForm({ ...accountForm, role: e.target.value as Role })
                    }
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="KARYAWAN">KARYAWAN / TEKNISI</option>
                    <option value="ADMIN">ADMIN OPERASIONAL</option>
                    <option value="SUPERADMIN">SUPERADMIN</option>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kantor
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jabatan
                  </label>
                  <input
                    type="text"
                    required
                    value={accountForm.jabatan}
                    onChange={(e) => setAccountForm({ ...accountForm, jabatan: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
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
              </div>

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
                    className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
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
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-blue-700 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Akun'}
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
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-blue-700 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Sandi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
