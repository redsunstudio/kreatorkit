'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Thin top progress bar for in-app navigations.
 *
 * A click on a link that isn't already in the router cache waits on the server
 * for a beat. Without feedback that gap reads as "nothing happened" and then a
 * "reload". The bar starts on the click itself (so the response is instant)
 * and finishes when the new route commits. Cache hits commit before the show
 * delay elapses, so instant navigations never flash a bar.
 *
 * The bar is driven straight through a ref (no React state): it's a pure
 * visual side effect, and re-rendering on every navigation step bought nothing.
 */
const SHOW_DELAY_MS = 80;
const SAFETY_TIMEOUT_MS = 10_000;

function inAppNavigationTarget(e: MouseEvent): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const anchor = (e.target as Element | null)?.closest?.('a');
  if (!anchor || !anchor.href) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Downloads and API endpoints are not page navigations.
  if (url.pathname.startsWith('/api/')) return null;
  const next = url.pathname + url.search;
  const current = window.location.pathname + window.location.search;
  if (next === current) return null; // same page or a hash jump
  return next;
}

function NavProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const shown = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const paint = (width: string, transition: string, opacity: number) => {
    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (!wrap || !bar) return;
    bar.style.transition = transition;
    bar.style.width = width;
    wrap.style.opacity = String(opacity);
  };

  useEffect(() => {
    const reset = () => {
      pending.current = false;
      shown.current = false;
      paint('0%', 'none', 0);
    };
    const onClick = (e: MouseEvent) => {
      if (!inAppNavigationTarget(e)) return;
      clearTimers();
      pending.current = true;
      timers.current.push(
        setTimeout(() => {
          if (!pending.current) return;
          shown.current = true;
          paint('0%', 'none', 1);
          // Next frame so the width change animates from 0.
          requestAnimationFrame(() => paint('80%', 'width 2.5s cubic-bezier(0.1, 0.7, 0.2, 1)', 1));
        }, SHOW_DELAY_MS),
        setTimeout(reset, SAFETY_TIMEOUT_MS)
      );
    };
    // Bubble phase on window: runs after next/link's own handler.
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('click', onClick);
      clearTimers();
    };
  }, []);

  // The route committed: finish the bar (if it ever showed) and fade out.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    clearTimers();
    if (!shown.current) return;
    shown.current = false;
    paint('100%', 'width 150ms ease-out', 1);
    timers.current.push(
      setTimeout(() => paint('100%', 'none', 0), 200),
      setTimeout(() => paint('0%', 'none', 0), 450)
    );
  }, [pathname, searchParams]);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]"
      style={{ opacity: 0, transition: 'opacity 200ms ease' }}
    >
      <div ref={barRef} className="h-full w-0 bg-primary shadow-[0_0_8px_var(--primary)]" />
    </div>
  );
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <NavProgressBar />
    </Suspense>
  );
}
