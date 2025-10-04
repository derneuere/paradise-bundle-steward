import React, { useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Removed ScrollArea in favor of TanStack Virtual lists
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ParsedTriggerData, Landmark, GenericRegion, Blackspot, VFXBoxRegion, TriggerRegionType, GenericRegionType, BlackspotScoreType, StuntCameraType, Vector4, SignatureStunt, Killzone, RoamingLocation, SpawnLocation } from '@/lib/core/triggerData';
import { SpawnType } from '@/lib/core/triggerData';

type TriggerDataEditorProps = {
  data: ParsedTriggerData;
  onChange: (next: ParsedTriggerData) => void;
};

function numberField<T extends object>(obj: T, path: (keyof any)[], value: number): T {
  const next = { ...(obj as any) };
  let cur: any = next;
  for (let i = 0; i < path.length - 1; i++) {
    cur[path[i]] = { ...cur[path[i]] };
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
  return next as T;
}

export const TriggerDataEditor: React.FC<TriggerDataEditorProps> = ({ data, onChange }) => {
  // =============================
  // regionIndex uniqueness helpers
  // =============================
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

  function ensureUniqueRegionIndex(value: number, exclude: { kind: 'landmark'|'generic'|'blackspot'|'vfx'; index: number }): number {
    let v = Math.max(0, value|0);
    const used = buildUsedSet(exclude);
    while (used.has(v)) v++;
    return v;
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

  // =============================
  // Small field helpers
  // =============================
  const vectorField = (v: Vector4, onVec: (nv: Vector4) => void) => (
    <div className="grid grid-cols-4 gap-2">
      <Input value={v.x} type="number" step="0.01" onChange={e => onVec({ ...v, x: parseFloat(e.target.value)||0 })} />
      <Input value={v.y} type="number" step="0.01" onChange={e => onVec({ ...v, y: parseFloat(e.target.value)||0 })} />
      <Input value={v.z} type="number" step="0.01" onChange={e => onVec({ ...v, z: parseFloat(e.target.value)||0 })} />
      <Input value={v.w} type="number" step="0.01" onChange={e => onVec({ ...v, w: parseFloat(e.target.value)||0 })} />
    </div>
  );

  function parseBigIntInput(str: string): bigint {
    const t = str.trim();
    if (t.length === 0) return 0n;
    if (/^0x/i.test(t)) return BigInt(t);
    return BigInt(Number.parseInt(t, 10) || 0);
  }

  function parseNumberArray(str: string): number[] {
    const cleaned = str.replace(/[^0-9,\-]/g, ',');
    return cleaned.split(',').map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  }

  function parseBigIntArray(str: string): bigint[] {
    const parts = str.split(',');
    const out: bigint[] = [];
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      try { out.push(parseBigIntInput(t)); } catch { /* ignore */ }
    }
    return out;
  }

  const LandmarksList: React.FC = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
      count: data.landmarks.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 96,
      overscan: 12,
    });
    const items = rowVirtualizer.getVirtualItems();
    return (
      <div ref={parentRef} className="h-[60vh] overflow-auto pr-2">
        {data.landmarks.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No landmarks</div>
        ) : null}
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {items.map(vi => {
            const i = vi.index;
            const lm = data.landmarks[i];
            return (
              <div
                key={vi.key}
                data-index={i}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center bg-background">
                  <div>
                    <Label>ID</Label>
                    <Input value={lm.id} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['id'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Region Index</Label>
                    <Input
                      value={lm.regionIndex}
                      type="number"
                      className={duplicateRegionIndexSet.has(lm.regionIndex|0) ? 'border-red-500' : undefined}
                      onChange={e => {
                        const raw = Number.parseInt(e.target.value)||0;
                        const unique = ensureUniqueRegionIndex(raw, { kind: 'landmark', index: i });
                        onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['regionIndex'], unique) : x) });
                      }}
                    />
                  </div>
                  <div>
                    <Label>Design</Label>
                    <Input value={lm.designIndex} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['designIndex'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>District</Label>
                    <Input value={lm.district} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['district'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Flags</Label>
                    <Input value={lm.flags} type="number" onChange={e => onChange({ ...data, landmarks: data.landmarks.map((x, j) => j===i ? numberField(lm, ['flags'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const HeaderEditor: React.FC = () => {
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

  const SignatureStuntsList: React.FC = () => {
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
          <Button size="sm" onClick={addSignatureStunt}>Add Stunt</Button>
        </div>
      </div>
    );
  };

  const KillzonesList: React.FC = () => {
    return (
      <div className="space-y-3">
        {data.killzones.length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">No killzones</div>
        ) : null}
        <div className="space-y-3">
          {data.killzones.map((kz, i) => (
            <div key={i} className="border rounded p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 items-center bg-background">
              <div>
                <Label>Trigger IDs (Generic Region mId list)</Label>
                <Input value={kz.triggerIds.join(',')} onChange={e => onChange({ ...data, killzones: data.killzones.map((x, j) => j===i ? { ...kz, triggerIds: parseNumberArray(e.target.value) } : x) })} />
              </div>
              <div>
                <Label>Region IDs (CgsID list)</Label>
                <Input value={kz.regionIds.map(v => String(v)).join(',')} onChange={e => onChange({ ...data, killzones: data.killzones.map((x, j) => j===i ? { ...kz, regionIds: parseBigIntArray(e.target.value) } : x) })} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => onChange({ ...data, killzones: data.killzones.filter((_, j) => j!==i) })}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={addKillzone}>Add Killzone</Button>
        </div>
      </div>
    );
  };

  const RoamingList: React.FC = () => {
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
          <Button size="sm" onClick={addRoaming}>Add Roaming</Button>
        </div>
      </div>
    );
  };

  const SpawnsList: React.FC = () => {
    return (
      <div className="space-y-3">
        {data.spawnLocations.length === 0 ? (
          <div className="text-sm text-muted-foreground p-2">No spawn locations</div>
        ) : null}
        <div className="space-y-3">
          {data.spawnLocations.map((sp, i) => (
            <div key={i} className="border rounded p-3 space-y-2 bg-background">
              <div>
                <Label>Position (x, y, z, w)</Label>
                {vectorField(sp.position, (nv) => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, position: nv } : x) }))}
              </div>
              <div>
                <Label>Direction (x, y, z, w)</Label>
                {vectorField(sp.direction, (nv) => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, direction: nv } : x) }))}
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div>
                  <Label>Junkyard CgsID</Label>
                  <Input value={String(sp.junkyardId)} onChange={e => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, junkyardId: parseBigIntInput(e.target.value) } : x) })} />
                </div>
                <div>
                  <Label>Type</Label>
                  <Input value={sp.type} type="number" onChange={e => onChange({ ...data, spawnLocations: data.spawnLocations.map((x, j) => j===i ? { ...sp, type: Number.parseInt(e.target.value)||0 } : x) })} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => onChange({ ...data, spawnLocations: data.spawnLocations.filter((_, j) => j!==i) })}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={addSpawn}>Add Spawn</Button>
        </div>
      </div>
    );
  };

  const GenericRegionsList: React.FC = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
      count: data.genericRegions.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 110,
      overscan: 12,
    });
    const items = rowVirtualizer.getVirtualItems();
    return (
      <div ref={parentRef} className="h-[60vh] overflow-auto pr-2">
        {data.genericRegions.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No generic regions</div>
        ) : null}
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {items.map(vi => {
            const i = vi.index;
            const gr = data.genericRegions[i];
            return (
              <div
                key={vi.key}
                data-index={i}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-center bg-background">
                  <div>
                    <Label>ID</Label>
                    <Input value={gr.id} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['id'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Region Index</Label>
                    <Input
                      value={gr.regionIndex}
                      type="number"
                      className={duplicateRegionIndexSet.has(gr.regionIndex|0) ? 'border-red-500' : undefined}
                      onChange={e => {
                        const raw = Number.parseInt(e.target.value)||0;
                        const unique = ensureUniqueRegionIndex(raw, { kind: 'generic', index: i });
                        onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['regionIndex'], unique) : x) });
                      }}
                    />
                  </div>
                  <div>
                    <Label>Group</Label>
                    <Input value={gr.groupId} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['groupId'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Type</Label>
                    <Input value={gr.genericType} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['genericType'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Cam1/Cam2</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={gr.cameraCut1} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['cameraCut1'], parseInt(e.target.value)||0) : x) })} />
                      <Input value={gr.cameraCut2} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['cameraCut2'], parseInt(e.target.value)||0) : x) })} />
                    </div>
                  </div>
                  <div>
                    <Label>One Way</Label>
                    <Input value={gr.isOneWay} type="number" onChange={e => onChange({ ...data, genericRegions: data.genericRegions.map((x, j) => j===i ? numberField(gr, ['isOneWay'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const BlackspotsList: React.FC = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
      count: data.blackspots.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 96,
      overscan: 12,
    });
    const items = rowVirtualizer.getVirtualItems();
    return (
      <div ref={parentRef} className="h-[60vh] overflow-auto pr-2">
        {data.blackspots.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No blackspots</div>
        ) : null}
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {items.map(vi => {
            const i = vi.index;
            const bs = data.blackspots[i];
            return (
              <div
                key={vi.key}
                data-index={i}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center bg-background">
                  <div>
                    <Label>ID</Label>
                    <Input value={bs.id} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['id'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Region Index</Label>
                    <Input
                      value={bs.regionIndex}
                      type="number"
                      className={duplicateRegionIndexSet.has(bs.regionIndex|0) ? 'border-red-500' : undefined}
                      onChange={e => {
                        const raw = Number.parseInt(e.target.value)||0;
                        const unique = ensureUniqueRegionIndex(raw, { kind: 'blackspot', index: i });
                        onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['regionIndex'], unique) : x) });
                      }}
                    />
                  </div>
                  <div>
                    <Label>Score Type</Label>
                    <Input value={bs.scoreType} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['scoreType'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Score Amount</Label>
                    <Input value={bs.scoreAmount} type="number" onChange={e => onChange({ ...data, blackspots: data.blackspots.map((x, j) => j===i ? numberField(bs, ['scoreAmount'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const VfxList: React.FC = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
      count: data.vfxBoxRegions.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 80,
      overscan: 12,
    });
    const items = rowVirtualizer.getVirtualItems();
    return (
      <div ref={parentRef} className="h-[60vh] overflow-auto pr-2">
        {data.vfxBoxRegions.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4">No VFX regions</div>
        ) : null}
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {items.map(vi => {
            const i = vi.index;
            const v = data.vfxBoxRegions[i];
            return (
              <div
                key={vi.key}
                data-index={i}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 right-0"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="mb-3 border rounded p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 items-center bg-background">
                  <div>
                    <Label>ID</Label>
                    <Input value={v.id} type="number" onChange={e => onChange({ ...data, vfxBoxRegions: data.vfxBoxRegions.map((x, j) => j===i ? numberField(v, ['id'], parseInt(e.target.value)||0) : x) })} />
                  </div>
                  <div>
                    <Label>Region Index</Label>
                    <Input
                      value={v.regionIndex}
                      type="number"
                      className={duplicateRegionIndexSet.has(v.regionIndex|0) ? 'border-red-500' : undefined}
                      onChange={e => {
                        const raw = Number.parseInt(e.target.value)||0;
                        const unique = ensureUniqueRegionIndex(raw, { kind: 'vfx', index: i });
                        onChange({ ...data, vfxBoxRegions: data.vfxBoxRegions.map((x, j) => j===i ? numberField(v, ['regionIndex'], unique) : x) });
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
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

      <Tabs defaultValue="landmarks" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 w-full gap-1">
          <TabsTrigger value="header">Header</TabsTrigger>
          <TabsTrigger value="landmarks">Landmarks</TabsTrigger>
          <TabsTrigger value="generic">Generic Regions</TabsTrigger>
          <TabsTrigger value="blackspots">Blackspots</TabsTrigger>
          <TabsTrigger value="vfx">VFX</TabsTrigger>
          <TabsTrigger value="stunts">Signature Stunts</TabsTrigger>
          <TabsTrigger value="killzones">Killzones</TabsTrigger>
          <TabsTrigger value="roaming">Roaming</TabsTrigger>
          <TabsTrigger value="spawns">Spawns</TabsTrigger>
        </TabsList>

        <TabsContent value="header">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Header</CardTitle>
            </CardHeader>
            <CardContent>
              <HeaderEditor />
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
              <LandmarksList />
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
              <GenericRegionsList />
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
              <BlackspotsList />
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
              <VfxList />
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
              <SignatureStuntsList />
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
              <KillzonesList />
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
              <RoamingList />
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
              <SpawnsList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};


