import { PanelSlot } from '@/components/workspace/tab-shell';
import { DrivePanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function DrivePage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="drive">
      <DrivePanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
