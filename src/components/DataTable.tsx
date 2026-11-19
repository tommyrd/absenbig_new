import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
  Search,
} from 'lucide-react';

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  sortValue?: (row: T) => string | number;
  render: (row: T, index: number) => ReactNode;
  mobileHide?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string | number;
  searchPlaceholder?: string;
  searchFilter?: (row: T, query: string) => boolean;
  filterToolbar?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  selectable?: boolean;
  bulkActions?: (selectedIds: (string | number)[], clearSelection: () => void) => ReactNode;
  renderMobileCard?: (row: T, index: number) => ReactNode;
  initialPageSize?: number;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  searchPlaceholder = 'Cari data...',
  searchFilter,
  filterToolbar,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Belum ada data',
  emptyDescription = 'Data akan tampil di sini setelah tercatat di sistem.',
  emptyAction,
  selectable = false,
  bulkActions,
  renderMobileCard,
  initialPageSize = 10,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !searchFilter) return data;
    return data.filter((row) => searchFilter(row, q));
  }, [data, query, searchFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortValue) return filtered;
    const getter = col.sortValue;
    return [...filtered].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  };

  const toggleAllVisible = () => {
    const visibleIds = paginated.map(getRowId);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allSelected) {
      visibleIds.forEach((id) => next.delete(id));
    } else {
      visibleIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  };

  const toggleOne = (id: string | number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Toolbar: Search + Filters */}
      {(searchFilter || filterToolbar) && (
        <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/80">
          {searchFilter && (
            <div className="relative w-full lg:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                className="w-full h-11 sm:h-10 pl-9 pr-3 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#c0392b]/20 focus:border-[#c0392b]"
              />
            </div>
          )}
          {filterToolbar && (
            <div className="flex flex-wrap items-center gap-2">{filterToolbar}</div>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectable && selected.size > 0 && bulkActions && (
        <div className="px-4 py-2.5 bg-brand-900 text-white flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium tabular-nums">
            {selected.size} baris dipilih
          </span>
          <div className="flex items-center gap-2">
            {bulkActions(Array.from(selected), clearSelection)}
            <button
              type="button"
              onClick={clearSelection}
              className="px-2.5 py-1 text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Batal pilih
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-8 text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 mb-3">
            <AlertCircle className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Gagal memuat data
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            {error}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#c0392b] hover:bg-[#a93226] text-white rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Coba Lagi
            </button>
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {!error && loading && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3.5 flex items-center gap-4">
              <div className="h-4 w-8 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 flex-1 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 w-28 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse hidden sm:block" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!error && !loading && sorted.length === 0 && (
        <div className="p-10 text-center">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mb-3">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {emptyTitle}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            {emptyDescription}
          </p>
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      )}

      {/* Populated Desktop Table + Mobile Card View */}
      {!error && !loading && sorted.length > 0 && (
        <>
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {paginated.map((row, idx) => {
              const rowId = getRowId(row);
              const absIdx = (safePage - 1) * pageSize + idx + 1;
              if (renderMobileCard) {
                return (
                  <div key={rowId} className="p-4">
                    {renderMobileCard(row, absIdx)}
                  </div>
                );
              }
              return (
                <div key={rowId} className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                    <span>#{absIdx}</span>
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={selected.has(rowId)}
                        onChange={() => toggleOne(rowId)}
                        className="w-5 h-5 accent-[#c0392b] dark:accent-brand-400"
                        aria-label={`Pilih baris ${absIdx}`}
                      />
                    )}
                  </div>
                  {columns
                    .filter((c) => !c.mobileHide)
                    .map((col) => (
                      <div
                        key={col.key}
                        className="flex items-start justify-between gap-3 text-sm"
                      >
                        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                          {col.header}
                        </span>
                        <div className="text-right text-slate-900 dark:text-slate-100 min-w-0">
                          {col.render(row, absIdx)}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {selectable && (
                    <th className="py-3 pl-4 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={
                          paginated.length > 0 &&
                          paginated.every((r) => selected.has(getRowId(r)))
                        }
                        onChange={toggleAllVisible}
                        className="w-4 h-4 accent-[#c0392b] dark:accent-brand-400 rounded"
                        aria-label="Pilih semua di halaman ini"
                      />
                    </th>
                  )}
                  <th className="py-3 px-4 w-14 text-slate-500 dark:text-slate-400 font-mono">
                    No.
                  </th>
                  {columns.map((col) => {
                    const isSorted = sortKey === col.key;
                    const alignCls =
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                        ? 'text-center'
                        : 'text-left';
                    return (
                      <th key={col.key} className={`py-3 px-4 whitespace-nowrap ${alignCls}`}>
                        {col.sortValue ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition-colors"
                          >
                            <span>{col.header}</span>
                            {isSorted ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5 text-[#c0392b] dark:text-brand-400" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                            )}
                          </button>
                        ) : (
                          col.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {paginated.map((row, idx) => {
                  const rowId = getRowId(row);
                  const absIdx = (safePage - 1) * pageSize + idx + 1;
                  return (
                    <tr
                      key={rowId}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {selectable && (
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={selected.has(rowId)}
                            onChange={() => toggleOne(rowId)}
                            className="w-4 h-4 accent-[#c0392b] dark:accent-brand-400 rounded"
                            aria-label={`Pilih baris ${absIdx}`}
                          />
                        </td>
                      )}
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {absIdx}
                      </td>
                      {columns.map((col) => {
                        const alignCls =
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                            ? 'text-center'
                            : 'text-left';
                        return (
                          <td key={col.key} className={`py-3 px-4 ${alignCls}`}>
                            {col.render(row, absIdx)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <span className="tabular-nums">
                {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} dari{' '}
                <strong className="text-slate-900 dark:text-slate-100">{sorted.length}</strong> data
              </span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Jumlah baris per halaman"
                className="h-10 sm:h-8 px-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs text-slate-700 dark:text-slate-200"
              >
                <option value={10}>10 / hal</option>
                <option value={25}>25 / hal</option>
                <option value={50}>50 / hal</option>
              </select>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2.5 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg sm:rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2.5 font-mono tabular-nums text-slate-700 dark:text-slate-200">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] px-2.5 inline-flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg sm:rounded-md hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Halaman berikutnya"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
