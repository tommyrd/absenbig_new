import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Briefcase, CalendarDays, CalendarOff, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { getServerWibDateString } from '../../lib/server-clock-client';
import type {
  HakOffPengganti,
  HariLibur,
  KalenderKerja,
  Kantor,
  Karyawan,
  KerjaKhusus,
} from '../../shared/types';
import { StatusBadge } from '../StatusBadge';

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function AdminCalendarTab() {
  const [subtab, setSubtab] = useState<'kantor' | 'libur' | 'khusus'>('kantor');
  const [calendars, setCalendars] = useState<KalenderKerja[]>([]);
  const [holidays, setHolidays] = useState<HariLibur[]>([]);
  const [specialWorks, setSpecialWorks] = useState<KerjaKhusus[]>([]);
  const [offRights, setOffRights] = useState<HakOffPengganti[]>([]);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [employees, setEmployees] = useState<Karyawan[]>([]);
  const [loading, setLoading] = useState(true);

  // Holiday Modal
  const [holModal, setHolModal] = useState(false);
  const [holForm, setHolForm] = useState({
    tanggal: getServerWibDateString(),
    nama: '',
    kantor_id: '',
    dihitung_masuk: true,
    keterangan: '',
  });

  // Kerja Khusus Modal
  const [kkModal, setKkModal] = useState(false);
  const [kkForm, setKkForm] = useState({
    karyawan_id: 0,
    tanggal: getServerWibDateString(),
    nama_project: '',
    keterangan: '',
    jumlah_sesi: 3,
    min_sesi_hadir: 2,
    berhak_off_pengganti: true,
  });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setActionErr(null);
    try {
      const [c, h, kk, hr, o, e] = await Promise.all([
        apiFetch<{ items: KalenderKerja[] }>('/api/v1/calendars'),
        apiFetch<{ items: HariLibur[] }>('/api/v1/holidays'),
        apiFetch<{ items: KerjaKhusus[] }>('/api/v1/special-work'),
        apiFetch<{ items: HakOffPengganti[] }>('/api/v1/off-rights'),
        apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
        apiFetch<{ items: Karyawan[] }>('/api/v1/master/employees'),
      ]);
      setCalendars(c.items);
      setHolidays(h.items);
      setSpecialWorks(kk.items);
      setOffRights(hr.items);
      setOffices(o.items);
      setEmployees(e.items);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Gagal memuat data kalender kerja.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleCalendarDay = async (cal: KalenderKerja) => {
    setActionErr(null);
    try {
      const nextStatus = cal.status_hari === 'HARI_KERJA' ? 'HARI_LIBUR' : 'HARI_KERJA';
      await apiFetch(`/api/v1/calendars/${cal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status_hari: nextStatus,
          jumlah_sesi_khusus: nextStatus === 'HARI_KERJA' ? cal.jumlah_sesi_khusus : null,
          keterangan:
            nextStatus === 'HARI_LIBUR' ? 'Libur Mingguan Kantor' : 'Hari Kerja Reguler',
        }),
      });
      await loadAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Gagal memperbarui kalender kerja.');
    }
  };

  const setSpecialSessionCount = async (cal: KalenderKerja, count: number | null) => {
    setActionErr(null);
    try {
      await apiFetch(`/api/v1/calendars/${cal.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status_hari: 'HARI_KERJA',
          jumlah_sesi_khusus: count,
          keterangan: count
            ? count === 1
              ? 'Khusus 1 Sesi (Masuk Saja)'
              : `Setengah Hari (${count} Sesi)`
            : 'Hari Kerja Reguler',
        }),
      });
      await loadAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Gagal mengubah jumlah sesi khusus.');
    }
  };

  const submitHoliday = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormErr(null);
    setSaving(true);
    try {
      await apiFetch('/api/v1/holidays', {
        method: 'POST',
        body: JSON.stringify({
          ...holForm,
          kantor_id: holForm.kantor_id ? Number(holForm.kantor_id) : null,
        }),
      });
      setHolModal(false);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menambah hari libur.');
    } finally {
      setSaving(false);
    }
  };

  const deleteHoliday = async (id: number) => {
    setActionErr(null);
    try {
      await apiFetch(`/api/v1/holidays/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Gagal menghapus hari libur.');
    }
  };

  const submitSpecialWork = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormErr(null);
    setSaving(true);
    try {
      await apiFetch('/api/v1/special-work', {
        method: 'POST',
        body: JSON.stringify(kkForm),
      });
      setKkModal(false);
      await loadAll();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Gagal menetapkan kerja khusus.');
    } finally {
      setSaving(false);
    }
  };

  const cancelSpecialWork = async (id: number) => {
    setActionErr(null);
    try {
      await apiFetch(`/api/v1/special-work/${id}/cancel`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Gagal membatalkan penugasan kerja khusus.');
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Kalender Kerja, Hari Libur & Kerja Khusus
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Atur pola hari kerja berbeda per kantor, hari raya perusahaan, kerja khusus, dan hak off pengganti.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {subtab === 'libur' && (
            <button
              type="button"
              onClick={() => {
                setHolForm({
                  tanggal: getServerWibDateString(),
                  nama: '',
                  kantor_id: '',
                  dihitung_masuk: true,
                  keterangan: '',
                });
                setFormErr(null);
                setHolModal(true);
              }}
              className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              Tambah Hari Libur
            </button>
          )}
          {subtab === 'khusus' && (
            <button
              type="button"
              onClick={() => {
                setKkForm({
                  karyawan_id: employees[0]?.id ?? 0,
                  tanggal: getServerWibDateString(),
                  nama_project: '',
                  keterangan: '',
                  jumlah_sesi: 3,
                  min_sesi_hadir: 2,
                  berhak_off_pengganti: true,
                });
                setFormErr(null);
                setKkModal(true);
              }}
              className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              Tetapkan Kerja Khusus
            </button>
          )}
        </div>
      </div>

      {actionErr && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/70 text-xs text-red-800 dark:text-red-300">
          {actionErr}
        </div>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setSubtab('kantor')}
            className={`min-h-[40px] sm:min-h-[34px] px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'kantor'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Kalender Mingguan Kantor
          </button>
          <button
            type="button"
            onClick={() => setSubtab('libur')}
            className={`min-h-[40px] sm:min-h-[34px] px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'libur'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Hari Libur Perusahaan ({holidays.length})
          </button>
          <button
            type="button"
            onClick={() => setSubtab('khusus')}
            className={`min-h-[40px] sm:min-h-[34px] px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subtab === 'khusus'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Kerja Khusus & Hak Off ({specialWorks.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
      ) : (
        <>
          {subtab === 'kantor' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
              {offices.map((off) => {
                const days = calendars.filter((c) => c.kantor_id === off.id);
                return (
                  <div
                    key={off.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                  >
                    <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
                      <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <CalendarDays className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                        {off.nama}
                      </h2>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {days.map((cal) => (
                        <div
                          key={cal.id}
                          className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {DAY_NAMES[cal.hari_minggu]}
                            </p>
                            <p className="text-slate-500 dark:text-slate-400">{cal.keterangan}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {cal.status_hari === 'HARI_KERJA' && (
                              <select
                                value={cal.jumlah_sesi_khusus ?? ''}
                                onChange={(e) =>
                                  setSpecialSessionCount(
                                    cal,
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                                className="min-h-[40px] sm:h-8 px-2 border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200"
                              >
                                <option value="">Ikuti Policy</option>
                                <option value="1">Khusus 1 Sesi</option>
                                <option value="2">Khusus 2 Sesi</option>
                                <option value="3">Khusus 3 Sesi</option>
                                <option value="4">Khusus 4 Sesi</option>
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleCalendarDay(cal)}
                              className={`min-h-[40px] sm:h-8 px-3 rounded-md font-semibold border transition-colors ${
                                cal.status_hari === 'HARI_KERJA'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                                  : 'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/60'
                              }`}
                            >
                              {cal.status_hari === 'HARI_KERJA' ? 'HARI KERJA' : 'HARI LIBUR'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subtab === 'libur' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
              {holidays.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Belum ada hari libur perusahaan yang ditetapkan.
                </div>
              ) : (
                holidays.map((h) => (
                  <div
                    key={h.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 flex items-center justify-center shrink-0">
                        <CalendarOff className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                            {h.tanggal}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{h.nama}</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Lingkup: {h.kantor_nama || 'Semua Kantor'} ·{' '}
                          {h.dihitung_masuk ? 'Dihitung Masuk Payroll' : 'Tidak Dihitung Masuk'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteHoliday(h.id)}
                      className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline self-start sm:self-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {subtab === 'khusus' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    Penugasan Kerja Khusus
                  </h2>
                </div>
                {specialWorks.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Belum ada penugasan kerja khusus tercatat.
                  </p>
                ) : (
                  specialWorks.map((kk) => (
                    <div
                      key={kk.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                            {kk.tanggal}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {kk.karyawan_nama}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">({kk.kantor_nama})</span>
                        </div>
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mt-1">
                          Project: {kk.nama_project}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Target: {kk.min_sesi_hadir}/{kk.jumlah_sesi} sesi ·{' '}
                          {kk.berhak_off_pengganti
                            ? 'Menghasilkan 1 hak Off Pengganti'
                            : 'Tanpa hak Off Pengganti'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={kk.status === 'AKTIF' ? 'KERJA_KHUSUS' : kk.status} />
                        {kk.status === 'AKTIF' && (
                          <button
                            type="button"
                            onClick={() => cancelSpecialWork(kk.id)}
                            className="min-h-[36px] text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
                          >
                            Batalkan
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Hak Off Pengganti Tracking */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Monitoring Hak Off Pengganti (1x Pakai)
                  </h2>
                </div>
                {offRights.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Belum ada hak Off Pengganti yang diterbitkan.
                  </p>
                ) : (
                  offRights.map((r) => (
                    <div
                      key={r.id}
                      className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {r.karyawan_nama} — {r.nama_project}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                          Kerja sumber: {r.tanggal_kerja_sumber} · Kadaluarsa: {r.kadaluarsa_pada}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Holiday Modal (Bottom Sheet on Mobile) */}
      {holModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setHolModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Tetapkan Hari Libur Perusahaan
              </h2>
              <button
                type="button"
                onClick={() => setHolModal(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitHoliday} className="p-5 space-y-3.5 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                  {formErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tanggal</label>
                <input
                  type="date"
                  required
                  value={holForm.tanggal}
                  onChange={(e) => setHolForm({ ...holForm, tanggal: e.target.value })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Hari Raya / Libur
                </label>
                <input
                  type="text"
                  required
                  value={holForm.nama}
                  onChange={(e) => setHolForm({ ...holForm, nama: e.target.value })}
                  placeholder="Mis. Hari Raya Idul Fitri"
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Lingkup Kantor
                </label>
                <select
                  value={holForm.kantor_id}
                  onChange={(e) => setHolForm({ ...holForm, kantor_id: e.target.value })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">Semua Kantor</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nama}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 min-h-[36px]">
                <input
                  type="checkbox"
                  checked={holForm.dihitung_masuk}
                  onChange={(e) => setHolForm({ ...holForm, dihitung_masuk: e.target.checked })}
                  className="w-4 h-4 accent-navy-900 dark:accent-brand-500"
                />
                Dihitung Masuk Payroll (menambah HARI MASUK)
              </label>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setHolModal(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white rounded-lg disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Hari Libur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Special Work Modal (Bottom Sheet on Mobile) */}
      {kkModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setKkModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Tetapkan Penugasan Kerja Khusus
              </h2>
              <button
                type="button"
                onClick={() => setKkModal(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={submitSpecialWork} className="p-5 space-y-3.5 overflow-y-auto">
              {formErr && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200">
                  {formErr}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilih Karyawan / Teknisi
                </label>
                <select
                  value={kkForm.karyawan_id}
                  onChange={(e) => setKkForm({ ...kkForm, karyawan_id: Number(e.target.value) })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nik} · {emp.nama_lengkap} ({emp.bidang_nama})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Kerja Khusus
                </label>
                <input
                  type="date"
                  required
                  value={kkForm.tanggal}
                  onChange={(e) => setKkForm({ ...kkForm, tanggal: e.target.value })}
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Project / Penugasan
                </label>
                <input
                  type="text"
                  required
                  value={kkForm.nama_project}
                  onChange={(e) => setKkForm({ ...kkForm, nama_project: e.target.value })}
                  placeholder="Mis. Penarikan Fiber ODP Timur"
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jumlah Sesi
                  </label>
                  <select
                    value={kkForm.jumlah_sesi}
                    onChange={(e) =>
                      setKkForm({
                        ...kkForm,
                        jumlah_sesi: Number(e.target.value),
                        min_sesi_hadir: Math.min(kkForm.min_sesi_hadir, Number(e.target.value)),
                      })
                    }
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value={1}>1 Sesi (Masuk Saja)</option>
                    <option value={2}>2 Sesi</option>
                    <option value={3}>3 Sesi</option>
                    <option value={4}>4 Sesi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Min. Sesi Hadir
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={kkForm.jumlah_sesi}
                    value={kkForm.min_sesi_hadir}
                    onChange={(e) =>
                      setKkForm({ ...kkForm, min_sesi_hadir: Number(e.target.value) })
                    }
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 min-h-[36px]">
                <input
                  type="checkbox"
                  checked={kkForm.berhak_off_pengganti}
                  onChange={(e) =>
                    setKkForm({ ...kkForm, berhak_off_pengganti: e.target.checked })
                  }
                  className="w-4 h-4 accent-navy-900 dark:accent-brand-500"
                />
                Berhak mendapatkan 1 hak Off Pengganti
              </label>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setKkModal(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-brand-600 dark:hover:bg-brand-500 text-white rounded-lg disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : 'Tetapkan Penugasan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
