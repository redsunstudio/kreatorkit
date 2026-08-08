'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  Check,
  Film,
  Kanban,
  Lightbulb,
  Link2,
  List,
  Loader2,
  MessageSquare,
  PackageOpen,
  Clock,
  Play,
  Plus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ThumbnailImage } from '@/components/thumbnail-image';
import { resolvePublicBunnyCdnHostname } from '@/lib/bunny-cdn';
import { resolveThumbnailUrl } from '@/lib/thumbnail-url';
import { VIDEO_TYPES, typeMeta, typeOptionLabel } from '@/lib/video-type';
import { formatCutDate, formatCutDateFull, formatCutDateRelative } from '@/lib/cut-date';

// Bunny poster thumbnails are stored against a shared host that must be rewritten
// to this library's pull-zone host before they will load (see resolveThumbnailUrl).
const BUNNY_CDN_HOSTNAME = resolvePublicBunnyCdnHostname();

export const PIPELINE_STAGES = [
  { key: 'IDEA', label: 'Idea', emoji: '💡' },
  { key: 'EDITING', label: 'In edit', emoji: '✂️' },
  { key: 'REVIEW', label: 'In review', emoji: '👀' },
  { key: 'APPROVED', label: 'Approved', emoji: '✅' },
  { key: 'PUBLISHED', label: 'Published', emoji: '🚀' },
  { key: 'REJECTED', label: 'Rejected', emoji: '❌' },
  { key: 'ARCHIVED', label: 'Archived', emoji: '📦' },
] as const;

// Retired stages still present on old rows map into the nearest live stage.
const LEGACY_STAGE_MAP: Record<string, StageKey> = {
  FILMED: 'EDITING',
  CHANGES: 'REVIEW',
};

type StageKey = (typeof PIPELINE_STAGES)[number]['key'];

const STAGE_CHIP: Record<StageKey, string> = {
  IDEA: 'bg-white/5 text-muted-foreground border-white/10',
  EDITING: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  REVIEW: 'bg-blue-400/10 text-blue-300 border-blue-400/30',
  APPROVED: 'bg-green-500/10 text-green-400 border-green-500/30',
  PUBLISHED: 'bg-green-700/15 text-green-500 border-green-700/40',
  REJECTED: 'bg-red-500/10 text-red-400 border-red-500/30',
  ARCHIVED: 'bg-white/5 text-muted-foreground border-white/10',
};

const STAGE_COL: Record<StageKey, string> = {
  IDEA: 'bg-white/[0.02]',
  EDITING: 'bg-orange-500/[0.05]',
  REVIEW: 'bg-blue-400/[0.05]',
  APPROVED: 'bg-green-500/[0.05]',
  PUBLISHED: 'bg-green-700/[0.06]',
  REJECTED: 'bg-red-500/[0.05]',
  ARCHIVED: 'bg-white/[0.02]',
};

export function stageOf(status: string): StageKey {
  if (LEGACY_STAGE_MAP[status]) return LEGACY_STAGE_MAP[status];
  return (PIPELINE_STAGES.find((s) => s.key === status)?.key ?? 'IDEA') as StageKey;
}

// Published and archived items leave the pipeline (Published tab / Archive page);
// both remain selectable as statuses so items can be sent there.
const PIPELINE_VIEW_STAGES = PIPELINE_STAGES.filter(
  (s) => !['PUBLISHED', 'ARCHIVED'].includes(s.key)
);

interface PipelineVideo {
  id: string;
  title: string;
  status: string;
  videoType?: string;
  brief: string | null;
  currentVersion: number;
  commentCount: number;
  projectId?: string;
  thumbnailUrl?: string | null;
  itemThumbnailUrl?: string | null;
  /** ISO date the newest cut was uploaded — null on idea items with no cut yet. */
  latestCutAt?: string | null;
  /** Title + thumbnail + description signed off. Gates EDITING and APPROVED. */
  packagingDone?: boolean;
  membersOnly?: boolean;
}

// Cut-date formatting lives in lib/cut-date so the item page and the review
// page format the same value identically. Re-exported here because callers
// already import these two from the pipeline module.
export { formatCutDate, formatCutDateFull } from '@/lib/cut-date';

interface PipelineBoardProps {
  projectId?: string;
  workspaceId?: string;
  videos: PipelineVideo[];
  canEdit: boolean;
  allowPosts?: boolean; // BETA: offer the 📝 Post type in the create dialog
}

function Thumb({ v, size }: { v: PipelineVideo; size: 'row' | 'card' }) {
  const src = resolveThumbnailUrl(v.itemThumbnailUrl || v.thumbnailUrl, BUNNY_CDN_HOSTNAME);
  const cls =
    size === 'row'
      ? 'h-9 w-16 rounded-md object-cover border border-white/10 flex-none'
      : 'w-full aspect-video rounded-lg object-cover border border-white/10';
  const placeholder = (
    <div
      className={cn(
        cls,
        'bg-gradient-to-br from-white/[0.06] to-white/[0.015] flex items-center justify-center text-muted-foreground/50'
      )}
    >
      <Film className={size === 'row' ? 'h-3.5 w-3.5' : 'h-6 w-6'} strokeWidth={1.5} />
    </div>
  );
  return <ThumbnailImage src={src} alt="" className={cls} fallback={placeholder} />;
}

// Grab the client-facing review link for a cut and copy it to the clipboard.
// Reuses the item's existing COMMENT share link so links already sent to a client
// keep working; only mints one if none exists yet.
function CopyReviewLink({ v, size }: { v: PipelineVideo; size: 'row' | 'card' }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!v.projectId) return null;

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const base = `/api/projects/${v.projectId}/videos/${v.id}/share`;
      const existing = await fetch(base);
      let url: string | null = existing.ok
        ? ((await existing.json())?.data?.shareUrl ?? null)
        : null;
      if (!url) {
        const created = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!created.ok) {
          throw new Error(
            (await created.json())?.error?.message || 'Could not create a review link'
          );
        }
        url = (await created.json())?.data?.shareUrl ?? null;
      }
      if (!url) throw new Error('No review link available');
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Review link copied — paste it to the client');
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy the review link');
    } finally {
      setBusy(false);
    }
  };

  const cls =
    size === 'row'
      ? 'flex-none inline-flex items-center gap-1 h-7 rounded-md border px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
      : 'inline-flex items-center gap-1 h-6 rounded-md border px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors';

  return (
    <button
      type="button"
      onClick={copy}
      disabled={busy}
      className={cls}
      title="Copy the client review link"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : copied ? (
        <Check className="h-3 w-3 text-green-400" />
      ) : (
        <Link2 className="h-3 w-3" />
      )}
      {size === 'row' ? (copied ? 'Copied' : 'Copy link') : null}
    </button>
  );
}

function StagePill({ status }: { status: string }) {
  const key = stageOf(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STAGE_CHIP[key]
      )}
    >
      {PIPELINE_STAGES.find((s) => s.key === key)?.emoji}{' '}
      {PIPELINE_STAGES.find((s) => s.key === key)?.label}
    </span>
  );
}

export function PipelineBoard({
  projectId,
  workspaceId,
  videos,
  canEdit,
  allowPosts,
}: PipelineBoardProps) {
  const [items, setItems] = useState<PipelineVideo[]>(videos);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [postCopy, setPostCopy] = useState('');
  const [videoType, setVideoType] = useState('LONGFORM');
  const [creating, setCreating] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<StageKey | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // keep local state in sync with fresh server props
  useEffect(() => setItems(videos), [videos]);

  // A selection can only ever name rows that are still on the board.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(videos.map((v) => v.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [videos]);

  useEffect(() => {
    const stored = window.localStorage.getItem('kk-pipeline-view');
    if (stored === 'board' || stored === 'list') setView(stored);
  }, []);
  const switchView = (v: 'list' | 'board') => {
    setView(v);
    window.localStorage.setItem('kk-pipeline-view', v);
  };

  // Straight to the review player (loads the active/latest cut).
  const reviewHref = useCallback(
    (v: PipelineVideo) =>
      v.projectId && v.currentVersion > 0 ? `/projects/${v.projectId}/videos/${v.id}` : null,
    []
  );

  const itemHref = useCallback(
    (v: PipelineVideo) =>
      workspaceId
        ? `/workspaces/${workspaceId}/videos/${v.id}`
        : `/projects/${projectId}/videos/${v.id}`,
    [workspaceId, projectId]
  );

  async function createIdea() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(
        workspaceId ? `/api/workspaces/${workspaceId}/videos` : `/api/projects/${projectId}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planned: true,
            title: title.trim(),
            brief: brief.trim() || null,
            ...(videoType === 'POST' && postCopy.trim() ? { description: postCopy.trim() } : {}),
            videoType,
          }),
        }
      );
      if (!res.ok)
        throw new Error((await res.json())?.error?.message || 'Could not create the item');
      const created = (await res.json()).data;
      setItems((prev) => [
        {
          id: created.id,
          title: created.title,
          status: created.status,
          videoType: created.videoType ?? videoType,
          brief: created.brief,
          currentVersion: 0,
          commentCount: 0,
          projectId: created.projectId,
        },
        ...prev,
      ]);
      toast.success('Added to the pipeline');
      setDialogOpen(false);
      setTitle('');
      setBrief('');
      setPostCopy('');
      setVideoType('LONGFORM');
      // The new row is already in `items` above with everything the pipeline
      // renders, so refreshing the route only re-fetched the whole list to
      // arrive back at the same screen.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the item');
    } finally {
      setCreating(false);
    }
  }

  /** Optimistic status move — instant UI, background PATCH, revert on failure. */
  async function moveStatus(videoId: string, next: string) {
    const current = items.find((v) => v.id === videoId);
    if (!current || current.status === next) return;

    const prev = current.status;
    setItems((list) => list.map((v) => (v.id === videoId ? { ...v, status: next } : v)));
    const patch = () =>
      fetch(`/api/projects/${current.projectId || projectId}/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
    try {
      let res = await patch();
      if (res.status === 429) {
        // Rapid triage can exhaust the mutate bucket — one spaced retry
        // usually clears it without bothering the user.
        await new Promise((r) => setTimeout(r, 1500));
        res = await patch();
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || '');
      }
    } catch (e) {
      setItems((list) => list.map((v) => (v.id === videoId ? { ...v, status: prev } : v)));
      // The server's refusal reason (validation) is the useful part — show it
      // when there is one.
      const reason = e instanceof Error && e.message ? e.message : '';
      toast.error(reason || 'Could not update status — reverted');
    }
  }

  const selectionActive = selected.size > 0;

  function toggleSelected(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function setStageSelected(stageItems: PipelineVideo[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const v of stageItems) {
        if (on) next.add(v.id);
        else next.delete(v.id);
      }
      return next;
    });
  }

  /**
   * Batch status move. Same optimistic pattern as a single move, one request for
   * the whole selection. "Archive" here parks items out of the pipeline (status
   * only) — the destructive archive that deletes files stays a per-item action.
   */
  async function applyBulkStatus(next: string) {
    if (!workspaceId || bulkBusy) return;
    const ids = items.filter((v) => selected.has(v.id) && v.status !== next).map((v) => v.id);
    if (ids.length === 0) {
      toast.info('Those items are already there');
      return;
    }
    const before = new Map(items.map((v) => [v.id, v.status]));
    const targeted = new Set(ids);
    setBulkBusy(true);
    setItems((list) => list.map((v) => (targeted.has(v.id) ? { ...v, status: next } : v)));
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/videos/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds: ids, status: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message || 'Could not update the selected items');

      const moved = body?.data?.updated ?? 0;
      if (moved > 0) {
        const label = PIPELINE_STAGES.find((s) => s.key === next)?.label ?? next;
        toast.success(`${moved} item${moved === 1 ? '' : 's'} moved to ${label}`);
      }
      setSelected(new Set());
    } catch (e) {
      setItems((list) =>
        list.map((v) => (targeted.has(v.id) ? { ...v, status: before.get(v.id) ?? v.status } : v))
      );
      toast.error(e instanceof Error ? e.message : 'Could not update the selected items');
    } finally {
      setBulkBusy(false);
    }
  }

  function SelectBox({ v, className }: { v: PipelineVideo; className?: string }) {
    if (!canEdit) return null;
    return (
      <input
        type="checkbox"
        aria-label={`Select ${v.title}`}
        checked={selected.has(v.id)}
        onChange={() => toggleSelected(v.id)}
        onClick={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        className={cn('h-3.5 w-3.5 accent-primary cursor-pointer', className)}
      />
    );
  }

  // Shared by both the board card and the list row's always-visible column —
  // one visual source of truth for "what cut/idea state is this at."
  function VersionMarker({ v, withDate = true }: { v: PipelineVideo; withDate?: boolean }) {
    return (
      <span
        className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono"
        title={
          v.currentVersion > 0 && v.latestCutAt
            ? `Latest cut (v${v.currentVersion}) uploaded ${formatCutDateFull(v.latestCutAt)}`
            : undefined
        }
      >
        {v.currentVersion > 0 ? (
          <>
            <Film className="h-3 w-3" />v{v.currentVersion}
            {withDate && v.latestCutAt && (
              <span className="text-muted-foreground/70">· {formatCutDate(v.latestCutAt)}</span>
            )}
          </>
        ) : (
          <>
            <Lightbulb className="h-3 w-3" />
            idea
          </>
        )}
      </span>
    );
  }

  // The always-visible middle column on list rows: 🕒 when the latest cut
  // landed ("3 hours ago" inside 24h, then the date) + 💬 comment count.
  // Both show whenever the item has a cut — a zero comment count is
  // information too (John: "comment logo 0"). Idea items have neither.
  //
  // It must still render its (empty) span on a cutless item. The list row is a
  // fixed 7-track grid relying on auto-placement, so returning null here removes
  // a child and shifts every later one a track to the left — which lands the
  // whole actions cluster in the 20px warning track and paints it over the
  // status pill. That was the "overlapping rows" bug on thumbnail-only items.
  function RowActivity({ v }: { v: PipelineVideo }) {
    if (v.currentVersion === 0) return <span aria-hidden />;
    return (
      <span className="inline-flex items-center gap-3 justify-self-end text-xs text-muted-foreground font-mono whitespace-nowrap">
        {v.latestCutAt && (
          <span
            suppressHydrationWarning
            className="inline-flex items-center gap-1"
            title={`Latest cut uploaded ${formatCutDateFull(v.latestCutAt)}`}
          >
            <Clock className="h-3 w-3" />
            {formatCutDateRelative(v.latestCutAt)}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1"
          title={`${v.commentCount} review comment${v.commentCount === 1 ? '' : 's'} on the current cut${v.commentCount === 0 ? ' — awaiting review' : ''}`}
        >
          <MessageSquare className="h-3 w-3" />
          {v.commentCount}
        </span>
      </span>
    );
  }

  const PACKAGING_WARNING_TITLE =
    'Title, thumbnail and description are not signed off - this cannot be pushed to YouTube yet';

  function packagingIncomplete(v: PipelineVideo): boolean {
    return v.packagingDone === false && stageOf(v.status) !== 'IDEA';
  }

  // List view's fixed-width warning column shows the icon alone (with the
  // same tooltip) — the "pkg" text label stays board-only, where there's
  // room for it without breaking column alignment.
  function PackagingWarningIcon({ v }: { v: PipelineVideo }) {
    if (!packagingIncomplete(v)) return null;
    return (
      <span title={PACKAGING_WARNING_TITLE}>
        <PackageOpen className="h-3.5 w-3.5 text-orange-300" />
      </span>
    );
  }

  function rowMeta(v: PipelineVideo) {
    const t = typeMeta(v.videoType);
    return (
      <>
        <span
          className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono"
          title={t.label}
        >
          {t.emoji} {typeOptionLabel(t)}
        </span>
        <VersionMarker v={v} />
        {packagingIncomplete(v) && (
          <span
            className="text-xs inline-flex items-center gap-1 font-mono text-orange-300"
            title={PACKAGING_WARNING_TITLE}
          >
            <PackageOpen className="h-3 w-3" />
            pkg
          </span>
        )}
        {v.membersOnly && (
          <span
            className="text-xs inline-flex items-center gap-1 font-mono text-muted-foreground"
            title="Members only - publish privately, then switch visibility in YouTube Studio"
          >
            <Users className="h-3 w-3" />
            members
          </span>
        )}
        {v.commentCount > 0 && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono">
            <MessageSquare className="h-3 w-3" />
            {v.commentCount}
          </span>
        )}
      </>
    );
  }

  const listView = (
    <div className="space-y-6">
      {PIPELINE_VIEW_STAGES.map((stage) => {
        const stageItems = items.filter((v) => stageOf(v.status) === stage.key);
        if (stageItems.length === 0 && stage.key !== 'IDEA') return null;
        return (
          <div
            key={stage.key}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOverStage(stage.key);
            }}
            onDragLeave={() => setDragOverStage((cur) => (cur === stage.key ? null : cur))}
            onDrop={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOverStage(null);
              const id = e.dataTransfer.getData('text/kk-video');
              if (id) void moveStatus(id, stage.key);
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              {canEdit && stageItems.length > 0 && (
                <input
                  type="checkbox"
                  aria-label={`Select everything in ${stage.label}`}
                  title={`Select everything in ${stage.label}`}
                  checked={stageItems.every((v) => selected.has(v.id))}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate =
                        stageItems.some((v) => selected.has(v.id)) &&
                        !stageItems.every((v) => selected.has(v.id));
                    }
                  }}
                  onChange={(e) => setStageSelected(stageItems, e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                />
              )}
              <span className="text-sm leading-none">{stage.emoji}</span>
              <span className="text-sm font-semibold">{stage.label}</span>
              <span className="text-xs text-muted-foreground font-mono">{stageItems.length}</span>
            </div>
            <div
              className={cn(
                'rounded-lg border divide-y overflow-hidden transition-colors',
                STAGE_COL[stage.key],
                dragOverStage === stage.key && 'border-primary/60 bg-primary/5'
              )}
            >
              {stageItems.length === 0 && (
                <p className="text-xs text-muted-foreground px-4 py-3">
                  Nothing here yet{canEdit ? ' — add the next video idea.' : '.'}
                </p>
              )}
              {stageItems.map((v) => {
                const t = typeMeta(v.videoType);
                return (
                  <div
                    key={v.id}
                    draggable={canEdit}
                    onDragStart={(e) => e.dataTransfer.setData('text/kk-video', v.id)}
                    className={cn(
                      'group grid items-center gap-x-3 px-4 py-2 border-l-2 border-l-transparent hover:border-l-primary/70 hover:bg-white/[0.03] transition-all duration-150',
                      canEdit
                        ? 'grid-cols-[16px_64px_minmax(0,1fr)_auto_64px_20px_auto]'
                        : 'grid-cols-[64px_minmax(0,1fr)_auto_64px_20px_auto]',
                      canEdit && 'cursor-grab active:cursor-grabbing',
                      selected.has(v.id) && 'bg-primary/[0.07] border-l-primary'
                    )}
                  >
                    <SelectBox
                      v={v}
                      className={cn(
                        'transition-opacity',
                        'pointer-coarse:opacity-100',
                        !selectionActive &&
                          'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus:opacity-100'
                      )}
                    />
                    <Thumb v={v} size="row" />
                    <div className="min-w-0">
                      <Link
                        href={itemHref(v)}
                        className="block text-sm font-medium hover:text-primary transition-colors truncate"
                      >
                        {v.title}
                      </Link>
                      {v.brief && (
                        <p className="hidden lg:block text-xs text-muted-foreground truncate mt-0.5">
                          {v.brief}
                        </p>
                      )}
                    </div>
                    <RowActivity v={v} />
                    <VersionMarker v={v} withDate={false} />
                    <div className="flex items-center justify-center">
                      <PackagingWarningIcon v={v} />
                    </div>
                    {/* Always visible — John's continuity rule: per-item actions
                        (Review, Copy link, status) must be discoverable without
                        hovering, on every row. */}
                    <div className="flex items-center gap-2 justify-self-end">
                      <span className="text-xs" title={t.label}>
                        {t.emoji}
                      </span>
                      {v.membersOnly && (
                        <span title="Members only - publish privately, then switch visibility in YouTube Studio">
                          <Users className="h-3 w-3 text-muted-foreground" />
                        </span>
                      )}
                      {reviewHref(v) && (
                        <>
                          <Link
                            href={reviewHref(v)!}
                            className="flex-none inline-flex items-center gap-1 h-7 rounded-md border px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          >
                            <Play className="h-3 w-3" />
                            Review
                          </Link>
                          <CopyReviewLink v={v} size="row" />
                        </>
                      )}
                      {canEdit ? (
                        <Select
                          value={stageOf(v.status)}
                          onValueChange={(next) => moveStatus(v.id, next)}
                        >
                          <SelectTrigger className="h-7 w-[124px] text-xs px-2 flex-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINE_STAGES.map((st) => (
                              <SelectItem key={st.key} value={st.key} className="text-xs">
                                {st.emoji} {st.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <StagePill status={v.status} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  const boardView = (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {PIPELINE_VIEW_STAGES.map((stage) => {
        const stageItems = items.filter((v) => stageOf(v.status) === stage.key);
        if (stageItems.length === 0 && stage.key === 'REJECTED') return null;
        return (
          <div
            key={stage.key}
            className={cn(
              'flex-none w-[250px] rounded-lg border transition-colors',
              STAGE_COL[stage.key],
              dragOverStage === stage.key && 'border-primary/60 bg-primary/5'
            )}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOverStage(stage.key);
            }}
            onDragLeave={() => setDragOverStage((s) => (s === stage.key ? null : s))}
            onDrop={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOverStage(null);
              const id = e.dataTransfer.getData('text/kk-video');
              if (id) void moveStatus(id, stage.key);
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b">
              <span className="text-sm leading-none">{stage.emoji}</span>
              <span className="text-xs font-semibold uppercase tracking-wide">{stage.label}</span>
              <span className="text-xs text-muted-foreground font-mono ml-auto">
                {stageItems.length}
              </span>
            </div>
            <div className="p-2 space-y-2 min-h-[80px]">
              {stageItems.map((v) => (
                <div
                  key={v.id}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData('text/kk-video', v.id)}
                  className={cn(
                    'group relative rounded-md border bg-background p-3 transition-all duration-150 hover:border-primary/50',
                    canEdit && 'cursor-grab active:cursor-grabbing',
                    selected.has(v.id) && 'border-primary bg-primary/[0.07]'
                  )}
                >
                  <SelectBox
                    v={v}
                    className={cn(
                      'absolute left-4 top-4 z-10 rounded-sm bg-background/80 transition-opacity',
                      'pointer-coarse:opacity-100',
                      !selectionActive &&
                        'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus:opacity-100'
                    )}
                  />
                  <Link href={itemHref(v)} className="block">
                    <Thumb v={v} size="card" />
                  </Link>
                  <Link
                    href={itemHref(v)}
                    className="text-sm font-medium hover:text-primary transition-colors line-clamp-2 block mt-2.5"
                  >
                    {v.title}
                  </Link>
                  {/* flex-wrap: the meta cluster + action buttons overflow a 250px
                      card at their widest ("Long form" + v18 date + pkg + 💬) —
                      wrapping drops the buttons to their own line instead of
                      pushing them out the card edge. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                    {rowMeta(v)}
                    {reviewHref(v) && (
                      <div className="ml-auto flex items-center gap-1">
                        <Link
                          href={reviewHref(v)!}
                          className="inline-flex items-center gap-1 h-6 rounded-md border px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        >
                          <Play className="h-3 w-3" />
                          Review
                        </Link>
                        <CopyReviewLink v={v} size="card" />
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="mt-2">
                      {/* Drag has no touch fallback — the Select is how mobile moves cards. */}
                      <Select
                        value={stageOf(v.status)}
                        onValueChange={(next) => moveStatus(v.id, next)}
                      >
                        <SelectTrigger className="h-7 w-full text-xs px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PIPELINE_STAGES.map((st) => (
                            <SelectItem key={st.key} value={st.key} className="text-xs">
                              {st.emoji} {st.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              ))}
              {stageItems.length === 0 && (
                <p className="text-[11px] text-muted-foreground px-1 py-2">
                  {canEdit ? 'Drag an item here' : 'Empty'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              className={cn(
                'px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors',
                view === 'list'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => switchView('list')}
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              className={cn(
                'px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 border-l transition-colors',
                view === 'board'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => switchView('board')}
            >
              <Kanban className="h-3.5 w-3.5" />
              Board
            </button>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {allowPosts ? 'New item' : 'New video idea'}
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-14 flex flex-col items-center text-center gap-3">
          <Lightbulb className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Nothing in the pipeline yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Every video starts as an idea — just a working title. Drop footage on it later, review
            the cuts here, and it ships from this board.
          </p>
          {canEdit && (
            <Button size="sm" className="mt-1" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {allowPosts ? 'Start your first item' : 'Start your first video idea'}
            </Button>
          )}
        </div>
      ) : view === 'list' ? (
        listView
      ) : (
        boardView
      )}

      {canEdit && workspaceId && selectionActive && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
            <span className="pl-1 text-xs font-medium tabular-nums">{selected.size} selected</span>
            <Separator orientation="vertical" className="h-5" />
            <Select value="" onValueChange={(next) => void applyBulkStatus(next)}>
              <SelectTrigger className="h-8 w-[168px] text-xs px-2" disabled={bulkBusy}>
                <SelectValue placeholder="Move to stage…" />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.filter((s) => s.key !== 'ARCHIVED').map((st) => (
                  <SelectItem key={st.key} value={st.key} className="text-xs">
                    {st.emoji} {st.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={bulkBusy}
              onClick={() => void applyBulkStatus('ARCHIVED')}
              title="Park these out of the pipeline. Files are kept — only the item page deletes media."
            >
              {bulkBusy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5 mr-1.5" />
              )}
              Archive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={bulkBusy}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {videoType === 'POST' ? '📝 New LinkedIn post' : 'New video idea'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={videoType} onValueChange={setVideoType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_TYPES.filter((t) => t.key !== 'POST' || allowPosts).map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.emoji} {typeOptionLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder={
                videoType === 'POST'
                  ? 'Internal title — e.g. "Cuff tear case study post" (never published)'
                  : 'Working title — e.g. "iPhone 17 vs iPhone 16"'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
            {videoType === 'POST' ? (
              <Textarea
                placeholder="Post copy (optional here) — write it now or on the item page. @tags welcome."
                value={postCopy}
                onChange={(e) => setPostCopy(e.target.value)}
                rows={6}
                maxLength={5000}
              />
            ) : (
              <Textarea
                placeholder="Brief (optional) — the angle, the hook, anything the shoot or edit needs to know"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                maxLength={5000}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={createIdea} disabled={creating || !title.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              {videoType === 'POST' ? 'Create post' : 'Add to pipeline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
