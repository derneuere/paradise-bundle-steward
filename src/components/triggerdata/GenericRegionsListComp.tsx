import React, { useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { numberField } from './utils';

export const GenericRegionsListComp: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  duplicateRegionIndexSet: Set<number>;
  ensureUniqueRegionIndex: (value: number, exclude: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }) => number;
  scrollPosRef: React.MutableRefObject<{ landmarks: number; generic: number; blackspots: number; vfx: number }>;
  onEditBox: (kind: 'landmark'|'generic'|'blackspot'|'vfx', index: number) => void;
}> = ({ data, onChange, duplicateRegionIndexSet, ensureUniqueRegionIndex: _ensureUniqueRegionIndex, scrollPosRef, onEditBox }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: data.genericRegions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 12,
    getItemKey: (index) => index,
  });
  const items = rowVirtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (el) el.scrollTop = scrollPosRef.current.generic;
  }, [items.length, data.genericRegions, scrollPosRef]);
  return (
    <div ref={parentRef} className="h-[60vh] overflow-auto pr-2" onScroll={e => { scrollPosRef.current.generic = e.currentTarget.scrollTop; }}>
      {data.genericRegions.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4">No generic regions</div>
      ) : null}
      <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {items.map(vi => {
          const i = vi.index;
          const gr = data.genericRegions[i];
          return (
            <div
              key={vi.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 right-0"
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-8 gap-2 items-center bg-background">
                <div>
                  <Label>ID</Label>
                  <Input value={gr.id} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['id'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Region Index</Label>
                  <Input
                    value={gr.regionIndex}
                    type="number"
                    className={(duplicateRegionIndexSet.has(gr.regionIndex|0) || ((gr.regionIndex|0) < 0)) ? 'border-red-500' : undefined}
                    onChange={e => {
                      const raw = Number.parseInt(e.target.value) || 0;
                      onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['regionIndex'], raw) : x) });
                    }}
                  />
                  {duplicateRegionIndexSet.has(gr.regionIndex|0) ? (
                    <div className="text-xs text-red-600 mt-1">Duplicate region index</div>
                  ) : null}
                  {(gr.regionIndex|0) < 0 ? (
                    <div className="text-xs text-red-600 mt-1">Region index should be &gt;= 0</div>
                  ) : null}
                </div>
                <div>
                  <Label>Group</Label>
                  <Input value={gr.groupId} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['groupId'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Type</Label>
                  <Input value={gr.genericType} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['genericType'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Cam1/Cam2</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={gr.cameraCut1} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['cameraCut1'], parseInt(e.target.value)||0) : x) })} />
                    <Input value={gr.cameraCut2} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['cameraCut2'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                </div>
                <div>
                  <Label>One Way</Label>
                  <Input value={gr.isOneWay} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['isOneWay'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Enabled</Label>
                  <Switch checked={gr.enabled === 1} onCheckedChange={checked => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? { ...gr, enabled: checked ? 1 : 0 } : x) })} />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onEditBox('generic', i)}>Edit Box</Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => onChange({ ...data, genericRegions: data.genericRegions.filter((_, j) => j !== i) })}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


