// Build the canonical vehicle-part taxonomy across a whole VEHICLES/ folder by
// joining every car's DeformationSpec IK parts (0x1001C) to its real GraphicsSpec
// part locators (0x10006). For each partType it aggregates presence, position
// centroid, hinge axis, fold angle, detach behaviour and tag/joint counts — the
// template the deform-rig-mvp.ts auto-rigger relies on (which partType is the
// root, the body shell, the wheels, etc.). Writes a JSON summary + per-car rows.
//
// Run:  npx tsx scripts/parts-taxonomy.ts --veh <VEHICLES dir> [--out parts-taxonomy.json]
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBundle } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import { parseGraphicsSpecData } from '../src/lib/core/graphicsSpec';
import { parseDeformationSpecData, DEFORMATION_SPEC_TYPE_ID } from '../src/lib/core/deformationSpec';

const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
};
const VEH = arg('veh');
const OUT = arg('out') ?? 'parts-taxonomy.json';
if (!VEH) throw new Error('usage: --veh <VEHICLES dir> [--out parts-taxonomy.json]');
const GSPEC = 0x10006;

function abOf(p: string) { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
function gspecParts(id: string): { pos: number[] }[] | null {
  try {
    const ab = abOf(path.join(VEH, `VEH_${id}_GR.BIN`));
    const b = parseBundle(ab);
    const res = b.resources.find((r) => r.resourceTypeId === GSPEC);
    if (!res) return null;
    const gs = parseGraphicsSpecData(extractResourceRaw(ab, b, res));
    return gs.parts.map((p) => ({ pos: [p.locator[12], p.locator[13], p.locator[14]] }));
  } catch { return null; }
}

type PartRow = { partType: number; gfx: number; pos: number[] | null; joints: number; axis: number[] | null; maxAngle: number | null; detach: number | null; tags: number; driven: number };
const perCar: { id: string; ik: PartRow[]; glassPartTypes: number[]; nGfxReal: number | null }[] = [];

const files = fs.readdirSync(VEH).filter((f) => /^VEH_.*_AT\.BIN$/i.test(f));
let joinable = 0;
for (const f of files) {
  const id = f.replace(/^VEH_/i, '').replace(/_AT\.BIN$/i, '');
  try {
    const ab = abOf(path.join(VEH, f));
    const b = parseBundle(ab);
    const res = b.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID)!;
    const d = parseDeformationSpecData(extractResourceRaw(ab, b, res));
    const gp = gspecParts(id);
    if (gp) joinable++;
    const ik: PartRow[] = d.ikParts.map((p) => {
      const j0 = p.jointSpecs[0];
      const pos = gp && p.partGraphics >= 0 && p.partGraphics < gp.length ? gp[p.partGraphics].pos : null;
      return {
        partType: p.partType, gfx: p.partGraphics, pos,
        joints: p.jointSpecs.length,
        axis: j0 ? j0.axis.slice(0, 3) : null,
        maxAngle: j0 ? j0.maxJointAngle : null,
        detach: j0 ? j0.jointDetachThreshold : null,
        tags: p.numberOfTagPoints, driven: p.numberOfDrivenPoints,
      };
    });
    perCar.push({ id, ik, glassPartTypes: d.glassPanes.map((g) => g.partType), nGfxReal: gp ? gp.length : null });
  } catch { /* skip */ }
}

// ---- aggregate by partType ----
const byType: Record<number, { cars: Set<string>; n: number; pos: number[][]; axis: number[][]; maxA: number[]; det: number[]; tags: number[]; driven: number[]; joints: number[] }> = {};
for (const car of perCar) for (const p of car.ik) {
  const t = (byType[p.partType] ??= { cars: new Set(), n: 0, pos: [], axis: [], maxA: [], det: [], tags: [], driven: [], joints: [] });
  t.cars.add(car.id); t.n++;
  if (p.pos) t.pos.push(p.pos);
  if (p.axis) t.axis.push(p.axis);
  if (p.maxAngle != null) t.maxA.push(p.maxAngle);
  if (p.detach != null) t.det.push(p.detach);
  t.tags.push(p.tags); t.driven.push(p.driven); t.joints.push(p.joints);
}
const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const cen = (v: number[][]) => v.length ? [0, 1, 2].map((i) => +(mean(v.map((p) => p[i]))!).toFixed(2)) : null;
const spread = (v: number[][]) => { if (!v.length) return null; const c = cen(v)!; return +(mean(v.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])))!).toFixed(2); };

const nCars = perCar.length;
const template = Object.entries(byType).map(([t, s]) => ({
  partType: +t,
  inCars: s.cars.size, pctCars: +(100 * s.cars.size / nCars).toFixed(0),
  instances: s.n, avgPerCar: +(s.n / s.cars.size).toFixed(2),
  posCentroid: cen(s.pos), posSpread: spread(s.pos), posSamples: s.pos.length,
  axisCentroid: cen(s.axis),
  maxAngleDeg: s.maxA.length ? { med: +(med(s.maxA)! * 57.2958).toFixed(1), max: +(Math.max(...s.maxA) * 57.2958).toFixed(1) } : null,
  detach: s.det.length ? { med: +med(s.det)!.toFixed(2), pctUnbreakable: +(100 * s.det.filter((x) => x <= -0.9).length / s.det.length).toFixed(0) } : null,
  medTags: med(s.tags), medDriven: med(s.driven), medJoints: med(s.joints),
})).sort((a, b) => b.pctCars - a.pctCars);

const ikCounts = perCar.map((c) => c.ik.length).sort((a, b) => a - b);
const summary = {
  cars: nCars, joinableWithGraphicsSpec: joinable,
  ikPartCount: { min: ikCounts[0], max: ikCounts[ikCounts.length - 1], median: ikCounts[Math.floor(ikCounts.length / 2)] },
  // the "standard" part set = partTypes present in >=80% of cars
  standardPartTypes: template.filter((t) => t.pctCars >= 80).map((t) => t.partType),
  distinctPartTypes: template.length,
  template,
};
fs.writeFileSync(OUT, JSON.stringify({ summary, perCar }, null, 1));
console.log(JSON.stringify(summary, null, 1));
