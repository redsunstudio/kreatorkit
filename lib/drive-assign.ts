import { VideoAssetProvider, VideoType } from '@prisma/client';
import { db } from '@/lib/db';
import { assetKindForContentType } from '@/lib/workspace-drive';
import { findOrCreateDefaultProject } from '@/lib/workspace-video';

/** Matches the existing drive list cap (`take: 500`) — keeps the batch
 * transaction bounded rather than risking a long-running one on a huge
 * selection. */
export const DRIVE_NEW_VIDEO_MAX_FILES = 500;

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

export type CreateVideoFromDriveSelectionResult =
  | { ok: true; videoId: string; videoTitle: string; assetsMoved: number }
  | { ok: false; reason: 'workspace_not_found' | 'no_files' | 'too_many_files' };

/**
 * Turn a batch of Drive selections (loose files and/or whole folders) straight
 * into a new pipeline item — the multi-select "New Video" action. Same
 * move-not-copy invariant as `assignDriveFileToVideo`, just batched: every
 * selected file becomes a VideoAsset on the new item and its WorkspaceUpload
 * row is deleted, all in one transaction so a mid-way failure can't strand
 * bytes with no owner or leave the same file listed twice.
 */
export async function createVideoFromDriveSelection(
  workspaceId: string,
  input: { title: string; videoType?: VideoType; fileIds?: string[]; folderIds?: string[] },
  actor: { userId?: string | null; name?: string | null }
): Promise<CreateVideoFromDriveSelectionResult> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true },
  });
  if (!workspace) return { ok: false, reason: 'workspace_not_found' };

  const fileIds = Array.from(new Set(input.fileIds ?? []));
  const folderIds = Array.from(new Set(input.folderIds ?? []));

  const fileSelect = {
    id: true,
    objectKey: true,
    displayName: true,
    contentType: true,
    sizeBytes: true,
    uploaderName: true,
  } as const;

  // Every id is re-verified against THIS workspace here — a hand-crafted
  // request naming another workspace's file/folder id simply resolves to
  // nothing, same guard `assignDriveFileToVideo` applies to videoId.
  const [directFiles, folderFiles] = await Promise.all([
    fileIds.length
      ? db.workspaceUpload.findMany({
          where: { id: { in: fileIds }, workspaceId },
          select: fileSelect,
        })
      : Promise.resolve([]),
    folderIds.length
      ? db.workspaceUpload.findMany({
          where: { folderId: { in: folderIds }, workspaceId },
          select: fileSelect,
        })
      : Promise.resolve([]),
  ]);

  const byId = new Map<string, (typeof directFiles)[number]>();
  for (const f of [...directFiles, ...folderFiles]) byId.set(f.id, f);
  const files = Array.from(byId.values());

  if (files.length === 0) return { ok: false, reason: 'no_files' };
  if (files.length > DRIVE_NEW_VIDEO_MAX_FILES) return { ok: false, reason: 'too_many_files' };

  const project = await findOrCreateDefaultProject(workspaceId, workspace.ownerId);
  const last = await db.video.findFirst({
    where: { projectId: project.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const video = await db.$transaction(async (tx) => {
    const created = await tx.video.create({
      data: {
        title: input.title,
        // Footage-implies-editing: same convention as the per-item Footage
        // handoff panel, which auto-flips IDEA -> EDITING once files land.
        // Here the files exist at creation time, so skip IDEA entirely.
        status: 'EDITING',
        videoType: input.videoType ?? 'LONGFORM',
        projectId: project.id,
        position: (last?.position ?? -1) + 1,
      },
      select: { id: true, title: true },
    });

    await tx.videoAsset.createMany({
      data: files.map((f) => ({
        videoId: created.id,
        kind: assetKindForContentType(f.contentType, f.displayName),
        provider: VideoAssetProvider.R2_FILE,
        displayName: f.displayName,
        sourceUrl: f.objectKey,
        sizeBytes: f.sizeBytes,
        uploadedByUserId: actor.userId ?? null,
        uploadedByGuestName: actor.userId ? null : (f.uploaderName ?? actor.name ?? null),
        billedUserId: workspace.ownerId,
      })),
    });

    await tx.workspaceUpload.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });

    return created;
  });

  return { ok: true, videoId: video.id, videoTitle: video.title, assetsMoved: files.length };
}
