import React, { useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ParsedTriggerData, Landmark, GenericRegion, Blackspot, VFXBoxRegion, TriggerRegionType, GenericRegionType, BlackspotScoreType, StuntCameraType, Vector4, SignatureStunt, Killzone, RoamingLocation, SpawnLocation } from '@/lib/core/triggerData';
import { SpawnType } from '@/lib/core/triggerData';
import { LandmarksListComp } from './LandmarksListComp';
import { GenericRegionsListComp } from './GenericRegionsListComp';
import { BlackspotsListComp } from './BlackspotsListComp';
import { VfxListComp } from './VfxListComp';
import { HeaderEditor } from './HeaderEditor';
import { SignatureStuntsList } from './SignatureStuntsList';
import { KillzonesList } from './KillzonesList';
import { RoamingList } from './RoamingList';
import { SpawnsList } from './SpawnsList';
import { RegionsMap } from './RegionsMap';

type TriggerDataEditorProps = {
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
};

export const TriggerDataEditor: React.FC<TriggerDataEditorProps> = ({ data, onChange }) => {
  const [activeTab, setActiveTab] = useState<'header'|'map'|'landmarks'|'generic'|'blackspots'|'vfx'|'stunts'|'killzones'|'roaming'|'spawns'>('landmarks');
  const scrollPosRef = useRef<{ landmarks: number; generic: number; blackspots: number; vfx: number }>(
    { landmarks: 0, generic: 0, blackspots: 0, vfx: 0 }
  );

  const allRegionIndexes = useMemo(() => {
    return [
      ...data.vfxBoxRegions.map(r => r.regionIndex|0),
      ...data.blackspots.map(r => r.regionIndex|0),
      ...data.genericRegions.map(r => r.regionIndex|0),
      ...data.landmarks.map(r => r.regionIndex|0),
    ];
  }, [data]);

  const duplicateRegionIndexSet = useMemo(() => {
    const counts = new Map<number, number>();
    for (const v of allRegionIndexes) counts.set(v, (counts.get(v) ?? 0) + 1);
    const dups = new Set<number>();
    counts.forEach((c, k) => { if ((k|0) >= 0 && c > 1) dups.add(k); });
    return dups;
  }, [allRegionIndexes]);

  function buildUsedSet(exclude?: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }): Set<number> {
    const set = new Set<number>();
    data.vfxBoxRegions.forEach((r, i) => { if (!(exclude && exclude.kind==='vfx' && exclude.index===i)) set.add(r.regionIndex|0); });
    data.blackspots.forEach((r, i) => { if (!(exclude && exclude.kind==='blackspot' && exclude.index===i)) set.add(r.regionIndex|0); });
    data.genericRegions.forEach((r, i) => { if (!(exclude && exclude.kind==='generic' && exclude.index===i)) set.add(r.regionIndex|0); });
    data.landmarks.forEach((r, i) => { if (!(exclude && exclude.kind==='landmark' && exclude.index===i)) set.add(r.regionIndex|0); });
    return set;
  }

  function nextFreeRegionIndex(exclude?: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }): number {
    const used = buildUsedSet(exclude);
    let n = 0;
    while (used.has(n)) n++;
    return n;
  }

  type BoxField = 'positionX'|'positionY'|'positionZ'|'rotationX'|'rotationY'|'rotationZ'|'dimensionX'|'dimensionY'|'dimensionZ';
  type BoxEditKind = 'landmark'|'generic'|'blackspot'|'vfx';

  const [boxEditKind, setBoxEditKind] = useState<BoxEditKind>('landmark');
  const [boxEditIndex, setBoxEditIndex] = useState<number>(0);
  const [isBoxDialogOpen, setIsBoxDialogOpen] = useState(false);

  const kindToArray = useMemo(() => ({
    landmark: data.landmarks,
    generic: data.genericRegions,
    blackspot: data.blackspots,
    vfx: data.vfxBoxRegions,
  }), [data]);

  const kindToProp = {
    landmark: 'landmarks',
    generic: 'genericRegions',
    blackspot: 'blackspots',
    vfx: 'vfxBoxRegions',
  } as const;

  const currentArray = kindToArray[boxEditKind] as Array<{ box: Record<BoxField, number> }>;
  const safeIndex = Math.min(Math.max(0, boxEditIndex|0), Math.max(0, currentArray.length - 1));
  const currentItem = currentArray[safeIndex] as (undefined | { box: Record<BoxField, number> });
  const currentBox = currentItem?.box;

  function updateCurrentBox(field: BoxField, value: number) {
    const prop = kindToProp[boxEditKind];
    const arr = (data as any)[prop] as Array<any>;
    if (!arr || arr.length === 0) return;
    const idx = safeIndex;
    const nextArr = arr.slice();
    nextArr[idx] = { ...arr[idx], box: { ...arr[idx].box, [field]: value } };
    onChange({ ...(data as any), [prop]: nextArr });
  }

  function changeKind(nextKind: BoxEditKind) {
    setBoxEditKind(nextKind);
    setBoxEditIndex(0);
  }

  function openBoxEditor(kind: BoxEditKind, index: number) {
    setBoxEditKind(kind);
    setBoxEditIndex(index|0);
    setIsBoxDialogOpen(true);
  }

  const counts = useMemo(() => ({
    landmarks: data.landmarks.length,
    genericRegions: data.genericRegions.length,
    blackspots: data.blackspots.length,
    vfx: data.vfxBoxRegions.length,
    signatureStunts: data.signatureStunts.length,
    killzones: data.killzones.length,
    roamingLocations: data.roamingLocations.length,
    spawnLocations: data.spawnLocations.length,
    duplicates: duplicateRegionIndexSet.size
  }), [data, duplicateRegionIndexSet.size]);

  const addLandmark = () => {
    const lm: Landmark = {
      type: 0 as TriggerRegionType,
      id: 0,
      regionIndex: nextFreeRegionIndex(),
      box: { positionX:0, positionY:0, positionZ:0, rotationX:0, rotationY:0, rotationZ:0, dimensionX:1, dimensionY:1, dimensionZ:1 },
      startingGrids: [],
      designIndex: 0,
      district: 0,
      flags: 0,
    };
    onChange({ ...data, landmarks: [...data.landmarks, lm] });
  };

  const addGeneric = () => {
    const gr: GenericRegion = {
      type: 2 as TriggerRegionType,
      id: 0,
      regionIndex: nextFreeRegionIndex(),
      box: { positionX:0, positionY:0, positionZ:0, rotationX:0, rotationY:0, rotationZ:0, dimensionX:1, dimensionY:1, dimensionZ:1 },
      groupId: 0,
      cameraCut1: 0,
      cameraCut2: 0,
      cameraType1: 0 as StuntCameraType,
      cameraType2: 0 as StuntCameraType,
      genericType: 0 as GenericRegionType,
      isOneWay: 0,
    };
    onChange({ ...data, genericRegions: [...data.genericRegions, gr] });
  };

  const addBlackspot = () => {
    const bs: Blackspot = {
      type: 1 as TriggerRegionType,
      id: 0,
      regionIndex: nextFreeRegionIndex(),
      box: { positionX:0, positionY:0, positionZ:0, rotationX:0, rotationY:0, rotationZ:0, dimensionX:1, dimensionY:1, dimensionZ:1 },
      scoreType: 0 as BlackspotScoreType,
      scoreAmount: 0,
    };
    onChange({ ...data, blackspots: [...data.blackspots, bs] });
  };

  const addVfx = () => {
    const v: VFXBoxRegion = {
      type: 3 as TriggerRegionType,
      id: 0,
      regionIndex: nextFreeRegionIndex(),
      box: { positionX:0, positionY:0, positionZ:0, rotationX:0, rotationY:0, rotationZ:0, dimensionX:1, dimensionY:1, dimensionZ:1 }
    };
    onChange({ ...data, vfxBoxRegions: [...data.vfxBoxRegions, v] });
  };

  const addSignatureStunt = () => {
    const st: SignatureStunt = { id: 0n, camera: 0n, stuntElementRegionIds: [] };
    onChange({ ...data, signatureStunts: [...data.signatureStunts, st] });
  };

  const addKillzone = () => {
    const kz: Killzone = { triggerIds: [], regionIds: [] };
    onChange({ ...data, killzones: [...data.killzones, kz] });
  };

  const addRoaming = () => {
    const rl: RoamingLocation = { position: { x:0, y:0, z:0, w:0 }, districtIndex: 0 };
    onChange({ ...data, roamingLocations: [...data.roamingLocations, rl] });
  };

  const addSpawn = () => {
    const sp: SpawnLocation = { position: { x:0, y:0, z:0, w:0 }, direction: { x:0, y:0, z:0, w:0 }, junkyardId: 0n, type: SpawnType.E_TYPE_PLAYER_SPAWN };
    onChange({ ...data, spawnLocations: [...data.spawnLocations, sp] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Trigger Data Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4 text-sm">
          <div>Landmarks: <b>{counts.landmarks}</b></div>
          <div>Generic: <b>{counts.genericRegions}</b></div>
          <div>Blackspots: <b>{counts.blackspots}</b></div>
          <div>VFX: <b>{counts.vfx}</b></div>
          <div>Stunts: <b>{counts.signatureStunts}</b></div>
          <div>Killzones: <b>{counts.killzones}</b></div>
          <div>Roaming: <b>{counts.roamingLocations}</b></div>
          <div>Spawns: <b>{counts.spawnLocations}</b></div>
          {counts.duplicates > 0 ? (
            <div className="text-red-600">Duplicate regionIndex: <b>{counts.duplicates}</b></div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-9 w-full gap-1">
          <TabsTrigger value="header">Header</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="landmarks">Landmarks</TabsTrigger>
          <TabsTrigger value="generic">Generic Regions</TabsTrigger>
          <TabsTrigger value="blackspots">Blackspots</TabsTrigger>
          <TabsTrigger value="vfx">VFX</TabsTrigger>
          <TabsTrigger value="stunts">Signature Stunts</TabsTrigger>
          <TabsTrigger value="killzones">Killzones</TabsTrigger>
          <TabsTrigger value="roaming">Roaming</TabsTrigger>
          <TabsTrigger value="spawns">Spawns</TabsTrigger>
        </TabsList>
        <TabsContent value="map">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Region Map</CardTitle>
            </CardHeader>
            <CardContent>
              <RegionsMap data={data} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="header">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Header</CardTitle>
            </CardHeader>
            <CardContent>
              <HeaderEditor data={data} onChange={onChange} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="landmarks">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Landmarks</CardTitle>
              <Button size="sm" onClick={addLandmark}>Add</Button>
            </CardHeader>
            <CardContent>
              <LandmarksListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="generic">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Generic Regions</CardTitle>
              <Button size="sm" onClick={addGeneric}>Add</Button>
            </CardHeader>
            <CardContent>
              <GenericRegionsListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blackspots">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Blackspots</CardTitle>
              <Button size="sm" onClick={addBlackspot}>Add</Button>
            </CardHeader>
            <CardContent>
              <BlackspotsListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vfx">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>VFX Regions</CardTitle>
              <Button size="sm" onClick={addVfx}>Add</Button>
            </CardHeader>
            <CardContent>
              <VfxListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stunts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Signature Stunts</CardTitle>
              <Button size="sm" onClick={addSignatureStunt}>Add</Button>
            </CardHeader>
            <CardContent>
              <SignatureStuntsList data={data} onChange={onChange} onAdd={addSignatureStunt} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="killzones">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Killzones</CardTitle>
              <Button size="sm" onClick={addKillzone}>Add</Button>
            </CardHeader>
            <CardContent>
              <KillzonesList data={data} onChange={onChange} onAdd={addKillzone} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roaming">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Roaming Locations</CardTitle>
              <Button size="sm" onClick={addRoaming}>Add</Button>
            </CardHeader>
            <CardContent>
              <RoamingList data={data} onChange={onChange} onAdd={addRoaming} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spawns">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Spawn Locations</CardTitle>
              <Button size="sm" onClick={addSpawn}>Add</Button>
            </CardHeader>
            <CardContent>
              <SpawnsList data={data} onChange={onChange} onAdd={addSpawn} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog open={isBoxDialogOpen} onOpenChange={setIsBoxDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit Box — {boxEditKind} #{safeIndex}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {currentArray.length === 0 ? (
              <div className="text-sm text-muted-foreground">No items to edit.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['positionX','positionY','positionZ','rotationX','rotationY','rotationZ','dimensionX','dimensionY','dimensionZ'] as BoxField[]).map((f) => (
                  <div key={f} className="flex flex-col gap-1">
                    <label className="text-sm font-medium capitalize">{f}</label>
                    <input
                      type="number"
                      step="0.01"
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                      value={currentBox ? (currentBox[f] ?? 0) : 0}
                      onChange={(e) => updateCurrentBox(f, Number.parseFloat(e.target.value))}
                      disabled={!currentBox}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TriggerDataEditor;


