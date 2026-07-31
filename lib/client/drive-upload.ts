import {
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  uploadPartsWithProgress,
} from '@/lib/client/r2-video-upload';

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

interface UploadDriveFileOptions {
  initUrl: string;
  completeUrl: string;
  /** Merged into the /complete POST body alongside objectKey/uploadId/displayName. */
  completeExtra?: Record<string, unknown>;
  onProgress?: (pct: number) => void;
}

/**
 * Shared upload orchestration for the workspace Drive: presign (single PUT, or
 * 64MB multipart parts once a file crosses the threshold — a single stream to
 * the bucket region crawls) then finalize into a WorkspaceUpload row. Used by
 * both the public grab-link page and the signed-in team uploader so the two
 * upload rails don't drift into different implementations.
 */
export async function uploadDriveFile(
  file: File,
  { initUrl, completeUrl, completeExtra, onProgress }: UploadDriveFileOptions
): Promise<void> {
  const useMultipart = file.size > MULTIPART_THRESHOLD_BYTES;
  const partCount = useMultipart ? Math.ceil(file.size / MULTIPART_PART_BYTES) : undefined;

  const initRes = await fetch(initUrl, {
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
    await uploadPartsWithProgress(file, init.data.partUrls, (pct) => onProgress?.(pct));
  } else {
    await putWithProgress(init.data.presignedPutUrl, file, (pct) => onProgress?.(pct));
  }

  const completeRes = await fetch(completeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objectKey: init.data.objectKey,
      uploadId: init.data.uploadId ?? undefined,
      displayName: init.data.displayName,
      ...completeExtra,
    }),
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => null);
    throw new Error(err?.error?.message || 'Upload could not be saved');
  }
}
