import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getPostReviewByToken, resolveReviewMedia } from '@/lib/post-review';
import { PostReviewActions } from '@/components/post-review-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

/** Copy with @[Name](urn:…) mentions rendered LinkedIn-blue. */
function renderCopy(text: string): ReactNode[] {
  return text.split(/(@\[[^\]]*\]\(urn:[^)]+\))/g).map((part, i) => {
    const m = part.match(/^@\[([^\]]*)\]\(urn:[^)]+\)$/);
    if (m) {
      return (
        <span key={i} className="text-[#0a66c2] font-semibold">
          @{m[1]}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default async function PostReviewPage({ params }: PageProps) {
  const { token } = await params;
  const ctx = await getPostReviewByToken(token);
  if (!ctx) notFound();
  // Video items keep their existing review player.
  if (ctx.video.videoType !== 'POST') {
    redirect(`/watch/${ctx.video.id}?shareToken=${token}`);
  }
  const { video, workspace } = ctx;
  const media = resolveReviewMedia(video);
  const options = (video.postOptions ?? {}) as { firstComment?: string; repostUrl?: string };
  const copy = video.description?.trim() || '';
  const initial = workspace.name.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-[#f4f2ee] text-neutral-900 px-3 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-[520px]">
        <p className="text-center text-xs text-neutral-500 mb-3 font-medium tracking-wide uppercase">
          Post preview — how it will look on LinkedIn
        </p>

        {/* The post card */}
        <div className="rounded-xl bg-white border border-neutral-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 pt-4">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold text-white flex-none"
              style={{ background: workspace.brandAccent || '#0a66c2' }}
            >
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight">{workspace.name}</p>
              <p className="text-xs text-neutral-500">Now · 🌐</p>
            </div>
          </div>

          {copy && (
            <p className="px-4 pt-3 pb-2 text-[15px] leading-relaxed whitespace-pre-wrap">
              {renderCopy(copy)}
            </p>
          )}

          {options.repostUrl && (
            <div className="mx-4 mb-3 rounded-lg border border-neutral-200 p-3 text-sm text-neutral-600">
              🔁 Quote-reshares:{' '}
              <span className="text-[#0a66c2] break-all">{options.repostUrl}</span>
            </div>
          )}

          {media.length > 0 && (
            <div className={media.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'}>
              {media.map((m) =>
                m.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.assetId}
                    src={`/api/p/${token}/media/${m.assetId}`}
                    alt=""
                    className="w-full object-cover max-h-[560px]"
                  />
                ) : m.kind === 'video' ? (
                  <video
                    key={m.assetId}
                    src={`/api/p/${token}/media/${m.assetId}`}
                    controls
                    playsInline
                    className="w-full max-h-[560px] bg-black"
                  />
                ) : (
                  <a
                    key={m.assetId}
                    href={`/api/p/${token}/media/${m.assetId}`}
                    className="flex items-center gap-3 m-4 rounded-lg border border-neutral-200 p-4 text-sm font-medium text-neutral-800"
                  >
                    📄 {m.name}
                    <span className="ml-auto text-xs text-neutral-500">Document post</span>
                  </a>
                )
              )}
            </div>
          )}

          <div className="flex items-center justify-around px-4 py-2.5 border-t border-neutral-100 text-[13px] text-neutral-500 font-medium">
            <span>👍 Like</span>
            <span>💬 Comment</span>
            <span>🔁 Repost</span>
            <span>➤ Send</span>
          </div>
        </div>

        {/* First comment, exactly as it will be posted */}
        {options.firstComment && (
          <div className="mt-3 rounded-xl bg-white border border-neutral-200 shadow-sm p-4">
            <div className="flex gap-3">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-none"
                style={{ background: workspace.brandAccent || '#0a66c2' }}
              >
                {initial}
              </div>
              <div className="min-w-0">
                <div className="rounded-xl bg-neutral-100 px-3 py-2">
                  <p className="text-[13px] font-semibold">{workspace.name}</p>
                  <p className="text-[14px] leading-snug whitespace-pre-wrap">
                    {renderCopy(options.firstComment)}
                  </p>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">
                  Posted automatically as the first comment
                </p>
              </div>
            </div>
          </div>
        )}

        <PostReviewActions token={token} initialStatus={video.status} />

        <p className="text-center text-[11px] text-neutral-400 mt-6">Reviewed with KreatorKit</p>
      </div>
    </div>
  );
}
