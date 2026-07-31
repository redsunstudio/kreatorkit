'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { formatBytes } from '@/lib/format-bytes';

interface PublishedStorageActionsProps {
  projectId: string;
  videoId: string;
  totalBytes: string;
  storageClearedAt: string | null;
  canManage: boolean;
}

export function PublishedStorageActions({
  projectId,
  videoId,
  totalBytes,
  storageClearedAt,
  canManage,
}: PublishedStorageActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function freeUpSpace() {
    setClearing(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/videos/${videoId}/archive`, {
        method: 'POST',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message || 'Could not free up space');
      toast.success(
        `Space freed — ${d.data.assetsCleared} asset${d.data.assetsCleared === 1 ? '' : 's'} cleared` +
          (d.data.versionsCleared > 0
            ? `, ${d.data.versionsCleared} old cut file${d.data.versionsCleared === 1 ? '' : 's'} removed`
            : '')
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not free up space');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="hidden md:flex flex-col items-end gap-1 shrink-0 text-xs">
      <span className="text-muted-foreground font-mono">{formatBytes(totalBytes)}</span>
      {storageClearedAt ? (
        <span className="text-muted-foreground whitespace-nowrap">
          🧹 Space freed {new Date(storageClearedAt).toLocaleDateString()}
        </span>
      ) : canManage ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setOpen(true)}
        >
          🧹 Free up space
        </Button>
      ) : null}

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Free up storage for this video?</AlertDialogTitle>
            <AlertDialogDescription>
              Warning: this clears all assets for this video and all prior cuts aside from the kept
              version. The thumbnail, the brief and the final cut with its comments remain. The item
              stays in Published. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={freeUpSpace} disabled={clearing}>
              {clearing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Free up space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
