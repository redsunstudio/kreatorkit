import { captureVideoThumbnail } from '@/lib/client/video-thumbnail';

export type R2VideoInitResponse = {
  presignedPutUrl: string | null;
  uploadId: string | null;
  partUrls: string[] | null;
  objectKey: string;
  proxyUrl: string;
  uploadToken: string;
  reservationId: string | null;
  contentType: string;
  thumbnailPresignedPutUrl: string;
  thumbnailObjectKey: string;
  thumbnailProxyUrl: string;
};

// Files above this size upload as parallel 64MB parts — a single PUT stream
// to the bucket's region measured ~5 Mbps on high-RTT connections.
const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;
const MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const MULTIPART_CONCURRENCY = 4;

export type R2VideoUploadResult = R2VideoInitResponse & {
  duration: number | null;
  thumbnailUrl: string | null;
};

type UploadProgressHandler = (progress: number) => void;

function uploadBytesWithProgress(
  url: string,
  body: Blob | File,
  contentType: string,
  onProgress?: UploadProgressHandler
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`Upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => {
      reject(
        new Error(
          'Network error during upload. If you use direct S3/R2 uploads, configure bucket CORS to allow PUT from this site origin.'
        )
      );
    };
    xhr.onabort = () => reject(new Error('Upload aborted'));

    xhr.send(body);
  });
}

async function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.onloadedmetadata = () => {
      const duration =
        Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration) : null;
      cleanup();
      resolve(duration);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = objectUrl;
  });
}

export async function initR2VideoUpload(
  projectId: string,
  file: File,
  partCount?: number
): Promise<R2VideoInitResponse> {
  const initRes = await fetch(`/api/projects/${projectId}/videos/r2-init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      ...(partCount && partCount > 1 ? { partCount } : {}),
    }),
  });

  const initPayload = (await initRes.json().catch(() => null)) as {
    data?: R2VideoInitResponse;
    error?: string;
  } | null;
  if (!initRes.ok || !initPayload?.data) {
    throw new Error(initPayload?.error || 'Failed to initialize video upload');
  }

  return initPayload.data;
}

export async function cleanupPendingR2VideoUpload(
  projectId: string,
  input: {
    objectKey: string;
    uploadToken: string;
    reservationId: string | null;
    thumbnailObjectKey?: string | null;
  },
  keepalive = false
): Promise<void> {
  try {
    await fetch(`/api/projects/${projectId}/videos/r2-init`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objectKey: input.objectKey,
        uploadToken: input.uploadToken,
        reservationId: input.reservationId,
        thumbnailObjectKey: input.thumbnailObjectKey ?? undefined,
      }),
      keepalive,
    });
  } catch (error) {
    console.error('Failed to cleanup pending R2 video upload:', error);
  }
}

async function uploadPartsWithProgress(
  file: File,
  partUrls: string[],
  onProgress?: UploadProgressHandler
): Promise<void> {
  const partCount = partUrls.length;
  const loadedByPart = new Array<number>(partCount).fill(0);
  const reportProgress = () => {
    if (!onProgress) return;
    const loaded = loadedByPart.reduce((a, b) => a + b, 0);
    onProgress(Math.min(100, Math.round((loaded / file.size) * 100)));
  };

  const uploadPart = (index: number, attempt = 0): Promise<void> =>
    new Promise((resolve, reject) => {
      const start = index * MULTIPART_PART_BYTES;
      const blob = file.slice(start, Math.min(start + MULTIPART_PART_BYTES, file.size));
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', partUrls[index]);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        loadedByPart[index] = event.loaded;
        reportProgress();
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          loadedByPart[index] = blob.size;
          reportProgress();
          resolve();
          return;
        }
        if (attempt < 2) {
          loadedByPart[index] = 0;
          resolve(uploadPart(index, attempt + 1));
          return;
        }
        reject(new Error(`Part ${index + 1} failed with status ${xhr.status}`));
      };
      xhr.onerror = () => {
        if (attempt < 2) {
          loadedByPart[index] = 0;
          resolve(uploadPart(index, attempt + 1));
          return;
        }
        reject(new Error(`Network error uploading part ${index + 1}`));
      };
      xhr.onabort = () => reject(new Error('Upload aborted'));
      xhr.send(blob);
    });

  let next = 0;
  const workers = Array.from(
    { length: Math.min(MULTIPART_CONCURRENCY, partCount) },
    async () => {
      while (next < partCount) {
        const index = next;
        next += 1;
        await uploadPart(index);
      }
    }
  );
  await Promise.all(workers);
}

export async function uploadVideoToR2(
  projectId: string,
  file: File,
  options?: { onProgress?: UploadProgressHandler }
): Promise<R2VideoUploadResult> {
  const useMultipart = file.size > MULTIPART_THRESHOLD_BYTES;
  const partCount = useMultipart ? Math.ceil(file.size / MULTIPART_PART_BYTES) : 0;
  const init = await initR2VideoUpload(projectId, file, useMultipart ? partCount : undefined);

  const cleanupInput = {
    objectKey: init.objectKey,
    uploadToken: init.uploadToken,
    reservationId: init.reservationId,
    thumbnailObjectKey: init.thumbnailObjectKey,
  };

  try {
    if (init.uploadId && init.partUrls && init.partUrls.length > 0) {
      await uploadPartsWithProgress(file, init.partUrls, options?.onProgress);
      const completeRes = await fetch(`/api/projects/${projectId}/videos/r2-init`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: init.objectKey,
          uploadId: init.uploadId,
          uploadToken: init.uploadToken,
        }),
      });
      if (!completeRes.ok) {
        const payload = (await completeRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to assemble the uploaded parts');
      }
    } else {
      if (!init.presignedPutUrl) {
        throw new Error('Upload initialization returned no destination URL');
      }
      await uploadBytesWithProgress(
        init.presignedPutUrl,
        file,
        init.contentType,
        options?.onProgress
      );
    }
  } catch (error) {
    await cleanupPendingR2VideoUpload(projectId, cleanupInput);
    throw error;
  }

  const [duration, thumbnailBlob] = await Promise.all([
    readVideoDuration(file),
    captureVideoThumbnail(file),
  ]);

  let thumbnailUrl: string | null = null;
  if (thumbnailBlob) {
    try {
      await uploadBytesWithProgress(init.thumbnailPresignedPutUrl, thumbnailBlob, 'image/jpeg');
      thumbnailUrl = init.thumbnailProxyUrl;
    } catch (error) {
      console.warn('Failed to upload video thumbnail:', error);
    }
  }

  return { ...init, duration, thumbnailUrl };
}
