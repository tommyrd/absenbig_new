import { useMemo } from 'react';
import { MapPin, Building2, AlertTriangle, Info, Check } from 'lucide-react';
import type { CakupanLokasiAbsensi, Kantor, WilayahOperasional } from '../shared/types';

export interface EmployeePlacementValue {
  wilayah_penempatan_id: string;
  cakupan_lokasi_absensi: CakupanLokasiAbsensi;
  kantor_izin_ids: number[];
}

interface EmployeePlacementSectionProps {
  regions: WilayahOperasional[];
  offices: Kantor[];
  value: EmployeePlacementValue;
  onChange: (next: EmployeePlacementValue) => void;
  required?: boolean;
  title?: string;
  showRegionChangeNotice?: boolean;
  previousWilayahId?: number | null;
}

export function EmployeePlacementSection({
  regions,
  offices,
  value,
  onChange,
  required = false,
  title = 'Penempatan dan Lokasi Absensi',
  showRegionChangeNotice = false,
  previousWilayahId = null,
}: EmployeePlacementSectionProps) {
  const activeRegions = useMemo(
    () => regions.filter((r) => Number(r.aktif) === 1),
    [regions]
  );

  const selectedRegionIdNum = value.wilayah_penempatan_id
    ? Number(value.wilayah_penempatan_id)
    : null;

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === selectedRegionIdNum) || null,
    [regions, selectedRegionIdNum]
  );

  const officesInSelectedRegion = useMemo(() => {
    if (!selectedRegionIdNum) return [];
    return offices.filter(
      (o) => Number(o.aktif ?? 1) === 1 && Number(o.wilayah_id) === selectedRegionIdNum
    );
  }, [offices, selectedRegionIdNum]);

  const regionChanged =
    showRegionChangeNotice &&
    previousWilayahId !== null &&
    selectedRegionIdNum !== null &&
    previousWilayahId !== selectedRegionIdNum;

  const handleWilayahChange = (nextWilayahId: string) => {
    const nextIdNum = nextWilayahId ? Number(nextWilayahId) : null;
    // Never retain allowed offices from a different region
    const validKeptIds = nextIdNum
      ? value.kantor_izin_ids.filter((officeId) => {
          const office = offices.find((o) => o.id === officeId);
          return office && Number(office.wilayah_id) === nextIdNum && Number(office.aktif ?? 1) === 1;
        })
      : [];

    onChange({
      ...value,
      wilayah_penempatan_id: nextWilayahId,
      kantor_izin_ids: validKeptIds,
    });
  };

  const handleCakupanChange = (nextCakupan: CakupanLokasiAbsensi) => {
    onChange({
      ...value,
      cakupan_lokasi_absensi: nextCakupan,
      kantor_izin_ids: nextCakupan === 'KANTOR_TERTENTU' ? value.kantor_izin_ids : [],
    });
  };

  const toggleAllowedOffice = (officeId: number) => {
    const exists = value.kantor_izin_ids.includes(officeId);
    const nextIds = exists
      ? value.kantor_izin_ids.filter((id) => id !== officeId)
      : [...value.kantor_izin_ids, officeId];
    onChange({
      ...value,
      kantor_izin_ids: nextIds,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>{title}</span>
          </h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
            Menentukan wilayah operasional utama karyawan dan kantor yang diizinkan saat absen di dalam wilayah tersebut.
          </p>
        </div>
      </div>

      {/* 1. Wilayah Penempatan */}
      <div>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1 block">
          Wilayah Penempatan {required && activeRegions.length > 0 ? <span className="text-red-500">*</span> : null}
        </label>
        <select
          value={value.wilayah_penempatan_id}
          onChange={(e) => handleWilayahChange(e.target.value)}
          required={required && activeRegions.length > 0}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          <option value="">
            {activeRegions.length === 0
              ? '— Belum ada wilayah operasional aktif —'
              : '— Pilih Wilayah Penempatan —'}
          </option>
          {activeRegions.map((reg) => (
            <option key={reg.id} value={String(reg.id)}>
              {reg.nama} ({reg.kota_kabupaten})
              {!reg.polygon_valid ? ' — Polygon Belum Lengkap' : ''}
            </option>
          ))}
        </select>

        {activeRegions.length === 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Belum ada master Wilayah Operasional aktif. Tambahkan wilayah terlebih dahulu di menu Master Data → Wilayah Operasional.
            </span>
          </p>
        )}

        {selectedRegion && !selectedRegion.polygon_valid && (
          <div className="mt-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              Batas polygon wilayah <strong>{selectedRegion.nama}</strong> belum lengkap. Sistem tidak akan memberikan pengecualian geofence luar wilayah sampai polygon wilayah dilengkapi.
            </span>
          </div>
        )}

        {regionChanged && (
          <div className="mt-2 p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 text-[11px] text-sky-800 dark:text-sky-200 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-sky-600" />
            <span>
              Wilayah penempatan diubah. Daftar kantor dari wilayah sebelumnya otomatis dibersihkan — pastikan cakupan kantor untuk wilayah baru sudah sesuai. Riwayat absensi lama tidak akan berubah.
            </span>
          </div>
        )}
      </div>

      {/* 2. Cakupan Lokasi Absensi */}
      <div>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5 block">
          Cakupan Lokasi Absensi (Saat di Dalam Wilayah)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleCakupanChange('SEMUA_KANTOR_DALAM_WILAYAH')}
            className={`text-left p-2.5 rounded-xl border transition-all ${
              value.cakupan_lokasi_absensi === 'SEMUA_KANTOR_DALAM_WILAYAH'
                ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/30 ring-1 ring-brand-500/30'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Semua Kantor dalam Wilayah
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  value.cakupan_lokasi_absensi === 'SEMUA_KANTOR_DALAM_WILAYAH'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-300 dark:border-slate-600'
                }`}
              >
                {value.cakupan_lokasi_absensi === 'SEMUA_KANTOR_DALAM_WILAYAH' && (
                  <Check className="w-2.5 h-2.5" />
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
              Boleh absen di seluruh kantor aktif yang terdaftar dalam wilayah penempatannya.
            </p>
          </button>

          <button
            type="button"
            onClick={() => handleCakupanChange('KANTOR_TERTENTU')}
            className={`text-left p-2.5 rounded-xl border transition-all ${
              value.cakupan_lokasi_absensi === 'KANTOR_TERTENTU'
                ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/30 ring-1 ring-brand-500/30'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Kantor Tertentu
              </span>
              <span
                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  value.cakupan_lokasi_absensi === 'KANTOR_TERTENTU'
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-300 dark:border-slate-600'
                }`}
              >
                {value.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' && (
                  <Check className="w-2.5 h-2.5" />
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
              Hanya boleh absen di satu atau beberapa kantor tertentu dari wilayah penempatannya.
            </p>
          </button>
        </div>
      </div>

      {/* 3. Daftar Kantor yang Diizinkan (hanya muncul jika KANTOR_TERTENTU) */}
      {value.cakupan_lokasi_absensi === 'KANTOR_TERTENTU' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Daftar Kantor yang Diizinkan</span>
              <span className="text-red-500">*</span>
            </label>
            {value.kantor_izin_ids.length > 0 && (
              <span className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                {value.kantor_izin_ids.length} kantor dipilih
              </span>
            )}
          </div>

          {!selectedRegionIdNum ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic py-2 px-3 rounded-lg bg-white dark:bg-slate-800 border border-dashed border-slate-200 dark:border-slate-700">
              Pilih Wilayah Penempatan terlebih dahulu untuk melihat daftar kantor dalam wilayah tersebut.
            </p>
          ) : officesInSelectedRegion.length === 0 ? (
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Belum ada kantor aktif yang terhubung ke wilayah <strong>{selectedRegion?.nama}</strong>. Hubungkan kantor ke wilayah ini terlebih dahulu pada Master Kantor.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto p-1">
              {officesInSelectedRegion.map((office) => {
                const checked = value.kantor_izin_ids.includes(office.id);
                return (
                  <label
                    key={office.id}
                    className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-950/30'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAllowedOffice(office.id)}
                      className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {office.nama}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {office.kode} · Radius {office.radius_meter}m
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Brief consequence note */}
      <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5 pt-0.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <span>
          Jika koordinat GPS karyawan terdeteksi berada di luar polygon wilayah penempatannya, pengecualian geofence kantor berlaku otomatis tanpa pengajuan dinas — GPS, selfie kamera, dan waktu server tetap direkam.
        </span>
      </p>
    </div>
  );
}
