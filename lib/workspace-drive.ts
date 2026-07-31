import { randomBytes, randomUUID } from 'crypto';
import { db } from '@/lib/db';

/**
 * The workspace Drive — files a client dropped through a "content grab" link,
 * waiting to be sorted onto pipeline items.
 *
 * Two rules hold the design together:
 *  1. Drive objects live under the SAME `files/` prefix as item assets, so
 *     assigning one to a video is a row insert, never a byte copy.
 *  2. Assigning MOVES the file: the drive row is deleted and a VideoAsset takes
 *     ownership of the key. A file is therefore in exactly one place, which is
 *     what keeps "sort the inbox" honest.
 */

export const DRIVE_FILE_MAX_BYTES = BigInt(5 * 1024 * 1024 * 1024); // S3 single-object cap
export const DRIVE_LINK_LABEL_MAX = 80;
export const DRIVE_UPLOADER_NAME_MAX = 80;
/** Parts are 64MB client-side; 200 parts covers the 5GB cap with room to spare. */
export const DRIVE_MAX_PARTS = 200;
export const DRIVE_LINK_DEFAULT_TTL_DAYS = 30;

export function newUploadToken(): string {
  // 32 hex chars — same shape as the share-link tokens, unguessable, URL-safe.
  return randomBytes(16).toString('hex');
}

export function driveObjectKey(fileName: string): string {
  return `files/${randomUUID()}-${fileName}`;
}

/** Mirrors the item-asset sanitiser so both rails accept the same names. */
export function sanitizeDriveFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.\.+/g, '.');
  return base.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 160) || 'file';
}

export const DRIVE_OBJECT_KEY_RE = /^files\/[A-Za-z0-9-]{36}-[A-Za-z0-9._ ()-]{1,160}$/;

export interface DriveLinkStatus {
  ok: boolean;
  reason?: 'not_found' | 'revoked' | 'expired';
}

export function checkLinkUsable(link: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): DriveLinkStatus {
  if (link.revokedAt) return { ok: false, reason: 'revoked' };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

export async function findUsableLink(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const link = await db.workspaceUploadLink.findUnique({
    where: { token },
    include: {
      workspace: {
        select: { id: true, name: true, brandAccent: true, brandLogoUrl: true, ownerId: true },
      },
    },
  });
  return link;
}

export interface DriveFileDTO {
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

export function driveFileDTO(f: {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: bigint;
  uploaderName: string | null;
  createdAt: Date;
  link?: { label: string | null } | null;
  folder?: { id: string; name: string } | null;
}): DriveFileDTO {
  return {
    id: f.id,
    displayName: f.displayName,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes.toString(),
    uploaderName: f.uploaderName,
    linkLabel: f.link?.label ?? null,
    folderId: f.folder?.id ?? null,
    folderName: f.folder?.name ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

export const DRIVE_FOLDER_NAME_MAX = 120;

/** Same shape as sanitizeDriveFileName so both accept the same charset — a
 * folder auto-created from a dropped directory name goes through this too. */
export function sanitizeFolderName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').trim();
  const cleaned = base.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, DRIVE_FOLDER_NAME_MAX);
  return cleaned || 'Untitled folder';
}

export interface DriveFolderDTO {
  id: string;
  name: string;
  fileCount: number;
  createdAt: string;
}

export function driveFolderDTO(f: {
  id: string;
  name: string;
  createdAt: Date;
  _count: { uploads: number };
}): DriveFolderDTO {
  return {
    id: f.id,
    name: f.name,
    fileCount: f._count.uploads,
    createdAt: f.createdAt.toISOString(),
  };
}

/** Drive files carry a real content type, so kind can be derived properly. */
export function assetKindForContentType(
  contentType: string,
  displayName: string
): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' {
  if (contentType.startsWith('image/')) return 'IMAGE';
  if (contentType.startsWith('audio/')) return 'AUDIO';
  if (contentType.startsWith('video/')) return 'VIDEO';
  if (/\.(png|jpe?g|webp|gif)$/i.test(displayName)) return 'IMAGE';
  if (/\.(mp4|mov|m4v|webm|mkv)$/i.test(displayName)) return 'VIDEO';
  if (/\.(mp3|wav|m4a|aac|flac)$/i.test(displayName)) return 'AUDIO';
  return 'FILE';
}
