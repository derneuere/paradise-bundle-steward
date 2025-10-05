import React, { useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { numberField } from './utils';

export const BlackspotsListComp: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  duplicateRegionIndexSet: Set<number>;
  ensureUniqueRegionIndex: (value: number, exclude: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }) => number;
  scrollPosRef: React.MutableRefObject<{ landmarks: number; generic: number; blackspots: number; vfx: number }>;
  onEditBox: (kind: 'landmark'|'generic'|'blackspot'|'vfx', index: number) => void;
}> = ({ data, onChange, duplicateRegionIndexSet, ensureUniqueRegionIndex: _ensureUniqueRegionIndex, scrollPosRef, onEditBox }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: data.blackspots.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 12,
    getItemKey: (index) => index,
  });
  const items = rowVirtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (el) el.scrollTop = scrollPosRef.current.blackspots;
  }, [items.length, data.blackspots, scrollPosRef]);
  return (
    <div ref={parentRef} className="h-[60vh] overflow-auto pr-2" onScroll={e => { scrollPosRef.current.blackspots = e.currentTarget.scrollTop; }}>
      {data.blackspots.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4">No blackspots</div>
      ) : null}
      <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {items.map(vi => {
          const i = vi.index;
          const bs = data.blackspots[i];
          return (
            <div
              key={vi.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 right-0"
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-center bg-background">
                <div>
                  <Label>ID</Label>
                  <Input value={bs.id} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['id'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Region Index</Label>
                  <Input
                    value={bs.regionIndex}
                    type="number"
                    className={(duplicateRegionIndexSet.has(bs.regionIndex|0) || ((bs.regionIndex|0) < 0)) ? 'border-red-500' : undefined}
                    onChange={e => {
                      const raw = Number.parseInt(e.target.value) || 0;
                      onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['regionIndex'], raw) : x) });
                    }}
                  />
                  {duplicateRegionIndexSet.has(bs.regionIndex|0) ? (
                    <div className="text-xs text-red-600 mt-1">Duplicate region index</div>
                  ) : null}
                  {(bs.regionIndex|0) < 0 ? (
                    <div className="text-xs text-red-600 mt-1">Region index should be &gt;= 0</div>
                  ) : null}
                </div>
                <div>
                  <Label>Score Type</Label>
                  <Input value={bs.scoreType} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['scoreType'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Score Amount</Label>
                  <Input value={bs.scoreAmount} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['scoreAmount'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div className="flex items-end">
                  <Button variant="secondary" size="sm" onClick={() => onEditBox('blackspot', i)}>Edit Box</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


