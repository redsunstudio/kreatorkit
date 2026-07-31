/**
 * Grabs the currently-decoded frame of a live `<video>` element at native
 * resolution. `drawImage` never throws on a cross-origin/tainted source —
 * the SecurityError only fires synchronously from `toBlob()`, so callers
 * must wrap the awaited promise in a try/catch, not just this call.
 */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width <= 0 || height <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
