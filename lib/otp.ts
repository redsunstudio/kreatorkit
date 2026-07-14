// Passwordless sign-in codes — the dashboards-style flow:
// email in -> 6-digit code lands in the inbox -> code in -> signed in.
// Codes only go to emails we know (existing users or pending invitations),
// but the request endpoint always answers OK (no account enumeration).

import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { sendEmail } from '@/lib/mailer';
import { logError } from '@/lib/logger';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(email: string, code: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? '';
  return createHash('sha256').update(`${email}:${code}:${secret}`).digest('hex');
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function isEligibleForCode(email: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) return true;
  const invitation = await db.invitation.findFirst({
    where: { email, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(invitation);
}

/** Issue + email a sign-in code. Silently no-ops for unknown emails. */
export async function requestLoginCode(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email || !email.includes('@')) return;
  try {
    if (!(await isEligibleForCode(email))) return;
    const code = String(randomInt(100000, 1000000));
    await db.loginCode.deleteMany({ where: { email } });
    await db.loginCode.create({
      data: {
        email,
        codeHash: hashCode(email, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    await sendEmail({
      to: email,
      subject: `[KreatorKit] Your sign-in code: ${code}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px">
          <h2 style="margin:0 0 4px">KreatorKit</h2>
          <p style="color:#555">Use this code to sign in. It expires in 10 minutes.</p>
          <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:20px 0">${code}</p>
          <p style="color:#888;font-size:12px">If you didn't request this, you can ignore it.</p>
        </div>`,
    });
  } catch (e) {
    logError('login code request failed:', e);
  }
}

/** Check a submitted code. Consumes it on success. */
export async function verifyLoginCode(rawEmail: string, code: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const trimmed = code.trim();
  if (!email || !/^\d{6}$/.test(trimmed)) return false;
  const row = await db.loginCode.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return false;
  if (row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) {
    await db.loginCode.deleteMany({ where: { email } });
    return false;
  }
  // Burn an attempt BEFORE checking the code, atomically gated on the cap —
  // concurrent wrong guesses can't all slip under MAX_ATTEMPTS.
  const burned = await db.loginCode.updateMany({
    where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (burned.count === 0) return false;
  const expected = Buffer.from(row.codeHash, 'hex');
  const actual = Buffer.from(hashCode(email, trimmed), 'hex');
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!ok) return false;
  await db.loginCode.deleteMany({ where: { email } });
  return true;
}
