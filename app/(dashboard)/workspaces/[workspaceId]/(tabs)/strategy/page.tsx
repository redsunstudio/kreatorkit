import { PanelSlot } from '@/components/workspace/tab-shell';
import { StrategyPanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function StrategyPage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="strategy">
      <StrategyPanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
