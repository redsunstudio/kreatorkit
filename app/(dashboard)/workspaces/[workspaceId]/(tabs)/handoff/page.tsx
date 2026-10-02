import { PanelSlot } from '@/components/workspace/tab-shell';
import { HandoffPanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function HandoffPage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="handoff">
      <HandoffPanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
