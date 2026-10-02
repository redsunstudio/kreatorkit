'use client';

import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { shellTabFromPath, shellTabHref, type ShellTab } from './tab-shell-tabs';

/**
 * Client tab shell for a workspace — the Clip Director model.
 *
 * Without it, every tab click is a route change: a server round trip, then the
 * old panel unmounts and the new one mounts from scratch. With it:
 *  - the tab the server routed to (hard load / deep link) renders as usual
 *    through <PanelSlot>;
 *  - any other tab is rendered ONCE by the `load` server action (the same
 *    panel code the route page uses) and kept, hidden in an <Activity>, so
 *    switching back is instant and keeps its state (scroll, view, selection);
 *  - the URL changes via history.pushState, which Next syncs into
 *    usePathname, so the tab bar, the address bar and Back all agree;
 *  - a kept panel older than STALE_MS is re-rendered quietly in the
 *    background when shown, and React reconciles it in place;
 *  - any failure falls back to a normal navigation.
 *
 * On by default; ?fast=0 turns it off for one browser, ?fast=1 back on.
 */
const STALE_MS = 60_000;
const FLAG_KEY = 'kk-fast-tabs';

type Panel = { node: ReactNode; loadedAt: number };
type LoadPanel = (workspaceId: string, tab: string) => Promise<ReactNode>;

// Survives the shell unmounting (open an item, press Back) for the session.
const panelCache = new Map<string, Map<ShellTab, Panel>>();

interface ShellValue {
  enabled: boolean;
  activeTab: ShellTab | null;
  registerRoutedTab: (tab: ShellTab) => void;
  go: (tab: ShellTab) => void;
  warm: (tab: ShellTab) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function useTabShell() {
  return useContext(ShellContext);
}

function readFlag(): boolean {
  // On by default. ?fast=0 opts this browser out (kill switch), ?fast=1 back in.
  try {
    const q = new URLSearchParams(window.location.search).get('fast');
    if (q === '0') localStorage.setItem(FLAG_KEY, '0');
    if (q === '1') localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) !== '0';
  } catch {
    return true;
  }
}

export function TabShell({
  workspaceId,
  load,
  children,
}: {
  workspaceId: string;
  load: LoadPanel;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [routedTab, setRoutedTab] = useState<ShellTab | null>(null);
  const [panels, setPanels] = useState<Map<ShellTab, Panel>>(
    () => panelCache.get(workspaceId) ?? new Map()
  );
  const inflight = useRef(new Map<ShellTab, Promise<ReactNode>>());
  const failed = useRef(new Set<ShellTab>());

  const activeTab = shellTabFromPath(workspaceId, pathname);

  useEffect(() => {
    // Client-only flag read; until it's on, tab links behave as plain links.
    const id = setTimeout(() => setEnabled(readFlag()), 0);
    return () => clearTimeout(id);
  }, []);

  const storePanel = useCallback(
    (tab: ShellTab, node: ReactNode) => {
      setPanels((prev) => {
        const next = new Map(prev);
        next.set(tab, { node, loadedAt: Date.now() });
        panelCache.set(workspaceId, next);
        return next;
      });
    },
    [workspaceId]
  );

  const fetchPanel = useCallback(
    (tab: ShellTab): Promise<ReactNode> => {
      const existing = inflight.current.get(tab);
      if (existing) return existing;
      const p = load(workspaceId, tab)
        .then((node) => {
          storePanel(tab, node);
          return node;
        })
        .finally(() => inflight.current.delete(tab));
      inflight.current.set(tab, p);
      return p;
    },
    [load, workspaceId, storePanel]
  );

  const fallback = useCallback(
    (tab: ShellTab) => {
      failed.current.add(tab);
      router.push(shellTabHref(workspaceId, tab));
    },
    [router, workspaceId]
  );

  const go = useCallback(
    (tab: ShellTab) => {
      const href = shellTabHref(workspaceId, tab);
      if (tab === activeTab) return;
      const kept = panels.get(tab);
      if (tab === routedTab || kept) {
        window.history.pushState(null, '', href);
        if (kept && tab !== routedTab && Date.now() - kept.loadedAt > STALE_MS) {
          fetchPanel(tab).catch(() => {}); // quiet refresh; the kept copy stays up
        }
        return;
      }
      // First visit: keep the current panel up (the nav bar shows progress)
      // until the new one is rendered, then switch in one step.
      fetchPanel(tab).then(
        () => window.history.pushState(null, '', href),
        () => fallback(tab)
      );
    },
    [workspaceId, activeTab, routedTab, panels, fetchPanel, fallback]
  );

  const warm = useCallback(
    (tab: ShellTab) => {
      if (tab === routedTab || panels.has(tab) || failed.current.has(tab)) return;
      fetchPanel(tab).catch(() => failed.current.add(tab));
    },
    [routedTab, panels, fetchPanel]
  );

  // Back/Forward onto a tab that isn't rendered yet (e.g. after a remount).
  useEffect(() => {
    if (!enabled || !activeTab || activeTab === routedTab || panels.has(activeTab)) return;
    if (failed.current.has(activeTab)) return;
    const tab = activeTab;
    fetchPanel(tab).catch(() => fallback(tab));
  }, [enabled, activeTab, routedTab, panels, fetchPanel, fallback]);

  const value = useMemo<ShellValue>(
    () => ({ enabled, activeTab, registerRoutedTab: setRoutedTab, go, warm }),
    [enabled, activeTab, go, warm]
  );

  const showSpinner =
    enabled && activeTab !== null && activeTab !== routedTab && !panels.has(activeTab);

  return (
    <ShellContext.Provider value={value}>
      {children}
      {enabled &&
        [...panels.entries()]
          .filter(([tab]) => tab !== routedTab)
          .map(([tab, panel]) => (
            <Activity key={tab} mode={tab === activeTab ? 'visible' : 'hidden'}>
              <div>{panel.node}</div>
            </Activity>
          ))}
      {showSpinner && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
    </ShellContext.Provider>
  );
}

/**
 * Wraps the panel the server routed to. Tells the shell which tab it is and
 * hides itself (state kept) while the shell shows a different tab.
 */
export function PanelSlot({ tab, children }: { tab: ShellTab; children: ReactNode }) {
  const shell = useTabShell();
  const register = shell?.registerRoutedTab;

  useLayoutEffect(() => {
    register?.(tab);
  }, [register, tab]);

  const visible = !shell?.enabled || shell.activeTab === null || shell.activeTab === tab;
  return <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>;
}
