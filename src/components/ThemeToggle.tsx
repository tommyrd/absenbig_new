import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

interface ThemeToggleProps {
  onDark?: boolean;
  showLabel?: boolean;
}

export function ThemeToggle({ onDark = false, showLabel = false }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme();

  const btnCls = onDark
    ? 'border-white/15 bg-white/10 text-slate-100 hover:bg-white/20'
    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title={isDark ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
      className={`min-h-[40px] sm:min-h-[36px] min-w-[40px] sm:min-w-[36px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${btnCls}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 shrink-0" />
      ) : (
        <Moon className="w-4 h-4 shrink-0" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">{isDark ? 'Terang' : 'Gelap'}</span>
      )}
    </button>
  );
}
