import { VideoAssetProvider } from '@prisma/client';
import { db } from '@/lib/db';
import { assetKindForContentType } from '@/lib/workspace-drive';

export type AssignResult =
  | { ok: true; assetId: string; videoTitle: string }
  | { ok: false; reason: 'file_not_found' | 'video_not_found' };

/**
 * Sort a Drive file onto a pipeline item.
 *
 * This MOVES the file: the drive row goes away and a VideoAsset takes over the
 * same `files/` key. No bytes are copied and no object is duplicated, so a file
 * is only ever in one place — the drive (unsorted) or an item (sorted).
 *
 * Both writes run in one transaction: a half-move would either strand bytes with
 * no owner or show the same file twice.
 */
export async function assignDriveFileToVideo(
  workspaceId: string,
  uploadId: string,
  videoId: string,
  actor: { userId?: string | null; name?: string | null }
): Promise<AssignResult> {
  const file = await db.workspaceUpload.findFirst({
    where: { id: uploadId, workspaceId },
    select: {
      id: true,
      objectKey: true,
      displayName: true,
      contentType: true,
      sizeBytes: true,
      uploaderName: true,
    },
  });
  if (!file) return { ok: false, reason: 'file_not_found' };

  // The item must live in THIS workspace — otherwise a drive file could be
  // pushed into another client's pipeline by id.
  const video = await db.video.findFirst({
    where: { id: videoId, project: { workspaceId } },
    select: {
      id: true,
      title: true,
      project: { select: { workspace: { select: { ownerId: true } } } },
    },
  });
  if (!video) return { ok: false, reason: 'video_not_found' };

  const asset = await db.$transaction(async (tx) => {
    const created = await tx.videoAsset.create({
      data: {
        videoId: video.id,
        kind: assetKindForContentType(file.contentType, file.displayName),
        provider: VideoAssetProvider.R2_FILE,
        displayName: file.displayName,
        // R2_FILE assets store the object key as the retrieval handle.
        sourceUrl: file.objectKey,
        sizeBytes: file.sizeBytes,
        uploadedByUserId: actor.userId ?? null,
        uploadedByGuestName: actor.userId ? null : (file.uploaderName ?? actor.name ?? null),
        billedUserId: video.project.workspace.ownerId,
      },
      select: { id: true },
    });
    await tx.workspaceUpload.delete({ where: { id: file.id } });
    return created;
  });

  return { ok: true, assetId: asset.id, videoTitle: video.title };
}
