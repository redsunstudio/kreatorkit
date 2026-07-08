'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Download,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Music,
  Play,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PIPELINE_STAGES, stageOf } from '@/components/pipeline-board';
import { VIDEO_TYPES, typeMeta, isImageAsset } from '@/lib/video-type';

interface ItemVersion {
  id: string;
  versionNumber: number;
  versionLabel: string | null;
  isActive: boolean;
}

interface PostOptions {
  repostUrl?: string;
  disableLinkPreview?: boolean;
  firstComment?: string;
}

interface ItemVideo {
  id: string;
  projectId: string;
  title: string;
  status: string;
  videoType: string;
  brief: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  postOptions?: PostOptions | null;
  versions: ItemVersion[];
}

interface Asset {
  id: string;
  displayName: string;
  kind: string;
  sizeBytes?: string | number | null;
  uploadedByUser?: { name: string | null } | null;
  uploadedByGuestName?: string | null;
  createdAt: string;
}

interface VideoItemClientProps {
  workspaceId: string;
  video: ItemVideo;
  canEdit: boolean;
  publishReady?: boolean;
  linkedInReady?: boolean;
  allowPosts?: boolean;
}

function fmtSize(b?: string | number | null): string {
  const n = typeof b === 'string' ? Number(b) : (b ?? 0);
  if (!n) return '';
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

function KindIcon({ kind }: { kind: string }) {
  const cls = 'h-3.5 w-3.5 text-muted-foreground flex-none';
  if (kind === 'VIDEO') return <Film className={cls} />;
  if (kind === 'IMAGE') return <ImageIcon className={cls} />;
  if (kind === 'AUDIO') return <Music className={cls} />;
  return <FileIcon className={cls} />;
}

export function VideoItemClient({
  workspaceId,
  video,
  canEdit,
  publishReady,
  linkedInReady,
  allowPosts,
}: VideoItemClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState(video.status);
  const [videoType, setVideoType] = useState(video.videoType);
  const [brief, setBrief] = useState(video.brief ?? '');
  const [description, setDescription] = useState(video.description ?? '');
  const [thumbnailUrl, setThumbnailUrl] = useState(video.thumbnailUrl);
  const [briefState, setBriefState] = useState<'idle' | 'typing' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const briefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedBrief = useRef(video.brief ?? '');
  const [descState, setDescState] = useState<'idle' | 'typing' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDesc = useRef(video.description ?? '');
  const [movingStatus, setMovingStatus] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [scheduleFor, setScheduleFor] = useState('');
  const [title, setTitle] = useState(video.title);
  const [titleDraft, setTitleDraft] = useState(video.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; pct: number; state: string }[]>([]);
  const [uploadingCut, setUploadingCut] = useState<string | null>(null);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notes, setNotes] = useState<
    { id: string; body: string; createdAt: string; author?: { name: string | null } | null }[]
  >([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [postingNote, setPostingNote] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState<string | null>(null);
  const [postOpts, setPostOpts] = useState<PostOptions>(video.postOptions ?? {});
  const [postOptsState, setPostOptsState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const postOptsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mentionUrl, setMentionUrl] = useState('');
  const [mentionName, setMentionName] = useState('');
  const [insertingMention, setInsertingMention] = useState(false);
  const footageInput = useRef<HTMLInputElement>(null);
  const cutInput = useRef<HTMLInputElement>(null);
  const thumbInput = useRef<HTMLInputElement>(null);

  const loadAssets = useCallback(async () => {
    try {
      const r = await fetch(`/api/videos/${video.id}/assets`);
      if (r.ok) {
        const d = await r.json();
        setAssets(d.data?.assets ?? []);
      }
    } finally {
      setAssetsLoaded(true);
    }
  }, [video.id]);

  const loadNotes = useCallback(async () => {
    const r = await fetch(`/api/videos/${video.id}/notes`);
    if (r.ok) setNotes((await r.json()).data?.notes ?? []);
  }, [video.id]);

  useEffect(() => {
    void loadAssets();
    void loadNotes();
  }, [loadAssets, loadNotes]);

  const uploadsActive =
    uploads.some((u) => u.state === 'uploading') || uploadingCut !== null || uploadingThumb;
  useEffect(() => {
    if (!uploadsActive) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadsActive]);

  async function patchItem(payload: Record<string, unknown>) {
    const r = await fetch(`/api/projects/${video.projectId}/videos/${video.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error('Save failed');
    return r.json();
  }

  async function changeStatus(next: string) {
    setMovingStatus(true);
    const prev = status;
    setStatus(next);
    try {
      await patchItem({ status: next });
      router.refresh();
    } catch {
      setStatus(prev);
      toast.error('Could not change status');
    } finally {
      setMovingStatus(false);
    }
  }

  async function persistBrief(value: string) {
    if (value.trim() === lastSavedBrief.current.trim()) {
      setBriefState('idle');
      return;
    }
    setBriefState('saving');
    try {
      await patchItem({ brief: value.trim() || null });
      lastSavedBrief.current = value;
      setBriefState('saved');
      setTimeout(() => setBriefState((st) => (st === 'saved' ? 'idle' : st)), 2000);
    } catch {
      setBriefState('error');
    }
  }

  function onBriefChange(value: string) {
    setBrief(value);
    setBriefState('typing');
    if (briefTimer.current) clearTimeout(briefTimer.current);
    briefTimer.current = setTimeout(() => void persistBrief(value), 1200);
  }

  function onBriefBlur() {
    if (briefTimer.current) clearTimeout(briefTimer.current);
    void persistBrief(brief);
  }

  async function persistDescription(value: string) {
    if (value.trim() === lastSavedDesc.current.trim()) {
      setDescState('idle');
      return;
    }
    setDescState('saving');
    try {
      await patchItem({ description: value.trim() || null });
      lastSavedDesc.current = value;
      setDescState('saved');
      setTimeout(() => setDescState((st) => (st === 'saved' ? 'idle' : st)), 2000);
    } catch {
      setDescState('error');
    }
  }

  function onDescriptionChange(value: string) {
    setDescription(value);
    setDescState('typing');
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => void persistDescription(value), 1200);
  }

  function onDescriptionBlur() {
    if (descTimer.current) clearTimeout(descTimer.current);
    void persistDescription(description);
  }

  async function changeType(next: string) {
    const prev = videoType;
    setVideoType(next);
    try {
      await patchItem({ videoType: next });
    } catch {
      setVideoType(prev);
      toast.error('Could not change the type');
    }
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === title) {
      setEditingTitle(false);
      setTitleDraft(title);
      return;
    }
    setSavingTitle(true);
    try {
      await patchItem({ title: next });
      setTitle(next);
      setEditingTitle(false);
      router.refresh();
    } catch {
      toast.error('Could not rename the video');
    } finally {
      setSavingTitle(false);
    }
  }

  /** Push to YouTube — lands in the channel's YouTube Studio as a private draft. */
  async function pushToYouTube() {
    setPublishing(true);
    try {
      const r = await fetch(`/api/videos/${video.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'studio' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Push failed');
      toast.success('Pushed 📺 — it lands in YouTube Studio as a private draft');
      setPublishOpen(false);
      await loadNotes();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPublishing(false);
    }
  }

  /** BETA: push a POST item to LinkedIn (draft / scheduled / live) via Zernio. */
  async function pushToLinkedIn(mode: 'draft' | 'live') {
    setPublishing(true);
    try {
      const r = await fetch(`/api/videos/${video.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          ...(mode === 'draft' && scheduleFor
            ? { scheduledFor: new Date(scheduleFor).toISOString() }
            : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Push failed');
      const result = d.data;
      if (result.mode === 'live') {
        setStatus('PUBLISHED');
        toast.success('Posted to LinkedIn 📝');
      } else if (result.mode === 'scheduled') {
        toast.success('Scheduled in Zernio — confirm any @tags there');
      } else {
        toast.success('Drafted in Zernio — confirm @tags, then schedule or post');
      }
      setPublishOpen(false);
      setScheduleFor('');
      await loadNotes();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPublishing(false);
    }
  }

  async function putWithRetry(
    url: string,
    file: File,
    contentType: string,
    onPct: (pct: number) => void,
    attempts = 3
  ) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await putWithProgress(url, file, contentType, onPct);
        return;
      } catch (e) {
        lastErr = e;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('upload failed');
  }

  function putWithProgress(
    url: string,
    file: File,
    contentType: string,
    onPct: (pct: number) => void
  ) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error('storage rejected the file'));
      xhr.onerror = () => reject(new Error('network error'));
      xhr.send(file);
    });
  }

  /** Generic asset upload: any file type. Returns the created asset. */
  async function uploadAsset(file: File, onPct: (pct: number) => void): Promise<Asset> {
    const isVideo = file.type.startsWith('video/');
    if (isVideo) {
      const initRes = await fetch(`/api/videos/${video.id}/assets/r2-init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      if (!initRes.ok)
        throw new Error((await initRes.json())?.error?.message || 'upload init failed');
      const init = (await initRes.json()).data;
      await putWithRetry(init.presignedPutUrl, file, init.contentType || file.type, onPct);
      const fin = await fetch(`/api/videos/${video.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'R2_VIDEO',
          sourceUrl: init.proxyUrl,
          objectKey: init.objectKey,
          uploadToken: init.uploadToken,
          displayName: file.name,
        }),
      });
      if (!fin.ok) throw new Error('could not finish the upload');
      return (await fin.json()).data;
    }
    const initRes = await fetch(`/api/videos/${video.id}/assets/file-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
    });
    if (!initRes.ok)
      throw new Error((await initRes.json())?.error?.message || 'upload init failed');
    const init = (await initRes.json()).data;
    await putWithRetry(init.presignedPutUrl, file, init.contentType || file.type, onPct);
    const fin = await fetch(`/api/videos/${video.id}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'R2_FILE',
        objectKey: init.objectKey,
        displayName: file.name,
      }),
    });
    if (!fin.ok) throw new Error('could not finish the upload');
    return (await fin.json()).data;
  }

  async function uploadFootage(files: FileList | null) {
    if (!files || files.length === 0) return;
    let anySuccess = false;
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, pct: 0, state: 'uploading' }]);
      const update = (patch: Partial<{ pct: number; state: string }>) =>
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, ...patch } : x)));
      try {
        await uploadAsset(file, (pct) => update({ pct }));
        update({ pct: 100, state: 'done' });
        anySuccess = true;
      } catch (e) {
        update({ state: 'error' });
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
    await loadAssets();
    if (anySuccess && stageOf(status) === 'IDEA') {
      try {
        await patchItem({ status: 'EDITING' });
        setStatus('EDITING');
        toast.success('Footage received — moved to In edit');
      } catch {
        /* non-fatal */
      }
    }
    setTimeout(() => setUploads([]), 3000);
  }

  async function uploadThumbnail(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('The thumbnail needs to be an image');
      return;
    }
    setUploadingThumb(true);
    try {
      const asset = await uploadAsset(file, () => {});
      const url = `/api/videos/${video.id}/assets/${asset.id}/download?inline=1`;
      await patchItem({ thumbnailUrl: url });
      setThumbnailUrl(url);
      toast.success('Thumbnail saved');
      await loadAssets();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Thumbnail upload failed');
    } finally {
      setUploadingThumb(false);
    }
  }

  async function uploadCut(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      toast.error('A cut needs to be a video file');
      return;
    }
    setUploadingCut('0%');
    try {
      const initRes = await fetch(`/api/projects/${video.projectId}/videos/r2-init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }),
      });
      if (!initRes.ok)
        throw new Error((await initRes.json())?.error?.message || 'upload init failed');
      const init = (await initRes.json()).data;
      await putWithRetry(init.presignedPutUrl, file, init.contentType || file.type, (pct) =>
        setUploadingCut(`${pct}%`)
      );
      setUploadingCut('finishing…');
      const fin = await fetch(`/api/projects/${video.projectId}/videos/${video.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: init.proxyUrl,
          providerId: 'r2',
          objectKey: init.objectKey,
          uploadToken: init.uploadToken,
          setActive: true,
        }),
      });
      if (!fin.ok)
        throw new Error((await fin.json())?.error?.message || 'could not create the version');
      toast.success('New cut uploaded — moved to review');
      setStatus((s) =>
        ['IDEA', 'FILMED', 'EDITING'].includes(stageOf(s)) ||
        ['IDEA', 'EDITING'].includes(stageOf(s))
          ? 'REVIEW'
          : s
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cut upload failed');
    } finally {
      setUploadingCut(null);
    }
  }

  async function archiveVideo() {
    setArchiving(true);
    try {
      const r = await fetch(`/api/projects/${video.projectId}/videos/${video.id}/archive`, {
        method: 'POST',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Could not archive');
      toast.success(
        `Archived — ${d.data.assetsCleared} asset${d.data.assetsCleared === 1 ? '' : 's'} cleared` +
          (d.data.versionsCleared > 0
            ? `, ${d.data.versionsCleared} old cut file${d.data.versionsCleared === 1 ? '' : 's'} removed`
            : '')
      );
      setArchiveOpen(false);
      await loadAssets();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not archive');
    } finally {
      setArchiving(false);
    }
  }

  async function deleteVideo() {
    setDeleting(true);
    try {
      const r = await fetch(`/api/projects/${video.projectId}/videos/${video.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error((await r.json())?.error?.message || 'Could not delete');
      toast.success('Video deleted');
      router.push(`/workspaces/${workspaceId}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
      setDeleting(false);
    }
  }

  /** Auto-save the LinkedIn options (repost / link preview / first comment). */
  function changePostOpts(patch: Partial<PostOptions>) {
    const next = { ...postOpts, ...patch };
    setPostOpts(next);
    setPostOptsState('saving');
    if (postOptsTimer.current) clearTimeout(postOptsTimer.current);
    postOptsTimer.current = setTimeout(async () => {
      try {
        const payload = {
          repostUrl: next.repostUrl?.trim() || null,
          disableLinkPreview: next.disableLinkPreview === true,
          firstComment: next.firstComment?.trim() || null,
        };
        const empty = !payload.repostUrl && !payload.disableLinkPreview && !payload.firstComment;
        await patchItem({ postOptions: empty ? null : payload });
        setPostOptsState('saved');
        setTimeout(() => setPostOptsState((s) => (s === 'saved' ? 'idle' : s)), 2000);
      } catch {
        setPostOptsState('error');
      }
    }, 1200);
  }

  /** Mint the public review link and put it on the clipboard. */
  async function copyReviewLink() {
    try {
      const r = await fetch(`/api/videos/${video.id}/review-link`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Could not create the link');
      await navigator.clipboard.writeText(d.data.url);
      toast.success('Review link copied — send it to the client');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the link');
    }
  }

  /** Resolve a LinkedIn profile into @[Name](urn) and append it to the copy. */
  async function insertMention() {
    if (!mentionUrl.trim() || !mentionName.trim()) return;
    setInsertingMention(true);
    try {
      const r = await fetch(`/api/videos/${video.id}/mention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: mentionUrl.trim(), displayName: mentionName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Could not resolve the mention');
      const fmt = d.data.mentionFormat as string;
      const joined = description ? `${description.replace(/\s+$/, '')} ${fmt}` : fmt;
      onDescriptionChange(joined);
      setMentionUrl('');
      setMentionName('');
      toast.success('Mention added to the copy');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resolve the mention');
    } finally {
      setInsertingMention(false);
    }
  }

  /** Sequential download of every handoff asset (browser may ask once to allow multiple). */
  async function downloadAll() {
    for (let i = 0; i < assets.length; i++) {
      setDownloadingAll(`${i + 1}/${assets.length}…`);
      const a = document.createElement('a');
      a.href = `/api/videos/${video.id}/assets/${assets[i].id}/download`;
      a.download = assets[i].displayName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 900));
    }
    setDownloadingAll(null);
  }

  async function postNote() {
    const body = noteDraft.trim();
    if (!body) return;
    setPostingNote(true);
    try {
      const r = await fetch(`/api/videos/${video.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error((await r.json())?.error?.message || 'Could not post');
      setNoteDraft('');
      await loadNotes();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post the note');
    } finally {
      setPostingNote(false);
    }
  }

  const archiveEligible = canEdit && ['ARCHIVED', 'REJECTED'].includes(status);
  const isPost = videoType === 'POST';
  const approvable = ['IDEA', 'EDITING', 'REVIEW'].includes(stageOf(status));
  const [approving, setApproving] = useState(false);

  async function approve() {
    setApproving(true);
    try {
      const r = await fetch(`/api/videos/${video.id}/approve`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json())?.error?.message || 'Could not approve');
      setStatus('APPROVED');
      toast.success('Approved ✅');
      await loadNotes();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setApproving(false);
    }
  }

  const activeVersion = video.versions.find((v) => v.isActive) ?? video.versions[0];

  return (
    <div className="space-y-6">
      {/* YouTube-preview hero: thumbnail + full title */}
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="sm:w-[340px] flex-none">
          {canEdit && (
            <input
              ref={thumbInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void uploadThumbnail(e.target.files);
                e.target.value = '';
              }}
            />
          )}
          {thumbnailUrl ? (
            <div className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl.includes('?') ? thumbnailUrl : `${thumbnailUrl}?inline=1`}
                alt="Thumbnail"
                className="rounded-xl border w-full aspect-video object-cover"
              />
              {canEdit && (
                <button
                  className="absolute bottom-2 right-2 rounded-md bg-black/70 backdrop-blur px-2.5 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => thumbInput.current?.click()}
                  disabled={uploadingThumb}
                >
                  {uploadingThumb ? 'Uploading…' : 'Replace'}
                </button>
              )}
            </div>
          ) : (
            <button
              className="rounded-xl border border-dashed w-full aspect-video flex flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-white/25 transition-colors"
              onClick={() => canEdit && thumbInput.current?.click()}
              disabled={!canEdit || uploadingThumb}
            >
              {uploadingThumb ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {canEdit ? 'Upload thumbnail' : 'No thumbnail yet'}
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-center gap-2">
          {editingTitle ? (
            <div className="flex items-start gap-2">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') {
                    setEditingTitle(false);
                    setTitleDraft(title);
                  }
                }}
                maxLength={200}
                autoFocus
                className="flex-1 min-w-0 bg-transparent text-2xl font-bold tracking-tight border-b border-primary/50 focus:outline-none"
              />
              <Button size="sm" onClick={() => void saveTitle()} disabled={savingTitle}>
                {savingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight leading-snug break-words group">
              {title}
              {canEdit && (
                <button
                  className="ml-2 align-middle text-muted-foreground/50 hover:text-foreground text-base transition-colors"
                  title="Rename"
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                >
                  ✏️
                </button>
              )}
            </h1>
          )}
          <p className="text-sm text-muted-foreground font-mono">
            {typeMeta(videoType).emoji} {typeMeta(videoType).label}
            {' · '}
            {video.versions.length > 0
              ? `v${activeVersion?.versionNumber ?? video.versions.length}`
              : 'idea'}
          </p>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2">
        {approvable && (
          <Button
            size="sm"
            variant="outline"
            className="border-green-700/50 text-green-500 hover:bg-green-500/10 hover:text-green-400"
            onClick={() => void approve()}
            disabled={approving}
          >
            {approving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : '✅ '}
            Approve
          </Button>
        )}
        {canEdit && !isPost && publishReady && video.versions.length > 0 && (
          <Button size="sm" onClick={() => setPublishOpen(true)}>
            📺 Push to YouTube
          </Button>
        )}
        {canEdit && isPost && (
          <Button size="sm" variant="outline" onClick={() => void copyReviewLink()}>
            🔗 Review link
          </Button>
        )}
        {canEdit &&
          isPost &&
          linkedInReady &&
          ['APPROVED', 'PUBLISHED'].includes(stageOf(status)) && (
            <Button size="sm" onClick={() => setPublishOpen(true)}>
              💼 Push to LinkedIn
            </Button>
          )}
        <Select value={videoType} onValueChange={changeType} disabled={!canEdit}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIDEO_TYPES.filter((t) => t.key !== 'POST' || allowPosts || isPost).map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.emoji} {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stageOf(status)} onValueChange={changeStatus} disabled={!canEdit}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.emoji} {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {archiveEligible && (
          <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
            📦 Archive video
          </Button>
        )}
        {movingStatus && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <span className="flex-1" />
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            🗑️ Delete
          </Button>
        )}
      </div>

      {/* Cuts: watch, review, upload new (not for written posts) */}
      {!isPost && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Play className="h-4 w-4" />
                Cuts
              </span>
              {canEdit && (
                <>
                  <input
                    ref={cutInput}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      void uploadCut(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => cutInput.current?.click()}
                    disabled={uploadingCut !== null}
                  >
                    {uploadingCut !== null ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        {uploadingCut}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-1.5" />
                        Upload new cut
                      </>
                    )}
                  </Button>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {video.versions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No cuts yet — when the edit lands here it moves straight into review.
              </p>
            )}
            {video.versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 text-sm">
                <Film className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">
                  v{v.versionNumber}
                  {v.versionLabel ? ` — ${v.versionLabel}` : ''}
                </span>
                {v.id === activeVersion?.id && (
                  <span className="text-xs text-muted-foreground">current</span>
                )}
                <Button asChild size="sm" variant="outline" className="ml-auto h-7">
                  <Link href={`/projects/${video.projectId}/videos/${video.id}`}>
                    Watch & review
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Brief + description */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={brief}
            onChange={(e) => onBriefChange(e.target.value)}
            onBlur={onBriefBlur}
            placeholder="The angle, the hook, references — anything the shoot or the edit needs to know…"
            rows={5}
            maxLength={5000}
            disabled={!canEdit}
            className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:border-0 text-[15px] leading-relaxed resize-none placeholder:text-muted-foreground/50"
          />
          {canEdit && (
            <p className="text-xs text-muted-foreground min-h-[1rem]" aria-live="polite">
              {briefState === 'saving' && 'Saving…'}
              {briefState === 'saved' && '✓ Saved'}
              {briefState === 'error' && (
                <button className="underline" onClick={() => void persistBrief(brief)}>
                  Save failed — tap to retry
                </button>
              )}
            </p>
          )}

          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-1">{isPost ? 'Post copy' : 'Description'}</p>
            <Textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              onBlur={onDescriptionBlur}
              placeholder={
                isPost
                  ? 'The LinkedIn post — write it exactly as it should read, @tags included…'
                  : 'The YouTube description — written here, shipped with the video on publish…'
              }
              rows={5}
              maxLength={5000}
              disabled={!canEdit}
              className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:border-0 text-[15px] leading-relaxed resize-none placeholder:text-muted-foreground/50"
            />
            {canEdit && (
              <p className="text-xs text-muted-foreground min-h-[1rem]" aria-live="polite">
                {descState === 'saving' && 'Saving…'}
                {descState === 'saved' && '✓ Saved'}
                {descState === 'error' && (
                  <button
                    className="underline"
                    onClick={() => void persistDescription(description)}
                  >
                    Save failed — tap to retry
                  </button>
                )}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* LinkedIn options — posts only */}
      {isPost && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>💼 LinkedIn options</span>
              {canEdit && (
                <span className="text-xs font-normal text-muted-foreground" aria-live="polite">
                  {postOptsState === 'saving' && 'Saving…'}
                  {postOptsState === 'saved' && '✓ Saved'}
                  {postOptsState === 'error' && 'Save failed'}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">@mention</p>
              <p className="text-xs text-muted-foreground">
                Resolves the profile and drops a clickable tag into the copy. The display name must
                match their LinkedIn name exactly.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  placeholder="Profile or company URL"
                  value={mentionUrl}
                  onChange={(e) => setMentionUrl(e.target.value)}
                  disabled={!canEdit || insertingMention}
                  className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm"
                />
                <input
                  placeholder="Display name"
                  value={mentionName}
                  onChange={(e) => setMentionName(e.target.value)}
                  disabled={!canEdit || insertingMention}
                  className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void insertMention()}
                  disabled={
                    !canEdit || insertingMention || !mentionUrl.trim() || !mentionName.trim()
                  }
                >
                  {insertingMention ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Insert'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Repost a LinkedIn post</p>
              <input
                placeholder="Paste the post link — quote-reshares it (replaces any media)"
                value={postOpts.repostUrl ?? ''}
                onChange={(e) => changePostOpts({ repostUrl: e.target.value })}
                disabled={!canEdit}
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm"
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={postOpts.disableLinkPreview === true}
                onChange={(e) => changePostOpts({ disableLinkPreview: e.target.checked })}
                disabled={!canEdit}
                className="h-4 w-4 rounded border accent-current"
              />
              Disable link preview
            </label>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">First comment</p>
                <span className="text-xs text-muted-foreground font-mono">
                  {(postOpts.firstComment ?? '').length}/1250
                </span>
              </div>
              <Textarea
                placeholder="Posted automatically as the first comment — best place for external links (LinkedIn suppresses link posts)."
                value={postOpts.firstComment ?? ''}
                onChange={(e) => changePostOpts({ firstComment: e.target.value.slice(0, 1250) })}
                rows={3}
                maxLength={1250}
                disabled={!canEdit}
                className="text-sm"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footage handoff — any file type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Inbox className="h-4 w-4" />
              {isPost ? 'Media' : 'Footage handoff'}
            </span>
            <span className="flex items-center gap-2">
              {assets.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void downloadAll()}
                  disabled={downloadingAll !== null}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  {downloadingAll ?? 'Download all'}
                </Button>
              )}
              {canEdit && (
                <>
                  <input
                    ref={footageInput}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void uploadFootage(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <Button size="sm" onClick={() => footageInput.current?.click()}>
                    <Upload className="h-4 w-4 mr-1.5" />
                    Drop files
                  </Button>
                </>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isPost
              ? 'What goes out with the post: one video, up to 9 images (carousel), or a PDF (document post). Text-only is fine too.'
              : 'Raw footage, stills, audio, PDFs, project files — anything the edit needs, stored on this video. Up to 5GB per file.'}
          </p>
          {uploads.map((u) => (
            <div key={u.name} className="text-xs text-muted-foreground flex items-center gap-2">
              {u.state === 'uploading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : u.state === 'done' ? (
                '✓'
              ) : (
                '✕'
              )}
              <span className="truncate">{u.name}</span>
              {u.state === 'uploading' && <span>{u.pct}%</span>}
            </div>
          ))}
          {/* Posts: see the images as they'll appear, not just filenames */}
          {isPost && assets.some((a) => isImageAsset(a)) && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {assets
                .filter((a) => isImageAsset(a))
                .map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={a.id}
                    src={`/api/videos/${video.id}/assets/${a.id}/download?inline=1`}
                    alt={a.displayName}
                    title={a.displayName}
                    className="aspect-square w-full rounded-lg border object-cover"
                    loading="lazy"
                  />
                ))}
            </div>
          )}
          {!assetsLoaded ? (
            <p className="text-xs text-muted-foreground">Loading assets…</p>
          ) : assets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No source files yet.</p>
          ) : (
            <div className="rounded-lg border divide-y">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <KindIcon kind={a.kind} />
                  <span className="truncate flex-1 font-medium">{a.displayName}</span>
                  <span className="text-xs text-muted-foreground flex-none">
                    {fmtSize(a.sizeBytes)}
                  </span>
                  <span className="text-xs text-muted-foreground flex-none inline-flex items-center gap-1">
                    <UserIcon className="h-3 w-3" />
                    {a.uploadedByUser?.name || a.uploadedByGuestName || '—'}
                  </span>
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 flex-none">
                    <a href={`/api/videos/${video.id}/assets/${a.id}/download`}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes — item-level discussion (review comments live on the cuts) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">💬 Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Thoughts on the idea, references, direction — the conversation lives with the video.
            </p>
          ) : (
            <div className="space-y-4">
              {notes.map((n) => (
                <div key={n.id} className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold flex-none mt-0.5">
                    {(n.author?.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{n.author?.name || 'Someone'}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {new Date(n.createdAt).toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap mt-0.5">
                      {n.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border bg-white/[0.02] p-3 transition-colors focus-within:border-primary/40">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postNote();
              }}
              placeholder="Add a note…"
              rows={2}
              maxLength={4000}
              className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:border-0 resize-none text-sm min-h-0 placeholder:text-muted-foreground/50"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-muted-foreground font-mono">⌘↵ to post</span>
              <Button
                size="sm"
                className="h-7"
                variant={noteDraft.trim() ? 'default' : 'ghost'}
                onClick={postNote}
                disabled={postingNote || !noteDraft.trim()}
              >
                {postingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &quot;{video.title}&quot; — every cut, comment, asset and its
              files in storage. This can&apos;t be undone. To free storage but keep the record, use
              Archive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteVideo}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Delete video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={publishOpen} onOpenChange={(o) => !publishing && setPublishOpen(o)}>
        {isPost ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>💼 Push to LinkedIn</AlertDialogTitle>
              <AlertDialogDescription>
                The post copy goes out exactly as written. Media rides along automatically: one
                video, up to 9 images as a carousel, or a PDF as a document post. @tags are
                confirmed in the Zernio editor before it goes live.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">{description.trim() ? '✅' : '❌'}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Post copy</p>
                  {description.trim() ? (
                    <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                      {description}
                    </p>
                  ) : (
                    <Textarea
                      value={description}
                      onChange={(e) => onDescriptionChange(e.target.value)}
                      onBlur={onDescriptionBlur}
                      placeholder="Write the post here…"
                      rows={4}
                      maxLength={5000}
                      className="mt-1.5 text-sm"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">
                  {assets.some((a) => a.kind === 'VIDEO')
                    ? '🎥'
                    : assets.some((a) => isImageAsset(a))
                      ? '🖼️'
                      : assets.some((a) => /\.pdf$/i.test(a.displayName))
                        ? '📄'
                        : '✍️'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Media</p>
                  <p className="text-muted-foreground">
                    {assets.some((a) => a.kind === 'VIDEO')
                      ? 'Video post'
                      : assets.filter((a) => isImageAsset(a)).length > 0
                        ? `${Math.min(assets.filter((a) => isImageAsset(a)).length, 9)} image${assets.filter((a) => isImageAsset(a)).length === 1 ? '' : 's'}${assets.filter((a) => isImageAsset(a)).length > 1 ? ' (carousel)' : ''}`
                        : assets.some((a) => /\.pdf$/i.test(a.displayName))
                          ? 'Document post (PDF)'
                          : 'Text-only post'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">🗓️</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Schedule (optional)</p>
                  <input
                    type="datetime-local"
                    value={scheduleFor}
                    onChange={(e) => setScheduleFor(e.target.value)}
                    className="mt-1.5 rounded-md border bg-transparent px-2.5 py-1.5 text-sm [color-scheme:dark]"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Empty = parked as a Zernio draft to finish there.
                  </p>
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={publishing}>Cancel</AlertDialogCancel>
              <Button
                variant="outline"
                onClick={() => void pushToLinkedIn('draft')}
                disabled={publishing || !description.trim()}
              >
                {publishing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : '📤 '}
                {scheduleFor ? 'Schedule' : 'Draft in Zernio'}
              </Button>
              <Button
                onClick={() => void pushToLinkedIn('live')}
                disabled={publishing || !description.trim()}
              >
                {publishing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : '💼 '}
                Post now
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>📺 Push to YouTube</AlertDialogTitle>
              <AlertDialogDescription>
                The current cut lands in the channel&apos;s YouTube Studio as a private draft — set
                it live from Studio when ready. Three things need to be in first:
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">{title.trim() ? '✅' : '❌'}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Title</p>
                  <p className="text-muted-foreground truncate">
                    {title.trim() || 'Missing — rename the video first'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">{description.trim() ? '✅' : '❌'}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Description</p>
                  {description.trim() ? (
                    <p className="text-muted-foreground line-clamp-2">{description}</p>
                  ) : (
                    <Textarea
                      value={description}
                      onChange={(e) => onDescriptionChange(e.target.value)}
                      onBlur={onDescriptionBlur}
                      placeholder="Write the YouTube description here…"
                      rows={3}
                      maxLength={5000}
                      className="mt-1.5 text-sm"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="flex-none mt-0.5">{thumbnailUrl ? '✅' : '❌'}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Thumbnail</p>
                  {thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailUrl.includes('?') ? thumbnailUrl : `${thumbnailUrl}?inline=1`}
                      alt=""
                      className="mt-1.5 h-16 rounded-md border object-cover"
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5"
                      disabled={uploadingThumb}
                      onClick={() => thumbInput.current?.click()}
                    >
                      {uploadingThumb ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-1.5" />
                      )}
                      Upload thumbnail
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={publishing}>Cancel</AlertDialogCancel>
              <Button
                onClick={() => void pushToYouTube()}
                disabled={publishing || !title.trim() || !description.trim() || !thumbnailUrl}
              >
                {publishing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : '📺 '}
                Push to YouTube
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this video?</AlertDialogTitle>
            <AlertDialogDescription>
              Warning: this clears all assets for this video and all prior versions aside from the
              approved version. The thumbnail, the brief and the final cut with its comments remain.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={archiveVideo} disabled={archiving}>
              {archiving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Archive video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
