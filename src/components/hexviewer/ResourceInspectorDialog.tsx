import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { InspectedResource } from './types';

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
        {inspected && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Size: {inspected.data.length.toLocaleString()} bytes</div>
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[60vh]">
                  <div className="font-mono text-sm p-4">
                    <div className="flex mb-2 pb-2 border-b sticky top-0 bg-background">
                      <div className="w-20 text-muted-foreground">Offset</div>
                      <div className="flex-1 text-muted-foreground">Hex Bytes</div>
                      <div className="w-48 text-muted-foreground">ASCII</div>
                    </div>
                    {(() => {
                      const overlayAt = (offset: number) => inspected.overlays.find(o => offset >= o.start && offset < o.end);
                      const rows = [] as { offset: number; hexBytes: { byte: number; color: string }[]; ascii: string }[];
                      const data = inspected.data;
                      const totalRows = Math.ceil(data.length / bytesPerRow);
                      for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
                        const rowStart = rowIndex * bytesPerRow;
                        const rowData = data.slice(rowStart, rowStart + bytesPerRow);
                        const hexBytes = Array.from(rowData).map((b, i) => {
                          const off = rowStart + i;
                          const ov = overlayAt(off);
                          return { byte: b, color: ov ? `${ov.color} text-white` : 'bg-gray-100' };
                        });
                        const ascii = Array.from(rowData).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
                        rows.push({ offset: rowStart, hexBytes, ascii });
                      }
                      return rows.map(r => (
                        <div key={r.offset} className="flex hover:bg-muted/50 py-1">
                          <div className="w-20 text-muted-foreground pr-4">{r.offset.toString(16).toUpperCase().padStart(8, '0')}</div>
                          <div className="flex-1 flex gap-1">
                            {r.hexBytes.map((hb, idx) => (
                              <div key={idx} className={`px-1 py-0.5 rounded text-xs ${hb.color}`}>{hb.byte.toString(16).toUpperCase().padStart(2, '0')}</div>
                            ))}
                          </div>
                          <div className="w-48 pl-4 font-mono text-muted-foreground">{r.ascii}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
