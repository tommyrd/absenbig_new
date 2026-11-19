import { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function PWAInstallButton({ onDark = false }: { onDark?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  const baseClass = onDark
    ? 'inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg text-xs font-semibold text-white bg-white/15 hover:bg-white/25 border border-white/25 whitespace-nowrap shrink-0 transition-colors'
    : 'inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg text-xs font-semibold text-[#c0392b] dark:text-brand-300 bg-brand-50 dark:bg-brand-950/50 hover:bg-brand-100 dark:hover:bg-brand-900/60 border border-brand-200 dark:border-brand-800 whitespace-nowrap shrink-0 transition-colors';

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={baseClass}
        title="Pasang aplikasi ke layar utama"
        aria-label="Pasang Aplikasi"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden md:inline">Pasang App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={baseClass}
          title="Cara pasang di iPhone / iPad"
          aria-label="Pasang di iOS"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden md:inline">Pasang App</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-3 text-slate-900 dark:text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold">Pasang di iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Tutup panduan"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed list-decimal list-inside">
                <li>
                  Ketuk tombol <strong className="inline-flex items-center gap-1"><Share className="w-3.5 h-3.5 inline" /> Bagikan (Share)</strong> di bilah bawah Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                </li>
                <li>
                  Ketuk <strong>Tambah</strong> agar Absensi BIGNET bisa dibuka seperti aplikasi native.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[40px] rounded-xl bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-semibold"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
