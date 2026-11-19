import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Edit3, FileCheck2, Plus, X, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getServerWibDateString, useServerClock } from '../../lib/server-clock-client';
import type { HakOffPengganti, Pengajuan, RequestType } from '../../shared/types';
import { StatusBadge } from '../StatusBadge';

export function EmployeePengajuanPage() {
  const [requests, setRequests] = useState<Pengajuan[]>([]);
  const [offRights, setOffRights] = useState<HakOffPengganti[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Pengajuan | null>(null);

  // Form state (always seeded from server WIB date)
  const { dateWib: serverToday } = useServerClock(30000);
  const [jenis, setJenis] = useState<RequestType>('CUTI');
  const [tanggalMulai, setTanggalMulai] = useState(() => getServerWibDateString());
  const [tanggalAkhir, setTanggalAkhir] = useState(() => getServerWibDateString());
  const [alasan, setAlasan] = useState('');
  const [catatan, setCatatan] = useState('');
  const [hakOffId, setHakOffId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, offRes] = await Promise.all([
        apiFetch<{ items: Pengajuan[] }>('/api/v1/requests'),
        apiFetch<{ items: HakOffPengganti[] }>('/api/v1/off-rights'),
      ]);
      setRequests(reqRes.items);
      setOffRights(offRes.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const availableRights = offRights.filter((r) => r.status === 'TERSEDIA');

  const openCreate = () => {
    setEditing(null);
    setJenis('CUTI');
    const today = getServerWibDateString() || serverToday;
    setTanggalMulai(today);
    setTanggalAkhir(today);
    setAlasan('');
    setCatatan('');
    setHakOffId(availableRights[0] ? String(availableRights[0].id) : '');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (req: Pengajuan) => {
    setEditing(req);
    setJenis(req.jenis);
    setTanggalMulai(req.tanggal_mulai);
    setTanggalAkhir(req.tanggal_akhir);
    setAlasan(req.alasan);
    setCatatan(req.catatan || '');
    setHakOffId(req.hak_off_id ? String(req.hak_off_id) : '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/api/v1/requests/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            tanggalMulai,
            tanggalAkhir: jenis === 'OFF_PENGGANTI' ? tanggalMulai : tanggalAkhir,
            alasan,
            catatan,
          }),
        });
      } else {
        await apiFetch('/api/v1/requests', {
          method: 'POST',
          body: JSON.stringify({
            jenis,
            tanggalMulai,
            tanggalAkhir: jenis === 'OFF_PENGGANTI' ? tanggalMulai : tanggalAkhir,
            alasan,
            catatan,
            hakOffId: jenis === 'OFF_PENGGANTI' && hakOffId ? Number(hakOffId) : null,
          }),
        });
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pengajuan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (req: Pengajuan) => {
    setActionError(null);
    try {
      await apiFetch(`/api/v1/requests/${req.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ alasan: 'Dibatalkan oleh karyawan sebelum diproses' }),
      });
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal membatalkan pengajuan.');
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
            Pengajuan Cuti, Off, Izin & Sakit
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Ajukan ketidakhadiran resmi atau gunakan hak Off Pengganti dari kerja khusus.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Buat Pengajuan
        </button>
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
          {actionError}
        </div>
      )}

      {/* Off Pengganti Rights Wallet */}
      {offRights.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-indigo-700 dark:text-indigo-400" />
            Hak Off Pengganti Anda ({availableRights.length} tersedia)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {offRights.map((r) => (
              <div
                key={r.id}
                className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{r.nama_project}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                    Kerja sumber: {r.tanggal_kerja_sumber}
                  </p>
                </div>
                {r.status === 'TERSEDIA' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setJenis('OFF_PENGGANTI');
                      const today = getServerWibDateString() || serverToday;
                      setTanggalMulai(today);
                      setTanggalAkhir(today);
                      setHakOffId(String(r.id));
                      setAlasan(`Menggunakan hak off pengganti dari ${r.nama_project}`);
                      setCatatan('');
                      setFormError(null);
                      setModalOpen(true);
                    }}
                    className="min-h-[36px] text-xs font-semibold text-indigo-700 dark:text-indigo-400 hover:underline text-left"
                  >
                    Gunakan hak off ini →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requests List */}
      <div className="space-y-3">
        {loading ? (
          <div className="h-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
        ) : requests.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Belum ada riwayat pengajuan</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Klik Buat Pengajuan untuk mengajukan cuti, izin, sakit, off, atau off pengganti.
            </p>
          </div>
        ) : (
          requests.map((req) => (
            <div
              key={req.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {req.jenis.replace(/_/g, ' ')}
                    </span>
                    <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {req.tanggal_mulai === req.tanggal_akhir
                        ? req.tanggal_mulai
                        : `${req.tanggal_mulai} s/d ${req.tanggal_akhir}`}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 mt-1.5">{req.alasan}</p>
                  {req.catatan && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Catatan: {req.catatan}</p>
                  )}
                  {req.jenis === 'OFF_PENGGANTI' && req.tanggal_kerja_sumber && (
                    <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1">
                      Sumber hak off: {req.nama_project_sumber} ({req.tanggal_kerja_sumber})
                    </p>
                  )}
                </div>
                <StatusBadge status={req.status} />
              </div>

              {req.alasan_keputusan && (req.status === 'REJECTED' || req.status === 'APPROVED' || req.status === 'CANCELLED') && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    req.status === 'REJECTED'
                      ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                      : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <strong>Keterangan Keputusan:</strong> {req.alasan_keputusan}
                </div>
              )}

              {req.status === 'PENDING' && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => openEdit(req)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit Pengajuan
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancel(req)}
                    className="min-h-[36px] inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Batalkan
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Modal (Bottom Sheet on Mobile) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editing ? 'Edit Pengajuan' : 'Buat Pengajuan Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                  {formError}
                </div>
              )}

              {!editing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Jenis Pengajuan
                  </label>
                  <select
                    value={jenis}
                    onChange={(e) => setJenis(e.target.value as RequestType)}
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="CUTI">CUTI</option>
                    <option value="OFF">OFF</option>
                    <option value="OFF_PENGGANTI">OFF PENGGANTI</option>
                    <option value="IZIN">IZIN</option>
                    <option value="SAKIT">SAKIT</option>
                  </select>
                </div>
              )}

              {jenis === 'OFF_PENGGANTI' && !editing && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Pilih Hak Off Pengganti Tersedia
                  </label>
                  {availableRights.length === 0 ? (
                    <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
                      Anda tidak memiliki hak Off Pengganti yang tersedia.
                    </p>
                  ) : (
                    <select
                      value={hakOffId}
                      onChange={(e) => setHakOffId(e.target.value)}
                      className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    >
                      {availableRights.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.nama_project} ({r.tanggal_kerja_sumber})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {jenis === 'OFF_PENGGANTI' ? 'Tanggal Off' : 'Tanggal Mulai'}
                  </label>
                  <input
                    type="date"
                    value={tanggalMulai}
                    onChange={(e) => {
                      setTanggalMulai(e.target.value);
                      if (jenis === 'OFF_PENGGANTI' || tanggalAkhir < e.target.value) {
                        setTanggalAkhir(e.target.value);
                      }
                    }}
                    required
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                {jenis !== 'OFF_PENGGANTI' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                      Tanggal Akhir
                    </label>
                    <input
                      type="date"
                      value={tanggalAkhir}
                      min={tanggalMulai}
                      onChange={(e) => setTanggalAkhir(e.target.value)}
                      required
                      className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Alasan Pengajuan
                </label>
                <textarea
                  rows={3}
                  value={alasan}
                  onChange={(e) => setAlasan(e.target.value)}
                  required
                  placeholder="Jelaskan alasan pengajuan Anda..."
                  className="w-full p-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Catatan Tambahan (Opsional)
                </label>
                <input
                  type="text"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="Mis. serah terima tugas ke rekan..."
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || (jenis === 'OFF_PENGGANTI' && !editing && availableRights.length === 0)}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Mengirim...' : editing ? 'Simpan Perubahan' : 'Kirim Pengajuan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
