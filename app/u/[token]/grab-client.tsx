'use client';

import { useCallback, useRef, useState } from 'react';
import { Check, CloudUpload, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  uploadPartsWithProgress,
} from '@/lib/client/r2-video-upload';

interface GrabClientProps {
  token: string;
  workspaceName: string;
  accent: string | null;
  label: string | null;
}

type Row = {
  key: string;
  name: string;
  size: number;
  pct: number;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
};

const NAME_STORAGE_KEY = 'kk_grab_uploader_name';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

/**
 * The client-facing drop zone behind a content grab link. No account, no invite,
 * no item to pick — just "here is my name, here are the files". Big files go up
 * as 64MB parts, because a single stream to the bucket region crawls.
 */
export function GrabClient({ token, workspaceName, accent, label }: GrabClientProps) {
  const [uploaderName, setUploaderName] = useState('');
  const [nameLocked, setNameLocked] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Restore the name they gave last time — the same person usually sends more
  // than one batch, and retyping it is friction for zero benefit.
  const [restored, setRestored] = useState(false);
  if (!restored && typeof window !== 'undefined') {
    setRestored(true);
    const saved = window.localStorage.getItem(NAME_STORAGE_KEY);
    if (saved) {
      setUploaderName(saved);
      setNameLocked(true);
    }
  }

  const setRow = useCallback((key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, key: string, who: string) => {
      setRow(key, { state: 'uploading', pct: 0 });
      const useMultipart = file.size > MULTIPART_THRESHOLD_BYTES;
      const partCount = useMultipart ? Math.ceil(file.size / MULTIPART_PART_BYTES) : undefined;

      const initRes = await fetch(`/api/u/${token}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          ...(partCount ? { partCount } : {}),
        }),
      });
      const init = await initRes.json().catch(() => null);
      if (!initRes.ok) throw new Error(init?.error?.message || 'Could not start the upload');

      if (init.data.partUrls) {
        await uploadPartsWithProgress(file, init.data.partUrls, (pct) => setRow(key, { pct }));
      } else {
        await putWithProgress(init.data.presignedPutUrl, file, (pct) => setRow(key, { pct }));
      }

      const doneRes = await fetch(`/api/u/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: init.data.objectKey,
          uploadId: init.data.uploadId ?? undefined,
          displayName: init.data.displayName,
          uploaderName: who || undefined,
        }),
      });
      if (!doneRes.ok) {
        const err = await doneRes.json().catch(() => null);
        throw new Error(err?.error?.message || 'Upload could not be saved');
      }
      setRow(key, { state: 'done', pct: 100 });
    },
    [setRow, token]
  );

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return;
      const who = uploaderName.trim();
      if (who) window.localStorage.setItem(NAME_STORAGE_KEY, who);
      setNameLocked(!!who);

      const incoming = Array.from(list).map((file) => {
        seq.current += 1;
        return { file, key: `f${seq.current}` };
      });
      setRows((prev) => [
        ...prev,
        ...incoming.map(({ file, key }) => ({
          key,
          name: file.name,
          size: file.size,
          pct: 0,
          state: 'queued' as const,
        })),
      ]);

      // Sequential: a client on a domestic connection sending a shoot folder does
      // better with one file at full bandwidth than six fighting each other.
      for (const { file, key } of incoming) {
        try {
          await uploadOne(file, key, who);
        } catch (e) {
          setRow(key, {
            state: 'error',
            error: e instanceof Error ? e.message : 'Upload failed',
          });
        }
      }
    },
    [setRow, uploadOne, uploaderName]
  );

  const busy = rows.some((r) => r.state === 'uploading' || r.state === 'queued');
  const doneCount = rows.filter((r) => r.state === 'done').length;
  const accentStyle = accent ? ({ '--primary': accent } as React.CSSProperties) : undefined;

  return (
    <div className="min-h-screen px-4 py-10 flex justify-center" style={accentStyle}>
      <div className="w-full max-w-xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Send files to {workspaceName}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {label ? `${label} — drop` : 'Drop'} your footage, stills or documents below. No account
            needed.
          </p>
        </header>

        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="uploader-name">
            Your name
          </label>
          <div className="flex gap-2 mt-1">
            <Input
              id="uploader-name"
              value={uploaderName}
              onChange={(e) => {
                setUploaderName(e.target.value);
                setNameLocked(false);
              }}
              placeholder="So we know who sent these"
              maxLength={80}
            />
            {nameLocked && (
              <span className="inline-flex items-center text-xs text-muted-foreground px-2">
                <Check className="h-3.5 w-3.5 mr-1" /> saved
              </span>
            )}
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            'w-full rounded-2xl border-2 border-dashed px-6 py-14 flex flex-col items-center gap-2 transition-colors',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-white/15 hover:border-white/30 hover:bg-white/[0.02]'
          )}
        >
          <CloudUpload className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium">Drop files here, or click to choose</span>
          <span className="text-xs text-muted-foreground">Up to 5GB per file</span>
        </button>

        {rows.length > 0 && (
          <ul className="mt-5 space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="rounded-lg border px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  {r.state === 'done' ? (
                    <Check className="h-4 w-4 text-green-500 flex-none" />
                  ) : r.state === 'error' ? (
                    <X className="h-4 w-4 text-red-400 flex-none" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-none" />
                  )}
                  <span className="truncate flex-1 min-w-0">{r.name}</span>
                  <span className="text-xs text-muted-foreground font-mono flex-none">
                    {formatBytes(r.size)}
                  </span>
                </div>
                {r.state === 'uploading' && (
                  <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                )}
                {r.error && <p className="mt-1.5 text-xs text-red-400">{r.error}</p>}
              </li>
            ))}
          </ul>
        )}

        {doneCount > 0 && !busy && (
          <p className="mt-5 text-sm text-green-400">
            {doneCount} file{doneCount === 1 ? '' : 's'} sent. You can close this page, or add more.
          </p>
        )}
        {busy && (
          <p className="mt-5 text-xs text-muted-foreground">
            Keep this tab open until the uploads finish.
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          Add more files
        </Button>
      </div>
    </div>
  );
}
