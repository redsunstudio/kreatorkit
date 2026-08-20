'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

interface ShareLinkBootstrapProps {
  videoId: string;
  shareToken: string;
}

// A 429 here previously rendered a dead "Too many requests" card with no way
// forward - the reviewer's only option was giving up. Rate limits are
// transient by definition, so we wait out the window and try again.
const RETRY_FALLBACK_MS = 8000;
const RETRY_MAX_MS = 60000;

function retryDelayFromHeaders(response: Response): number {
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) return Math.min(ms + 500, RETRY_MAX_MS);
  }
  return RETRY_FALLBACK_MS;
}

export function ShareLinkBootstrap({ videoId, shareToken }: ShareLinkBootstrapProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [retryingIn, setRetryingIn] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retryNow = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setError('');
    setRetryingIn(null);
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function establishSession() {
      try {
        const response = await fetch(`/watch/${videoId}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shareToken }),
        });

        if (isCancelled) return;

        if (response.ok) {
          // Preserve presentation params (embed/accent) through the session redirect.
          const passthrough = new URLSearchParams(window.location.search);
          passthrough.delete('shareToken');
          const qs = passthrough.toString();
          router.replace(`/watch/${videoId}${qs ? `?${qs}` : ''}`);
          router.refresh();
          return;
        }

        if (response.status === 429) {
          const delayMs = retryDelayFromHeaders(response);
          setError('');
          setRetryingIn(Math.ceil(delayMs / 1000));
          retryTimerRef.current = setTimeout(() => {
            if (!isCancelled) setAttempt((a) => a + 1);
          }, delayMs);
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          requiresPassword?: boolean;
          error?: string;
        } | null;
        if (payload?.requiresPassword) {
          router.replace(`/watch/${videoId}?unlock=1`);
          return;
        }

        setError(payload?.error || 'Invalid or expired share link');
      } catch {
        if (!isCancelled) {
          setError('Failed to open share link');
        }
      }
    }

    void establishSession();
    return () => {
      isCancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [router, shareToken, videoId, attempt]);

  // Tick the visible countdown down once a second while a retry is scheduled.
  useEffect(() => {
    if (retryingIn === null || retryingIn <= 0) return;
    const tick = setTimeout(() => setRetryingIn((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(tick);
  }, [retryingIn]);

  return (
    <div className="h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm text-center space-y-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
        <h1 className="text-lg font-semibold">Opening shared video</h1>
        <p className="text-sm text-muted-foreground">
          {retryingIn !== null
            ? `The server is busy - retrying in ${Math.max(retryingIn, 0)}s...`
            : error || 'Verifying link access...'}
        </p>
        {(error || retryingIn !== null) && (
          <button
            type="button"
            onClick={retryNow}
            className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
