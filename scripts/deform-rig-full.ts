// Panel crash rig for a vehicle whose _GR body is split into separate meshes
// (bonnet, doors, bumpers, spoiler, ... as their own GraphicsSpec parts).
//
// Keeps the DONOR car's whole IK hierarchy and retargets each donor panel onto
// the target mesh nearest to it, so panels hinge and break off where the
// target actually has them. Same remap/physics/wheel handling as
// deform-rig-mvp.ts; the differences:
//   * Each donor panel is matched to a target part by the centroid of its own
//     (remapped) tag points: one-to-one, nearest pair first, never across the
//     car's centre line, and only within --max-match metres.
//   * Big target meshes besides the shell (any part >= --fused of the shell's
//     box volume) are fused body sections: no panel may drive them, or the
//     body itself would fly off. They stay rigid with the car.
//   * A matched panel keeps the donor's joints (pivots remapped), angles and
//     break thresholds. Unmatched donor parts are neutralised in place.
//   * The bonnet (type 3) only ever hinges open; the engine never breaks it off.
//
// Run (pure parse/write, no GL):
//   npx tsx scripts/deform-rig-full.ts \
//     --donor <VEH_<car>_AT.BIN> --target-gr <_GR> --target-at <_AT> --out <_AT> \
//     [--donor-gr <_GR>] [--corners a,b,c,d] [--max-match 0.6] [--fused 0.35] [--veh <VEHICLES dir>]
//
// Writes only to --out. Check the result with preview-deform.ts --explode.

import type { IKPart, Vec3 } from '../src/lib/core/deformationSpec';
import {
	PART_BODY_SHELL, PART_ROOT, WHEEL_PARTS, canLeaveCar, crashBehaviour, partName,
} from './lib/deform-rig/parts';
import { analyzeTarget, readGfxBody, type GfxPart } from './lib/deform-rig/geometry';
import { arg, cloneSpec, readDeformationSpec, writeRigBundle } from './lib/deform-rig/io';
import {
	adoptTargetPhysics, bindPartToGfx, boxRemap, makeNeverDetach, neutralizePart, ownWheelMeshes, partTags, placeWheels,
	remapSpec, stripJoints, toMeshSpace,
} from './lib/deform-rig/spec';
import { checkRig, reportSkinRows } from './lib/deform-rig/report';

const DONOR = arg('donor'), TARGET_GR = arg('target-gr'), TARGET_AT = arg('target-at'), OUT = arg('out');
if (!DONOR || !TARGET_GR || !TARGET_AT || !OUT) {
	throw new Error('usage: --donor <_AT> --target-gr <_GR> --target-at <_AT> --out <_AT> '
		+ '[--donor-gr <_GR>] [--corners a,b,c,d] [--max-match m] [--fused f] [--veh <dir>]');
}
const MAX_MATCH = Number(arg('max-match') ?? 0.6);
const FUSED = Number(arg('fused') ?? 0.35);
const SIDE_EPS = 0.2;

const donor = readDeformationSpec(DONOR).spec;
const targetAt = readDeformationSpec(TARGET_AT);
const corners = arg('corners')?.split(',').map((s) => Number(s.trim()));
const target = analyzeTarget(readGfxBody(TARGET_GR), corners, ownWheelMeshes(targetAt.spec));
reportSkinRows(donor, target.skinRows, arg('veh'));

const model = cloneSpec(donor);
const DONOR_GR = arg('donor-gr');
const donorBody = DONOR_GR ? analyzeTarget(readGfxBody(DONOR_GR), undefined, ownWheelMeshes(donor)) : undefined;
const { R } = boxRemap(donor, targetAt.spec, target, donorBody);
remapSpec(model, R);
adoptTargetPhysics(model, targetAt.spec);

const shell = target.parts[target.shellGfx];
const wheelGfx = target.wheelMeshes;
const fused = target.parts.filter((p) => p.index !== shell.index && !wheelGfx.has(p.index) && p.volume >= FUSED * shell.volume);
const free = target.parts.filter((p) => p.centroid && p.index !== shell.index && !wheelGfx.has(p.index) && !fused.includes(p));
console.log(`[target] shell gfx ${shell.index}, wheel meshes {${[...wheelGfx].join(', ')}}, fused body {${fused.map((p) => p.index).join(', ')}}`);

const tagCentroid = (part: IKPart): Vec3 | null => {
	const tags = partTags(model, part);
	if (!tags.length) return null;
	const c = [0, 1, 2].map((k) => tags.reduce((s, t) => s + t.initialPosition[k], 0) / tags.length) as Vec3;
	return toMeshSpace(model, c);
};

const panels = model.ikParts.filter((p) => p.partType !== PART_ROOT && p.partType !== PART_BODY_SHELL && !WHEEL_PARTS.has(p.partType));
const pairs: { part: IKPart; gfx: GfxPart; d: number }[] = [];
for (const part of panels) {
	const c = tagCentroid(part);
	if (!c) continue;
	for (const gfx of free) {
		const g = gfx.centroid!;
		if (Math.abs(c[0]) > SIDE_EPS && Math.abs(g[0]) > SIDE_EPS && Math.sign(c[0]) !== Math.sign(g[0])) continue;
		const d = Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]);
		if (d <= MAX_MATCH) pairs.push({ part, gfx, d });
	}
}
pairs.sort((a, b) => a.d - b.d);
const matched = new Map<IKPart, GfxPart>();
const taken = new Set<number>();
for (const { part, gfx } of pairs) {
	if (matched.has(part) || taken.has(gfx.index)) continue;
	matched.set(part, gfx);
	taken.add(gfx.index);
}

let shellBound = false;
for (const part of model.ikParts) {
	if (part.partType === PART_ROOT) continue;
	if (part.partType === PART_BODY_SHELL && !shellBound) {
		bindPartToGfx(part, shell);
		stripJoints(model, part);
		makeNeverDetach(model, part);
		shellBound = true;
	} else if (target.wheelPartGfx.has(part.partType)) {
		bindPartToGfx(part, target.parts[target.wheelPartGfx.get(part.partType)!]);
		stripJoints(model, part);
		makeNeverDetach(model, part);
	} else if (matched.has(part)) {
		bindPartToGfx(part, matched.get(part)!);
	} else {
		neutralizePart(model, part);
	}
}
if (!shellBound) throw new Error(`donor has no body shell part (type ${PART_BODY_SHELL})`);

model.glassPanes = [];
placeWheels(model, targetAt.spec, target);

writeRigBundle(targetAt, model, OUT);
const rigged = checkRig(OUT, target, (spec) => {
	const fails: string[] = [];
	const fusedIdx = new Set(fused.map((p) => p.index));
	spec.ikParts.forEach((p, i) => {
		if (fusedIdx.has(p.partGraphics)) fails.push(`part ${i} drives fused body gfx ${p.partGraphics}`);
		if ((p.partType === PART_BODY_SHELL || WHEEL_PARTS.has(p.partType)) && canLeaveCar(crashBehaviour(p, spec.tagPoints))) {
			fails.push(`part ${i} (${partName(p.partType)}) can leave the car`);
		}
	});
	return fails;
});

const driven = new Map(rigged.ikParts.filter((p) => p.partGraphics >= 0).map((p) => [p.partGraphics, p]));
console.log('\n=== target meshes ===');
for (const g of target.parts) {
	const p = driven.get(g.index);
	console.log(`  gfx ${String(g.index).padStart(2)}  ${p ? `${partName(p.partType).padEnd(16)} ${crashBehaviour(p, rigged.tagPoints)}` : 'rigid (not driven)'}`);
}
const leaving = rigged.ikParts.filter((p) => canLeaveCar(crashBehaviour(p, rigged.tagPoints))).length;
console.log(`\n${leaving} panels can come off`);
if (!leaving) console.warn('no panel can come off: the target meshes did not line up with any donor panel; deform-rig-mvp.ts gives the same result');
