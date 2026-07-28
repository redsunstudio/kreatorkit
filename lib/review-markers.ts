/**
 * Pure review-marker helpers. Deliberately free of any `db` import so client
 * components (the strip, the add dialog) can share the limits and the timecode
 * parser without dragging Prisma into the browser bundle. DB access lives in
 * `lib/review-markers-db.ts`.
 */

export const MARKER_LABEL_MAX = 200;
/** Plenty for a long cut, low enough that a runaway agent can't flood a timeline. */
export const MARKERS_PER_VERSION_MAX = 200;

export interface ReviewMarkerDTO {
  id: string;
  timestamp: number;
  label: string;
  createdByName: string | null;
  createdAt: string;
}

export type MarkerInputError =
  | { ok: false; reason: 'timestamp' }
  | { ok: false; reason: 'label' }
  | { ok: false; reason: 'label_length' };

export type MarkerInputResult = { ok: true; timestamp: number; label: string } | MarkerInputError;

/**
 * Accepts a raw timestamp (seconds as number or numeric string) or a clock string
 * — "1:23", "01:02:03" — because that is how a person reads a timecode off a
 * player and how an agent gets one out of a transcript.
 */
export function parseMarkerTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part.trim())) return null;
    total = total * 60 + Number(part.trim());
  }
  return Number.isFinite(total) && total >= 0 ? total : null;
}

export function validateMarkerInput(timestamp: unknown, label: unknown): MarkerInputResult {
  const seconds = parseMarkerTimestamp(timestamp);
  if (seconds === null) return { ok: false, reason: 'timestamp' };

  if (typeof label !== 'string') return { ok: false, reason: 'label' };
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, reason: 'label' };
  if (trimmed.length > MARKER_LABEL_MAX) return { ok: false, reason: 'label_length' };

  // Round to centiseconds: the player seeks nowhere near frame-exactly anyway, and
  // it keeps the stored value readable.
  return { ok: true, timestamp: Math.round(seconds * 100) / 100, label: trimmed };
}

export function markerDTO(m: {
  id: string;
  timestamp: number;
  label: string;
  createdByName: string | null;
  createdAt: Date;
}): ReviewMarkerDTO {
  return {
    id: m.id,
    timestamp: m.timestamp,
    label: m.label,
    createdByName: m.createdByName,
    createdAt: m.createdAt.toISOString(),
  };
}
