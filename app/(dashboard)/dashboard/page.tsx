import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// KreatorKit: the projects overview is deprecated — workspaces (clients) are
// the top level and videos live directly inside them.
export default function DashboardPage() {
  redirect('/workspaces');
}
