/**
 * The packaging gate (John, 2026-07-28).
 *
 * Packaging — title, thumbnail, description — used to get bolted on at the end,
 * right before a push, which meant edits got approved with nothing decided about
 * how the video would actually be presented. It now happens at the FRONT: by the
 * time an item leaves the idea column for a first edit, all three are settled and
 * the team can review them alongside the cut.
 *
 * A title always exists (it is required at create time), so its presence proves
 * nothing — a working title looks identical to a final one. That is why the gate
 * checks an explicit confirmation stamp rather than three non-empty fields: the
 * stamp is somebody saying "this IS the title".
 *
 * Pure module — no db import, so client components can share it.
 */

/**
 * The packaging track (John, 2026-08-12).
 *
 * Packaging is a second status on the item, shown beside the video status on the
 * pipeline: the video status says where the CUT is, this says where the title,
 * thumbnail and description are. Moving one never moves the other, and anyone who
 * can move an item can move this.
 *
 * APPROVED is the one value with teeth. It cannot be set while a field is
 * genuinely missing — otherwise the row would read "approved" while the push
 * refused, and the board would be the thing that lied.
 */
export const PACKAGING_STATUSES = [
  { key: 'NOT_STARTED', emoji: '📦', label: 'Not started' },
  { key: 'IN_PROGRESS', emoji: '✍️', label: 'In progress' },
  { key: 'READY', emoji: '👀', label: 'Ready for sign-off' },
  { key: 'APPROVED', emoji: '✅', label: 'Approved' },
  { key: 'CHANGES', emoji: '🔁', label: 'Changes needed' },
] as const;

export type PackagingStatusKey = (typeof PACKAGING_STATUSES)[number]['key'];

export function isPackagingStatus(value: unknown): value is PackagingStatusKey {
  return typeof value === 'string' && PACKAGING_STATUSES.some((s) => s.key === (value as string));
}

export function packagingStatusMeta(key: string) {
  return PACKAGING_STATUSES.find((s) => s.key === key) ?? PACKAGING_STATUSES[0];
}

export interface PackagingInput {
  title: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  packagingConfirmedAt: Date | string | null;
}

export interface PackagingState {
  hasTitle: boolean;
  hasThumbnail: boolean;
  hasDescription: boolean;
  /** All three present — the stamp becomes available. */
  ready: boolean;
  /** Someone confirmed the packaging is final. This is what the gates check. */
  confirmed: boolean;
  /** Human-readable list of what is still outstanding. */
  missing: string[];
}

export function packagingState(video: PackagingInput): PackagingState {
  const hasTitle = !!video.title?.trim();
  const hasThumbnail = !!video.thumbnailUrl?.trim();
  const hasDescription = !!video.description?.trim();
  const ready = hasTitle && hasThumbnail && hasDescription;
  const confirmed = ready && !!video.packagingConfirmedAt;

  const missing: string[] = [];
  if (!hasTitle) missing.push('title');
  if (!hasThumbnail) missing.push('thumbnail');
  if (!hasDescription) missing.push('description');
  if (ready && !video.packagingConfirmedAt) missing.push('packaging sign-off');

  return { hasTitle, hasThumbnail, hasDescription, ready, confirmed, missing };
}

/**
 * What a packaging-status write turns into. APPROVED stamps the confirmation
 * (that stamp is what the publish gate reads, so it must stay in step with the
 * status); every other value clears it. Returns the refusal reason instead of a
 * write when APPROVED is asked for with a field still missing.
 */
export type PackagingWrite =
  | {
      ok: true;
      data: {
        packagingStatus: PackagingStatusKey;
        packagingConfirmedAt: Date | null;
        packagingConfirmedById: string | null;
        packagingConfirmedName: string | null;
      };
    }
  | { ok: false; reason: string };

export function packagingStatusWrite(
  next: PackagingStatusKey,
  state: PackagingState,
  actor: { id: string | null; name: string }
): PackagingWrite {
  if (next === 'APPROVED') {
    if (!state.ready) {
      return {
        ok: false,
        reason: `Packaging cannot be approved yet — still missing: ${state.missing
          .filter((m) => m !== 'packaging sign-off')
          .join(', ')}`,
      };
    }
    return {
      ok: true,
      data: {
        packagingStatus: next,
        packagingConfirmedAt: new Date(),
        packagingConfirmedById: actor.id,
        packagingConfirmedName: actor.name,
      },
    };
  }

  return {
    ok: true,
    data: {
      packagingStatus: next,
      packagingConfirmedAt: null,
      packagingConfirmedById: null,
      packagingConfirmedName: null,
    },
  };
}

/**
 * The gate is on the PUSH, not on the board (John, 2026-08-06).
 *
 * Gating status moves turned the sign-off into a handbrake: an item could not be
 * marked approved, or walked back for a re-edit, until somebody stamped the
 * packaging — which is exactly when you most want the board telling the truth
 * about where the work is. Status now moves freely. What packaging protects is
 * the step that is hard to take back: content reaching the client's channel.
 *
 * Zernio drafts are exempt — they park in Zernio and never touch YouTube.
 */
export function packagingBlocksPublish(mode: string, state: PackagingState): boolean {
  return mode !== 'draft' && !state.confirmed;
}

export function packagingErrorMessage(state: PackagingState): string {
  const what = state.missing.join(', ');
  return (
    `Packaging is not signed off, so this cannot go to YouTube yet — still missing: ${what}. ` +
    `Set the title, thumbnail and description on the item, then mark the packaging done.`
  );
}

/**
 * ABC packaging test (John, 2026-08-27): up to three candidate title+thumbnail
 * pairs for YouTube's Test & Compare, stored on Video.packagingOptions. Slots
 * are positional (A/B/C), so empty slots are KEPT as empty objects — dropping
 * them would shift a filled C into B on the next read. Shared by the session
 * and agent PATCH rails so both enforce the same shape.
 */
export const ASSET_DOWNLOAD_PATH_RE =
  /^\/api\/videos\/[A-Za-z0-9]+\/assets\/[A-Za-z0-9]+\/download(\?inline=1)?$/;

export type SanitizedPackagingOptions =
  | { ok: true; value: { title?: string; thumbnailUrl?: string }[] | null }
  | { ok: false; reason: string };

export function sanitizePackagingOptions(input: unknown): SanitizedPackagingOptions {
  if (input === null) return { ok: true, value: null };
  if (!Array.isArray(input) || input.length > 3) {
    return { ok: false, reason: 'packagingOptions must be an array of up to 3 options' };
  }
  const clean: { title?: string; thumbnailUrl?: string }[] = [];
  for (const raw of input) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: 'each packaging option must be an object' };
    }
    const record = raw as Record<string, unknown>;
    const option: { title?: string; thumbnailUrl?: string } = {};
    if (record.title !== undefined && record.title !== null) {
      if (typeof record.title !== 'string') {
        return { ok: false, reason: 'a packaging option title must be a string' };
      }
      const trimmed = record.title.trim().slice(0, 200);
      if (trimmed) option.title = trimmed;
    }
    if (record.thumbnailUrl !== undefined && record.thumbnailUrl !== null) {
      if (
        typeof record.thumbnailUrl !== 'string' ||
        !ASSET_DOWNLOAD_PATH_RE.test(record.thumbnailUrl)
      ) {
        return {
          ok: false,
          reason: 'a packaging option thumbnailUrl must be an asset download path',
        };
      }
      option.thumbnailUrl = record.thumbnailUrl;
    }
    clean.push(option);
  }
  return { ok: true, value: clean.some((o) => o.title || o.thumbnailUrl) ? clean : null };
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/**
 * Links a client or the team dropped in the item notes / handoff. These are the
 * articles and references that belong in the YouTube description, so the item page
 * offers them up rather than making somebody scroll the note history.
 */
export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(URL_RE) ?? [];
  // Trailing punctuation is almost always sentence punctuation, not part of the URL.
  return found.map((u) => u.replace(/[.,;:]+$/, ''));
}

export function collectNoteLinks(notes: { body: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    for (const link of extractLinks(note.body)) {
      if (seen.has(link)) continue;
      seen.add(link);
      out.push(link);
    }
  }
  return out;
}

/** Links present in the notes but not yet in the description. */
export function missingFromDescription(links: string[], description: string | null): string[] {
  const body = description ?? '';
  return links.filter((l) => !body.includes(l));
}
