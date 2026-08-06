/**
 * Cut (version) date formatting, shared by the pipeline, the item page and the
 * review page so "when did this cut land" reads identically everywhere.
 *
 * Fixed locale + UTC on purpose: a locale-dependent or timezone-dependent string
 * renders differently on the server and the client, which hydrates mismatched.
 */
const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const FULL_FMT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** "25 Jul", or "25 Jul 24" once the upload is in a previous calendar year. */
export function formatCutDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const short = DAY_FMT.format(d);
  const thisYear = new Date().getUTCFullYear();
  return d.getUTCFullYear() === thisYear
    ? short
    : `${short} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** "25 Jul 2026, 14:03 UTC" — the tooltip / secondary line form. */
export function formatCutDateFull(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${FULL_FMT.format(d)} UTC`;
}

/**
 * "uploaded 3 hours ago" inside the first 24h, then "uploaded 25 Jul".
 * Render with suppressHydrationWarning — the hour count is computed at render
 * time, so server and client can disagree across an hour boundary.
 */
export function formatCutDateRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 0 || hours >= 24) return `uploaded ${formatCutDate(iso)}`;
  if (hours < 1) return 'uploaded just now';
  return `uploaded ${hours} hour${hours === 1 ? '' : 's'} ago`;
}
