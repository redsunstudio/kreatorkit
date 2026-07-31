'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Copy,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  Trash2,
  Download,
  Plus,
  Upload,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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
import { formatBytes } from '@/lib/format-bytes';
import { uploadDriveFile } from '@/lib/client/drive-upload';

interface DriveFile {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: string;
  uploaderName: string | null;
  linkLabel: string | null;
  folderId: string | null;
  folderName: string | null;
  createdAt: string;
}

interface DriveFolder {
  id: string;
  name: string;
  fileCount: number;
  createdAt: string;
}

interface GrabLink {
  id: string;
  label: string | null;
  url: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  uploadCount: number;
}

interface PipelineItem {
  id: string;
  title: string;
  status: string;
}

interface DriveClientProps {
  workspaceId: string;
  isAdmin: boolean;
  items: PipelineItem[];
}

type UploadRow = {
  key: string;
  name: string;
  pct: number;
  state: 'uploading' | 'done' | 'error';
  error?: string;
};

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function DriveCheckbox({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onToggle}
      onClick={(e) => e.stopPropagation()}
      className={cn('h-4 w-4 rounded border-input accent-primary cursor-pointer', className)}
    />
  );
}

export function DriveClient({ workspaceId, isAdmin, items }: DriveClientProps) {
  const router = useRouter();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [links, setLinks] = useState<GrabLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [minting, setMinting] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newVideoDialogOpen, setNewVideoDialogOpen] = useState(false);
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [creatingVideo, setCreatingVideo] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      // No typed React prop for these — directory picking is a non-standard
      // attribute set imperatively on the input element.
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const qs = currentFolderId ? `?folderId=${currentFolderId}` : '';
      const [filesRes, linksRes, foldersRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/drive${qs}`),
        isAdmin
          ? fetch(`/api/workspaces/${workspaceId}/drive/links`)
          : Promise.resolve(null as unknown as Response),
        fetch(`/api/workspaces/${workspaceId}/drive/folders`),
      ]);
      if (filesRes.ok) setFiles((await filesRes.json())?.data?.files ?? []);
      if (linksRes?.ok) setLinks((await linksRes.json())?.data?.links ?? []);
      if (foldersRes.ok) setFolders((await foldersRes.json())?.data?.folders ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isAdmin, currentFolderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Selections don't carry across a folder navigation — the New Video
    // action always targets what's visibly checked right now.
    setSelectedFileIds(new Set());
  }, [currentFolderId]);

  async function mintLink() {
    setMinting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/drive/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: linkLabel.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'Could not create the link');
      const link: GrabLink = data.data.link;
      setLinks((prev) => [link, ...prev]);
      await navigator.clipboard.writeText(link.url).catch(() => {});
      toast.success('Grab link created and copied — send it to the client');
      setLinkDialogOpen(false);
      setLinkLabel('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the link');
    } finally {
      setMinting(false);
    }
  }

  async function revokeLink(id: string) {
    const previous = links;
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, revokedAt: 'now' } : l)));
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/drive/links/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Link turned off');
    } catch {
      setLinks(previous);
      toast.error('Could not turn off the link');
    }
  }

  async function assign(fileId: string, videoId: string) {
    setBusyFileId(fileId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/drive/${fileId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'Could not move the file');
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      toast.success(`Moved onto “${data.data.videoTitle}”`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move the file');
    } finally {
      setBusyFileId(null);
    }
  }

  async function remove(fileId: string) {
    setBusyFileId(fileId);
    const previous = files;
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/drive/${fileId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
    } catch {
      setFiles(previous);
      toast.error('Could not delete the file');
    } finally {
      setBusyFileId(null);
    }
  }

  const setUploadRow = useCallback((key: string, patch: Partial<UploadRow>) => {
    setUploadRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const uploadFileList = useCallback(
    async (fileList: FileList | File[], folderId: string | null) => {
      const incoming = Array.from(fileList).map((file, i) => ({
        file,
        key: `u${i}_${file.name}_${file.size}`,
      }));
      setUploadRows((prev) => [
        ...prev,
        ...incoming.map(({ file, key }) => ({
          key,
          name: file.name,
          pct: 0,
          state: 'uploading' as const,
        })),
      ]);

      for (const { file, key } of incoming) {
        try {
          await uploadDriveFile(file, {
            initUrl: `/api/workspaces/${workspaceId}/drive/upload/init`,
            completeUrl: `/api/workspaces/${workspaceId}/drive/upload/complete`,
            completeExtra: folderId ? { folderId } : {},
            onProgress: (pct) => setUploadRow(key, { pct }),
          });
          setUploadRow(key, { state: 'done', pct: 100 });
        } catch (e) {
          setUploadRow(key, {
            state: 'error',
            error: e instanceof Error ? e.message : 'Upload failed',
          });
        }
      }

      await load();
      setTimeout(() => {
        setUploadRows((prev) => prev.filter((r) => r.state !== 'done'));
      }, 3000);
    },
    [workspaceId, setUploadRow, load]
  );

  async function handleFileUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    await uploadFileList(fileList, currentFolderId);
  }

  async function findOrCreateFolder(name: string): Promise<DriveFolder> {
    const res = await fetch(`/api/workspaces/${workspaceId}/drive/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || 'Could not create the folder');
    const folder: DriveFolder = data.data.folder;
    setFolders((prev) => (prev.some((f) => f.id === folder.id) ? prev : [folder, ...prev]));
    return folder;
  }

  async function handleFolderUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);

    // Flat folders only: any deeper nesting in the dropped tree collapses
    // into its first path segment (the directory the user actually picked).
    const groups = new Map<string, File[]>();
    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const top = rel.split('/')[0] || 'Untitled folder';
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top)!.push(file);
    }

    for (const [folderName, groupFiles] of groups) {
      try {
        const folder = await findOrCreateFolder(folderName);
        await uploadFileList(groupFiles, folder.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload folder "${folderName}"`);
      }
    }
  }

  async function createFolder() {
    setCreatingFolder(true);
    try {
      await findOrCreateFolder(newFolderName.trim());
      toast.success('Folder created');
      setNewFolderDialogOpen(false);
      setNewFolderName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the folder');
    } finally {
      setCreatingFolder(false);
    }
  }

  function toggleFileSelected(id: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolderSelected(id: string) {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createVideoFromSelection() {
    setCreatingVideo(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/drive/new-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newVideoTitle.trim(),
          fileIds: Array.from(selectedFileIds),
          folderIds: Array.from(selectedFolderIds),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'Could not create the video');
      toast.success(
        `Created “${data.data.videoTitle}” with ${data.data.assetsMoved} file${data.data.assetsMoved === 1 ? '' : 's'}`
      );
      setNewVideoDialogOpen(false);
      setNewVideoTitle('');
      setSelectedFileIds(new Set());
      setSelectedFolderIds(new Set());
      router.push(`/workspaces/${workspaceId}/videos/${data.data.videoId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the video');
    } finally {
      setCreatingVideo(false);
    }
  }

  const liveLinks = links.filter((l) => !l.revokedAt);
  const selectionCount = selectedFileIds.size + selectedFolderIds.size;
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null;

  return (
    <div className="space-y-8 pb-16">
      {isAdmin && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-lg font-semibold">Content grab links</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send one to a client and they can drop files straight in — no account, no invite.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setLinkDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New link
            </Button>
          </div>

          {liveLinks.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm font-medium">No active grab link</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create one, paste it into an email, and whatever they send lands here.
              </p>
            </div>
          ) : (
            <ul className="rounded-lg border divide-y overflow-hidden">
              {liveLinks.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link2 className="h-4 w-4 text-muted-foreground flex-none" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{l.label || 'Grab link'}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{l.url}</p>
                  </div>
                  <span className="hidden sm:inline text-xs text-muted-foreground font-mono flex-none">
                    {l.uploadCount} file{l.uploadCount === 1 ? '' : 's'}
                  </span>
                  <span className="hidden md:inline text-xs text-muted-foreground flex-none">
                    {l.expiresAt ? `expires ${DAY_FMT.format(new Date(l.expiresAt))}` : 'no expiry'}
                  </span>
                  <button
                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-none"
                    onClick={async () => {
                      await navigator.clipboard.writeText(l.url);
                      setCopiedId(l.id);
                      setTimeout(() => setCopiedId(null), 1500);
                    }}
                  >
                    {copiedId === l.id ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copiedId === l.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors flex-none"
                    title="Turn this link off"
                    onClick={() => void revokeLink(l.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div>
            {currentFolder ? (
              <button
                className="inline-flex items-center gap-1.5 text-lg font-semibold hover:text-primary transition-colors"
                onClick={() => setCurrentFolderId(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                {currentFolder.name}
              </button>
            ) : (
              <h2 className="text-lg font-semibold">Drive</h2>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              Everything waiting to be sorted. Assigning a file moves it onto that item — it leaves
              the drive.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFileUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFolderUpload(e.target.files);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="outline" onClick={() => setNewFolderDialogOpen(true)}>
              <FolderPlus className="h-4 w-4 mr-1.5" />
              New folder
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload files
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderInputRef.current?.click()}>
              <UploadCloud className="h-4 w-4 mr-1.5" />
              Upload folder
            </Button>
          </div>
        </div>

        {uploadRows.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {uploadRows.map((r) => (
              <li key={r.key} className="rounded-md border px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  {r.state === 'done' ? (
                    <Check className="h-3.5 w-3.5 text-green-500 flex-none" />
                  ) : r.state === 'error' ? (
                    <Trash2 className="h-3.5 w-3.5 text-red-400 flex-none" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-none" />
                  )}
                  <span className="truncate flex-1 min-w-0">{r.name}</span>
                  <span className="text-muted-foreground flex-none">{r.pct}%</span>
                </div>
                {r.error && <p className="mt-1 text-red-400">{r.error}</p>}
              </li>
            ))}
          </ul>
        )}

        {!currentFolder && folders.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-accent/40 transition-colors"
              >
                <DriveCheckbox
                  checked={selectedFolderIds.has(folder.id)}
                  onToggle={() => toggleFolderSelected(folder.id)}
                />
                <button
                  className="inline-flex items-center gap-1.5 text-sm"
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  {folder.name}
                  <span className="text-xs text-muted-foreground">({folder.fileCount})</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border px-4 py-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">Nothing here</p>
            <p className="text-xs text-muted-foreground mt-1">
              Files sent through a grab link or uploaded directly land here until sorted onto a
              video.
            </p>
          </div>
        ) : (
          <ul className="rounded-lg border divide-y overflow-hidden">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <DriveCheckbox
                  checked={selectedFileIds.has(f.id)}
                  onToggle={() => toggleFileSelected(f.id)}
                  className="flex-none"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{f.displayName}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {formatBytes(f.sizeBytes)}
                    {f.uploaderName ? ` · ${f.uploaderName}` : ''}
                    {f.linkLabel ? ` · ${f.linkLabel}` : ''} ·{' '}
                    {DAY_FMT.format(new Date(f.createdAt))}
                  </p>
                </div>

                <Select
                  disabled={busyFileId === f.id || items.length === 0}
                  onValueChange={(videoId) => void assign(f.id, videoId)}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs flex-none">
                    <SelectValue placeholder={items.length ? 'Assign to item…' : 'No items yet'} />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id} className="text-xs">
                        {it.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <a
                  href={`/api/workspaces/${workspaceId}/drive/${f.id}`}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-none"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-accent transition-colors flex-none"
                  title="Delete this file"
                  disabled={busyFileId === f.id}
                  onClick={() => void remove(f.id)}
                >
                  {busyFileId === f.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectionCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border bg-card shadow-lg px-4 py-2.5">
          <span className="text-sm font-medium">{selectionCount} selected</span>
          <Button size="sm" onClick={() => setNewVideoDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Video
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedFileIds(new Set());
              setSelectedFolderIds(new Set());
            }}
          >
            Clear
          </Button>
        </div>
      )}

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New content grab link</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void mintLink();
              }}
              maxLength={80}
              placeholder="What is it for? e.g. “March shoot”"
            />
            <p className="text-xs text-muted-foreground">
              Anyone with the link can upload — so it expires in 30 days by default. The label is
              shown to them and tags whatever they send.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)} disabled={minting}>
              Cancel
            </Button>
            <Button onClick={() => void mintLink()} disabled={minting}>
              {minting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Create &amp; copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFolder();
            }}
            maxLength={120}
            placeholder="e.g. “March shoot”"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewFolderDialogOpen(false)}
              disabled={creatingFolder}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createFolder()}
              disabled={creatingFolder || !newFolderName.trim()}
            >
              {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newVideoDialogOpen} onOpenChange={setNewVideoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New video from {selectionCount} selected</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={newVideoTitle}
              onChange={(e) => setNewVideoTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createVideoFromSelection();
              }}
              maxLength={200}
              placeholder="Video title"
            />
            <p className="text-xs text-muted-foreground">
              Creates a new item in the pipeline at “In edit” with the selected files (and any
              folder contents) attached — they leave the drive.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewVideoDialogOpen(false)}
              disabled={creatingVideo}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void createVideoFromSelection()}
              disabled={creatingVideo || !newVideoTitle.trim()}
            >
              {creatingVideo ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Create video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
