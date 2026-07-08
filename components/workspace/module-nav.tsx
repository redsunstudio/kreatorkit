import Link from 'next/link';
import { MonitorPlay, Inbox, Palette, BarChart3, Youtube } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasModule, KREATORKIT_MODULES, type KreatorKitModule } from '@/lib/workspace-features';

const MODULE_META: Record<
  KreatorKitModule,
  { label: string; href: (id: string) => string; icon: typeof MonitorPlay }
> = {
  review: { label: 'Pipeline', href: (id) => `/workspaces/${id}`, icon: MonitorPlay },
  handoff: { label: 'Footage Handoff', href: (id) => `/workspaces/${id}/handoff`, icon: Inbox },
  published: { label: 'Published', href: (id) => `/workspaces/${id}/published`, icon: Youtube },
  assets: { label: 'Brand assets', href: (id) => `/workspaces/${id}/assets`, icon: Palette },
  reports: { label: 'Reports', href: (id) => `/workspaces/${id}/reports`, icon: BarChart3 },
};

interface ModuleNavProps {
  workspace: { id: string; features?: unknown };
  active: KreatorKitModule;
}

/** KreatorKit module tab bar — one tab per enabled module for this client. */
export function ModuleNav({ workspace, active }: ModuleNavProps) {
  const enabled = KREATORKIT_MODULES.filter((m) => hasModule(workspace, m));
  if (enabled.length <= 1) return null;

  return (
    <nav className="mb-8 flex items-center gap-1 border-b">
      {enabled.map((m) => {
        const meta = MODULE_META[m];
        const Icon = meta.icon;
        const isActive = m === active;
        return (
          <Link
            key={m}
            href={meta.href(workspace.id)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {meta.label}
          </Link>
        );
      })}
    </nav>
  );
}
