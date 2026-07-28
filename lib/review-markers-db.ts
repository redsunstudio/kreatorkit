import { db } from '@/lib/db';
import { MARKERS_PER_VERSION_MAX, markerDTO, type ReviewMarkerDTO } from '@/lib/review-markers';

export async function listMarkers(versionId: string): Promise<ReviewMarkerDTO[]> {
  const rows = await db.videoMarker.findMany({
    where: { versionId },
    orderBy: { timestamp: 'asc' },
    take: MARKERS_PER_VERSION_MAX,
    select: {
      id: true,
      timestamp: true,
      label: true,
      createdByName: true,
      createdAt: true,
    },
  });
  return rows.map(markerDTO);
}

export async function isVersionMarkerFull(versionId: string): Promise<boolean> {
  const count = await db.videoMarker.count({ where: { versionId } });
  return count >= MARKERS_PER_VERSION_MAX;
}
