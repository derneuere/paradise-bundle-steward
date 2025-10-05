import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { vectorField } from './utils';

export const HeaderEditor: React.FC<{ data: ParsedTriggerData; onChange: (next: ParsedTriggerData) => void; }> = ({ data, onChange }) => {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
        <div>
          <Label>Version</Label>
          <Input value={data.version} type="number" onChange={e => onChange({ ...data, version: Number.parseInt(e.target.value)||0 })} />
        </div>
        <div>
          <Label>Online Landmark Count</Label>
          <Input value={data.onlineLandmarkCount} type="number" onChange={e => onChange({ ...data, onlineLandmarkCount: Number.parseInt(e.target.value)||0 })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Player Start Position (x, y, z, w)</Label>
        {vectorField(data.playerStartPosition, (nv) => onChange({ ...data, playerStartPosition: nv }))}
      </div>
      <div className="space-y-2">
        <Label>Player Start Direction (x, y, z, w)</Label>
        {vectorField(data.playerStartDirection, (nv) => onChange({ ...data, playerStartDirection: nv }))}
      </div>
    </div>
  );
};


