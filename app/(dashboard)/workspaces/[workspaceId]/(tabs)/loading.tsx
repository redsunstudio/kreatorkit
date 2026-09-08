import { Loader2 } from 'lucide-react';

/**
 * Panel-level streaming boundary. Lives INSIDE the workspace shell layout, so
 * a tab switch keeps the hero + tabs on screen and only the panel shows this
 * while its data streams in.
 */
export default function WorkspacePanelLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
