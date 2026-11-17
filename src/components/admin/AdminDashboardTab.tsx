import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { BidangKerja, Kantor, Pengajuan, WorkforceMember } from '../../shared/types';
import { DataTable, type ColumnDef } from '../DataTable';
import { StatusBadge } from '../StatusBadge';

interface EarlyRow {
  karyawan_id: number;
  nik: string;
  nama_lengkap: string;
  kantor_nama: string;
  bidang_nama: string;
  sesi1_waktu: string | null;
  status_ketepatan: string | null;
  keterlambatan_menit: number | null;
  dalam_geofence: number | null;
}

export function AdminDashboardTab({ onNavigateApproval }: { onNavigateApproval: () => void }) {
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [earlyRows, setEarlyRows] = useState<EarlyRow[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [offices, setOffices] = useState<Kantor[]>([]);
  const [bidangList, setBidangList] = useState<BidangKerja[]>([]);
  const [kantorFilter, setKantorFilter] = useState('');
  const [bidangFilter, setBidangFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wf, early, reqs, off, bid] = await Promise.all([
        apiFetch<{ items: WorkforceMember[] }>('/api/v1/workforce/today'),
        apiFetch<{ items: EarlyRow[] }>('/api/v1/payroll/early-report'),
        apiFetch<{ items: Pengajuan[] }>('/api/v1/requests?status=PENDING'),
        apiFetch<{ items: Kantor[] }>('/api/v1/master/offices'),
        apiFetch<{ items: BidangKerja[] }>('/api/v1/master/bidang'),
      ]);
      setWorkforce(wf.items);
      setEarlyRows(early.items);
      setPendingCount(reqs.items.length);
      setOffices(off.items);
      setBidangList(bid.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dashboard operasional.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredWorkforce = workforce.filter((w) => {
    if (kantorFilter && String(w.kantorId) !== kantorFilter) return false;
    if (bidangFilter && String(w.bidangId) !== bidangFilter) return false;
    return true;
  });

  const lateCount = earlyRows.filter((r) => r.status_ketepatan === 'TERLAMBAT').length;
  const workingCount = workforce.filter((w) => w.isWorkingToday).length;
  const doneCount = workforce.filter((w) => w.operationalStatus === 'HADIR').length;

  const wfCols: ColumnDef<WorkforceMember>[] = [
    {
      key: 'nik',
      header: 'NIK',
      sortValue: (r) => r.nik,
      render: (r) => <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{r.nik}</span>,
    },
    {
      key: 'nama',
      header: 'Karyawan',
      sortValue: (r) => r.namaLengkap,
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{r.namaLengkap}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{r.jabatan}</p>
        </div>
      ),
    },
    {
      key: 'penempatan',
      header: 'Kantor / Bidang',
      sortValue: (r) => r.kantorNama,
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800 dark:text-slate-200">{r.kantorNama.split('(')[0].trim()}</p>
          <p className="text-slate-500 dark:text-slate-400">{r.bidangNama}</p>
        </div>
      ),
    },
    {
      key: 'progres',
      header: 'Progres Sesi',
      sortValue: (r) => r.sessionsCompleted,
      render: (r) => (
        <span className="font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
          {r.sessionsCompleted} / {r.sessionsTotal} sesi
        </span>
      ),
    },
    {
      key: 'sesi1',
      header: 'Masuk Sesi 1',
      sortValue: (r) => r.sesi1Time || '99:99',
      render: (r) =>
        r.sesi1Time ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-slate-900 dark:text-slate-100">{r.sesi1Time} WIB</span>
            {r.sesi1Terlambat && <StatusBadge status="TERLAMBAT" />}
          </div>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">Belum absen</span>
        ),
    },
    {
      key: 'status',
      header: 'Status Operasional',
      sortValue: (r) => r.operationalStatus,
      render: (r) => <StatusBadge status={r.operationalStatus} />,
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Dashboard & Monitoring Operasional
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Pantau kehadiran sesi hari ini, laporan awal masuk, dan antrean approval.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="min-h-[44px] sm:h-9 px-3.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 self-start sm:self-auto w-full sm:w-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Muat Ulang
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Bekerja Hari Ini</p>
          <p className="font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">
            {workingCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Tuntas Hadir</p>
          <p className="font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1">
            {doneCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Terlambat Sesi 1</p>
          <p className="font-mono text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-1">
            {lateCount}
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateApproval}
          className="text-left bg-navy-900 dark:bg-slate-900 border border-navy-800 dark:border-blue-800/70 text-white rounded-xl p-4 hover:bg-navy-800 dark:hover:bg-slate-800 transition-colors"
        >
          <p className="text-xs text-blue-300">Menunggu Approval</p>
          <p className="font-mono text-2xl font-bold tabular-nums mt-1">{pendingCount}</p>
          <p className="text-[11px] text-slate-300 mt-0.5">Klik untuk proses pengajuan →</p>
        </button>
      </div>

      {/* Monitoring Table */}
      <div className="space-y-3">
        <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
          Monitoring Kehadiran & Laporan Awal Masuk Hari Ini
        </h2>
        <DataTable
          data={filteredWorkforce}
          columns={wfCols}
          getRowId={(r) => r.karyawanId}
          loading={loading}
          error={error}
          onRetry={loadAll}
          searchPlaceholder="Cari NIK atau nama karyawan..."
          searchFilter={(r, q) =>
            r.namaLengkap.toLowerCase().includes(q) ||
            r.nik.toLowerCase().includes(q) ||
            r.bidangNama.toLowerCase().includes(q)
          }
          filterToolbar={
            <>
              <select
                value={kantorFilter}
                onChange={(e) => setKantorFilter(e.target.value)}
                className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
              >
                <option value="">Semua Kantor</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nama}
                  </option>
                ))}
              </select>
              <select
                value={bidangFilter}
                onChange={(e) => setBidangFilter(e.target.value)}
                className="min-h-[44px] sm:h-9 px-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 w-full sm:w-auto"
              >
                <option value="">Semua Bidang</option>
                {bidangList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nama}
                  </option>
                ))}
              </select>
            </>
          }
        />
      </div>
    </div>
  );
}
