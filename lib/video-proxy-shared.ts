/**
 * Proxy rendition vocabulary shared by the server and the browser.
 *
 * Deliberately free of any database or storage import: the review page imports
 * these, and pulling Prisma into a client bundle breaks the build.
 */

/**
 * The proxy ladder.
 *
 * Every cut we host ourselves gets a lightweight rendition at each rung that is
 * no taller than the source. Review playback streams the proxy (a 4K master was
 * being pulled in full on every view — the biggest source of felt lag and of the
 * storage daily-cap incidents), and the download menu offers each ready rung
 * next to the untouched original.
 */
export const PROXY_LADDER = [2160, 1080, 720] as const;
export type ProxyHeight = (typeof PROXY_LADDER)[number];

/** What review playback reaches for first, in order, before falling back to the master. */
export const PLAYBACK_PREFERENCE: readonly number[] = [1080, 720, 2160];

export function isProxyHeight(value: number): value is ProxyHeight {
  return (PROXY_LADDER as readonly number[]).includes(value);
}

export const PROXY_KEY_PREFIX = 'proxies/';

export function proxyObjectKey(versionId: string, height: number): string {
  return `${PROXY_KEY_PREFIX}${versionId}/${height}p.mp4`;
}

export function proxyQualityLabel(height: number): string {
  if (height >= 2160) return '4K proxy';
  return `${height}p proxy`;
}

/** The rung playback should default to: nearest to 1080, never above the source. */
export function pickPlaybackProxy<T extends { height: number }>(options: T[]): T | null {
  for (const preferred of PLAYBACK_PREFERENCE) {
    const match = options.find((option) => option.height === preferred);
    if (match) return match;
  }
  return options[0] ?? null;
}
