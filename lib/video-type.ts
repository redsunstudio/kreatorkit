// Client-safe metadata for the video type field (mirrors the VideoType enum).
// POST is BETA — only offered in workspaces with the 'posts' feature flag.
export const VIDEO_TYPES = [
  { key: 'PODCAST', label: 'Podcast', emoji: '🎙️' },
  { key: 'LONGFORM', label: 'Long form', emoji: '🎬' },
  { key: 'SHORT', label: 'Short', emoji: '📱' },
  { key: 'POST', label: 'Post', emoji: '📝' },
] as const;

export type VideoTypeKey = (typeof VIDEO_TYPES)[number]['key'];

export function typeMeta(key: string | null | undefined) {
  return VIDEO_TYPES.find((t) => t.key === key) ?? VIDEO_TYPES[1];
}

/** Image detection tolerant of legacy FILE-kind rows (pre-backfill uploads). */
export function isImageAsset(a: { kind: string; displayName: string }): boolean {
  return a.kind === 'IMAGE' || (a.kind === 'FILE' && /\.(png|jpe?g|webp|gif)$/i.test(a.displayName));
}
