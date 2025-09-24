import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { VehicleListEntry } from '@/lib/parsers/vehicleListParser';
import { getDecryptedId } from '@/lib/parsers/vehicleListParser';
import { Rank, VehicleType, CarType, LiveryType } from '@/lib/core/types';

type VehicleEditorProps = {
  vehicle: VehicleListEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (vehicle: VehicleListEntry) => void;
  isNewVehicle?: boolean;
}

const VEHICLE_FLAGS = [
  { value: 1, label: 'Is Race Vehicle' },
  { value: 2, label: 'Can Check Traffic' },
  { value: 4, label: 'Can Be Checked' },
  { value: 8, label: 'Is Trailer' },
  { value: 16, label: 'Can Tow Trailer' },
  { value: 32, label: 'Can Be Painted' },
  { value: 64, label: 'Unknown 0' },
  { value: 128, label: 'Is First In Speed Range' },
  { value: 256, label: 'Has Switchable Boost' },
  { value: 512, label: 'Unknown 1' },
  { value: 1024, label: 'Unknown 2' },
  { value: 2048, label: 'Is WIP' },
  { value: 4096, label: 'Is From V10' },
  { value: 8192, label: 'Is From V13' },
  { value: 16384, label: 'Is From V14' },
  { value: 32768, label: 'Is From V15' },
  { value: 65536, label: 'Is From V16' },
  { value: 131072, label: 'Is From V17' },
  { value: 262144, label: 'Is From V18' },
  { value: 524288, label: 'Is From V19' },
];

const RANK_OPTIONS = [
  { value: Rank.LEARNERS_PERMIT, label: 'LEARNERS_PERMIT' },
  { value: Rank.D_CLASS, label: 'D_CLASS' },
  { value: Rank.C_CLASS, label: 'C_CLASS' },
  { value: Rank.B_CLASS, label: 'B_CLASS' },
  { value: Rank.A_CLASS, label: 'A_CLASS' },
  { value: Rank.BURNOUT_LICENSE, label: 'BURNOUT_LICENSE' }
];

const VEHICLE_TYPE_OPTIONS = [
  { value: VehicleType.CAR, label: 'CAR' },
  { value: VehicleType.BIKE, label: 'BIKE' },
  { value: VehicleType.PLANE, label: 'PLANE' }
];

const BOOST_TYPE_OPTIONS = [
  { value: CarType.SPEED, label: 'SPEED' },
  { value: CarType.AGGRESSION, label: 'AGGRESSION' },
  { value: CarType.STUNT, label: 'STUNT' }
];

const LIVERY_TYPE_OPTIONS = [
  { value: LiveryType.DEFAULT, label: 'DEFAULT' },
  { value: LiveryType.COLOUR, label: 'COLOUR' },
  { value: LiveryType.PATTERN, label: 'PATTERN' }
];

export const VehicleEditor = ({ vehicle, isOpen, onClose, onSave, isNewVehicle = false }: VehicleEditorProps) => {
  const [editedVehicle, setEditedVehicle] = useState<VehicleListEntry | null>(null);

  useEffect(() => {
    if (vehicle) {
      setEditedVehicle({ ...vehicle });
    } else if (isNewVehicle) {
      // Create a new vehicle with default values
      setEditedVehicle({
        id: 0n,
        parentId: 0n,
        wheelName: '',
        vehicleName: '',
        manufacturer: '',
        gamePlayData: {
          damageLimit: 100,
          flags: 0,
          boostBarLength: 100,
          unlockRank: Rank.LEARNERS_PERMIT,
          boostCapacity: 100,
          strengthStat: 100
        },
        attribCollectionKey: 0n,
        audioData: {
          exhaustName: 0n,
          exhaustEntityKey: 0n,
          engineEntityKey: 0n,
          engineName: 0n,
          rivalUnlockName: '',
          wonCarVoiceOverKey: 0n,
          rivalReleasedVoiceOverKey: 0n,
          aiMusicLoopContentSpec: '',
          aiExhaustIndex: 0,
          aiExhaustIndex2ndPick: 0,
          aiExhaustIndex3rdPick: 0
        },
        category: 0,
        vehicleType: VehicleType.CAR,
        boostType: CarType.SPEED,
        liveryType: LiveryType.DEFAULT,
        topSpeedNormal: 100,
        topSpeedBoost: 120,
        topSpeedNormalGUIStat: 5,
        topSpeedBoostGUIStat: 6,
        colorIndex: 0,
        paletteIndex: 0
      });
    }
  }, [vehicle, isNewVehicle]);

  const handleSave = () => {
    if (!editedVehicle) return;
    onSave(editedVehicle);
    onClose();
  };

  const updateField = (path: string, value: any) => {
    if (!editedVehicle) return;
    
    setEditedVehicle(prev => {
      if (!prev) return null;
      
      const keys = path.split('.');
      const newVehicle = { ...prev };
      let current: any = newVehicle;
      
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      
      current[keys[keys.length - 1]] = value;
      return newVehicle;
    });
  };

  const toggleFlag = (flagValue: number) => {
    if (!editedVehicle) return;
    const currentFlags = editedVehicle.gamePlayData.flags;
    const newFlags = currentFlags & flagValue ? currentFlags & ~flagValue : currentFlags | flagValue;
    updateField('gamePlayData.flags', newFlags);
  };

  if (!editedVehicle) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNewVehicle ? 'Add New Vehicle' : `Edit Vehicle: ${editedVehicle.vehicleName}`}
          </DialogTitle>
        </DialogHeader>

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
                      value={editedVehicle.vehicleName}
                      onChange={(e) => updateField('vehicleName', e.target.value)}
                      placeholder="Enter vehicle name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="manufacturer">Manufacturer</Label>
                    <Input
                      id="manufacturer"
                      value={editedVehicle.manufacturer}
                      onChange={(e) => updateField('manufacturer', e.target.value)}
                      placeholder="Enter manufacturer"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="vehicleId">Vehicle ID (Hex)</Label>
                    <Input
                      id="vehicleId"
                      value={`0x${editedVehicle.id.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('id', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                      placeholder="Enter vehicle ID as hex"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Decrypted: {getDecryptedId(editedVehicle.id)}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="parentId">Parent ID (Hex)</Label>
                    <Input
                      id="parentId"
                      value={`0x${editedVehicle.parentId.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('parentId', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                      placeholder="Enter parent ID as hex"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Decrypted: {getDecryptedId(editedVehicle.parentId)}
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="wheelName">Wheel Name</Label>
                  <Input
                    id="wheelName"
                    value={editedVehicle.wheelName}
                    onChange={(e) => updateField('wheelName', e.target.value)}
                    placeholder="Enter wheel name"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="vehicleType">Vehicle Type</Label>
                    <Select value={editedVehicle.vehicleType.toString()} onValueChange={(value) => updateField('vehicleType', parseInt(value))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VEHICLE_TYPE_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="boostType">Boost Type</Label>
                    <Select value={editedVehicle.boostType.toString()} onValueChange={(value) => updateField('boostType', parseInt(value))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOOST_TYPE_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="liveryType">Livery Type</Label>
                    <Select value={editedVehicle.liveryType.toString()} onValueChange={(value) => updateField('liveryType', parseInt(value))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LIVERY_TYPE_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
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
                      value={editedVehicle.gamePlayData.damageLimit}
                      onChange={(e) => updateField('gamePlayData.damageLimit', parseFloat(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="boostCapacity">Boost Capacity</Label>
                    <Input
                      id="boostCapacity"
                      type="number"
                      value={editedVehicle.gamePlayData.boostCapacity}
                      onChange={(e) => updateField('gamePlayData.boostCapacity', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="boostBarLength">Boost Bar Length</Label>
                    <Input
                      id="boostBarLength"
                      type="number"
                      value={editedVehicle.gamePlayData.boostBarLength}
                      onChange={(e) => updateField('gamePlayData.boostBarLength', parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="unlockRank">Unlock Rank</Label>
                    <Select value={editedVehicle.gamePlayData.unlockRank.toString()} onValueChange={(value) => updateField('gamePlayData.unlockRank', parseInt(value))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RANK_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value.toString()}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="strengthStat">Strength Stat</Label>
                    <Input
                      id="strengthStat"
                      type="number"
                      value={editedVehicle.gamePlayData.strengthStat}
                      onChange={(e) => updateField('gamePlayData.strengthStat', parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <Label>Vehicle Flags</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2 max-h-40 overflow-y-auto border rounded p-3">
                    {VEHICLE_FLAGS.map(flag => (
                      <div key={flag.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`flag-${flag.value}`}
                          checked={(editedVehicle.gamePlayData.flags & flag.value) !== 0}
                          onCheckedChange={() => toggleFlag(flag.value)}
                        />
                        <Label htmlFor={`flag-${flag.value}`} className="text-sm">{flag.label}</Label>
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
                      value={editedVehicle.topSpeedNormal}
                      onChange={(e) => updateField('topSpeedNormal', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="topSpeedBoost">Top Speed (Boost)</Label>
                    <Input
                      id="topSpeedBoost"
                      type="number"
                      value={editedVehicle.topSpeedBoost}
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
                      value={editedVehicle.topSpeedNormalGUIStat}
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
                      value={editedVehicle.topSpeedBoostGUIStat}
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
                      value={editedVehicle.colorIndex}
                      onChange={(e) => updateField('colorIndex', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="paletteIndex">Palette Index</Label>
                    <Input
                      id="paletteIndex"
                      type="number"
                      value={editedVehicle.paletteIndex}
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
                    <Label htmlFor="exhaustName">Exhaust Name (Hex)</Label>
                    <Input
                      id="exhaustName"
                      value={`0x${editedVehicle.audioData.exhaustName.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.exhaustName', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Decrypted: {getDecryptedId(editedVehicle.audioData.exhaustName)}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="engineName">Engine Name (Hex)</Label>
                    <Input
                      id="engineName"
                      value={`0x${editedVehicle.audioData.engineName.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.engineName', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Decrypted: {getDecryptedId(editedVehicle.audioData.engineName)}
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="rivalUnlockName">Rival Unlock Name</Label>
                  <Input
                    id="rivalUnlockName"
                    value={editedVehicle.audioData.rivalUnlockName}
                    onChange={(e) => updateField('audioData.rivalUnlockName', e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="aiMusicLoop">AI Music Loop</Label>
                  <Input
                    id="aiMusicLoop"
                    value={editedVehicle.audioData.aiMusicLoopContentSpec}
                    onChange={(e) => updateField('audioData.aiMusicLoopContentSpec', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="aiExhaust1">AI Exhaust Index</Label>
                    <Input
                      id="aiExhaust1"
                      type="number"
                      value={editedVehicle.audioData.aiExhaustIndex}
                      onChange={(e) => updateField('audioData.aiExhaustIndex', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="aiExhaust2">AI Exhaust 2nd Pick</Label>
                    <Input
                      id="aiExhaust2"
                      type="number"
                      value={editedVehicle.audioData.aiExhaustIndex2ndPick}
                      onChange={(e) => updateField('audioData.aiExhaustIndex2ndPick', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="aiExhaust3">AI Exhaust 3rd Pick</Label>
                    <Input
                      id="aiExhaust3"
                      type="number"
                      value={editedVehicle.audioData.aiExhaustIndex3rdPick}
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
                    value={`0x${editedVehicle.category.toString(16).toUpperCase()}`}
                    onChange={(e) => {
                      const hex = e.target.value.replace('0x', '');
                      const value = parseInt(hex, 16);
                      if (!isNaN(value)) updateField('category', value);
                    }}
                  />
                </div>

                <div>
                  <Label htmlFor="attribKey">Attribute Collection Key (Hex)</Label>
                  <Input
                    id="attribKey"
                    value={`0x${editedVehicle.attribCollectionKey.toString(16).toUpperCase()}`}
                    onChange={(e) => {
                      const hex = e.target.value.replace('0x', '');
                      try {
                        const value = BigInt(`0x${hex}`);
                        updateField('attribCollectionKey', value);
                      } catch (e) {
                        // Invalid hex, ignore
                      }
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="exhaustEntityKey">Exhaust Entity Key (Hex)</Label>
                    <Input
                      id="exhaustEntityKey"
                      value={`0x${editedVehicle.audioData.exhaustEntityKey.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.exhaustEntityKey', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="engineEntityKey">Engine Entity Key (Hex)</Label>
                    <Input
                      id="engineEntityKey"
                      value={`0x${editedVehicle.audioData.engineEntityKey.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.engineEntityKey', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="wonCarVoiceOverKey">Won Car Voice Over Key (Hex)</Label>
                    <Input
                      id="wonCarVoiceOverKey"
                      value={`0x${editedVehicle.audioData.wonCarVoiceOverKey.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.wonCarVoiceOverKey', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rivalReleasedVoiceOverKey">Rival Released Voice Over Key (Hex)</Label>
                    <Input
                      id="rivalReleasedVoiceOverKey"
                      value={`0x${editedVehicle.audioData.rivalReleasedVoiceOverKey.toString(16).toUpperCase()}`}
                      onChange={(e) => {
                        const hex = e.target.value.replace('0x', '');
                        try {
                          const value = BigInt(`0x${hex}`);
                          updateField('audioData.rivalReleasedVoiceOverKey', value);
                        } catch (e) {
                          // Invalid hex, ignore
                        }
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Vehicle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}; 