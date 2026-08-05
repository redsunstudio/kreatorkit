import { timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';
import { isAgentRequest } from '@/lib/agent-auth';

/**
 * Transcode worker access.
 *
 * The worker only ever needs to claim a job, read one cut and write one proxy,
 * so it gets its own key (TRANSCODE_API_KEY, X-Worker-Key header) rather than
 * the admin-equivalent agent key. That means a worker can run anywhere — the
 * Railway service, John's GPU box — without handing it the keys to the platform.
 * The agent key is still accepted so automation can drive the queue directly.
 */
export function isTranscodeWorkerRequest(request: NextRequest): boolean {
  const configured = process.env.TRANSCODE_API_KEY;
  const provided = request.headers.get('x-worker-key');
  if (configured && provided) {
    const a = Buffer.from(configured);
    const b = Buffer.from(provided);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return isAgentRequest(request);
}
