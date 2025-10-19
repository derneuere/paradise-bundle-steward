import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ChallengeListEntryAction } from '@/lib/core/challengeList';
import {
  ChallengeActionType,
  ChallengeCoopType,
  ChallengeModifier,
  CombineActionType,
  LocationType,
  ChallengeDataType,
  getOptions,
} from '@/lib/core/challengeList';
import { LocationDataEditor } from './LocationDataEditor';

type ActionEditorProps = {
  action: ChallengeListEntryAction;
  onChange: (updated: ChallengeListEntryAction) => void;
  actionIndex: number;
  disabled?: boolean;
};

const actionTypeOptions = getOptions('actionType');

const coopTypeOptions = getOptions('coopType');

const modifierOptions = getOptions('modifier');

const combineActionTypeOptions = getOptions('combineActionType');

const locationTypeOptions = getOptions('locationType');

const dataTypeOptions = getOptions('dataType');

export const ActionEditor: React.FC<ActionEditorProps> = ({ action, onChange, actionIndex, disabled }) => {
  const updateField = <K extends keyof ChallengeListEntryAction>(
    field: K,
    value: ChallengeListEntryAction[K]
  ) => {
    onChange({ ...action, [field]: value });
  };

  const updateLocationType = (index: number, value: number) => {
    const newTypes = [...action.locationType];
    newTypes[index] = value;
    updateField('locationType', newTypes);
  };

  const updateTargetValue = (index: number, value: number) => {
    const newValues = [...action.targetValue];
    newValues[index] = value;
    updateField('targetValue', newValues);
  };

  const updateTargetDataType = (index: number, value: number) => {
    const newTypes = [...action.targetDataType];
    newTypes[index] = value;
    updateField('targetDataType', newTypes);
  };

  if (disabled) {
    return (
      <Alert>
        <AlertDescription>
          Action {actionIndex} is disabled. Set "Number of Actions" to 2 to enable this action.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Action Type</Label>
          <Select
            value={action.actionType.toString()}
            onValueChange={(val) => updateField('actionType', parseInt(val))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actionTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value.toString()}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Co-op Type</Label>
          <Select
            value={action.coopType.toString()}
            onValueChange={(val) => updateField('coopType', parseInt(val))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {coopTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value.toString()}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Modifier</Label>
          <Select
            value={action.modifier.toString()}
            onValueChange={(val) => updateField('modifier', parseInt(val))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modifierOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value.toString()}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Combine Action Type</Label>
          <Select
            value={action.combineActionType.toString()}
            onValueChange={(val) => updateField('combineActionType', parseInt(val))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {combineActionTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value.toString()}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Time Limit (seconds)</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={Number.isFinite(action.timeLimit) ? action.timeLimit : 0}
            onChange={(e) => updateField('timeLimit', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label>Convoy Time (seconds)</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            value={Number.isFinite(action.convoyTime) ? action.convoyTime : 0}
            onChange={(e) => updateField('convoyTime', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Locations</Label>
        <div className="space-y-4 border rounded-lg p-4">
          <div>
            <Label className="text-sm">Number of Locations</Label>
            <Input
              type="number"
              min="0"
              max="4"
              value={action.numLocations}
              onChange={(e) => updateField('numLocations', parseInt(e.target.value) || 0)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Label className="text-sm">Location {i + 1} Type</Label>
                <Select
                  value={action.locationType[i]?.toString() || '0'}
                  onValueChange={(val) => updateLocationType(i, parseInt(val))}
                  disabled={i >= action.numLocations}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locationTypeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <LocationDataEditor
                key={i}
                locationData={action.locationData[i]}
                locationIndex={i}
                onChange={(updated) => {
                  const newData = [...action.locationData];
                  newData[i] = updated;
                  updateField('locationData', newData);
                }}
                disabled={i >= action.numLocations}
              />
            ))}
          </div>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Targets</Label>
        <div className="space-y-4 border rounded-lg p-4">
          <div>
            <Label className="text-sm">Number of Targets</Label>
            <Input
              type="number"
              min="0"
              max="2"
              value={action.numTargets}
              onChange={(e) => updateField('numTargets', parseInt(e.target.value) || 0)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div>
                  <Label className="text-sm">Target {i + 1} Value</Label>
                  <Input
                    type="number"
                    value={action.targetValue[i] || 0}
                    onChange={(e) => updateTargetValue(i, parseInt(e.target.value) || 0)}
                    disabled={i >= action.numTargets}
                  />
                </div>
                <div>
                  <Label className="text-sm">Target {i + 1} Data Type</Label>
                  <Select
                    value={action.targetDataType[i]?.toString() || '0'}
                    onValueChange={(val) => updateTargetDataType(i, parseInt(val))}
                    disabled={i >= action.numTargets}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dataTypeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value.toString()}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

