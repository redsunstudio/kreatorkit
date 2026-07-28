import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/logger';
import { checkLinkUsable, findUsableLink } from '@/lib/workspace-drive';

type RouteParams = { params: Promise<{ token: string }> };

// GET /api/u/[token]
// Public: just enough for the grab page to render — who is asking and how it is
// branded. Deliberately no file list: an upload link is a letterbox, not a window
// into the workspace.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'drive-link-read');
    if (limited) return limited;

    const { token } = await params;
    const link = await findUsableLink(token);
    if (!link) return apiErrors.notFound('Link');

    const usable = checkLinkUsable(link);

    const response = successResponse({
      ok: usable.ok,
      reason: usable.reason ?? null,
      label: link.label,
      workspace: {
        name: link.workspace.name,
        brandAccent: link.workspace.brandAccent,
        brandLogoUrl: link.workspace.brandLogoUrl,
      },
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Failed to read an upload link:', error);
    return apiErrors.internalError('Failed to load the upload link');
  }
}
