'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Link2, Loader2, Trash2, Download, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface DriveFile {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: string;
  uploaderName: string | null;
  linkLabel: string | null;
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

function formatBytes(raw: string): string {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function DriveClient({ workspaceId, isAdmin, items }: DriveClientProps) {
  const router = useRouter();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [links, setLinks] = useState<GrabLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [minting, setMinting] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [filesRes, linksRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/drive`),
        isAdmin
          ? fetch(`/api/workspaces/${workspaceId}/drive/links`)
          : Promise.resolve(null as unknown as Response),
      ]);
      if (filesRes.ok) setFiles((await filesRes.json())?.data?.files ?? []);
      if (linksRes?.ok) setLinks((await linksRes.json())?.data?.links ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const liveLinks = links.filter((l) => !l.revokedAt);

  return (
    <div className="space-y-8">
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
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Unsorted files</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Everything clients have sent. Assigning a file moves it onto that item — it leaves the
            drive.
          </p>
        </div>

        {loading ? (
          <div className="rounded-lg border px-4 py-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">Nothing waiting</p>
            <p className="text-xs text-muted-foreground mt-1">
              Files sent through a grab link land here until you sort them onto a video.
            </p>
          </div>
        ) : (
          <ul className="rounded-lg border divide-y overflow-hidden">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
    </div>
  );
}
