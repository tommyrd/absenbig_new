import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 360);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Kembali ke atas"
      title="Kembali ke atas"
      className="fixed bottom-16 lg:bottom-6 right-4 z-40 w-10 h-10 rounded-full bg-[#c0392b] hover:bg-[#a93226] text-white shadow-lg shadow-red-950/25 flex items-center justify-center transition-all active:scale-95"
    >
      <ArrowUp className="w-4 h-4" />
    </button>
  );
}
