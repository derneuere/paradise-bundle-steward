import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { parseBigIntArray, parseNumberArray } from './utils';

export const KillzonesList: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  onAdd: () => void;
}> = ({ data, onChange, onAdd }) => {
  return (
    <div className="space-y-3">
      {data.killzones.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">No killzones</div>
      ) : null}
      <div className="space-y-3">
        {data.killzones.map((kz, i) => (
          <div key={i} className="border rounded p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 items-center bg-background">
            <div>
              <Label>Trigger IDs (Generic Region mId list)</Label>
              <Input value={kz.triggerIds.join(',')} onChange={e => onChange({ ...data, killzones: data.killzones.map((x, j) => j===i ? { ...kz, triggerIds: parseNumberArray(e.target.value) } : x) })} />
            </div>
            <div>
              <Label>Region IDs (CgsID list)</Label>
              <Input value={kz.regionIds.map(v => String(v)).join(',')} onChange={e => onChange({ ...data, killzones: data.killzones.map((x, j) => j===i ? { ...kz, regionIds: parseBigIntArray(e.target.value) } : x) })} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onChange({ ...data, killzones: data.killzones.filter((_, j) => j!==i) })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}>Add Killzone</Button>
      </div>
    </div>
  );
};


