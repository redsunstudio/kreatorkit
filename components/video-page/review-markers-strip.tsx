'use client';

import { useState } from 'react';
import { Flag, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MARKER_LABEL_MAX } from '@/lib/review-markers';
import type { ReviewMarker } from '@/components/video-page/types';

interface ReviewMarkersStripProps {
  markers: ReviewMarker[];
  canManage: boolean;
  saving: boolean;
  /** Seconds captured when the add button was pressed. */
  pendingTimestamp: number | null;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** Fullscreen hides the rail but MUST keep the dialog mounted — the player's
   *  "Mark" button lives in the fullscreen chrome too. */
  hideList?: boolean;
  formatTime: (seconds: number) => string;
  onSeek: (timestamp: number) => void;
  onAdd: (timestamp: number, label: string) => Promise<boolean>;
  onDelete: (markerId: string) => void;
}

/**
 * The review-points rail under the player: every orange marker on the timeline,
 * listed in order so a client can work through them without hunting for 3px flags.
 * Renders nothing when a cut has no markers and the viewer cannot add any.
 */
export function ReviewMarkersStrip({
  markers,
  canManage,
  saving,
  pendingTimestamp,
  dialogOpen,
  setDialogOpen,
  hideList = false,
  formatTime,
  onSeek,
  onAdd,
  onDelete,
}: ReviewMarkersStripProps) {
  const [label, setLabel] = useState('');

  // Clear the draft each time the dialog opens, adjusting state during render
  // rather than in an effect (same pattern as ThumbnailImage — no cascading render).
  const [wasOpen, setWasOpen] = useState(dialogOpen);
  if (dialogOpen !== wasOpen) {
    setWasOpen(dialogOpen);
    if (dialogOpen) setLabel('');
  }

  const submit = async () => {
    if (pendingTimestamp === null || !label.trim()) return;
    const ok = await onAdd(pendingTimestamp, label);
    if (ok) setDialogOpen(false);
  };

  return (
    <>
      {!hideList && markers.length > 0 && (
        // shrink-0: the rail is a sibling of the flex-1 video viewport, so
        // without this it wins the fight for space and squeezes the player.
        <div className="shrink-0 px-3 py-2 border-t bg-background/60">
          <div className="flex items-center gap-2 mb-1.5">
            <Flag className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs font-semibold">Review points</span>
            <span className="text-xs text-muted-foreground font-mono">{markers.length}</span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              — flagged for you to check
            </span>
            <span className="sm:hidden text-xs text-muted-foreground">— swipe</span>
          </div>
          {/*
            On a phone every chip claimed its own row, so a cut with a dozen
            review points grew a rail taller than the screen and collapsed the
            video to nothing. Mobile gets ONE row that scrolls sideways;
            wrapping returns at sm: where there is width for it.
          */}
          <ul className="flex flex-nowrap overflow-x-auto snap-x snap-mandatory gap-1.5 -mx-3 px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible sm:mx-0 sm:px-0 sm:pb-0 sm:snap-none">
            {markers.map((marker) => (
              <li key={marker.id} className="flex items-center shrink-0 snap-start sm:shrink">
                <button
                  onClick={() => onSeek(marker.timestamp)}
                  className="inline-flex items-center gap-1.5 h-7 rounded-md border border-orange-500/30 bg-orange-500/10 pl-2 pr-2 text-xs text-orange-200 hover:bg-orange-500/20 transition-colors max-w-[280px]"
                  title={marker.createdByName ? `Added by ${marker.createdByName}` : 'Review point'}
                >
                  <span className="font-mono text-orange-400 shrink-0">
                    {formatTime(marker.timestamp)}
                  </span>
                  <span className="truncate">{marker.label}</span>
                </button>
                {canManage && (
                  <button
                    onClick={() => onDelete(marker.id)}
                    className="ml-0.5 h-7 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Remove this review point"
                    aria-label={`Remove review point at ${formatTime(marker.timestamp)}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              🟠 Flag{' '}
              <span className="font-mono">
                {pendingTimestamp !== null ? formatTime(pendingTimestamp) : ''}
              </span>{' '}
              for review
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              maxLength={MARKER_LABEL_MAX}
              placeholder="What should they look at? e.g. “New lower third — happy with the wording?”"
            />
            <p className="text-xs text-muted-foreground">
              The client sees an orange marker here on the timeline. Use it to point at a graphic, a
              quote card or a take you are unsure about.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving || !label.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Add marker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
