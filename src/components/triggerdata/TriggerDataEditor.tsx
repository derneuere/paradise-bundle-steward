import React, { useMemo, useRef, useState, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
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
import { BoxFieldsGrid } from './BoxFieldsGrid';
import { TriggerDataViewport, type TriggerSelection } from './TriggerDataViewport';

type TriggerDataEditorProps = {
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
};

export const TriggerDataEditor: React.FC<TriggerDataEditorProps> = ({ data, onChange }) => {
  const [activeTab, setActiveTab] = useState<'header'|'map'|'map3d'|'landmarks'|'generic'|'blackspots'|'vfx'|'stunts'|'killzones'|'roaming'|'spawns'>('landmarks');
  const [filterQuery, setFilterQuery] = useState('');
  const [triggerSel, setTriggerSel] = useState<TriggerSelection>(null);

  // When 3D viewport selection changes, switch to the matching tab
  useEffect(() => {
    if (!triggerSel) return;
    const tabMap: Record<string, typeof activeTab> = {
      landmark: 'landmarks', generic: 'generic', blackspot: 'blackspots',
      vfx: 'vfx', spawn: 'spawns', roaming: 'roaming', playerStart: 'header',
    };
    const target = tabMap[triggerSel.kind];
    if (target) setActiveTab(target);
  }, [triggerSel]);
  const scrollPosRef = useRef<{ landmarks: number; generic: number; blackspots: number; vfx: number }>(
    { landmarks: 0, generic: 0, blackspots: 0, vfx: 0 }
  );

  function matchesFilter(item: Record<string, unknown>, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    for (const v of Object.values(item)) {
      if (v == null) continue;
      if (typeof v === 'number' || typeof v === 'bigint') { if (String(v).includes(q)) return true; }
      else if (typeof v === 'string') { if (v.toLowerCase().includes(q)) return true; }
      else if (Array.isArray(v)) { if (v.some(x => String(x).toLowerCase().includes(q))) return true; }
      else if (typeof v === 'object') {
        // match vector/box sub-objects
        if (Object.values(v as Record<string, unknown>).some(sv => typeof sv === 'number' && String(sv).includes(q))) return true;
      }
    }
    return false;
  }

  function buildFilteredIndices<T extends Record<string, unknown>>(arr: T[]): number[] {
    if (!filterQuery) return arr.map((_, i) => i);
    return arr.reduce<number[]>((acc, item, i) => { if (matchesFilter(item, filterQuery)) acc.push(i); return acc; }, []);
  }

  const filteredLandmarkIndices = useMemo(() => buildFilteredIndices(data.landmarks), [data.landmarks, filterQuery]);
  const filteredGenericIndices = useMemo(() => buildFilteredIndices(data.genericRegions), [data.genericRegions, filterQuery]);
  const filteredBlackspotIndices = useMemo(() => buildFilteredIndices(data.blackspots), [data.blackspots, filterQuery]);
  const filteredVfxIndices = useMemo(() => buildFilteredIndices(data.vfxBoxRegions), [data.vfxBoxRegions, filterQuery]);
  const filteredStuntIndices = useMemo(() => buildFilteredIndices(data.signatureStunts as unknown as Record<string, unknown>[]), [data.signatureStunts, filterQuery]);
  const filteredKillzoneIndices = useMemo(() => buildFilteredIndices(data.killzones as unknown as Record<string, unknown>[]), [data.killzones, filterQuery]);
  const filteredRoamingIndices = useMemo(() => buildFilteredIndices(data.roamingLocations as unknown as Record<string, unknown>[]), [data.roamingLocations, filterQuery]);
  const filteredSpawnIndices = useMemo(() => buildFilteredIndices(data.spawnLocations as unknown as Record<string, unknown>[]), [data.spawnLocations, filterQuery]);

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
      enabled: 1,
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
      enabled: 1,
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
      enabled: 1,
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
      box: { positionX:0, positionY:0, positionZ:0, rotationX:0, rotationY:0, rotationZ:0, dimensionX:1, dimensionY:1, dimensionZ:1 },
      enabled: 1,
    };
    onChange({ ...data, vfxBoxRegions: [...data.vfxBoxRegions, v] });
  };

  const cloneLandmark = (index: number) => {
    const src = data.landmarks[index];
    if (!src) return;
    const nextId = data.landmarks.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
    const clone = { ...src, box: { ...src.box }, startingGrids: [...src.startingGrids], id: nextId, regionIndex: nextFreeRegionIndex() };
    onChange({ ...data, landmarks: [...data.landmarks.slice(0, index + 1), clone, ...data.landmarks.slice(index + 1)] });
  };

  const cloneGeneric = (index: number) => {
    const src = data.genericRegions[index];
    if (!src) return;
    const nextId = data.genericRegions.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
    const clone = { ...src, box: { ...src.box }, id: nextId, regionIndex: nextFreeRegionIndex() };
    onChange({ ...data, genericRegions: [...data.genericRegions.slice(0, index + 1), clone, ...data.genericRegions.slice(index + 1)] });
  };

  const cloneBlackspot = (index: number) => {
    const src = data.blackspots[index];
    if (!src) return;
    const nextId = data.blackspots.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
    const clone = { ...src, box: { ...src.box }, id: nextId, regionIndex: nextFreeRegionIndex() };
    onChange({ ...data, blackspots: [...data.blackspots.slice(0, index + 1), clone, ...data.blackspots.slice(index + 1)] });
  };

  const cloneVfx = (index: number) => {
    const src = data.vfxBoxRegions[index];
    if (!src) return;
    const nextId = data.vfxBoxRegions.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
    const clone = { ...src, box: { ...src.box }, id: nextId, regionIndex: nextFreeRegionIndex() };
    onChange({ ...data, vfxBoxRegions: [...data.vfxBoxRegions.slice(0, index + 1), clone, ...data.vfxBoxRegions.slice(index + 1)] });
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
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 w-full gap-1">
          <TabsTrigger value="header">Header</TabsTrigger>
          <TabsTrigger value="map">Map 2D</TabsTrigger>
          <TabsTrigger value="map3d">Map 3D</TabsTrigger>
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
              <CardTitle>Region Map (2D)</CardTitle>
            </CardHeader>
            <CardContent>
              <RegionsMap data={data} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map3d">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Region Map (3D)</CardTitle>
            </CardHeader>
            <CardContent>
              <TriggerDataViewport
                data={data}
                onChange={onChange}
                selected={triggerSel}
                onSelect={setTriggerSel}
              />
              <div className="mt-2 text-xs text-muted-foreground">
                Click regions to select. Colors: <span style={{color:'#44cc44'}}>Landmarks</span> | <span style={{color:'#4488cc'}}>Shops</span> | <span style={{color:'#9944cc'}}>Stunts/Jumps</span> | <span style={{color:'#cc4444'}}>Blackspots/Crash</span> | <span style={{color:'#cc44cc'}}>VFX</span> | <span style={{color:'#ffcc00'}}>Player Start</span>
              </div>
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
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Landmarks</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addLandmark}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <LandmarksListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
                onClone={cloneLandmark}
                filteredIndices={filteredLandmarkIndices}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="generic">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Generic Regions</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addGeneric}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <GenericRegionsListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
                onClone={cloneGeneric}
                filteredIndices={filteredGenericIndices}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blackspots">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Blackspots</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addBlackspot}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <BlackspotsListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
                onClone={cloneBlackspot}
                filteredIndices={filteredBlackspotIndices}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vfx">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>VFX Regions</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addVfx}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <VfxListComp
                data={data}
                onChange={onChange}
                duplicateRegionIndexSet={duplicateRegionIndexSet}
                ensureUniqueRegionIndex={() => 0}
                scrollPosRef={scrollPosRef}
                onEditBox={(kind, index) => openBoxEditor(kind, index)}
                onClone={cloneVfx}
                filteredIndices={filteredVfxIndices}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stunts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Signature Stunts</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addSignatureStunt}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <SignatureStuntsList data={data} onChange={onChange} onAdd={addSignatureStunt} filteredIndices={filteredStuntIndices} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="killzones">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Killzones</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addKillzone}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <KillzonesList data={data} onChange={onChange} onAdd={addKillzone} filteredIndices={filteredKillzoneIndices} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roaming">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Roaming Locations</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addRoaming}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <RoamingList data={data} onChange={onChange} onAdd={addRoaming} filteredIndices={filteredRoamingIndices} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spawns">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Spawn Locations</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 w-48" placeholder="Filter…" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} />
                </div>
                <Button size="sm" onClick={addSpawn}>Add</Button>
              </div>
            </CardHeader>
            <CardContent>
              <SpawnsList data={data} onChange={onChange} onAdd={addSpawn} filteredIndices={filteredSpawnIndices} />
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
              <BoxFieldsGrid box={currentBox ?? null} onChange={updateCurrentBox} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TriggerDataEditor;


