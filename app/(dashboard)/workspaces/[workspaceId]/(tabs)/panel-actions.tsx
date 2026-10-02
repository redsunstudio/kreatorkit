'use server';

import { PipelinePanel } from './panel';
import { PublishedPanel } from './published/panel';
import { AssetsPanel } from './assets/panel';
import { StrategyPanel } from './strategy/panel';
import { DrivePanel } from './drive/panel';
import { HandoffPanel } from './handoff/panel';
import type { ShellTab } from '@/components/workspace/tab-shell-tabs';

const PANELS: Record<ShellTab, (props: { workspaceId: string }) => Promise<React.ReactNode>> = {
  review: PipelinePanel,
  published: PublishedPanel,
  assets: AssetsPanel,
  strategy: StrategyPanel,
  drive: DrivePanel,
  handoff: HandoffPanel,
};

/**
 * Render one workspace tab panel for the client tab shell, so switching tabs
 * doesn't route through the server. Same server code as the tab's route page,
 * and every panel runs its own auth + workspace access check, so this exposes
 * nothing the page itself doesn't. Unknown input is rejected outright.
 */
export async function loadWorkspacePanel(workspaceId: string, tab: string) {
  if (typeof workspaceId !== 'string' || !/^[a-z0-9]{10,40}$/i.test(workspaceId)) {
    throw new Error('Bad workspace');
  }
  if (typeof tab !== 'string' || !Object.hasOwn(PANELS, tab)) {
    throw new Error('Bad tab');
  }
  const Panel = PANELS[tab as ShellTab];
  return <Panel workspaceId={workspaceId} />;
}
