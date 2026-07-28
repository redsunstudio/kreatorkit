'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ReviewMarker } from '@/components/video-page/types';

interface UseReviewMarkersArgs {
  activeVersionId: string | null;
  /** Signed-in members can plant and remove markers; guests only read them. */
  canManage: boolean;
}

/**
 * Review markers for the active cut. Kept in its own hook (rather than folded into
 * the comments state) because markers are a separate object with a separate
 * lifecycle — they ship WITH the cut, comments come back on it.
 */
export function useReviewMarkers({ activeVersionId, canManage }: UseReviewMarkersArgs) {
  const [markers, setMarkers] = useState<ReviewMarker[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchMarkers = useCallback(async () => {
    if (!activeVersionId) {
      setMarkers([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/versions/${activeVersionId}/markers`);
      if (!res.ok) return;
      const data = await res.json();
      setMarkers(data?.data?.markers ?? []);
    } catch {
      // A marker strip that fails to load must never break the review page.
    } finally {
      setLoading(false);
    }
  }, [activeVersionId]);

  useEffect(() => {
    void fetchMarkers();
  }, [fetchMarkers]);

  const addMarker = useCallback(
    async (timestamp: number, label: string): Promise<boolean> => {
      if (!activeVersionId || !canManage) return false;
      const trimmed = label.trim();
      if (!trimmed) return false;

      setSaving(true);
      try {
        const res = await fetch(`/api/versions/${activeVersionId}/markers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp, label: trimmed }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error?.message || 'Could not add the marker');
        }
        const created: ReviewMarker | undefined = data?.data?.marker;
        if (created) {
          setMarkers((prev) => [...prev, created].sort((a, b) => a.timestamp - b.timestamp));
        }
        toast.success('Review marker added');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not add the marker');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [activeVersionId, canManage]
  );

  const deleteMarker = useCallback(
    async (markerId: string) => {
      if (!canManage) return;
      const previous = markers;
      setMarkers((prev) => prev.filter((m) => m.id !== markerId));
      try {
        const res = await fetch(`/api/markers/${markerId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
      } catch {
        setMarkers(previous);
        toast.error('Could not remove the marker');
      }
    },
    [canManage, markers]
  );

  return { markers, loading, saving, addMarker, deleteMarker, refreshMarkers: fetchMarkers };
}
