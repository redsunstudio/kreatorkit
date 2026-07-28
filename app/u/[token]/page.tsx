import { notFound } from 'next/navigation';
import { checkLinkUsable, findUsableLink } from '@/lib/workspace-drive';
import { GrabClient } from './grab-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

// The public "content grab" page. A client opens this from a link in an email and
// drops files straight into the workspace Drive — no login, no invite, and no
// pipeline item required (which is the whole point: footage usually arrives
// before anyone has decided what video it belongs to).
export default async function GrabPage({ params }: PageProps) {
  const { token } = await params;
  const link = await findUsableLink(token);
  if (!link) notFound();

  const usable = checkLinkUsable(link);
  if (!usable.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">This upload link is closed</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {usable.reason === 'expired'
              ? 'The link has expired.'
              : 'The link has been turned off.'}{' '}
            Ask {link.workspace.name} for a fresh one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <GrabClient
      token={token}
      workspaceName={link.workspace.name}
      accent={link.workspace.brandAccent}
      label={link.label}
    />
  );
}
