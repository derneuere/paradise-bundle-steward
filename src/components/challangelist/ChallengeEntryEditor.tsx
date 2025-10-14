import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ChallengeListEntry } from '@/lib/core/challengeList';
import {
  ChallengeDifficulty,
  CarRestrictionType,
  EntitlementGroup,
} from '@/lib/core/challengeList';
import { ActionEditor } from './ActionEditor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type ChallengeEntryEditorProps = {
  challenge: ChallengeListEntry;
  onChange: (updated: ChallengeListEntry) => void;
};

export const ChallengeEntryEditor: React.FC<ChallengeEntryEditorProps> = ({ challenge, onChange }) => {
  const updateField = <K extends keyof ChallengeListEntry>(field: K, value: ChallengeListEntry[K]) => {
    onChange({ ...challenge, [field]: value });
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="action1">Action 1</TabsTrigger>
          <TabsTrigger value="action2">Action 2</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Title String ID</Label>
              <Input
                value={challenge.titleStringID}
                onChange={(e) => updateField('titleStringID', e.target.value)}
                placeholder="FBCT_<GameDB ID>"
              />
            </div>
            <div>
              <Label>Description String ID</Label>
              <Input
                value={challenge.descriptionStringID}
                onChange={(e) => updateField('descriptionStringID', e.target.value)}
                placeholder="FBCD_<GameDB ID>"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label>Challenge ID</Label>
              <Input
                type="text"
                value={challenge.challengeID.toString()}
                onChange={(e) => {
                  const val = e.target.value;
                  try {
                    updateField('challengeID', BigInt(val || '0'));
                  } catch {
                    // Invalid bigint, ignore
                  }
                }}
              />
            </div>
            <div>
              <Label>Difficulty</Label>
              <Select
                value={challenge.difficulty.toString()}
                onValueChange={(val) => updateField('difficulty', parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ChallengeDifficulty.EASY.toString()}>Easy</SelectItem>
                  <SelectItem value={ChallengeDifficulty.MEDIUM.toString()}>Medium</SelectItem>
                  <SelectItem value={ChallengeDifficulty.HARD.toString()}>Hard</SelectItem>
                  <SelectItem value={ChallengeDifficulty.VERY_HARD.toString()}>Very Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Number of Players</Label>
              <Select
                value={challenge.numPlayers.toString()}
                onValueChange={(val) => updateField('numPlayers', parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="34">2 Players (0x22)</SelectItem>
                  <SelectItem value="51">3 Players (0x33)</SelectItem>
                  <SelectItem value="68">4 Players (0x44)</SelectItem>
                  <SelectItem value="85">5 Players (0x55)</SelectItem>
                  <SelectItem value="102">6 Players (0x66)</SelectItem>
                  <SelectItem value="119">7 Players (0x77)</SelectItem>
                  <SelectItem value="136">8 Players (0x88)</SelectItem>
                  <SelectItem value="153">9 Players (0x99)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Number of Actions</Label>
              <Select
                value={challenge.numActions.toString()}
                onValueChange={(val) => updateField('numActions', parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 Action</SelectItem>
                  <SelectItem value="2">2 Actions</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Entitlement Group</Label>
              <Select
                value={challenge.entitlementGroup.toString()}
                onValueChange={(val) => updateField('entitlementGroup', parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EntitlementGroup.RELEASE.toString()}>Release</SelectItem>
                  <SelectItem value={EntitlementGroup.UNKNOWN_DLC.toString()}>Unknown DLC</SelectItem>
                  <SelectItem value={EntitlementGroup.UNKNOWN_DLC_2.toString()}>Unknown DLC 2</SelectItem>
                  <SelectItem value={EntitlementGroup.CAGNEY.toString()}>Cagney</SelectItem>
                  <SelectItem value={EntitlementGroup.DAVIS.toString()}>Davis</SelectItem>
                  <SelectItem value={EntitlementGroup.ISLAND.toString()}>Island</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Car Restriction Type</Label>
              <Select
                value={challenge.carType.toString()}
                onValueChange={(val) => updateField('carType', parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CarRestrictionType.NONE.toString()}>None</SelectItem>
                  <SelectItem value={CarRestrictionType.DANGER.toString()}>Danger</SelectItem>
                  <SelectItem value={CarRestrictionType.AGGRESSION.toString()}>Aggression</SelectItem>
                  <SelectItem value={CarRestrictionType.STUNT.toString()}>Stunt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="action1">
          <ActionEditor
            action={challenge.actions[0]}
            onChange={(updated) => {
              const newActions = [...challenge.actions];
              newActions[0] = updated;
              updateField('actions', newActions);
            }}
            actionIndex={1}
          />
        </TabsContent>

        <TabsContent value="action2">
          <ActionEditor
            action={challenge.actions[1]}
            onChange={(updated) => {
              const newActions = [...challenge.actions];
              newActions[1] = updated;
              updateField('actions', newActions);
            }}
            actionIndex={2}
            disabled={challenge.numActions < 2}
          />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <Label>Car ID</Label>
              <Input
                type="text"
                value={challenge.carID.toString()}
                onChange={(e) => {
                  const val = e.target.value;
                  try {
                    updateField('carID', BigInt(val || '0'));
                  } catch {
                    // Invalid bigint, ignore
                  }
                }}
              />
            </div>
            <div>
              <Label>Car Colour Index</Label>
              <Input
                type="number"
                value={challenge.carColourIndex}
                onChange={(e) => updateField('carColourIndex', parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label>Car Colour Palette Index</Label>
              <Input
                type="number"
                value={challenge.carColourPaletteIndex}
                onChange={(e) => updateField('carColourPaletteIndex', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

