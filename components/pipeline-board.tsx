'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, Kanban, Lightbulb, List, Loader2, MessageSquare, Plus } from 'lucide-react';
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
import { VIDEO_TYPES, typeMeta } from '@/lib/video-type';

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
}

interface PipelineBoardProps {
  projectId?: string;
  workspaceId?: string;
  videos: PipelineVideo[];
  canEdit: boolean;
}

function Thumb({ v, size }: { v: PipelineVideo; size: 'row' | 'card' }) {
  const src = v.itemThumbnailUrl || v.thumbnailUrl || null;
  const cls =
    size === 'row'
      ? 'h-9 w-16 rounded-md object-cover border border-white/10 flex-none'
      : 'w-full aspect-video rounded-lg object-cover border border-white/10';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cls} loading="lazy" />;
  }
  return (
    <div
      className={cn(
        cls,
        'bg-white/[0.04] flex items-center justify-center text-muted-foreground',
        size === 'row' ? 'text-sm' : 'text-2xl'
      )}
    >
      🎬
    </div>
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

export function PipelineBoard({ projectId, workspaceId, videos, canEdit }: PipelineBoardProps) {
  const router = useRouter();
  const [items, setItems] = useState<PipelineVideo[]>(videos);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
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
      setVideoType('LONGFORM');
      router.refresh();
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

  function rowMeta(v: PipelineVideo) {
    const t = typeMeta(v.videoType);
    return (
      <>
        <span
          className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono"
          title={t.label}
        >
          {t.emoji} {t.label}
        </span>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1 font-mono">
          {v.currentVersion > 0 ? (
            <>
              <Film className="h-3 w-3" />v{v.currentVersion}
            </>
          ) : (
            <>
              <Lightbulb className="h-3 w-3" />
              idea
            </>
          )}
        </span>
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
      {PIPELINE_STAGES.map((stage) => {
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
              {stageItems.map((v) => (
                <div
                  key={v.id}
                  draggable={canEdit}
                  onDragStart={(e) => e.dataTransfer.setData('text/kk-video', v.id)}
                  className={cn(
                    'flex items-center gap-4 px-4 py-2.5 border-l-2 border-l-transparent hover:border-l-primary/70 hover:bg-white/[0.03] transition-all duration-150',
                    canEdit && 'cursor-grab active:cursor-grabbing'
                  )}
                >
                  <Thumb v={v} size="row" />
                  <Link
                    href={itemHref(v)}
                    className="text-sm font-medium hover:text-primary transition-colors truncate flex-1 min-w-0"
                  >
                    {v.title}
                  </Link>
                  {v.brief && (
                    <span className="hidden lg:block text-xs text-muted-foreground truncate max-w-[240px]">
                      {v.brief}
                    </span>
                  )}
                  {rowMeta(v)}
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
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const boardView = (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {PIPELINE_STAGES.map((stage) => {
        const stageItems = items.filter((v) => stageOf(v.status) === stage.key);
        if (stageItems.length === 0 && ['PUBLISHED', 'REJECTED', 'ARCHIVED'].includes(stage.key))
          return null;
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
                  <div className="flex items-center gap-3 mt-2">{rowMeta(v)}</div>
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
              New video idea
            </Button>
          )}
        </div>
      </div>

      {view === 'list' ? listView : boardView}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New video idea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder='Working title — e.g. "iPhone 17 vs iPhone 16"'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
            <Select value={videoType} onValueChange={setVideoType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.emoji} {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Brief (optional) — the angle, the hook, anything the shoot or edit needs to know"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              maxLength={5000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={createIdea} disabled={creating || !title.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Add to pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
