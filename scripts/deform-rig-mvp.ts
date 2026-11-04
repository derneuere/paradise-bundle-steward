// Soft-skin crash rig for a vehicle whose body has no usable panel split (a
// custom mod body, or one you just don't want to shed parts).
//
// Grafting a paneled car's DeformationSpec straight onto another body drives
// the wrong meshes: panels detach where there are none, a frame hovers, FX
// locators land in empty space. This tool takes a DONOR car's spec and makes a
// rig any body can carry: the body shell, wheel arches and root stay live, every
// other part is neutralised in place (no mesh, no joints, never detaches), all
// glass is stripped, and every point is box->box remapped from the donor's
// extent onto the TARGET's real graphics body (decoded from its _GR). The whole
// body then dents as one soft skin and never sheds anything.
//
// Nothing is deleted or reordered: the body mesh addresses deformation rows by
// index (see lib/deform-rig/spec.ts). The best donor is the car the target's
// mesh was skinned against; the tool reports when the row counts disagree.
//
// Run (pure parse/write, no GL):
//   npx tsx scripts/deform-rig-mvp.ts \
//     --donor     <VEH_<car>_AT.BIN>     a retail car's rig \
//     --target-gr <VEH_<target>_GR.BIN>  the body to rig \
//     --target-at <VEH_<target>_AT.BIN>  the target's own _AT (attribs/audio/physics are kept) \
//     --out       <out_AT.BIN> \
//     [--donor-gr <VEH_<car>_GR.BIN>]  the donor's body: remap mesh box to mesh box (more exact) \
//     [--corners a,b,c,d]  gfx indices of the 4 wheel-corner parts (default: the target spec's own
//                          wheel arches, else the off-origin parts) \
//     [--veh <VEHICLES dir>]  on a skin-row mismatch, list donors that match
//
// Writes only to --out.

import {
	PART_BODY_SHELL, PART_ROOT, canLeaveCar, crashBehaviour, partName,
} from './lib/deform-rig/parts';
import { analyzeTarget, readGfxBody } from './lib/deform-rig/geometry';
import { arg, cloneSpec, readDeformationSpec, writeRigBundle } from './lib/deform-rig/io';
import {
	adoptTargetPhysics, bindPartToGfx, boxRemap, makeNeverDetach, neutralizePart, ownWheelMeshes, placeWheels, remapSpec,
	stripJoints,
} from './lib/deform-rig/spec';
import { checkRig, reportSkinRows } from './lib/deform-rig/report';

const DONOR = arg('donor'), TARGET_GR = arg('target-gr'), TARGET_AT = arg('target-at'), OUT = arg('out');
if (!DONOR || !TARGET_GR || !TARGET_AT || !OUT) {
	throw new Error('usage: --donor <_AT> --target-gr <_GR> --target-at <_AT> --out <_AT> '
		+ '[--donor-gr <_GR>] [--corners a,b,c,d] [--veh <dir>]');
}
const corners = arg('corners')?.split(',').map((s) => Number(s.trim()));

const donor = readDeformationSpec(DONOR).spec;
const targetAt = readDeformationSpec(TARGET_AT);
const target = analyzeTarget(readGfxBody(TARGET_GR), corners, ownWheelMeshes(targetAt.spec));
console.log(`[donor] ${donor.ikParts.length} IK parts, ${donor.tagPoints.length} tags, ${donor.glassPanes.length} glass`);
console.log(`[target] ${target.parts.length} gfx parts, shell gfx ${target.shellGfx}, corners `
	+ [...target.corners.values()].map((c) => `${partName(c.arch)}=${c.gfx}`).join(' '));
reportSkinRows(donor, target.skinRows, arg('veh'));

const model = cloneSpec(donor);
const DONOR_GR = arg('donor-gr');
const donorBody = DONOR_GR ? analyzeTarget(readGfxBody(DONOR_GR), undefined, ownWheelMeshes(donor)) : undefined;
const { R, scale } = boxRemap(donor, targetAt.spec, target, donorBody);
console.log(`[remap] scale ${scale.map((v) => v.toFixed(3)).join(', ')}`);
remapSpec(model, R);
adoptTargetPhysics(model, targetAt.spec);

let shellBound = false;
for (const part of model.ikParts) {
	if (part.partType === PART_ROOT) continue;
	if (part.partType === PART_BODY_SHELL && !shellBound) {
		bindPartToGfx(part, target.parts[target.shellGfx]);
		stripJoints(model, part);
		makeNeverDetach(model, part);
		shellBound = true;
		continue;
	}
	const wheelGfx = target.wheelPartGfx.get(part.partType);
	if (wheelGfx !== undefined) {
		bindPartToGfx(part, target.parts[wheelGfx]);
		stripJoints(model, part);
		makeNeverDetach(model, part);
		continue;
	}
	// Everything else, including a wheel part with no target mesh: its tags
	// still dent with the body (and a wheel part's still anchor the suspension).
	neutralizePart(model, part);
}
if (!shellBound) throw new Error(`donor has no body shell part (type ${PART_BODY_SHELL})`);

// A pane only shatters when paired with a GraphicsSpec shattered-glass model;
// a body without those would keep a dangling smash reference.
model.glassPanes = [];
placeWheels(model, targetAt.spec, target);

writeRigBundle(targetAt, model, OUT);
checkRig(OUT, target, (spec) => {
	const fails: string[] = [];
	spec.ikParts.forEach((p, i) => {
		if (p.jointSpecs.length) fails.push(`part ${i} (${partName(p.partType)}) still has joints`);
		if (p.partType !== PART_ROOT && canLeaveCar(crashBehaviour(p, spec.tagPoints))) fails.push(`part ${i} can leave the car`);
	});
	if (spec.glassPanes.length) fails.push('glass panes left');
	return fails;
});
