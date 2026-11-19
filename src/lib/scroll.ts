import { useLayoutEffect, type DependencyList } from 'react';

function forceScrollTopNow() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollTo(0, 0);
  }
  if (document.scrollingElement) {
    document.scrollingElement.scrollTop = 0;
    document.scrollingElement.scrollLeft = 0;
  }
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  if (document.body) {
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }
  const rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.scrollTop = 0;
  }
}

/**
 * Resets viewport scroll strictly to (0, 0) immediately and across post-mount
 * frames so login transitions, mobile keyboard dismissal, and async route mounts
 * never leave the page scrolled down. Automatically cancels delayed ticks if the
 * user starts scrolling manually.
 */
export function resetViewportScroll(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  // Blur focused login inputs/buttons so browser focus-anchoring does not jump scroll
  const active = document.activeElement;
  if (active && active !== document.body && active instanceof HTMLElement) {
    try {
      active.blur();
    } catch {
      // ignore
    }
  }

  let cancelled = false;
  let raf1 = 0;
  let raf2 = 0;
  let t1 = 0;
  let t2 = 0;

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    window.cancelAnimationFrame(raf1);
    window.cancelAnimationFrame(raf2);
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('pointerdown', stop);
    window.removeEventListener('keydown', stop);
  };

  window.addEventListener('wheel', stop, { passive: true, once: true });
  window.addEventListener('touchstart', stop, { passive: true, once: true });
  window.addEventListener('pointerdown', stop, { passive: true, once: true });
  window.addEventListener('keydown', stop, { passive: true, once: true });

  forceScrollTopNow();

  raf1 = window.requestAnimationFrame(() => {
    if (cancelled) return;
    forceScrollTopNow();
    raf2 = window.requestAnimationFrame(() => {
      if (cancelled) return;
      forceScrollTopNow();
    });
  });

  t1 = window.setTimeout(() => {
    if (!cancelled) forceScrollTopNow();
  }, 100);

  t2 = window.setTimeout(() => {
    if (!cancelled) {
      forceScrollTopNow();
      stop();
    }
  }, 260);

  return stop;
}

export function useResetScroll(deps: DependencyList, enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return;
    return resetViewportScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
