import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { vectorField } from './utils';

export const RoamingList: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  onAdd: () => void;
}> = ({ data, onChange, onAdd }) => {
  return (
    <div className="space-y-3">
      {data.roamingLocations.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">No roaming locations</div>
      ) : null}
      <div className="space-y-3">
        {data.roamingLocations.map((rl, i) => (
          <div key={i} className="border rounded p-3 space-y-2 bg-background">
            <div>
              <Label>Position (x, y, z, w)</Label>
              {vectorField(rl.position, (nv) => onChange({ ...data, roamingLocations: data.roamingLocations.map((x, j) => j===i ? { ...rl, position: nv } : x) }))}
            </div>
            <div>
              <Label>District</Label>
              <Input value={rl.districtIndex} type="number" onChange={e => onChange({ ...data, roamingLocations: data.roamingLocations.map((x, j) => j===i ? { ...rl, districtIndex: Number.parseInt(e.target.value)||0 } : x) })} />
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onChange({ ...data, roamingLocations: data.roamingLocations.filter((_, j) => j!==i) })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}>Add Roaming</Button>
      </div>
    </div>
  );
};


