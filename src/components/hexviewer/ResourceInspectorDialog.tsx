import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import type { InspectedResource } from './types';
import { HexTable } from './HexTable';
import { getSchemaFields } from './utils.ts';
import { VehicleEntrySchema } from '@/lib/core/vehicleList';

export type ResourceInspectorDialogProps = {
  inspected: InspectedResource | null;
  onOpenChange: (open: boolean) => void;
  bytesPerRow: number;
};

// Generic schema descriptor to allow multiple resource types to plug in
// Offsets/sizes are relative to the start of a single entry payload (not including headers)
const schemaRegistry: Record<number, {
  label: string;
  headerSizeFromData: (data: Uint8Array) => number;
  entrySize: number;
  countFromData: (data: Uint8Array, headerSize: number) => number;
  fields: Array<{ key: string; name: string; offset: number; size: number }>;
}> = {
  [RESOURCE_TYPE_IDS.VEHICLE_LIST]: {
    label: 'VehicleListEntry',
    headerSizeFromData: (data) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true) >>> 0,
    entrySize: 0x108,
    countFromData: (data, headerSize) => {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const numVehicles = dv.getUint32(0, true) >>> 0;
      const maxVehicles = Math.floor((data.length - headerSize) / 0x108);
      return Math.min(numVehicles, maxVehicles);
    },
    fields: getSchemaFields(VehicleEntrySchema)
  }
};


export const ResourceInspectorDialog: React.FC<ResourceInspectorDialogProps> = ({ inspected, onOpenChange, bytesPerRow }) => {
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);

  const schema = useMemo(() => inspected ? schemaRegistry[inspected.resource.resourceTypeId] : undefined, [inspected]);

  const headerInfo = useMemo(() => {
    if (!inspected || !schema) return null;
    const headerSize = schema.headerSizeFromData(inspected.data);
    const count = schema.countFromData(inspected.data, headerSize);
    return { headerSize, count };
  }, [inspected, schema]);

  // Precompute a mask for selected field across ALL entries
  const selectedFieldMask = useMemo(() => {
    if (!inspected || !schema || !headerInfo || !selectedFieldKey) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const field = schema.fields.find(f => f.key === selectedFieldKey);
    if (!field) return mask;
    const { headerSize, count } = headerInfo;
    const entrySize = schema.entrySize;
    for (let i = 0; i < count; i++) {
      const s = headerSize + i * entrySize + field.offset;
      const e = Math.min(s + field.size, mask.length);
      if (e > s) mask.fill(1, s, e);
    }
    return mask;
  }, [inspected, schema, headerInfo, selectedFieldKey]);

  // Precompute overlay mask
  const overlayMask = useMemo(() => {
    if (!inspected) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    for (const ov of inspected.overlays) {
      const s = Math.max(0, ov.start);
      const e = Math.min(inspected.data.length, ov.end);
      if (e > s) mask.fill(1, s, e);
    }
    return mask;
  }, [inspected]);

  const fieldsForSchema = schema?.fields ?? [];

  const totalRows = useMemo(() => inspected ? Math.ceil(inspected.data.length / bytesPerRow) : 0, [inspected, bytesPerRow]);

  const getRow = (rowIndex: number): { offset: number; hexBytes: { byte: number; offset: number; section: string; color: string }[]; ascii: string } => {
    if (!inspected) return { offset: 0, hexBytes: [], ascii: '' };
    const rowStart = rowIndex * bytesPerRow;
    const rowData = inspected.data.subarray(rowStart, Math.min(rowStart + bytesPerRow, inspected.data.length));
    const hexBytes = Array.from(rowData).map((b, i) => {
      const off = rowStart + i;
      const isSelected = !!selectedFieldMask && selectedFieldMask[off] === 1;
      const isOverlay = !!overlayMask && overlayMask[off] === 1;
      const color = isSelected ? 'bg-fuchsia-600 text-white border border-border'
        : (isOverlay ? 'bg-secondary text-secondary-foreground border border-border'
        : 'bg-muted text-foreground border border-border');
      return { byte: b, offset: off, section: '', color };
    });
    const ascii = Array.from(rowData).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    return { offset: rowStart, hexBytes, ascii };
  };

  return (
    <Dialog open={!!inspected} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Resource Inspector — {inspected?.typeLabel}</DialogTitle>
        </DialogHeader>
        {inspected && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Size: {inspected.data.length.toLocaleString()} bytes</div>

            {schema && headerInfo && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-end gap-4 flex-wrap">
                    <div className="text-xs text-muted-foreground">Header {headerInfo.headerSize} bytes • Entry size {schema.entrySize} bytes • {headerInfo.count} entries</div>
                    <div className="text-xs text-muted-foreground">Selected field highlights across all entries</div>
                  </div>

                  <div className="space-y-2">
                    <Label>Fields</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-auto pr-1">
                      {fieldsForSchema.map(f => (
                        <Button
                          key={f.key}
                          size="sm"
                          variant={selectedFieldKey === f.key ? 'secondary' : 'outline'}
                          className="justify-start"
                          onClick={() => setSelectedFieldKey(prev => prev === f.key ? null : f.key)}
                        >
                          <span className="truncate">{f.name}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">+0x{f.offset.toString(16).toUpperCase()} • {f.size}B</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <HexTable rowCount={totalRows} getRow={getRow} heightClass="h-[60vh]" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
