// Zernio (Late) REST client — the publish rail out of KreatorKit.
// Auth: ZERNIO_API_KEY env (Bearer). Media flow: presign -> PUT bytes -> use publicUrl.

const ZERNIO_BASE = 'https://zernio.com/api/v1';

// Files at or under this size are buffered in memory for the copy to Zernio's
// store; larger files stream. Buffering avoids chunked-encoding rejections on
// the presigned PUT, so it is the default path for typical cuts.
const BUFFER_LIMIT_BYTES = 256 * 1024 * 1024;

export function isZernioConfigured(): boolean {
  return Boolean(process.env.ZERNIO_API_KEY);
}

async function zernioFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error('ZERNIO_API_KEY is not set');
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new Error(`Zernio ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Copy a file from a (presigned) source URL into Zernio's media store. Returns the public URL. */
export async function zernioUploadFromUrl(
  sourceUrl: string,
  filename: string,
  contentType: string,
  sizeBytes?: number
): Promise<string> {
  const presign = await zernioFetch('/media/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  });
  const nested = (presign.data ?? {}) as Record<string, unknown>;
  const uploadUrl = (presign.uploadUrl ?? nested.uploadUrl) as string | undefined;
  const publicUrl = (presign.publicUrl ?? nested.publicUrl) as string | undefined;
  if (!uploadUrl || !publicUrl) throw new Error('Zernio presign returned no upload URL');

  const src = await fetch(sourceUrl);
  if (!src.ok || !src.body) throw new Error(`could not read the source file (${src.status})`);

  const headers: Record<string, string> = { 'Content-Type': contentType };
  let body: BodyInit;
  if (sizeBytes !== undefined && sizeBytes > 0 && sizeBytes <= BUFFER_LIMIT_BYTES) {
    body = Buffer.from(await src.arrayBuffer());
  } else {
    if (sizeBytes) headers['Content-Length'] = String(sizeBytes);
    body = src.body as unknown as BodyInit;
  }
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body,
    // @ts-expect-error duplex is required by undici for streaming request bodies
    duplex: 'half',
  });
  if (!put.ok) throw new Error(`Zernio media upload failed (${put.status})`);
  return publicUrl;
}

export interface ZernioMediaItem {
  type: 'video' | 'image';
  url: string;
  thumbnail?: string;
}

export interface ZernioPlatformTarget {
  platform: string;
  accountId: string;
  platformSpecificData?: Record<string, unknown>;
}

export async function zernioCreatePost(payload: {
  content: string;
  mediaItems: ZernioMediaItem[];
  platforms: ZernioPlatformTarget[];
  isDraft?: boolean;
  publishNow?: boolean;
}): Promise<{ postId: string | null; raw: Record<string, unknown> }> {
  const raw = await zernioFetch('/posts', { method: 'POST', body: JSON.stringify(payload) });
  const nested = (raw.post ?? raw.data ?? raw) as Record<string, unknown>;
  const postId =
    typeof nested._id === 'string' ? nested._id : typeof nested.id === 'string' ? nested.id : null;
  return { postId, raw };
}
