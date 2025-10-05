import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import { parseBigIntInput, parseNumberArray } from './utils';

export const SignatureStuntsList: React.FC<{
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
  onAdd: () => void;
}> = ({ data, onChange, onAdd }) => {
  return (
    <div className="space-y-3">
      {data.signatureStunts.length === 0 ? (
        <div className="text-sm text-muted-foreground p-2">No signature stunts</div>
      ) : null}
      <div className="space-y-3">
        {data.signatureStunts.map((st, i) => (
          <div key={i} className="border rounded p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-center bg-background">
            <div className="sm:col-span-1">
              <Label>ID (CgsID)</Label>
              <Input value={String(st.id)} onChange={e => onChange({ ...data, signatureStunts: data.signatureStunts.map((x, j) => j===i ? { ...st, id: parseBigIntInput(e.target.value) } : x) })} />
            </div>
            <div className="sm:col-span-1">
              <Label>Camera (i64)</Label>
              <Input value={String(st.camera)} onChange={e => onChange({ ...data, signatureStunts: data.signatureStunts.map((x, j) => j===i ? { ...st, camera: parseBigIntInput(e.target.value) } : x) })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Stunt Element Region IDs (comma-separated)</Label>
              <Input value={st.stuntElementRegionIds.join(',')} onChange={e => onChange({ ...data, signatureStunts: data.signatureStunts.map((x, j) => j===i ? { ...st, stuntElementRegionIds: parseNumberArray(e.target.value) } : x) })} />
            </div>
            <div className="sm:col-span-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => onChange({ ...data, signatureStunts: data.signatureStunts.filter((_, j) => j!==i) })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}>Add Stunt</Button>
      </div>
    </div>
  );
};


