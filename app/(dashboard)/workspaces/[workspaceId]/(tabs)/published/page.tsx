import { PanelSlot } from '@/components/workspace/tab-shell';
import { PublishedPanel } from './panel';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function PublishedPage({ params }: PageProps) {
  const { workspaceId } = await params;
  return (
    <PanelSlot tab="published">
      <PublishedPanel workspaceId={workspaceId} />
    </PanelSlot>
  );
}
