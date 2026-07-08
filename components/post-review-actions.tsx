'use client';

import { useState } from 'react';

/** Approve / feedback bar for the public post review page. Mobile-first. */
export function PostReviewActions({
  token,
  initialStatus,
}: {
  token: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const approved = status === 'APPROVED' || status === 'PUBLISHED';

  async function approve() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(`/api/p/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      if (!r.ok) throw new Error();
      setStatus('APPROVED');
      setMessage('Approved — thank you! The team has been notified.');
    } catch {
      setMessage('That didn’t go through — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendFeedback() {
    if (!feedback.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(`/api/p/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feedback',
          body: feedback.trim(),
          name: name.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error();
      setFeedback('');
      setFeedbackOpen(false);
      setMessage('Feedback sent — the team has been notified.');
    } catch {
      setMessage('That didn’t go through — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {message && (
        <p className="text-sm text-center rounded-lg bg-white border border-neutral-200 px-4 py-3 text-neutral-700 shadow-sm">
          {message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => void approve()}
          disabled={busy || approved}
          className={`flex-1 rounded-full px-4 py-3 text-[15px] font-semibold transition-colors ${
            approved
              ? 'bg-green-100 text-green-700 cursor-default'
              : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
          }`}
        >
          {approved ? '✓ Approved' : busy ? '…' : '✅ Approve'}
        </button>
        <button
          onClick={() => setFeedbackOpen((v) => !v)}
          disabled={busy}
          className="flex-1 rounded-full px-4 py-3 text-[15px] font-semibold border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
        >
          💬 Feedback
        </button>
      </div>

      {feedbackOpen && (
        <div className="rounded-xl bg-white border border-neutral-200 p-3 space-y-2 shadow-sm">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change?"
            rows={3}
            maxLength={4000}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-500"
          />
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={80}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-500"
            />
            <button
              onClick={() => void sendFeedback()}
              disabled={busy || !feedback.trim()}
              className="rounded-lg bg-neutral-900 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
