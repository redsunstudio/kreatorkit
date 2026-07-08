// Client-safe metadata for the video type field (mirrors the VideoType enum).
export const VIDEO_TYPES = [
  { key: 'PODCAST', label: 'Podcast', emoji: '🎙️' },
  { key: 'LONGFORM', label: 'Long form', emoji: '🎬' },
  { key: 'SHORT', label: 'Short', emoji: '📱' },
] as const;

export type VideoTypeKey = (typeof VIDEO_TYPES)[number]['key'];

export function typeMeta(key: string | null | undefined) {
  return VIDEO_TYPES.find((t) => t.key === key) ?? VIDEO_TYPES[1];
}
