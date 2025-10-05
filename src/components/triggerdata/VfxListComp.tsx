import React, { useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { numberField } from './utils';

export const VfxListComp: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  duplicateRegionIndexSet: Set<number>;
  ensureUniqueRegionIndex: (value: number, exclude: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }) => number;
  scrollPosRef: React.MutableRefObject<{ landmarks: number; generic: number; blackspots: number; vfx: number }>;
  onEditBox: (kind: 'landmark'|'generic'|'blackspot'|'vfx', index: number) => void;
}> = ({ data, onChange, duplicateRegionIndexSet, ensureUniqueRegionIndex: _ensureUniqueRegionIndex, scrollPosRef, onEditBox }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: data.vfxBoxRegions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 12,
    getItemKey: (index) => index,
  });
  const items = rowVirtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (el) el.scrollTop = scrollPosRef.current.vfx;
  }, [items.length, data.vfxBoxRegions, scrollPosRef]);
  return (
    <div ref={parentRef} className="h-[60vh] overflow-auto pr-2" onScroll={e => { scrollPosRef.current.vfx = e.currentTarget.scrollTop; }}>
      {data.vfxBoxRegions.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4">No VFX regions</div>
      ) : null}
      <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {items.map(vi => {
          const i = vi.index;
          const v = data.vfxBoxRegions[i];
          return (
            <div
              key={vi.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 right-0"
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center bg-background">
                <div>
                  <Label>ID</Label>
                  <Input value={v.id} type="number" onChange={e => onChange({ ...data, vfxBoxRegions: data.vfxBoxRegions.map((x, j) => j===i ? numberField(v, ['id'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Region Index</Label>
                  <Input
                    value={v.regionIndex}
                    type="number"
                    className={(duplicateRegionIndexSet.has(v.regionIndex|0) || ((v.regionIndex|0) < 0)) ? 'border-red-500' : undefined}
                    onChange={e => {
                      const raw = Number.parseInt(e.target.value) || 0;
                      onChange({ ...data, vfxBoxRegions: data.vfxBoxRegions.map((x, j) => j===i ? numberField(v, ['regionIndex'], raw) : x) });
                    }}
                  />
                  {duplicateRegionIndexSet.has(v.regionIndex|0) ? (
                    <div className="text-xs text-red-600 mt-1">Duplicate region index</div>
                  ) : null}
                  {(v.regionIndex|0) < 0 ? (
                    <div className="text-xs text-red-600 mt-1">Region index should be &gt;= 0</div>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <Button variant="secondary" size="sm" onClick={() => onEditBox('vfx', i)}>Edit Box</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


