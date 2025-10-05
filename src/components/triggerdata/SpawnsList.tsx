import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ParsedTriggerData, SpawnType } from '@/lib/core/triggerData';
import { parseBigIntInput, vectorField } from './utils';

export const SpawnsList: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  onAdd: () => void;
}> = ({ data, onChange, onAdd }) => {
  return (
    <div className="space-y-3">
      {data.spawnLocations.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">No spawn locations</div>
      ) : null}
      <div className="space-y-3">
        {data.spawnLocations.map((sp, i) => (
          <div key={i} className="border rounded p-3 space-y-2 bg-background">
            <div>
              <Label>Position (x, y, z, w)</Label>
              {vectorField(sp.position, (nv) => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, position: nv } : x) }))}
            </div>
            <div>
              <Label>Direction (x, y, z, w)</Label>
              {vectorField(sp.direction, (nv) => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, direction: nv } : x) }))}
            </div>
            <div className="grid grid-cols-2 gap-2 items-center">
              <div>
                <Label>Junkyard CgsID</Label>
                <Input value={String(sp.junkyardId)} onChange={e => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, junkyardId: parseBigIntInput(e.target.value) } : x) })} />
              </div>
              <div>
                <Label>Type</Label>
                <Input value={sp.type} type="number" onChange={e => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, type: Number.parseInt(e.target.value)||0 } : x) })} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onChange({ ...data, spawnLocations: data.spawnLocations.filter((_, j) => j!==i) })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}>Add Spawn</Button>
      </div>
    </div>
  );
};


