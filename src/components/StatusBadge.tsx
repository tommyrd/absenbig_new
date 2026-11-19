import {
  AlertTriangle,
  Briefcase,
  CalendarOff,
  CheckCircle2,
  Clock,
  FileCheck2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_MAP: Record<
  string,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  HADIR: {
    label: 'HADIR',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
  DIHITUNG_MASUK: {
    label: 'DIHITUNG MASUK',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
  TIDAK_HADIR: {
    label: 'TIDAK HADIR',
    cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
    Icon: XCircle,
  },
  TIDAK_DIHITUNG_MASUK: {
    label: 'TIDAK DIHITUNG MASUK',
    cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    Icon: XCircle,
  },
  HARI_LIBUR: {
    label: 'HARI LIBUR',
    cls: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70',
    Icon: CalendarOff,
  },
  KERJA_KHUSUS: {
    label: 'KERJA KHUSUS',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    Icon: Briefcase,
  },
  OFF_PENGGANTI: {
    label: 'OFF PENGGANTI',
    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70',
    Icon: FileCheck2,
  },
  CUTI: {
    label: 'CUTI',
    cls: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70',
    Icon: CalendarOff,
  },
  IZIN: {
    label: 'IZIN',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    Icon: Clock,
  },
  SAKIT: {
    label: 'SAKIT',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    Icon: AlertTriangle,
  },
  OFF: {
    label: 'OFF',
    cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    Icon: CalendarOff,
  },
  BELUM_SELESAI: {
    label: 'BERJALAN',
    cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
    Icon: Clock,
  },
  PENDING: {
    label: 'MENUNGGU APPROVAL',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    Icon: Clock,
  },
  APPROVED: {
    label: 'DISETUJUI',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
  REJECTED: {
    label: 'DITOLAK',
    cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/70',
    Icon: XCircle,
  },
  CANCELLED: {
    label: 'DIBATALKAN',
    cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    Icon: XCircle,
  },
  TEPAT_WAKTU: {
    label: 'TEPAT WAKTU',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
  TERLAMBAT: {
    label: 'TERLAMBAT',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
    Icon: AlertTriangle,
  },
  TERSEDIA: {
    label: 'TERSEDIA',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
  DIPAKAI: {
    label: 'SUDAH DIPAKAI',
    cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    Icon: FileCheck2,
  },
  CLOSED: {
    label: 'PERIODE DITUTUP',
    cls: 'bg-slate-900 text-white border-slate-800 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700',
    Icon: ShieldAlert,
  },
  OPEN: {
    label: 'PERIODE TERBUKA',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
    Icon: CheckCircle2,
  },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const cfg = STATUS_MAP[status] || {
    label: status.replace(/_/g, ' '),
    cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    Icon: Clock,
  };
  const Icon = cfg.Icon;
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border font-medium whitespace-nowrap shrink-0 ${pad} ${cfg.cls}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
}
