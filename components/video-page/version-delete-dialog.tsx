'use client';

import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface VersionDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDeletingVersion: boolean;
  onDelete: () => void;
}

export const VersionDeleteDialog = memo(function VersionDeleteDialog({
  open,
  onOpenChange,
  isDeletingVersion,
  onDelete,
}: VersionDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this cut?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this cut and all its comments. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeletingVersion}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeletingVersion}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeletingVersion && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Delete cut
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
