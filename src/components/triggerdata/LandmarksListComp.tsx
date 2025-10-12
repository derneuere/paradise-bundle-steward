import React, { useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { numberField } from './utils';

export const LandmarksListComp: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  duplicateRegionIndexSet: Set<number>;
  ensureUniqueRegionIndex: (value: number, exclude: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }) => number;
  scrollPosRef: React.MutableRefObject<{ landmarks: number; generic: number; blackspots: number; vfx: number }>;
  onEditBox: (kind: 'landmark'|'generic'|'blackspot'|'vfx', index: number) => void;
}> = ({ data, onChange, duplicateRegionIndexSet, ensureUniqueRegionIndex: _ensureUniqueRegionIndex, scrollPosRef, onEditBox }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: data.landmarks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 12,
    getItemKey: (index) => index,
  });
  const items = rowVirtualizer.getVirtualItems();
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (el) el.scrollTop = scrollPosRef.current.landmarks;
  }, [items.length, data.landmarks, scrollPosRef]);
  return (
    <div ref={parentRef} className="h-[60vh] overflow-auto pr-2" onScroll={e => { scrollPosRef.current.landmarks = e.currentTarget.scrollTop; }}>
      {data.landmarks.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4">No landmarks</div>
      ) : null}
      <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
        {items.map(vi => {
          const i = vi.index;
          const lm = data.landmarks[i];
          return (
            <div
              key={vi.key}
              data-index={i}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 right-0"
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-7 gap-2 items-center bg-background">
                <div>
                  <Label>ID</Label>
                  <Input value={lm.id} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['id'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Region Index</Label>
                  <Input
                    value={lm.regionIndex}
                    type="number"
                    className={(duplicateRegionIndexSet.has(lm.regionIndex|0) || ((lm.regionIndex|0) < 0)) ? 'border-red-500' : undefined}
                    onChange={e => {
                      const raw = Number.parseInt(e.target.value) || 0;
                      onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['regionIndex'], raw) : x) });
                    }}
                  />
                  {duplicateRegionIndexSet.has(lm.regionIndex|0) ? (
                    <div className="text-xs text-red-600 mt-1">Duplicate region index</div>
                  ) : null}
                  {(lm.regionIndex|0) < 0 ? (
                    <div className="text-xs text-red-600 mt-1">Region index should be &gt;= 0</div>
                  ) : null}
                </div>
                <div>
                  <Label>Design</Label>
                  <Input value={lm.designIndex} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['designIndex'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>District</Label>
                  <Input value={lm.district} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['district'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div>
                  <Label>Flags</Label>
                  <Input value={lm.flags} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['flags'], parseInt(e.target.value)||0) : x) })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Enabled</Label>
                  <Switch checked={lm.enabled === 1} onCheckedChange={checked => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? { ...lm, enabled: checked ? 1 : 0 } : x) })} />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onEditBox('landmark', i)}>Edit Box</Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => onChange({ ...data, landmarks: data.landmarks.filter((_, j) => j !== i) })}
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


