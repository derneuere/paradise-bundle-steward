import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { InspectedResource } from './types';
import { ResourceInspectorView } from './ResourceInspectorView';

export type ResourceInspectorDialogProps = {
  inspected: InspectedResource | null;
  onOpenChange: (open: boolean) => void;
  bytesPerRow: number;
};

export const ResourceInspectorDialog: React.FC<ResourceInspectorDialogProps> = ({ inspected, onOpenChange, bytesPerRow }) => {
  return (
    <Dialog open={!!inspected} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Resource Inspector — {inspected?.typeLabel}</DialogTitle>
        </DialogHeader>
        {inspected && <ResourceInspectorView inspected={inspected} bytesPerRow={bytesPerRow} />}
      </DialogContent>
    </Dialog>
  );
};

