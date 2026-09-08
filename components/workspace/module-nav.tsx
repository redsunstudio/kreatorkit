'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MonitorPlay,
  Inbox,
  Palette,
  BarChart3,
  Youtube,
  Compass,
  FolderInput,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasModule, KREATORKIT_MODULES, type KreatorKitModule } from '@/lib/workspace-features';

// Modules without an entry here (e.g. 'posts') are capabilities, not tabs.
const MODULE_META: Partial<
  Record<
    KreatorKitModule,
    { label: string; href: (id: string) => string; icon: typeof MonitorPlay }
  >
> = {
  review: { label: 'Pipeline', href: (id) => `/workspaces/${id}`, icon: MonitorPlay },
  handoff: { label: 'Footage Handoff', href: (id) => `/workspaces/${id}/handoff`, icon: Inbox },
  published: { label: 'Published', href: (id) => `/workspaces/${id}/published`, icon: Youtube },
  assets: { label: 'Brand assets', href: (id) => `/workspaces/${id}/assets`, icon: Palette },
  reports: { label: 'Reports', href: (id) => `/workspaces/${id}/reports`, icon: BarChart3 },
  strategy: { label: 'Strategy', href: (id) => `/workspaces/${id}/strategy`, icon: Compass },
  drive: { label: 'Drive', href: (id) => `/workspaces/${id}/drive`, icon: FolderInput },
};

interface ModuleNavProps {
  workspace: { id: string; features?: unknown };
  /** Optional override; by default the active tab is read from the URL. */
  active?: KreatorKitModule;
}

/**
 * KreatorKit module tab bar — one tab per enabled module for this client.
 *
 * Client component so it can live in the workspace layout: the shell (hero +
 * tabs) stays mounted across tab switches and only the panel below swaps,
 * which is what makes switching feel instant instead of a full page reload.
 * Tabs prefetch their full route so the panel is usually ready before the click.
 */
export function ModuleNav({ workspace, active }: ModuleNavProps) {
  const pathname = usePathname();
  const enabled = KREATORKIT_MODULES.filter((m) => MODULE_META[m] && hasModule(workspace, m));
  if (enabled.length <= 1) return null;

  // Longest matching href wins: `/workspaces/{id}` is a prefix of every tab.
  const current =
    active ??
    enabled.reduce<{ key: KreatorKitModule | null; len: number }>(
      (best, m) => {
        const href = MODULE_META[m]!.href(workspace.id);
        const matches = pathname === href || pathname.startsWith(`${href}/`);
        return matches && href.length > best.len ? { key: m, len: href.length } : best;
      },
      { key: null, len: -1 }
    ).key;

  return (
    <nav className="mb-8 flex items-center gap-1 border-b overflow-x-auto">
      {enabled.map((m) => {
        const meta = MODULE_META[m]!;
        const Icon = meta.icon;
        const isActive = m === current;
        return (
          <Link
            key={m}
            href={meta.href(workspace.id)}
            prefetch={true}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex flex-none items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
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
