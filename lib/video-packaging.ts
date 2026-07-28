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
 * Statuses that require packaging to be signed off first.
 *
 * EDITING is the front gate — the whole point of the change. APPROVED is the back
 * stop, so an edit can never be approved with the packaging still undone.
 *
 * Deliberately NOT gated: REVIEW. A cut upload auto-flips an item into REVIEW and
 * blocking that would mean refusing an editor's upload, which is the wrong place
 * to argue about a thumbnail.
 */
export const PACKAGING_GATED_STATUSES = new Set(['EDITING', 'APPROVED']);

export function packagingBlocksStatus(next: string, state: PackagingState): boolean {
  return PACKAGING_GATED_STATUSES.has(next) && !state.confirmed;
}

export function packagingErrorMessage(state: PackagingState, next: string): string {
  const what = state.missing.join(', ');
  return (
    `Packaging must be done before an item moves to ${next.toLowerCase()} — still missing: ${what}. ` +
    `Set the title, thumbnail and description on the item, then mark the packaging done.`
  );
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
