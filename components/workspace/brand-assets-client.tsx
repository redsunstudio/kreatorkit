'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File as FileIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface BrandAsset {
  id: string;
  displayName: string;
  contentType: string | null;
  sizeBytes: string;
  uploadedBy: string | null;
  createdAt: string;
  isImage: boolean;
}

function fmtSize(b: string): string {
  const n = Number(b);
  if (!n) return '';
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

export function BrandAssetsClient({ workspaceId }: { workspaceId: string }) {
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploads, setUploads] = useState<{ name: string; pct: number; state: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/assets`);
      if (r.ok) {
        const d = (await r.json()).data;
        setAssets(d.assets);
        setCanManage(d.canManage);
      }
    } finally {
      setLoaded(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploads((u) => [...u, { name: file.name, pct: 0, state: 'uploading' }]);
      const update = (patch: Partial<{ pct: number; state: string }>) =>
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, ...patch } : x)));
      try {
        const initRes = await fetch(`/api/workspaces/${workspaceId}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            init: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
          }),
        });
        if (!initRes.ok)
          throw new Error((await initRes.json())?.error?.message || 'upload init failed');
        const init = (await initRes.json()).data;
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', init.presignedPutUrl);
          xhr.setRequestHeader('Content-Type', init.contentType || file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) update({ pct: Math.round((e.loaded / e.total) * 100) });
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error('storage rejected the file'));
          xhr.onerror = () => reject(new Error('network error'));
          xhr.send(file);
        });
        const fin = await fetch(`/api/workspaces/${workspaceId}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commit: { objectKey: init.objectKey, displayName: file.name } }),
        });
        if (!fin.ok) throw new Error('could not finish the upload');
        update({ pct: 100, state: 'done' });
      } catch (e) {
        update({ state: 'error' });
        toast.error(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
    await load();
    setTimeout(() => setUploads([]), 2500);
  }

  async function remove(asset: BrandAsset) {
    if (!window.confirm(`Delete "${asset.displayName}" from the brand library?`)) return;
    const r = await fetch(`/api/workspaces/${workspaceId}/assets/${asset.id}`, {
      method: 'DELETE',
    });
    if (r.ok) {
      toast.success('Deleted');
      await load();
    } else {
      toast.error('Could not delete');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Logos, fonts, brand kits, recurring imagery — always here, never cleared by video
          housekeeping. Up to 2GB per file.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
        <Button size="sm" onClick={() => input.current?.click()}>
          <Upload className="h-4 w-4 mr-1.5" />
          Upload
        </Button>
      </div>

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

      {!loaded ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing in the library yet — drop the brand kit in.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border bg-card overflow-hidden group transition-colors hover:border-white/20"
            >
              <div className="aspect-square bg-white/[0.03] flex items-center justify-center overflow-hidden">
                {a.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/workspaces/${workspaceId}/assets/${a.id}?inline=1`}
                    alt=""
                    className="w-full h-full object-contain p-3"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium truncate">{a.displayName}</p>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-mono">
                  <span>{fmtSize(a.sizeBytes)}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button asChild size="sm" variant="ghost" className="h-6 px-1.5">
                      <a href={`/api/workspaces/${workspaceId}/assets/${a.id}`}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 hover:text-destructive"
                        onClick={() => remove(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
