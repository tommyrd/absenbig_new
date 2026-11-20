import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Building2,
  Edit3,
  Image as ImageIcon,
  MapPin,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import {
  exportEmployeeDirectoryPng,
  printEmployeeDirectoryPdf,
} from '../../lib/employee-directory-export';
import { getServerWibDateString } from '../../lib/server-clock-client';
import type { BidangKerja, Kantor, Karyawan, Role, SystemSettings } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { OfficeGeofenceMap } from '../OfficeGeofenceMap';
import { UserAvatar } from '../UserAvatar';

interface AdminMasterTabProps {
  settings?: SystemSettings | null;
  printedByName?: string;
}

export function AdminMasterTab({
  settings = null,
  printedByName = 'Operator Operasional',
}: AdminMasterTabProps) {
  const [subtab, setSubtab] = useState<'karyawan' | 'kantor' | 'bidang'>('karyawan');
  const [employees, setEmployees] = useState<Karyawan[]>([]);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Employee Directory Filters & Export
  const [empStatusFilter, setEmpStatusFilter] = useState<'AKTIF' | 'KELUAR' | 'ALL'>('AKTIF');
  const [empOfficeFilter, setEmpOfficeFilter] = useState<string>('');
  const [empBidangFilter, setEmpBidangFilter] = useState<string>('');
  const [exportingDir, setExportingDir] = useState(false);

  // Employee Modal
  const [empModal, setEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Karyawan | null>(null);
  const [empForm, setEmpForm] = useState({
    nik: '',
    nama_lengkap: '',
    email: '',
    no_hp: '',
    kantor_id: 1,
    bidang_id: 1,
    username: '',
    role: 'KARYAWAN' as Role,
    aktif: 1,
  });

  // Offboarding (Tandai Keluar) Modal
  const [resignTarget, setResignTarget] = useState<Karyawan | null>(null);
  const [resignDate, setResignDate] = useState('');
  const [resignReason, setResignReason] = useState('');

  // Permanent Delete Employee Modal
  const [hardDeleteEmpTarget, setHardDeleteEmpTarget] = useState<Karyawan | null>(null);
  const [hardDeleteReason, setHardDeleteReason] = useState('');
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('');

  // Office Modal
  const [officeModal, setOfficeModal] = useState(false);
  const [editingOffice, setEditingOffice] = useState<Kantor | null>(null);
  const [officeForm, setOfficeForm] = useState({
    kode: '',
    nama: '',
    alamat: '',
    lat: '-6.2088',
    lng: '106.8456',
    radius_meter: '250',
  });

  // Bidang Modal
  const [bidangModal, setBidangModal] = useState(false);
  const [editingBidang, setEditingBidang] = useState<BidangKerja | null>(null);
  const [bidangForm, setBidangForm] = useState({ kode: '', nama: '', deskripsi: '' });

  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [previewMapOfficeId, setPreviewMapOfficeId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, o, b] = await Promise.all([
        apiFetch<{ items: Karyawan[] }>('/api/v1/master/employees'),
        apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
        apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
      ]);
      setEmployees(e.items);
      setOffices(o.items);
      setBidangList(b.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat master data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openEditEmp = (emp: Karyawan) => {
    setEditingEmp(emp);
    setEmpForm({
      nik: emp.nik,
      nama_lengkap: emp.nama_lengkap,
      email: emp.email,
      no_hp: emp.no_hp,
      kantor_id: emp.kantor_id,
      bidang_id: emp.bidang_id,
      username: emp.username || '',
      role: emp.role || 'KARYAWAN',
      aktif: emp.aktif,
    });
    setFormErr(null);
    setEmpModal(true);
  };

  const openResignModal = (emp: Karyawan) => {
    setResignTarget(emp);
    setResignDate(getServerWibDateString());
    setResignReason('');
    setFormErr(null);
  };

  const submitResign = async (e: FormEvent) => {
    e.preventDefault();
    if (!resignTarget) return;
    setSaving(true);
    setFormErr(null);
    setDeleteError(null);
    setDeleteNotice(null);
    try {
      await apiFetch(`/api/v1/master/employees/${resignTarget.id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          aktif: 0,
          tanggal_keluar: resignDate,
          alasan_keluar: resignReason,
        }),
      });
      setDeleteNotice(
        `${resignTarget.nama_lengkap} (${resignTarget.nik}) ditandai KELUAR per ${resignDate}. Akun login dinonaktifkan & riwayat absensi tetap tersimpan aman.`
      );
      setResignTarget(null);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal memperbarui status karyawan.');
    } finally {
      setSaving(false);
    }
  };

  const handleReactivateEmp = async (emp: Karyawan) => {
    setDeleteError(null);
    setDeleteNotice(null);
    setDeletingItem(`reactivate:${emp.id}`);
    try {
      await apiFetch(`/api/v1/master/employees/${emp.id}/status`, {
        method: 'POST',
        body: JSON.stringify({
          aktif: 1,
          alasan_keluar: 'Diaktifkan kembali oleh Operator',
        }),
      });
      setDeleteNotice(`${emp.nama_lengkap} (${emp.nik}) berhasil diaktifkan kembali.`);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal mengaktifkan karyawan.');
    } finally {
      setDeletingItem(null);
    }
  };

  const openHardDeleteEmp = (emp: Karyawan) => {
    setHardDeleteEmpTarget(emp);
    setHardDeleteReason('');
    setHardDeleteConfirmText('');
    setFormErr(null);
  };

  const submitHardDeleteEmp = async (e: FormEvent) => {
    e.preventDefault();
    if (!hardDeleteEmpTarget) return;
    if (hardDeleteConfirmText.trim().toUpperCase() !== 'HAPUS') {
      setFormErr('Ketik kata HAPUS pada kolom konfirmasi untuk melanjutkan penghapusan permanen.');
      return;
    }
    setSaving(true);
    setFormErr(null);
    setDeleteError(null);
    setDeleteNotice(null);
    try {
      await apiFetch(`/api/v1/master/employees/${hardDeleteEmpTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ alasan: hardDeleteReason }),
      });
      setDeleteNotice(
        `Data karyawan ${hardDeleteEmpTarget.nama_lengkap} (${hardDeleteEmpTarget.nik}) telah dihapus permanen dan dicatat di Audit Trail.`
      );
      setHardDeleteEmpTarget(null);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menghapus data karyawan.');
    } finally {
      setSaving(false);
    }
  };

  const submitEmp = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormErr(null);
    try {
      if (editingEmp) {
        await apiFetch(`/api/v1/master/employees/${editingEmp.id}`, {
          method: 'PUT',
          body: JSON.stringify(empForm),
        });
      } else {
        await apiFetch('/api/v1/master/employees', {
          method: 'POST',
          body: JSON.stringify(empForm),
        });
      }
      setEmpModal(false);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menyimpan karyawan.');
    } finally {
      setSaving(false);
    }
  };

  const submitOffice = async (e: FormEvent) => {
    e.preventDefault();
    const parsedLat = Number(officeForm.lat);
    const parsedLng = Number(officeForm.lng);
    const parsedRadius = Number(officeForm.radius_meter);
    if (
      !Number.isFinite(parsedLat) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      !Number.isFinite(parsedLng) ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      setFormErr('Koordinat latitude (-90 s.d. 90) dan longitude (-180 s.d. 180) harus berupa angka valid.');
      return;
    }
    if (!Number.isFinite(parsedRadius) || parsedRadius < 20 || parsedRadius > 50000) {
      setFormErr('Radius geofence harus antara 20 hingga 50.000 meter.');
      return;
    }
    setSaving(true);
    setFormErr(null);
    const payload = {
      kode: officeForm.kode,
      nama: officeForm.nama,
      alamat: officeForm.alamat,
      lat: parsedLat,
      lng: parsedLng,
      radius_meter: Math.round(parsedRadius),
    };
    try {
      if (editingOffice) {
        await apiFetch(`/api/v1/master/offices/${editingOffice.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, geofence_mode: 'TOLAK_LUAR_RADIUS' }),
        });
      } else {
        await apiFetch('/api/v1/master/offices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setOfficeModal(false);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menyimpan kantor.');
    } finally {
      setSaving(false);
    }
  };

  const openCreateBidang = () => {
    setEditingBidang(null);
    setBidangForm({ kode: '', nama: '', deskripsi: '' });
    setFormErr(null);
    setBidangModal(true);
  };

  const openEditBidang = (bidang: BidangKerja) => {
    setEditingBidang(bidang);
    setBidangForm({
      kode: bidang.kode,
      nama: bidang.nama,
      deskripsi: bidang.deskripsi || '',
    });
    setFormErr(null);
    setBidangModal(true);
  };

  const submitBidang = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormErr(null);
    try {
      if (editingBidang) {
        await apiFetch(`/api/v1/master/bidang/${editingBidang.id}`, {
          method: 'PUT',
          body: JSON.stringify(bidangForm),
        });
      } else {
        await apiFetch('/api/v1/master/bidang', {
          method: 'POST',
          body: JSON.stringify(bidangForm),
        });
      }
      setBidangModal(false);
      setEditingBidang(null);
      setBidangForm({ kode: '', nama: '', deskripsi: '' });
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menyimpan bidang.');
    } finally {
      setSaving(false);
    }
  };

  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'office'; item: Kantor }
    | { kind: 'bidang'; item: BidangKerja }
    | null
  >(null);

  const deleteOffice = (office: Kantor) => {
    if (office.can_delete !== true || deletingItem) return;
    setPendingDelete({ kind: 'office', item: office });
  };

  const deleteBidang = (bidang: BidangKerja) => {
    if (bidang.can_delete !== true || deletingItem) return;
    setPendingDelete({ kind: 'bidang', item: bidang });
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete || deletingItem) return;
    const target = pendingDelete;
    setPendingDelete(null);

    if (target.kind === 'office') {
      const office = target.item;
      setDeletingItem(`office:${office.id}`);
      setDeleteError(null);
      setDeleteNotice(null);
      try {
        await apiFetch(`/api/v1/master/offices/${office.id}`, { method: 'DELETE' });
        setDeleteNotice(`Kantor "${office.nama}" berhasil dihapus.`);
        await loadAll();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus kantor.');
      } finally {
        setDeletingItem(null);
      }
      return;
    }

    const bidang = target.item;
    setDeletingItem(`bidang:${bidang.id}`);
    setDeleteError(null);
    setDeleteNotice(null);
    try {
      await apiFetch(`/api/v1/master/bidang/${bidang.id}`, { method: 'DELETE' });
      setDeleteNotice(`Bidang kerja "${bidang.nama}" berhasil dihapus.`);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus bidang kerja.');
    } finally {
      setDeletingItem(null);
    }
  };

  const activeEmployeesCount = employees.filter((e) => e.aktif === 1).length;
  const resignedEmployeesCount = employees.filter((e) => e.aktif !== 1).length;

  const filteredEmployees = employees.filter((e) => {
    if (empStatusFilter === 'AKTIF' && e.aktif !== 1) return false;
    if (empStatusFilter === 'KELUAR' && e.aktif === 1) return false;
    if (empOfficeFilter && String(e.kantor_id) !== empOfficeFilter) return false;
    if (empBidangFilter && String(e.bidang_id) !== empBidangFilter) return false;
    return true;
  });

  const getDirectoryExportPayload = () => {
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
      items: filteredEmployees.map((e) => ({
        nik: e.nik,
        nama_lengkap: e.nama_lengkap,
        username: e.username,
        email: e.email,
        no_hp: e.no_hp,
        kantor_nama: e.kantor_nama || '-',
        bidang_nama: e.bidang_nama || '-',
        tanggal_masuk: e.tanggal_masuk,
        tanggal_keluar: e.tanggal_keluar ?? null,
        alasan_keluar: e.alasan_keluar ?? '',
        aktif: e.aktif,
      })),
      settings,
      printedByName,
      printedByRoleLabel: 'Operator Operasional',
      statusLabel,
      officeLabel,
      bidangLabel,
    };
  };

  const handleExportDirectoryPng = async () => {
    if (exportingDir || filteredEmployees.length === 0) return;
    setExportingDir(true);
    setDeleteError(null);
    try {
      await exportEmployeeDirectoryPng(getDirectoryExportPayload());
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal mengekspor PNG daftar karyawan.');
    } finally {
      setExportingDir(false);
    }
  };

  const handleExportDirectoryPdf = () => {
    if (filteredEmployees.length === 0) return;
    printEmployeeDirectoryPdf(getDirectoryExportPayload());
  };

  const empCols: ColumnDef<Karyawan>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik,
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
          {r.nik}
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
            karyawanId={r.id}
            name={r.nama_lengkap}
            role={r.role || 'KARYAWAN'}
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
      key: 'aktif',
      header: 'Status & Masa Kerja',
      sortValue: (r) => `${r.aktif ? '1' : '0'}_${r.tanggal_masuk}`,
      render: (r) => (
        <div className="text-xs space-y-0.5">
          {r.aktif ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
              AKTIF
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-900 border border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800">
              KELUAR
            </span>
          )}
          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            Masuk: {r.tanggal_masuk}
          </p>
          {!r.aktif && r.tanggal_keluar && (
            <p className="text-[11px] font-mono text-red-700 dark:text-red-400">
              Keluar: {r.tanggal_keluar}
            </p>
          )}
          {!r.aktif && r.alasan_keluar && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate" title={r.alasan_keluar}>
              {r.alasan_keluar}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'aksi',
      header: 'Aksi',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => openEditEmp(r)}
            className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Edit
          </button>
          {r.aktif ? (
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
              disabled={deletingItem !== null}
              onClick={() => void handleReactivateEmp(r)}
              title="Aktifkan kembali akun karyawan ini"
              className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-semibold text-emerald-800 dark:text-emerald-300 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Aktifkan
            </button>
          )}
          <button
            type="button"
            onClick={() => openHardDeleteEmp(r)}
            title="Hapus permanen data karyawan beserta akunnya"
            className="inline-flex items-center gap-1 min-h-[34px] px-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-xs font-semibold text-red-700 dark:text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Hapus
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
            Master Karyawan, Kantor & Bidang
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Kelola daftar karyawan aktif/keluar, export laporan untuk Direktur, geofence kantor, dan bidang kerja.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {subtab === 'karyawan' && (
            <>
              <button
                type="button"
                disabled={loading || exportingDir || filteredEmployees.length === 0}
                onClick={() => void handleExportDirectoryPng()}
                title="Unduh daftar karyawan sesuai filter aktif dalam format gambar PNG HD (siap kirim ke Direktur)"
                className="min-h-[40px] px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <ImageIcon className="w-4 h-4" />
                {exportingDir ? 'Membuat PNG...' : 'Export PNG'}
              </button>
              <button
                type="button"
                disabled={loading || filteredEmployees.length === 0}
                onClick={handleExportDirectoryPdf}
                title="Cetak atau simpan daftar karyawan sebagai dokumen PDF resmi untuk Direktur"
                className="min-h-[40px] px-3.5 bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                Cetak / PDF
              </button>
            </>
          )}
          {subtab === 'kantor' && (
            <button
              type="button"
              onClick={() => {
                setEditingOffice(null);
                setOfficeForm({
                  kode: '',
                  nama: '',
                  alamat: '',
                  lat: '-6.2088',
                  lng: '106.8456',
                  radius_meter: '250',
                });
                setFormErr(null);
                setOfficeModal(true);
              }}
              className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              Tambah Kantor
            </button>
          )}
          {subtab === 'bidang' && (
            <button
              type="button"
              onClick={openCreateBidang}
              className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              Tambah Bidang
            </button>
          )}
        </div>
      </div>

      {/* Segmented Subtabs */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setSubtab('karyawan')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'karyawan'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Karyawan ({activeEmployeesCount} Aktif{resignedEmployeesCount > 0 ? ` · ${resignedEmployeesCount} Keluar` : ''})
          </button>
          <button
            type="button"
            onClick={() => setSubtab('kantor')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'kantor'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Kantor & Geofence ({offices.length})
          </button>
          <button
            type="button"
            onClick={() => setSubtab('bidang')}
            className={`min-h-[38px] sm:min-h-0 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'bidang'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Bidang Kerja ({bidangList.length})
          </button>
        </div>
      </div>

      {(deleteError || deleteNotice) && (
        <div
          role={deleteError ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2.5 text-xs flex items-center justify-between gap-2 ${
            deleteError
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-200'
          }`}
        >
          <span>{deleteError || deleteNotice}</span>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeleteNotice(null);
            }}
            className="p-1 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {subtab === 'karyawan' && (
        <div className="space-y-4">
          {/* Executive KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-navy-900 text-white rounded-xl p-4">
              <p className="text-[11px] text-brand-200 font-semibold">KARYAWAN AKTIF</p>
              <p className="font-mono text-2xl font-bold tabular-nums mt-1">{activeEmployeesCount}</p>
              <p className="text-[11px] text-slate-300 mt-0.5">Wajib absensi harian</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">KELUAR / NONAKTIF</p>
              <p className="font-mono text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums mt-1">
                {resignedEmployeesCount}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Arsip riwayat tetap utuh</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">SESUAI FILTER</p>
              <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                {filteredEmployees.length}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Siap export PDF / PNG</p>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">AKUN BARU & ACC</p>
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1.5 leading-snug">
                Pendaftaran & ACC dikelola Superadmin
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Operator dapat edit, tandai keluar, & hapus data
              </p>
            </div>
          </div>

          <DataTable
            data={filteredEmployees}
            columns={empCols}
            getRowId={(r) => r.id}
            loading={loading}
            error={error}
            onRetry={loadAll}
            emptyTitle={
              empStatusFilter === 'KELUAR'
                ? 'Belum ada karyawan berstatus keluar / nonaktif'
                : 'Tidak ada karyawan sesuai filter'
            }
            emptyDescription="Ubah filter status, kantor, atau bidang kerja untuk melihat data lainnya."
            searchPlaceholder="Cari NIK, nama, no. HP, email, kantor, atau bidang..."
            searchFilter={(r, q) =>
              r.nama_lengkap.toLowerCase().includes(q) ||
              r.nik.toLowerCase().includes(q) ||
              (r.username || '').toLowerCase().includes(q) ||
              (r.no_hp || '').toLowerCase().includes(q) ||
              (r.email || '').toLowerCase().includes(q) ||
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
                  <option value="AKTIF">Aktif ({activeEmployeesCount})</option>
                  <option value="KELUAR">Keluar / Nonaktif ({resignedEmployeesCount})</option>
                  <option value="ALL">Semua ({employees.length})</option>
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
      )}

      {subtab === 'kantor' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {offices.map((o) => {
            const officeBlockers = [
              o.jumlah_karyawan ? `${o.jumlah_karyawan} pegawai` : null,
              o.jumlah_pendaftaran ? `${o.jumlah_pendaftaran} pendaftaran akun` : null,
              o.jumlah_hari_libur ? `${o.jumlah_hari_libur} data hari libur` : null,
              o.jumlah_periode_payroll ? `${o.jumlah_periode_payroll} periode payroll` : null,
            ].filter(Boolean);
            const officeDeleteTitle = o.can_delete
              ? 'Hapus kantor yang belum memiliki relasi bisnis'
              : `Tidak dapat dihapus: ${officeBlockers.join(', ') || 'status relasi belum dapat diverifikasi'}`;
            return (
            <div
              key={o.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">
                    {o.kode}
                  </span>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {o.nama}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{o.alamat}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOffice(o);
                      setOfficeForm({
                        kode: o.kode,
                        nama: o.nama,
                        alamat: o.alamat,
                        lat: String(o.lat),
                        lng: String(o.lng),
                        radius_meter: String(o.radius_meter),
                      });
                      setFormErr(null);
                      setOfficeModal(true);
                    }}
                    className="min-h-[36px] px-2 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Ubah
                  </button>
                  <button
                    type="button"
                    title={officeDeleteTitle}
                    disabled={!o.can_delete || deletingItem !== null}
                    onClick={() => void deleteOffice(o)}
                    className="min-h-[36px] px-2 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deletingItem === `office:${o.id}` ? 'Menghapus...' : 'Hapus'}
                  </button>
                </div>
              </div>
              {officeBlockers.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Tidak dapat dihapus karena masih terhubung dengan: {officeBlockers.join(' · ')}.
                </p>
              )}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 dark:text-slate-500">Koordinat:</span>
                  <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {o.lat}, {o.lng}
                  </p>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <span className="text-slate-400 dark:text-slate-500">Aturan Absensi:</span>
                    <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                      {o.radius_meter}m · Wajib dalam radius
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewMapOfficeId((prev) => (prev === o.id ? null : o.id))
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 shrink-0"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
                    {previewMapOfficeId === o.id ? 'Tutup Peta' : 'Lihat Peta'}
                  </button>
                </div>
              </div>
              {previewMapOfficeId === o.id && (
                <div className="pt-1">
                  <OfficeGeofenceMap
                    lat={o.lat}
                    lng={o.lng}
                    radiusMeter={o.radius_meter}
                    interactive={false}
                    heightClass="h-44"
                  />
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {subtab === 'bidang' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bidangList.map((b) => {
            const fieldBlockers = [
              b.jumlah_karyawan ? `${b.jumlah_karyawan} pegawai` : null,
              b.jumlah_kebijakan ? `${b.jumlah_kebijakan} kebijakan absensi` : null,
              b.jumlah_pendaftaran ? `${b.jumlah_pendaftaran} pendaftaran akun` : null,
            ].filter(Boolean);
            const fieldDeleteTitle = b.can_delete
              ? 'Hapus bidang kerja yang belum memiliki relasi'
              : `Tidak dapat dihapus: ${fieldBlockers.join(', ') || 'status relasi belum dapat diverifikasi'}`;
            return (
            <div
              key={b.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 min-w-0">
                  <Users className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs font-semibold">{b.kode}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditBidang(b)}
                    className="min-h-[36px] px-2 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Ubah
                  </button>
                  <button
                    type="button"
                    title={fieldDeleteTitle}
                    disabled={!b.can_delete || deletingItem !== null}
                    onClick={() => void deleteBidang(b)}
                    className="min-h-[36px] px-2 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deletingItem === `bidang:${b.id}` ? 'Menghapus...' : 'Hapus'}
                  </button>
                </div>
              </div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
                {b.nama}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                {b.deskripsi}
              </p>
              {fieldBlockers.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2">
                  Tidak dapat dihapus karena masih terhubung dengan: {fieldBlockers.join(' · ')}.
                </p>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Employee Modal */}
      {empModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingEmp ? `Edit Karyawan (${editingEmp.nik})` : 'Tambah Karyawan Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setEmpModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 dark:text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitEmp} className="p-5 space-y-3.5 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {formErr}
                </div>
              )}
              {!editingEmp && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      NIK
                    </label>
                    <input
                      type="text"
                      required
                      value={empForm.nik}
                      onChange={(e) => setEmpForm({ ...empForm, nik: e.target.value })}
                      placeholder="BG-107"
                      className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      value={empForm.username}
                      onChange={(e) => setEmpForm({ ...empForm, username: e.target.value })}
                      placeholder="bima"
                      className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={empForm.nama_lengkap}
                  onChange={(e) => setEmpForm({ ...empForm, nama_lengkap: e.target.value })}
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              {!editingEmp && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={empForm.email}
                    onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kantor
                  </label>
                  <select
                    value={empForm.kantor_id}
                    onChange={(e) => setEmpForm({ ...empForm, kantor_id: Number(e.target.value) })}
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
                    value={empForm.bidang_id}
                    onChange={(e) => setEmpForm({ ...empForm, bidang_id: Number(e.target.value) })}
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
                  No. HP
                </label>
                <input
                  type="text"
                  value={empForm.no_hp}
                  onChange={(e) => setEmpForm({ ...empForm, no_hp: e.target.value })}
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              {editingEmp && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 pt-1 min-h-[32px]">
                  <input
                    type="checkbox"
                    checked={Boolean(empForm.aktif)}
                    onChange={(e) => setEmpForm({ ...empForm, aktif: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-navy-900 dark:accent-brand-500"
                  />
                  Karyawan Aktif
                </label>
              )}
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEmpModal(false)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Office Modal */}
      {officeModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                {editingOffice ? 'Ubah Lokasi & Geofence Kantor' : 'Tambah Kantor Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setOfficeModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitOffice} className="p-5 space-y-3.5 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {formErr}
                </div>
              )}
              {!editingOffice && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Kode Kantor
                  </label>
                  <input
                    type="text"
                    required
                    value={officeForm.kode}
                    onChange={(e) => setOfficeForm({ ...officeForm, kode: e.target.value })}
                    placeholder="KTR-C"
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nama Kantor
                  </label>
                  <input
                    type="text"
                    required
                    value={officeForm.nama}
                    onChange={(e) => setOfficeForm({ ...officeForm, nama: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Alamat
                  </label>
                  <input
                    type="text"
                    value={officeForm.alamat}
                    onChange={(e) => setOfficeForm({ ...officeForm, alamat: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              </div>

              {/* Interactive Geofence Map Picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Peta Titik Kantor & Radius Geofence
                </label>
                <OfficeGeofenceMap
                  lat={Number(officeForm.lat)}
                  lng={Number(officeForm.lng)}
                  radiusMeter={Number(officeForm.radius_meter) || 250}
                  interactive
                  heightClass="h-52"
                  onLocationChange={(nextLat, nextLng) =>
                    setOfficeForm((prev) => ({
                      ...prev,
                      lat: String(nextLat),
                      lng: String(nextLng),
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Latitude
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={officeForm.lat}
                    onChange={(e) => setOfficeForm({ ...officeForm, lat: e.target.value })}
                    placeholder="-6.2088"
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Longitude
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={officeForm.lng}
                    onChange={(e) => setOfficeForm({ ...officeForm, lng: e.target.value })}
                    placeholder="106.8456"
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Radius (Meter)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={50000}
                      required
                      value={officeForm.radius_meter}
                      onChange={(e) => setOfficeForm({ ...officeForm, radius_meter: e.target.value })}
                      className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Aturan Geofence
                    </label>
                    <div className="min-h-11 sm:min-h-10 flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Wajib berada dalam radius
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-400">50m</span>
                  <input
                    type="range"
                    min={50}
                    max={2000}
                    step={25}
                    value={Math.min(2000, Math.max(50, Number(officeForm.radius_meter) || 250))}
                    onChange={(e) =>
                      setOfficeForm((prev) => ({ ...prev, radius_meter: e.target.value }))
                    }
                    aria-label="Geser radius geofence"
                    className="flex-1 accent-[#c0392b]"
                  />
                  <span className="text-[11px] font-mono text-slate-400">2000m</span>
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setOfficeModal(false)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bidang Modal */}
      {bidangModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editingBidang ? 'Edit Bidang Kerja' : 'Tambah Bidang Kerja'}
              </h2>
              <button
                type="button"
                onClick={() => setBidangModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitBidang} className="p-5 space-y-3.5 overflow-y-auto">
              {formErr && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {formErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kode Bidang
                </label>
                <input
                  type="text"
                  required
                  value={bidangForm.kode}
                  onChange={(e) => setBidangForm({ ...bidangForm, kode: e.target.value })}
                  placeholder="MKT"
                  className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Bidang
                </label>
                <input
                  type="text"
                  required
                  value={bidangForm.nama}
                  onChange={(e) => setBidangForm({ ...bidangForm, nama: e.target.value })}
                  placeholder="Sales & Pemasaran"
                  className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Deskripsi
                </label>
                <textarea
                  rows={2}
                  value={bidangForm.deskripsi}
                  onChange={(e) => setBidangForm({ ...bidangForm, deskripsi: e.target.value })}
                  className="w-full p-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setBidangModal(false)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-brand-600 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : editingBidang ? 'Simpan Perubahan' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {pendingDelete.kind === 'office' ? 'Konfirmasi Hapus Kantor' : 'Konfirmasi Hapus Bidang'}
              </h2>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {pendingDelete.kind === 'office'
                  ? `Hapus kantor "${pendingDelete.item.nama}" (${pendingDelete.item.kode})? Pengaturan kalender mingguan kantor ini juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`
                  : `Hapus bidang kerja "${pendingDelete.item.nama}" (${pendingDelete.item.kode})? Tindakan ini tidak dapat dibatalkan.`}
              </p>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPendingDelete()}
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-red-700 hover:bg-red-800 text-white rounded-lg"
                >
                  Ya, Hapus Permanen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tandai Karyawan Keluar (Resign / Nonaktif) */}
      {resignTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <UserMinus className="w-4 h-4 text-amber-600" />
                Tandai Karyawan Keluar
              </h2>
              <button
                type="button"
                onClick={() => setResignTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            <form onSubmit={submitResign} className="p-5 space-y-4 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {formErr}
                </div>
              )}
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                <strong>Direkomendasikan untuk karyawan resign / habis kontrak:</strong> Akun{' '}
                <strong>{resignTarget.nama_lengkap}</strong> ({resignTarget.nik}) langsung dinonaktifkan, sesi login diputus, dan dikeluarkan dari daftar absensi aktif — sementara <strong>seluruh riwayat absensi & payroll tetap utuh</strong> untuk audit.
              </div>
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
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Keluar (Wajib)
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

      {/* Modal Hapus Permanen Data Karyawan */}
      {hardDeleteEmpTarget && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-red-200 dark:border-red-900/70 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/40 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-red-900 dark:text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                Hapus Permanen Data Karyawan
              </h2>
              <button
                type="button"
                onClick={() => setHardDeleteEmpTarget(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5 text-red-700 dark:text-red-300" />
              </button>
            </div>
            <form onSubmit={submitHardDeleteEmp} className="p-5 space-y-4 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
                  {formErr}
                </div>
              )}
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-900 dark:text-red-200 space-y-1.5 leading-relaxed">
                <p>
                  Anda akan menghapus permanen profil & akun{' '}
                  <strong>{hardDeleteEmpTarget.nama_lengkap}</strong> ({hardDeleteEmpTarget.nik}).
                </p>
                <p className="font-mono text-[11px]">
                  Data terkait yang ikut terhapus: <strong>{hardDeleteEmpTarget.jumlah_absensi ?? 0} sesi absensi</strong> ·{' '}
                  <strong>{hardDeleteEmpTarget.jumlah_pengajuan ?? 0} pengajuan</strong> · foto profil & bukti absensi.
                </p>
                {(hardDeleteEmpTarget.jumlah_absensi ?? 0) > 0 && hardDeleteEmpTarget.aktif === 1 && (
                  <p className="pt-1 font-semibold text-amber-900 dark:text-amber-300">
                    Tips: Jika karyawan hanya resign dan riwayat payroll masih dibutuhkan, tutup modal ini lalu gunakan tombol &ldquo;Keluar&rdquo;.
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
                  value={hardDeleteReason}
                  onChange={(e) => setHardDeleteReason(e.target.value)}
                  placeholder="Contoh: Karyawan sudah keluar / akun ganda salah input"
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
                  value={hardDeleteConfirmText}
                  onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                  placeholder="HAPUS"
                  className="w-full h-11 sm:h-10 px-3 text-sm font-mono uppercase border border-red-200 dark:border-red-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setHardDeleteEmpTarget(null)}
                  className="min-h-[44px] sm:min-h-[40px] px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || hardDeleteConfirmText.trim().toUpperCase() !== 'HAPUS'}
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
