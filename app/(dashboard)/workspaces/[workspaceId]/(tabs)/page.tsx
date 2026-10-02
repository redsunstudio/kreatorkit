import { PanelSlot } from '@/components/workspace/tab-shell';
import { PipelinePanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspacePage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="review">
      <PipelinePanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
