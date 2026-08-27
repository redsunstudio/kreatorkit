import { timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';

/**
 * KreatorKit agent access — two tiers via the X-Agent-Key header.
 *
 * - AGENT_API_KEY: the master key (Claude Code / Agency OS). Admin-equivalent —
 *   scope it like a root credential.
 * - AGENT_SCOPED_KEYS: named keys for other automations, "name:key,name2:key2".
 *   Scoped keys can read and work the pipeline (list/get/patch items, ideas,
 *   assets, cuts, comments, markers, share links) but are refused the rails
 *   that destroy data or reach a client's channel: video delete, storage
 *   cleanup, publish, workspace config writes and member management — and
 *   workspace reads never include per-workspace publishing secrets.
 */
export interface AgentAuth {
  ok: boolean;
  admin: boolean;
  /** 'master' for the admin key, else the scoped key's name. */
  name: string | null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function agentAuth(request: NextRequest): AgentAuth {
  const provided = request.headers.get('x-agent-key');
  if (!provided) return { ok: false, admin: false, name: null };

  const master = process.env.AGENT_API_KEY;
  if (master && safeEqual(master, provided)) {
    return { ok: true, admin: true, name: 'master' };
  }

  for (const entry of (process.env.AGENT_SCOPED_KEYS ?? '').split(',')) {
    const sep = entry.indexOf(':');
    if (sep <= 0) continue;
    const name = entry.slice(0, sep).trim();
    const key = entry.slice(sep + 1).trim();
    if (name && key && safeEqual(key, provided)) {
      return { ok: true, admin: false, name };
    }
  }
  return { ok: false, admin: false, name: null };
}

/** Any valid agent key (master or scoped). */
export function isAgentRequest(request: NextRequest): boolean {
  return agentAuth(request).ok;
}
