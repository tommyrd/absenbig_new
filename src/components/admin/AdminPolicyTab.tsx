import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Edit3, Plus, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AttendanceLocationRule, BidangKerja, Karyawan, KebijakanAbsensi, PolicyLevel, SesiConfig } from '../../shared/types';

function makeDefaultSesi(count: number): SesiConfig[] {
  return Array.from({ length: count }).map((_, i) => ({
    urutan: i + 1,
    nama: `Sesi ${i + 1}`,
    jam_mulai: i === 0 ? '08:00' : i === 1 ? '12:00' : i === 2 ? '15:00' : '17:00',
    jam_selesai: i === 0 ? '09:30' : i === 1 ? '14:00' : i === 2 ? '16:30' : '19:30',
    wajib_foto: 1,
    wajib_aktivitas: i >= 1 ? 1 : 0,
    aktif: 1,
  }));
}

export function AdminPolicyTab() {
  const [policies, setPolicies] = useState<KebijakanAbsensi[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [employees, setEmployees] = useState<Karyawan[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KebijakanAbsensi | null>(null);
  const [form, setForm] = useState({
    level: 'BIDANG' as PolicyLevel,
    bidang_id: 1,
    karyawan_id: 3,
    nama: '',
    jumlah_sesi: 3,
    min_sesi_hadir: 2,
    toleransi_terlambat_menit: 15,
    aturan_lokasi: 'SESI_PERTAMA_KANTOR' as AttendanceLocationRule,
    wajib_foto_semua_sesi: true,
    wajib_aktivitas_sesi_lanjut: true,
    libur_dihitung_masuk: true,
    off_pengganti_dihitung_masuk: true,
    izin_dihitung_masuk: false,
    sakit_dihitung_masuk: true,
    cuti_dihitung_masuk: true,
    sesi: makeDefaultSesi(3),
  });
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b, e] = await Promise.all([
        apiFetch<{ items: KebijakanAbsensi[] }>('/api/v1/policies'),
        apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
        apiFetch<{ items: Karyawan[] }>('/api/v1/master/employees'),
      ]);
      setPolicies(p.items);
      setBidangList(b.items);
      setEmployees(e.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      level: 'BIDANG',
      bidang_id: bidangList[0]?.id ?? 1,
      karyawan_id: employees[0]?.id ?? 3,
      nama: '',
      jumlah_sesi: 3,
      min_sesi_hadir: 2,
      toleransi_terlambat_menit: 15,
      aturan_lokasi: 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: true,
      wajib_aktivitas_sesi_lanjut: true,
      libur_dihitung_masuk: true,
      off_pengganti_dihitung_masuk: true,
      izin_dihitung_masuk: false,
      sakit_dihitung_masuk: true,
      cuti_dihitung_masuk: true,
      sesi: makeDefaultSesi(3),
    });
    setModalOpen(true);
  };

  const openEdit = (p: KebijakanAbsensi) => {
    setEditing(p);
    setForm({
      level: p.level,
      bidang_id: p.bidang_id ?? (bidangList[0]?.id ?? 1),
      karyawan_id: p.karyawan_id ?? (employees[0]?.id ?? 3),
      nama: p.nama,
      jumlah_sesi: p.jumlah_sesi,
      min_sesi_hadir: p.min_sesi_hadir,
      toleransi_terlambat_menit: p.toleransi_terlambat_menit,
      aturan_lokasi: p.aturan_lokasi || 'SESI_PERTAMA_KANTOR',
      wajib_foto_semua_sesi: Boolean(p.wajib_foto_semua_sesi),
      wajib_aktivitas_sesi_lanjut: Boolean(p.wajib_aktivitas_sesi_lanjut),
      libur_dihitung_masuk: Boolean(p.libur_dihitung_masuk),
      off_pengganti_dihitung_masuk: Boolean(p.off_pengganti_dihitung_masuk),
      izin_dihitung_masuk: Boolean(p.izin_dihitung_masuk),
      sakit_dihitung_masuk: Boolean(p.sakit_dihitung_masuk),
      cuti_dihitung_masuk: Boolean(p.cuti_dihitung_masuk),
      sesi: p.sesi && p.sesi.length === p.jumlah_sesi ? p.sesi : makeDefaultSesi(p.jumlah_sesi),
    });
    setModalOpen(true);
  };

  const handleCountChange = (count: number) => {
    const next = Array.from({ length: count }).map(
      (_, i) => form.sesi[i] || makeDefaultSesi(count)[i]
    );
    setForm({
      ...form,
      jumlah_sesi: count,
      min_sesi_hadir: Math.min(form.min_sesi_hadir, count),
      sesi: next,
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/v1/policies/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch('/api/v1/policies', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setModalOpen(false);
      await loadAll();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Kebijakan Sesi & Aturan Payroll
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Hierarki prioritas resolver: Kebijakan Karyawan → Kebijakan Bidang → Kebijakan Default.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="min-h-[44px] sm:h-10 px-4 bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 self-start sm:self-auto w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          Buat Kebijakan Baru
        </button>
      </div>

      {loading ? (
        <div className="h-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {policies.map((p) => (
            <div key={p.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400 font-semibold">
                    <ShieldCheck className="w-4 h-4" />
                    <span>
                      Prioritas {p.level}
                      {p.bidang_nama ? ` · ${p.bidang_nama}` : ''}
                      {p.karyawan_nama ? ` · ${p.karyawan_nama}` : ''}
                    </span>
                  </div>
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 mt-1">{p.nama}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => openEdit(p)}
                  className="min-h-[36px] text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Ubah
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Jumlah Sesi</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">{p.jumlah_sesi} Sesi</p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Minimum Hadir</span>
                  <p className="font-mono font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {p.min_sesi_hadir} Sesi
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Toleransi Telat</span>
                  <p className="font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {p.toleransi_terlambat_menit} Menit
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2.5 text-xs">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Aturan Lokasi Absensi</p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {p.aturan_lokasi === 'SEMUA_SESI_KANTOR'
                    ? 'Semua sesi wajib dilakukan di dalam radius kantor.'
                    : 'Sesi 1 wajib di kantor; Sesi 2 dan seterusnya boleh dari lokasi lain.'}
                </p>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Jadwal Sesi:</p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(p.sesi || []).map((s) => (
                    <div key={s.urutan} className="py-1.5 flex items-center justify-between">
                      <span>{s.nama}</span>
                      <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {s.jam_mulai}–{s.jam_selesai} WIB
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                <span>Libur Dibayar: <strong className="text-slate-900 dark:text-slate-200">{p.libur_dihitung_masuk ? 'Ya' : 'Tidak'}</strong></span>
                <span>·</span>
                <span>Off Pengganti: <strong className="text-slate-900 dark:text-slate-200">{p.off_pengganti_dihitung_masuk ? 'Masuk' : 'Tidak'}</strong></span>
                <span>·</span>
                <span>Cuti: <strong className="text-slate-900 dark:text-slate-200">{p.cuti_dihitung_masuk ? 'Masuk' : 'Tidak'}</strong></span>
                <span>·</span>
                <span>Sakit: <strong className="text-slate-900 dark:text-slate-200">{p.sakit_dihitung_masuk ? 'Masuk' : 'Tidak'}</strong></span>
                <span>·</span>
                <span>Izin: <strong className="text-slate-900 dark:text-slate-200">{p.izin_dihitung_masuk ? 'Masuk' : 'Tidak'}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl max-w-xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {editing ? 'Ubah Kebijakan Sesi' : 'Buat Kebijakan Sesi Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              {!editing && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Level Hierarki
                    </label>
                    <select
                      value={form.level}
                      onChange={(e) => setForm({ ...form, level: e.target.value as PolicyLevel })}
                      className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    >
                      <option value="BIDANG">BIDANG KERJA</option>
                      <option value="KARYAWAN">INDIVIDU KARYAWAN</option>
                      <option value="DEFAULT">DEFAULT PERUSAHAAN</option>
                    </select>
                  </div>
                  {form.level === 'BIDANG' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Pilih Bidang
                      </label>
                      <select
                        value={form.bidang_id}
                        onChange={(e) => setForm({ ...form, bidang_id: Number(e.target.value) })}
                        className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      >
                        {bidangList.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.nama}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.level === 'KARYAWAN' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Pilih Karyawan
                      </label>
                      <select
                        value={form.karyawan_id}
                        onChange={(e) => setForm({ ...form, karyawan_id: Number(e.target.value) })}
                        className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                      >
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nik} · {emp.nama_lengkap}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Kebijakan
                </label>
                <input
                  type="text"
                  required
                  value={form.nama}
                  onChange={(e) => setForm({ ...form, nama: e.target.value })}
                  placeholder="Mis. Kebijakan Khusus Teknisi NOC (3 Sesi)"
                  className="w-full min-h-[44px] sm:h-10 px-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jumlah Sesi
                  </label>
                  <select
                    value={form.jumlah_sesi}
                    onChange={(e) => handleCountChange(Number(e.target.value))}
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
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
                    max={form.jumlah_sesi}
                    value={form.min_sesi_hadir}
                    onChange={(e) => setForm({ ...form, min_sesi_hadir: Number(e.target.value) })}
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Toleransi (Menit)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={form.toleransi_terlambat_menit}
                    onChange={(e) =>
                      setForm({ ...form, toleransi_terlambat_menit: Number(e.target.value) })
                    }
                    className="w-full min-h-[44px] sm:h-10 px-3 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                    Aturan Lokasi Absensi
                  </label>
                  <select
                    value={form.aturan_lokasi}
                    onChange={(e) =>
                      setForm({ ...form, aturan_lokasi: e.target.value as AttendanceLocationRule })
                    }
                    className="w-full min-h-[44px] px-3 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="SESI_PERTAMA_KANTOR">Sesi 1 wajib di kantor; sesi berikutnya fleksibel</option>
                    <option value="SEMUA_SESI_KANTOR">Semua sesi wajib di kantor</option>
                  </select>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {form.aturan_lokasi === 'SEMUA_SESI_KANTOR'
                    ? 'Karyawan harus melakukan seluruh absensi dalam radius kantor. Lokasi dengan GPS tidak akurat akan ditolak.'
                    : 'Pengaturan default perusahaan: absensi pertama wajib dalam radius kantor. Sesi 2 dan seterusnya boleh dari lokasi kerja lain; koordinat dan akurasi GPS tetap direkam sebagai informasi lokasi.'}
                </p>
              </div>

              {/* Session Rows */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Konfigurasi Rentang Sesi</p>
                {form.sesi.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 sm:p-0 rounded-lg border border-slate-200 dark:border-slate-800 sm:border-0 bg-slate-50/50 dark:bg-slate-800/30 sm:bg-transparent">
                    <input
                      type="text"
                      value={s.nama}
                      onChange={(e) => {
                        const copy = [...form.sesi];
                        copy[idx] = { ...s, nama: e.target.value };
                        setForm({ ...form, sesi: copy });
                      }}
                      className="sm:col-span-6 min-h-[40px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                    />
                    <div className="grid grid-cols-2 sm:col-span-6 gap-2">
                      <input
                        type="time"
                        value={s.jam_mulai}
                        onChange={(e) => {
                          const copy = [...form.sesi];
                          copy[idx] = { ...s, jam_mulai: e.target.value };
                          setForm({ ...form, sesi: copy });
                        }}
                        className="min-h-[40px] sm:h-9 px-2 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                      <input
                        type="time"
                        value={s.jam_selesai}
                        onChange={(e) => {
                          const copy = [...form.sesi];
                          copy[idx] = { ...s, jam_selesai: e.target.value };
                          setForm({ ...form, sesi: copy });
                        }}
                        className="min-h-[40px] sm:h-9 px-2 text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Explicit Payroll Decision Toggles */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Kebijakan Perhitungan Payroll & Bukti
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.wajib_foto_semua_sesi}
                      onChange={(e) => setForm({ ...form, wajib_foto_semua_sesi: e.target.checked })}
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Wajib foto semua sesi
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.wajib_aktivitas_sesi_lanjut}
                      onChange={(e) =>
                        setForm({ ...form, wajib_aktivitas_sesi_lanjut: e.target.checked })
                      }
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Wajib aktivitas Sesi 2+
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.libur_dihitung_masuk}
                      onChange={(e) => setForm({ ...form, libur_dihitung_masuk: e.target.checked })}
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Libur perusahaan masuk
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.off_pengganti_dihitung_masuk}
                      onChange={(e) =>
                        setForm({ ...form, off_pengganti_dihitung_masuk: e.target.checked })
                      }
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Off pengganti masuk
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.cuti_dihitung_masuk}
                      onChange={(e) => setForm({ ...form, cuti_dihitung_masuk: e.target.checked })}
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Cuti dihitung masuk
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.sakit_dihitung_masuk}
                      onChange={(e) => setForm({ ...form, sakit_dihitung_masuk: e.target.checked })}
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Sakit dihitung masuk
                  </label>
                  <label className="flex items-center gap-2 min-h-[32px]">
                    <input
                      type="checkbox"
                      checked={form.izin_dihitung_masuk}
                      onChange={(e) => setForm({ ...form, izin_dihitung_masuk: e.target.checked })}
                      className="w-4 h-4 accent-navy-900 dark:accent-blue-500"
                    />
                    Izin dihitung masuk
                  </label>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] sm:h-10 px-4 text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] sm:h-10 px-5 text-xs font-semibold bg-navy-900 hover:bg-navy-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-lg"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Kebijakan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
