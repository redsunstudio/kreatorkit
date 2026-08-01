'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Film,
  Kanban,
  Lightbulb,
  Link2,
  List,
  Loader2,
  MessageSquare,
  PackageOpen,
  Play,
  Plus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

// Fixed locale + UTC so the server render and the client render agree (a
// locale-dependent or timezone-dependent string hydrates mismatched).
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

export function formatCutDateFull(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${FULL_FMT.format(d)} UTC`;
}

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

  // keep local state in sync with fresh server props
  useEffect(() => setItems(videos), [videos]);

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
    try {
      const res = await fetch(`/api/projects/${current.projectId || projectId}/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems((list) => list.map((v) => (v.id === videoId ? { ...v, status: prev } : v)));
      toast.error('Could not update status — reverted');
    }
  }

  // Shared by both the board card and the list row's always-visible column —
  // one visual source of truth for "what cut/idea state is this at."
  function VersionMarker({ v }: { v: PipelineVideo }) {
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
            {v.latestCutAt && (
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

  const PACKAGING_WARNING_TITLE =
    'Title, thumbnail and description are not signed off - this cannot be approved';

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
                      'group grid grid-cols-[64px_minmax(0,1fr)_104px_20px_auto] items-center gap-x-3 px-4 py-2 border-l-2 border-l-transparent hover:border-l-primary/70 hover:bg-white/[0.03] transition-all duration-150',
                      canEdit && 'cursor-grab active:cursor-grabbing'
                    )}
                  >
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
                    <VersionMarker v={v} />
                    <div className="flex items-center justify-center">
                      <PackagingWarningIcon v={v} />
                    </div>
                    <div
                      className={cn(
                        'flex items-center gap-2 justify-self-end transition-opacity',
                        'pointer-coarse:opacity-100',
                        'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100'
                      )}
                    >
                      <span className="text-xs" title={t.label}>
                        {t.emoji}
                      </span>
                      {v.membersOnly && (
                        <span title="Members only - publish privately, then switch visibility in YouTube Studio">
                          <Users className="h-3 w-3 text-muted-foreground" />
                        </span>
                      )}
                      {v.commentCount > 0 && (
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono">
                          <MessageSquare className="h-3 w-3" />
                          {v.commentCount}
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
                    'rounded-md border bg-background p-3 transition-all duration-150 hover:border-primary/50',
                    canEdit && 'cursor-grab active:cursor-grabbing'
                  )}
                >
                  <Link href={itemHref(v)} className="block">
                    <Thumb v={v} size="card" />
                  </Link>
                  <Link
                    href={itemHref(v)}
                    className="text-sm font-medium hover:text-primary transition-colors line-clamp-2 block mt-2.5"
                  >
                    {v.title}
                  </Link>
                  <div className="flex items-center gap-3 mt-2">
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
