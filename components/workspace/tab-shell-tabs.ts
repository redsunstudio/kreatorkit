/** Workspace tabs the client tab shell can switch between without a route change. */
export type ShellTab = 'review' | 'published' | 'assets' | 'strategy' | 'drive' | 'handoff';

const SUFFIX: Record<ShellTab, string> = {
  review: '',
  published: '/published',
  assets: '/assets',
  strategy: '/strategy',
  drive: '/drive',
  handoff: '/handoff',
};

export function shellTabHref(workspaceId: string, tab: ShellTab): string {
  return `/workspaces/${workspaceId}${SUFFIX[tab]}`;
}

/** Which shell tab a pathname shows, or null if it isn't one of them. */
export function shellTabFromPath(workspaceId: string, pathname: string): ShellTab | null {
  const base = `/workspaces/${workspaceId}`;
  if (pathname === base || pathname === `${base}/`) return 'review';
  for (const [tab, suffix] of Object.entries(SUFFIX) as [ShellTab, string][]) {
    if (suffix && pathname === base + suffix) return tab;
  }
  return null;
}

export function isShellTab(value: string): value is ShellTab {
  return Object.hasOwn(SUFFIX, value);
}
