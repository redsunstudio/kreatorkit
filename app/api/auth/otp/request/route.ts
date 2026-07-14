import { NextRequest } from 'next/server';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { rateLimit } from '@/lib/rate-limit';
import { requestLoginCode } from '@/lib/otp';
import { logError } from '@/lib/logger';

// POST { email } — email a one-time sign-in code.
// Always answers ok so account existence can't be probed.
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(request, 'login');
    if (limited) return limited;
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email : '';
    if (!email) return apiErrors.badRequest('email is required');
    await requestLoginCode(email);
    return withCacheControl(successResponse({ ok: true }), 'private, no-store');
  } catch (error) {
    logError('otp request failed:', error);
    return withCacheControl(successResponse({ ok: true }), 'private, no-store');
  }
}
