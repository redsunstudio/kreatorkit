import { PanelSlot } from '@/components/workspace/tab-shell';
import { AssetsPanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceAssetsPage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="assets">
      <AssetsPanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
