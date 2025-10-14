import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LocationData } from '@/lib/core/challengeList';

type LocationDataEditorProps = {
  locationData: LocationData;
  locationIndex: number;
  onChange: (updated: LocationData) => void;
  disabled?: boolean;
};

export const LocationDataEditor: React.FC<LocationDataEditorProps> = ({
  locationData,
  locationIndex,
  onChange,
  disabled,
}) => {
  const updateField = <K extends keyof LocationData>(field: K, value: LocationData[K]) => {
    onChange({ ...locationData, [field]: value });
  };

  return (
    <div className={`border rounded p-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="text-sm font-medium mb-2">Location {locationIndex + 1} Data</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <Label className="text-xs">District</Label>
          <Input
            type="number"
            value={locationData.district}
            onChange={(e) => updateField('district', parseInt(e.target.value) || 0)}
            disabled={disabled}
            className="h-8"
          />
        </div>
        <div>
          <Label className="text-xs">County</Label>
          <Input
            type="number"
            value={locationData.county}
            onChange={(e) => updateField('county', parseInt(e.target.value) || 0)}
            disabled={disabled}
            className="h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Trigger ID</Label>
          <Input
            type="text"
            value={locationData.triggerID.toString()}
            onChange={(e) => {
              try {
                updateField('triggerID', BigInt(e.target.value || '0'));
              } catch {
                // Invalid bigint, ignore
              }
            }}
            disabled={disabled}
            className="h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Road ID</Label>
          <Input
            type="text"
            value={locationData.roadID.toString()}
            onChange={(e) => {
              try {
                updateField('roadID', BigInt(e.target.value || '0'));
              } catch {
                // Invalid bigint, ignore
              }
            }}
            disabled={disabled}
            className="h-8"
          />
        </div>
      </div>
    </div>
  );
};

