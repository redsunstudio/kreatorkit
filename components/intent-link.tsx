'use client';

import { useRef, type ComponentProps } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';

/**
 * A Link that prefetches ONLY on intent (hover / touch), and then in full.
 *
 * For long lists (pipeline rows, published rows). A plain Link prefetches every
 * row that scrolls into view: measured on Marketing School that was ~42 server
 * hits right after the pipeline loaded, each a 0.5 KB route map with no data,
 * queued exactly when the user is about to click. Here nothing is fetched until
 * the pointer shows intent, and then the whole page is, so the click usually
 * lands on a cached page.
 */
export function IntentLink({
  href,
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  // Re-arm after a minute so a row hovered long ago gets fresh data again.
  const lastAt = useRef(0);
  const target = typeof href === 'string' ? href : null;

  const prefetch = () => {
    const now = Date.now();
    if (!target || now - lastAt.current < 60_000) return;
    lastAt.current = now;
    router.prefetch(target, { kind: PrefetchKind.FULL });
  };

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        prefetch();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        prefetch();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        prefetch();
        onFocus?.(e);
      }}
      {...props}
    />
  );
}
