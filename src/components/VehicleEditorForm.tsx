// Controlled form for a single VehicleListEntry.
//
// Mirrors the tab layout of the old VehicleEditor.tsx Dialog but without the
// Dialog chrome — the schema editor's inspector pane hosts this directly
// via the `vehicleListExtensions` registry. Edits propagate immediately via
// `onChange` rather than being staged in local state and committed on save.

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VehicleListEntry } from '@/lib/core/vehicleList';
import { getDecryptedId, Rank, VehicleType, CarType, LiveryType } from '@/lib/core/vehicleList';
import { CgsIdInput } from '@/components/common/CgsIdInput';

type VehicleEditorFormProps = {
  vehicle: VehicleListEntry;
  onChange: (next: VehicleListEntry) => void;
};

const VEHICLE_FLAGS = [
  { value: 0x1, label: 'Is Race Vehicle' },
  { value: 0x2, label: 'Can Check Traffic' },
  { value: 0x4, label: 'Can Be Checked' },
  { value: 0x8, label: 'Is Trailer' },
  { value: 0x10, label: 'Can Tow Trailer' },
  { value: 0x20, label: 'Can Be Painted' },
  { value: 0x40, label: 'Unknown 0' },
  { value: 0x80, label: 'Is First In Speed Range' },
  { value: 0x100, label: 'Has Switchable Boost' },
  { value: 0x200, label: 'Unknown 1' },
  { value: 0x400, label: 'Unknown 2' },
  { value: 0x800, label: 'Is WIP' },
  { value: 0x1000, label: 'Is From V10' },
  { value: 0x2000, label: 'Is From V13' },
  { value: 0x4000, label: 'Is From V14' },
  { value: 0x8000, label: 'Is From V15' },
  { value: 0x10000, label: 'Is From V16' },
  { value: 0x20000, label: 'Is From V17' },
  { value: 0x40000, label: 'Is From V18' },
  { value: 0x80000, label: 'Is From V19' },
];

const RANK_OPTIONS = [
  { value: Rank.LEARNERS_PERMIT, label: 'LEARNERS_PERMIT' },
  { value: Rank.D_CLASS, label: 'D_CLASS' },
  { value: Rank.C_CLASS, label: 'C_CLASS' },
  { value: Rank.B_CLASS, label: 'B_CLASS' },
  { value: Rank.A_CLASS, label: 'A_CLASS' },
  { value: Rank.BURNOUT_LICENSE, label: 'BURNOUT_LICENSE' },
];

const VEHICLE_TYPE_OPTIONS = [
  { value: VehicleType.CAR, label: 'CAR' },
  { value: VehicleType.BIKE, label: 'BIKE' },
  { value: VehicleType.PLANE, label: 'PLANE' },
];

const BOOST_TYPE_OPTIONS = [
  { value: CarType.SPEED, label: 'SPEED' },
  { value: CarType.AGGRESSION, label: 'AGGRESSION' },
  { value: CarType.STUNT, label: 'STUNT' },
  { value: CarType.NONE, label: 'NONE' },
  { value: CarType.LOCKED, label: 'LOCKED' },
];

const LIVERY_TYPE_OPTIONS = [
  { value: LiveryType.DEFAULT, label: 'DEFAULT' },
  { value: LiveryType.COLOUR, label: 'COLOUR' },
  { value: LiveryType.PATTERN, label: 'PATTERN' },
  { value: LiveryType.SILVER, label: 'SILVER' },
  { value: LiveryType.GOLD, label: 'GOLD' },
  { value: LiveryType.COMMUNITY, label: 'COMMUNITY' },
];

export const VehicleEditorForm = ({ vehicle, onChange }: VehicleEditorFormProps) => {
  // Dotted path setter — applies one update and fires onChange immediately.
  // Clones each nested object along the path so downstream consumers see a
  // fresh reference tree (matches the structural-sharing contract of the
  // schema editor's updateAtPath).
  const updateField = (path: string, value: unknown) => {
    const keys = path.split('.');
    const next: VehicleListEntry = { ...vehicle };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursor: any = next;
    for (let i = 0; i < keys.length - 1; i++) {
      cursor[keys[i]] = { ...cursor[keys[i]] };
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
    onChange(next);
  };

  const toggleFlag = (flagValue: number) => {
    const currentFlags = vehicle.gamePlayData.flags;
    const newFlags = currentFlags & flagValue ? currentFlags & ~flagValue : currentFlags | flagValue;
    updateField('gamePlayData.flags', newFlags >>> 0);
  };

  return (
    <Tabs defaultValue="basic" className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="basic">Basic</TabsTrigger>
        <TabsTrigger value="gameplay">Gameplay</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="audio">Audio</TabsTrigger>
        <TabsTrigger value="technical">Technical</TabsTrigger>
      </TabsList>

      <TabsContent value="basic" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="vehicleName">Vehicle Name</Label>
                <Input
                  id="vehicleName"
                  value={vehicle.vehicleName}
                  onChange={(e) => updateField('vehicleName', e.target.value)}
                  placeholder="Enter vehicle name"
                />
              </div>
              <div>
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <Input
                  id="manufacturer"
                  value={vehicle.manufacturer}
                  onChange={(e) => updateField('manufacturer', e.target.value)}
                  placeholder="Enter manufacturer"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <CgsIdInput
                  label="Vehicle ID (CgsID)"
                  value={vehicle.id}
                  onChange={(v) => updateField('id', v)}
                  allowHexToggle
                  allowDecimalToggle
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Decrypted: {getDecryptedId(vehicle.id)}
                </div>
              </div>
              <div>
                <CgsIdInput
                  label="Parent ID (CgsID)"
                  value={vehicle.parentId}
                  onChange={(v) => updateField('parentId', v)}
                  allowHexToggle
                  allowDecimalToggle
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Decrypted: {getDecryptedId(vehicle.parentId)}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="wheelName">Wheel Name</Label>
              <Input
                id="wheelName"
                value={vehicle.wheelName}
                onChange={(e) => updateField('wheelName', e.target.value)}
                placeholder="Enter wheel name"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="vehicleType">Vehicle Type</Label>
                <Select
                  value={vehicle.vehicleType.toString()}
                  onValueChange={(value) => updateField('vehicleType', parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="boostType">Boost Type</Label>
                <Select
                  value={vehicle.boostType.toString()}
                  onValueChange={(value) => updateField('boostType', parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOOST_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="liveryType">Livery Type</Label>
                <Select
                  value={vehicle.liveryType.toString()}
                  onValueChange={(value) => updateField('liveryType', parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIVERY_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="gameplay" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Gameplay Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="damageLimit">Damage Limit</Label>
                <Input
                  id="damageLimit"
                  type="number"
                  value={vehicle.gamePlayData.damageLimit}
                  onChange={(e) => updateField('gamePlayData.damageLimit', parseFloat(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="boostCapacity">Boost Capacity</Label>
                <Input
                  id="boostCapacity"
                  type="number"
                  value={vehicle.gamePlayData.boostCapacity}
                  onChange={(e) => updateField('gamePlayData.boostCapacity', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="boostBarLength">Boost Bar Length</Label>
                <Input
                  id="boostBarLength"
                  type="number"
                  value={vehicle.gamePlayData.boostBarLength}
                  onChange={(e) => updateField('gamePlayData.boostBarLength', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="unlockRank">Unlock Rank</Label>
                <Select
                  value={vehicle.gamePlayData.unlockRank.toString()}
                  onValueChange={(value) => updateField('gamePlayData.unlockRank', parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RANK_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value.toString()}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="strengthStat">Strength Stat</Label>
                <Input
                  id="strengthStat"
                  type="number"
                  value={vehicle.gamePlayData.strengthStat}
                  onChange={(e) => updateField('gamePlayData.strengthStat', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div>
              <Label>Vehicle Flags</Label>
              <div className="grid grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto border rounded p-3">
                {VEHICLE_FLAGS.map((flag) => (
                  <div key={flag.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`flag-${flag.value}`}
                      checked={(vehicle.gamePlayData.flags & flag.value) !== 0}
                      onCheckedChange={() => toggleFlag(flag.value)}
                    />
                    <Label htmlFor={`flag-${flag.value}`} className="text-sm">
                      {flag.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="performance" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Performance Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="topSpeedNormal">Top Speed (Normal)</Label>
                <Input
                  id="topSpeedNormal"
                  type="number"
                  value={vehicle.topSpeedNormal}
                  onChange={(e) => updateField('topSpeedNormal', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="topSpeedBoost">Top Speed (Boost)</Label>
                <Input
                  id="topSpeedBoost"
                  type="number"
                  value={vehicle.topSpeedBoost}
                  onChange={(e) => updateField('topSpeedBoost', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="speedStat">Speed GUI Stat</Label>
                <Input
                  id="speedStat"
                  type="number"
                  min="1"
                  max="10"
                  value={vehicle.topSpeedNormalGUIStat}
                  onChange={(e) => updateField('topSpeedNormalGUIStat', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="boostStat">Boost GUI Stat</Label>
                <Input
                  id="boostStat"
                  type="number"
                  min="1"
                  max="10"
                  value={vehicle.topSpeedBoostGUIStat}
                  onChange={(e) => updateField('topSpeedBoostGUIStat', parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="colorIndex">Color Index</Label>
                <Input
                  id="colorIndex"
                  type="number"
                  value={vehicle.colorIndex}
                  onChange={(e) => updateField('colorIndex', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="paletteIndex">Palette Index</Label>
                <Input
                  id="paletteIndex"
                  type="number"
                  value={vehicle.paletteIndex}
                  onChange={(e) => updateField('paletteIndex', parseInt(e.target.value))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="audio" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Audio Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <CgsIdInput
                  label="Exhaust Name (CgsID)"
                  value={vehicle.audioData.exhaustName}
                  onChange={(v) => updateField('audioData.exhaustName', v)}
                  allowHexToggle
                  allowDecimalToggle
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Decrypted: {getDecryptedId(vehicle.audioData.exhaustName)}
                </div>
              </div>
              <div>
                <CgsIdInput
                  label="Engine Name (CgsID)"
                  value={vehicle.audioData.engineName}
                  onChange={(v) => updateField('audioData.engineName', v)}
                  allowHexToggle
                  allowDecimalToggle
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Decrypted: {getDecryptedId(vehicle.audioData.engineName)}
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="rivalUnlockName">Rival Unlock Name</Label>
              <Input
                id="rivalUnlockName"
                value={vehicle.audioData.rivalUnlockName}
                onChange={(e) => updateField('audioData.rivalUnlockName', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="aiMusicLoop">AI Music Loop</Label>
              <Input
                id="aiMusicLoop"
                value={vehicle.audioData.aiMusicLoopContentSpec}
                onChange={(e) => updateField('audioData.aiMusicLoopContentSpec', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="aiExhaust1">AI Exhaust Index</Label>
                <Input
                  id="aiExhaust1"
                  type="number"
                  value={vehicle.audioData.aiExhaustIndex}
                  onChange={(e) => updateField('audioData.aiExhaustIndex', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="aiExhaust2">AI Exhaust 2nd Pick</Label>
                <Input
                  id="aiExhaust2"
                  type="number"
                  value={vehicle.audioData.aiExhaustIndex2ndPick}
                  onChange={(e) => updateField('audioData.aiExhaustIndex2ndPick', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="aiExhaust3">AI Exhaust 3rd Pick</Label>
                <Input
                  id="aiExhaust3"
                  type="number"
                  value={vehicle.audioData.aiExhaustIndex3rdPick}
                  onChange={(e) => updateField('audioData.aiExhaustIndex3rdPick', parseInt(e.target.value))}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="technical" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Technical Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="category">Category (Hex)</Label>
              <Input
                id="category"
                value={`0x${vehicle.category.toString(16).toUpperCase()}`}
                onChange={(e) => {
                  const hex = e.target.value.replace('0x', '');
                  const value = parseInt(hex, 16);
                  if (!isNaN(value)) updateField('category', value >>> 0);
                }}
              />
            </div>

            <div>
              <CgsIdInput
                label="Attribute Collection Key (GameDB)"
                value={vehicle.attribCollectionKey}
                onChange={(v) => updateField('attribCollectionKey', v)}
                isOnlyGameId
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <CgsIdInput
                  label="Exhaust Entity Key (GameDB)"
                  value={vehicle.audioData.exhaustEntityKey}
                  onChange={(v) => updateField('audioData.exhaustEntityKey', v)}
                  isOnlyGameId
                />
              </div>
              <div>
                <CgsIdInput
                  label="Engine Entity Key (GameDB)"
                  value={vehicle.audioData.engineEntityKey}
                  onChange={(v) => updateField('audioData.engineEntityKey', v)}
                  isOnlyGameId
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <CgsIdInput
                  label="Won Car Voice Over Key (GameDB)"
                  value={vehicle.audioData.wonCarVoiceOverKey}
                  onChange={(v) => updateField('audioData.wonCarVoiceOverKey', v)}
                  isOnlyGameId
                />
              </div>
              <div>
                <CgsIdInput
                  label="Rival Released Voice Over Key (GameDB)"
                  value={vehicle.audioData.rivalReleasedVoiceOverKey}
                  onChange={(v) => updateField('audioData.rivalReleasedVoiceOverKey', v)}
                  isOnlyGameId
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};
