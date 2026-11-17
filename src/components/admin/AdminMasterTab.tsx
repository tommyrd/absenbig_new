import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Edit3, Plus, Users, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { BidangKerja, Kantor, Karyawan, Role } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { UserAvatar } from '../UserAvatar';

export function AdminMasterTab() {
  const [subtab, setSubtab] = useState<'karyawan' | 'kantor' | 'bidang'>('karyawan');
  const [employees, setEmployees] = useState<Karyawan[]>([]);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    jabatan: '',
    username: '',
    role: 'KARYAWAN' as Role,
    aktif: 1,
  });

  // Office Modal
  const [officeModal, setOfficeModal] = useState(false);
  const [editingOffice, setEditingOffice] = useState<Kantor | null>(null);
  const [officeForm, setOfficeForm] = useState({
    kode: '',
    nama: '',
    alamat: '',
    lat: -6.2088,
    lng: 106.8456,
    radius_meter: 250,
  });

  // Bidang Modal
  const [bidangModal, setBidangModal] = useState(false);
  const [editingBidang, setEditingBidang] = useState<BidangKerja | null>(null);
  const [bidangForm, setBidangForm] = useState({ kode: '', nama: '', deskripsi: '' });

  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      jabatan: emp.jabatan,
      username: emp.username || '',
      role: emp.role || 'KARYAWAN',
      aktif: emp.aktif,
    });
    setFormErr(null);
    setEmpModal(true);
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
    setSaving(true);
    setFormErr(null);
    try {
      if (editingOffice) {
        await apiFetch(`/api/v1/master/offices/${editingOffice.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...officeForm, geofence_mode: 'TOLAK_LUAR_RADIUS' }),
        });
      } else {
        await apiFetch('/api/v1/master/offices', {
          method: 'POST',
          body: JSON.stringify(officeForm),
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

  const empCols: ColumnDef<Karyawan>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik,
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
          {r.nik}
        </span>
      ),
    },
    {
      key: 'nama',
      header: 'Nama & Akun',
      sortValue: (r) => r.nama_lengkap,
      render: (r) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            karyawanId={r.id}
            name={r.nama_lengkap}
            role={r.role}
            version={r.foto_profil_updated_at}
            size="sm"
          />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {r.nama_lengkap}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              @{r.username} · {r.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'kantor',
      header: 'Kantor & Bidang',
      sortValue: (r) => r.kantor_nama || '',
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantor_nama}</p>
          <p className="text-slate-500 dark:text-slate-400">
            {r.bidang_nama} · {r.jabatan}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (r) => r.role || '',
      render: (r) => (
        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
          {r.role}
        </span>
      ),
    },
    {
      key: 'aktif',
      header: 'Status',
      render: (r) => (
        <span
          className={`text-xs font-semibold ${
            r.aktif
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {r.aktif ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'aksi',
      header: 'Aksi',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          onClick={() => openEditEmp(r)}
          className="inline-flex items-center gap-1 min-h-[36px] px-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit
        </button>
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
            Kelola penempatan kantor, geofence radius, bidang kerja, dan akun pengguna.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {subtab === 'karyawan' && (
            <span className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
              Pembuatan & ACC akun baru dikelola oleh Superadmin
            </span>
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
                  lat: -6.2088,
                  lng: 106.8456,
                  radius_meter: 250,
                });
                setFormErr(null);
                setOfficeModal(true);
              }}
              className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              Tambah Kantor
            </button>
          )}
          {subtab === 'bidang' && (
            <button
              type="button"
              onClick={openCreateBidang}
              className="min-h-[44px] sm:min-h-[40px] px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-700 dark:hover:bg-blue-600 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
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
            Karyawan ({employees.length})
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

      {subtab === 'karyawan' && (
        <DataTable
          data={employees}
          columns={empCols}
          getRowId={(r) => r.id}
          loading={loading}
          error={error}
          onRetry={loadAll}
          searchPlaceholder="Cari NIK, nama, kantor, atau bidang..."
          searchFilter={(r, q) =>
            r.nama_lengkap.toLowerCase().includes(q) ||
            r.nik.toLowerCase().includes(q) ||
            (r.kantor_nama || '').toLowerCase().includes(q) ||
            (r.bidang_nama || '').toLowerCase().includes(q)
          }
        />
      )}

      {subtab === 'kantor' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {offices.map((o) => (
            <div
              key={o.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                    {o.kode}
                  </span>
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {o.nama}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{o.alamat}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingOffice(o);
                    setOfficeForm({
                      kode: o.kode,
                      nama: o.nama,
                      alamat: o.alamat,
                      lat: o.lat,
                      lng: o.lng,
                      radius_meter: o.radius_meter,
                    });
                    setFormErr(null);
                    setOfficeModal(true);
                  }}
                  className="min-h-[36px] px-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Ubah
                </button>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 dark:text-slate-500">Koordinat:</span>
                  <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {o.lat}, {o.lng}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500">Aturan Absensi:</span>
                  <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {o.radius_meter}m · Wajib dalam radius
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {subtab === 'bidang' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {bidangList.map((b) => (
            <div
              key={b.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 min-w-0">
                  <Users className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs font-semibold">{b.kode}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openEditBidang(b)}
                  className="min-h-[36px] px-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Ubah
                </button>
              </div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
                {b.nama}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                {b.deskripsi}
              </p>
            </div>
          ))}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jabatan
                  </label>
                  <input
                    type="text"
                    required
                    value={empForm.jabatan}
                    onChange={(e) => setEmpForm({ ...empForm, jabatan: e.target.value })}
                    className="w-full h-11 sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
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
              </div>
              {editingEmp && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 pt-1 min-h-[32px]">
                  <input
                    type="checkbox"
                    checked={Boolean(empForm.aktif)}
                    onChange={(e) => setEmpForm({ ...empForm, aktif: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
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
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-blue-700 text-white rounded-lg"
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
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    required
                    value={officeForm.lat}
                    onChange={(e) => setOfficeForm({ ...officeForm, lat: Number(e.target.value) })}
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    required
                    value={officeForm.lng}
                    onChange={(e) => setOfficeForm({ ...officeForm, lng: Number(e.target.value) })}
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Radius (Meter)
                  </label>
                  <input
                    type="number"
                    min={20}
                    required
                    value={officeForm.radius_meter}
                    onChange={(e) => setOfficeForm({ ...officeForm, radius_meter: Number(e.target.value) })}
                    className="w-full h-11 sm:h-10 px-3 text-sm font-mono border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg"
                  />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Aturan Geofence
                  </label>
                  <div className="min-h-11 flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                    Wajib berada dalam radius
                  </div>
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
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-blue-700 text-white rounded-lg"
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
                  className="min-h-[44px] sm:min-h-[40px] px-5 text-xs font-semibold bg-navy-900 dark:bg-blue-700 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : editingBidang ? 'Simpan Perubahan' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
