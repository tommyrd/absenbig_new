import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getServerWibDateString } from '../../lib/server-clock-client';
import type { Karyawan, Pengajuan, RequestType } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';

export function AdminApprovalTab() {
  const [requests, setRequests] = useState<Pengajuan[]>([]);
  const [employees, setEmployees] = useState<Karyawan[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [jenisFilter, setJenisFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decision Modal
  const [decisionTarget, setDecisionTarget] = useState<{
    req: Pengajuan;
    mode: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Admin Create On Behalf Modal
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    karyawanId: 0,
    jenis: 'IZIN' as RequestType,
    tanggalMulai: getServerWibDateString(),
    tanggalAkhir: getServerWibDateString(),
    alasan: '',
    catatan: '',
  });
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [decisionErr, setDecisionErr] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (jenisFilter) qs.set('jenis', jenisFilter);
      const [r, e] = await Promise.all([
        apiFetch<{ items: Pengajuan[] }>(`/api/v1/requests?${qs.toString()}`),
        apiFetch<{ items: Karyawan[] }>('/api/v1/master/employees'),
      ]);
      setRequests(r.items);
      setEmployees(e.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar pengajuan.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, jenisFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const submitDecision = async (e: FormEvent) => {
    e.preventDefault();
    if (!decisionTarget) return;
    setSubmitting(true);
    setDecisionErr(null);
    try {
      await apiFetch(`/api/v1/requests/${decisionTarget.req.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision: decisionTarget.mode,
          alasanKeputusan: decisionReason,
        }),
      });
      setDecisionTarget(null);
      setDecisionReason('');
      await loadData();
    } catch (err) {
      setDecisionErr(err instanceof Error ? err.message : 'Gagal memproses keputusan pengajuan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminCancel = async (req: Pengajuan) => {
    setError(null);
    try {
      await apiFetch(`/api/v1/requests/${req.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ alasan: 'Dibatalkan oleh Admin karena perubahan jadwal kerja' }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan status pengajuan.');
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateErr(null);
    try {
      await apiFetch('/api/v1/requests', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setCreateModal(false);
      await loadData();
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Gagal membuat pengajuan.');
    }
  };

  const columns: ColumnDef<Pengajuan>[] = [
    {
      key: 'karyawan',
      header: 'Karyawan',
      sortValue: (r) => r.karyawan_nama || '',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.karyawan_nama}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {r.nik} · {r.bidang_nama}
          </p>
        </div>
      ),
    },
    {
      key: 'jenis',
      header: 'Jenis & Tanggal',
      sortValue: (r) => r.tanggal_mulai,
      render: (r) => (
        <div className="text-xs">
          <p className="font-bold text-slate-900 dark:text-slate-100">{r.jenis.replace(/_/g, ' ')}</p>
          <p className="font-mono text-slate-600 dark:text-slate-400 tabular-nums mt-0.5">
            {r.tanggal_mulai === r.tanggal_akhir
              ? r.tanggal_mulai
              : `${r.tanggal_mulai} s/d ${r.tanggal_akhir}`}
          </p>
        </div>
      ),
    },
    {
      key: 'alasan',
      header: 'Alasan',
      render: (r) => (
        <div className="max-w-xs text-xs text-slate-700 dark:text-slate-300">
          <p>{r.alasan}</p>
          {r.tanggal_kerja_sumber && (
            <p className="text-indigo-700 dark:text-indigo-400 mt-0.5">
              Sumber Off: {r.nama_project_sumber} ({r.tanggal_kerja_sumber})
            </p>
          )}
          {r.alasan_keputusan && (
            <p className="text-slate-500 dark:text-slate-400 mt-0.5">Catatan proses: {r.alasan_keputusan}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'aksi',
      header: 'Aksi',
      align: 'right',
      render: (r) =>
        r.status === 'PENDING' ? (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDecisionTarget({ req: r, mode: 'APPROVED' });
                setDecisionReason('Disetujui sesuai jadwal operasional');
              }}
              className="min-h-[40px] sm:min-h-[32px] px-3 sm:px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              Setujui
            </button>
            <button
              type="button"
              onClick={() => {
                setDecisionTarget({ req: r, mode: 'REJECTED' });
                setDecisionReason('');
              }}
              className="min-h-[40px] sm:min-h-[32px] px-3 sm:px-2.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              Tolak
            </button>
          </div>
        ) : r.status === 'APPROVED' ? (
          <button
            type="button"
            onClick={() => handleAdminCancel(r)}
            className="min-h-[36px] text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
          >
            Batalkan Status
          </button>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Approval Pengajuan Karyawan
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Proses persetujuan atau penolakan pengajuan dengan alasan wajib yang tercatat di audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const today = getServerWibDateString();
            setCreateForm({
              karyawanId: employees[0]?.id ?? 0,
              jenis: 'IZIN',
              tanggalMulai: today,
              tanggalAkhir: today,
              alasan: '',
              catatan: '',
            });
            setCreateErr(null);
            setCreateModal(true);
          }}
          className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 self-start sm:self-auto w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Buat Atas Nama Karyawan
        </button>
      </div>

      {decisionErr && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
          {decisionErr}
        </div>
      )}

      <DataTable
        data={requests}
        columns={columns}
        getRowId={(r) => r.id}
        loading={loading}
        error={error}
        onRetry={loadData}
        searchPlaceholder="Cari nama karyawan atau alasan..."
        searchFilter={(r, q) =>
          (r.karyawan_nama || '').toLowerCase().includes(q) ||
          r.alasan.toLowerCase().includes(q) ||
          r.jenis.toLowerCase().includes(q)
        }
        filterToolbar={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
            >
              <option value="">Semua Status</option>
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <select
              value={jenisFilter}
              onChange={(e) => setJenisFilter(e.target.value)}
              className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
            >
              <option value="">Semua Jenis</option>
              <option value="CUTI">CUTI</option>
              <option value="OFF">OFF</option>
              <option value="OFF_PENGGANTI">OFF PENGGANTI</option>
              <option value="IZIN">IZIN</option>
              <option value="SAKIT">SAKIT</option>
            </select>
          </>
        }
      />

      {/* Approve / Reject Modal (Bottom Sheet on Mobile) */}
      {decisionTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {decisionTarget.mode === 'APPROVED' ? 'Setujui Pengajuan' : 'Tolak Pengajuan'}
              </h2>
              <button
                type="button"
                onClick={() => setDecisionTarget(null)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitDecision} className="p-5 space-y-4 overflow-y-auto">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs">
                <p className="font-bold text-slate-900 dark:text-slate-100">{decisionTarget.req.karyawan_nama}</p>
                <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                  {decisionTarget.req.jenis} · {decisionTarget.req.tanggal_mulai} s/d{' '}
                  {decisionTarget.req.tanggal_akhir}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Alasan Keputusan (Wajib Tercatat di Audit)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={3}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder="Tuliskan alasan persetujuan atau penolakan..."
                  className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDecisionTarget(null)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`min-h-[44px] sm:h-10 px-5 text-xs font-semibold text-white rounded-lg ${
                    decisionTarget.mode === 'APPROVED'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  {submitting
                    ? 'Memproses...'
                    : decisionTarget.mode === 'APPROVED'
                    ? 'Konfirmasi Setujui'
                    : 'Konfirmasi Tolak'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Create On Behalf Modal (Bottom Sheet on Mobile) */}
      {createModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Buat Pengajuan Atas Nama Karyawan
              </h2>
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitCreate} className="p-5 space-y-3.5 overflow-y-auto">
              {createErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                  {createErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Karyawan</label>
                <select
                  value={createForm.karyawanId}
                  onChange={(e) => setCreateForm({ ...createForm, karyawanId: Number(e.target.value) })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nik} · {emp.nama_lengkap}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Jenis</label>
                <select
                  value={createForm.jenis}
                  onChange={(e) => setCreateForm({ ...createForm, jenis: e.target.value as RequestType })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="CUTI">CUTI</option>
                  <option value="OFF">OFF</option>
                  <option value="IZIN">IZIN</option>
                  <option value="SAKIT">SAKIT</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Mulai</label>
                  <input
                    type="date"
                    value={createForm.tanggalMulai}
                    onChange={(e) => setCreateForm({ ...createForm, tanggalMulai: e.target.value })}
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Akhir</label>
                  <input
                    type="date"
                    value={createForm.tanggalAkhir}
                    min={createForm.tanggalMulai}
                    onChange={(e) => setCreateForm({ ...createForm, tanggalAkhir: e.target.value })}
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Alasan</label>
                <textarea
                  rows={2}
                  required
                  value={createForm.alasan}
                  onChange={(e) => setCreateForm({ ...createForm, alasan: e.target.value })}
                  className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white rounded-lg"
                >
                  Simpan Pengajuan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
