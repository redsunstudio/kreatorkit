import Link from 'next/link';
import { Video } from 'lucide-react';
import { getValidInvitationByToken } from '@/lib/invitations';
import { db } from '@/lib/db';
import { LoginForm, LoginFormSkeleton } from './login-form';
import { CreatedBy } from '@/components/created-by';
import { Suspense } from 'react';

interface LoginPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

  // Invited? Pre-fill their email and greet them by workspace.
  const { invite } = await searchParams;
  let inviteEmail: string | null = null;
  let inviteTarget: string | null = null;
  if (invite) {
    const invitation = await getValidInvitationByToken(invite).catch(() => null);
    if (invitation) {
      inviteEmail = invitation.email;
      if (invitation.workspaceId) {
        const ws = await db.workspace.findUnique({
          where: { id: invitation.workspaceId },
          select: { name: true },
        });
        inviteTarget = ws?.name ?? null;
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <Video className="h-8 w-8 text-primary" />
          <span className="font-bold text-2xl">KreatorKit</span>
        </Link>

        <CreatedBy className="-mt-6 mb-8" />
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginForm
            googleEnabled={googleEnabled}
            githubEnabled={githubEnabled}
            inviteEmail={inviteEmail}
            inviteTarget={inviteTarget}
          />
        </Suspense>

        <p className="text-center text-xs text-muted-foreground mt-4">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
