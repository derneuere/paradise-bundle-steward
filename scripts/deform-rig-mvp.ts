// Minimal crash-deformation auto-rigger (MVP).
//
// PURPOSE: give a single-mesh vehicle (e.g. a custom mod whose body is one
// welded mesh + wheels, with no separate panels) a working, non-broken crash
// rig, WITHOUT re-modelling it. A full paneled car crumples by hinging ~30
// separate body parts; a one-piece body has nothing to hinge, so grafting a
// paneled car's DeformationSpec drives the wrong meshes (panels fly off / a
// frame hovers). This tool instead builds a MINIMAL rig that any body can carry:
//   root + one soft body-shell + four wheels — no hinged panels, no glass.
// The whole body then dents as a single soft skin and never disintegrates.
//
// HOW: take a DONOR car's DeformationSpec (any normal car carries the standard
// part set), keep only 6 IK parts by partType — 999 (root), 46 (body shell),
// 48/49/50/51 (wheels) — delete every hinged panel and all glass, then box->box
// remap every point (sensors, tag points, driven points, and the FX/camera/light
// locators) from the donor's body extent into the TARGET's real graphics-body
// AABB (decoded from its _GR bundle). Wheels are placed at the target's real
// wheel-locator positions. The new spec is written into the target's own _AT
// bundle wrapper, preserving the target's attribs/audio resources.
//
// The DeformationSpec partType meaning (999 root, 46 body shell with the bulk of
// the soft-body tag points, 48-51 wheels) is a stable slot convention observed
// across every retail vehicle spec — see scripts/parts-taxonomy.ts.
//
// Run (pure parse/write, no GL — plain node/tsx is fine):
//   npx tsx scripts/deform-rig-mvp.ts \
//     --donor     <VEH_<donorCar>_AT.BIN>   (a normal car's rig, e.g. a coupe) \
//     --target-gr <VEH_<target>_GR.BIN>     (the single-mesh car's geometry) \
//     --target-at <VEH_<target>_AT.BIN>     (the target's own _AT; its attribs/audio are kept) \
//     --out       <out_AT.BIN> \
//     [--corners 0,1,21,22]   (gfx part indices of the 4 wheels; default: auto-detect non-origin parts)
//
// Never writes to the game folder — only to --out.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { parseBundle, writeBundleFresh } from '../src/lib/core/bundle';
import { extractResourceRaw } from '../src/lib/core/registry';
import {
	parseDeformationSpecData,
	writeDeformationSpecData,
	DEFORMATION_SPEC_TYPE_ID,
	type ParsedDeformationSpec,
	type IKPart,
	type TagPointSpec,
	type DrivenPoint,
	type Vec3,
	type Vec4,
} from '../src/lib/core/deformationSpec';
import { parseGraphicsSpecData, resolveGraphicsSpecParts, GRAPHICS_SPEC_TYPE_ID } from '../src/lib/core/graphicsSpec';
import { decodeAllRenderables, locatorToMatrix4 } from '../src/lib/core/renderableDecode';

// --- args -------------------------------------------------------------------
function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const DONOR = arg('donor');
const TARGET_GR = arg('target-gr');
const TARGET_AT = arg('target-at');
const OUT = arg('out');
const CORNERS_ARG = arg('corners');
if (!DONOR || !TARGET_GR || !TARGET_AT || !OUT) {
	throw new Error(
		'usage: --donor <_AT.BIN> --target-gr <_GR.BIN> --target-at <_AT.BIN> --out <_AT.BIN> [--corners a,b,c,d]',
	);
}

// The 6 IK part types the MVP keeps (stable partType slots; see parts-taxonomy.ts).
const ROOT = 999, BODY_SHELL = 46;
const WHEEL_TYPES = [48, 49, 50, 51]; // FL, FR, RL, RR
const KEEP_TYPES = new Set([ROOT, BODY_SHELL, ...WHEEL_TYPES]);
const NEVER_DETACH = 9995; // runtime sentinel: a tag point at/above this never detaches
const CORNER_EPS = 0.1;    // a gfx part this far off the body origin counts as a wheel/corner

function abOf(p: string): ArrayBuffer {
	const b = fs.readFileSync(p);
	// A Node Buffer views a shared pool — slice out this file's own bytes.
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

type Vec3T = { x: number; y: number; z: number };

// =============================================================================
// Decode the target body geometry from its _GR bundle.
// =============================================================================

type TargetGeom = {
	min: Vec3T; max: Vec3T; center: Vec3T; half: Vec3T;
	bodyIdx: number;                          // gfx index of the largest body part
	wheelSlotToGfx: Record<number, number>;   // partType(48/49/50/51) -> gfx idx
	wheelSlotToPos: Record<number, Vec3>;     // partType -> [x,y,z] locator translation
	numGfxParts: number;
	corners: Set<number>;
};

function decodeTargetGeometry(grPath: string): TargetGeom {
	const ab = abOf(grPath);
	const bundle = parseBundle(ab);

	const gsRes = bundle.resources.find((r) => r.resourceTypeId === GRAPHICS_SPEC_TYPE_ID);
	if (!gsRes) throw new Error('target _GR has no GraphicsSpec (0x10006)');
	const gs = parseGraphicsSpecData(extractResourceRaw(ab, bundle, gsRes));
	const parts = resolveGraphicsSpecParts(ab, bundle, gs); // index == gfx index
	const numGfxParts = parts.length;
	console.log(`[geom] GraphicsSpec parts: ${numGfxParts}`);

	// Corners (wheels) = explicit --corners, else auto: parts whose locator sits
	// off the body origin. A single-mesh body keeps every panel at the origin, so
	// the only non-origin parts are the wheels.
	const corners = new Set<number>();
	if (CORNERS_ARG) {
		for (const s of CORNERS_ARG.split(',')) corners.add(Number(s.trim()));
	} else {
		for (let i = 0; i < numGfxParts; i++) {
			const l = parts[i].locator;
			if (Math.hypot(l[12], l[13], l[14]) > CORNER_EPS) corners.add(i);
		}
	}
	console.log(`[geom] corner/wheel gfx parts: {${[...corners].sort((a, b) => a - b).join(', ')}}`);
	if (corners.size !== 4) console.warn(`[geom] WARNING: expected 4 wheel/corner parts, found ${corners.size}`);

	const { renderables } = decodeAllRenderables(ab, bundle, new Map(), false, 'graphics');
	const byRid = new Map<bigint, (typeof renderables)[number]>();
	for (const d of renderables) byRid.set(d.resourceId, d);

	const partBox = (i: number): THREE.Box3 | null => {
		const part = parts[i];
		if (part.renderableId == null) return null;
		const d = byRid.get(part.renderableId);
		if (!d || d.meshes.length === 0) return null;
		const m = locatorToMatrix4(part.locator);
		const box = new THREE.Box3();
		let any = false;
		for (const mesh of d.meshes) {
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			const bb = mesh.geometry.boundingBox;
			if (!bb) continue;
			box.union(bb.clone().applyMatrix4(m));
			any = true;
		}
		return any ? box : null;
	};

	// Body AABB = union over all NON-corner parts; bodyIdx = the largest of them.
	const bodyBox = new THREE.Box3();
	let bodyBoxHasAny = false, bodyIdx = -1, bestVol = -1;
	for (let i = 0; i < numGfxParts; i++) {
		if (corners.has(i)) continue;
		const b = partBox(i);
		if (!b) continue;
		bodyBox.union(b);
		bodyBoxHasAny = true;
		const size = b.getSize(new THREE.Vector3());
		const vol = size.x * size.y * size.z;
		if (vol > bestVol) { bestVol = vol; bodyIdx = i; }
	}
	if (!bodyBoxHasAny) throw new Error('no body meshes decoded for target');

	const mn = bodyBox.min, mx = bodyBox.max;
	const center: Vec3T = { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 };
	const half: Vec3T = { x: (mx.x - mn.x) / 2, y: (mx.y - mn.y) / 2, z: (mx.z - mn.z) / 2 };

	// Corner parts -> wheel slot by sign of locator translation:
	//   x<0,z>0 = 48 FL   x>0,z>0 = 49 FR   x<0,z<0 = 50 RL   x>0,z<0 = 51 RR
	const wheelSlotToGfx: Record<number, number> = {};
	const wheelSlotToPos: Record<number, Vec3> = {};
	for (const i of corners) {
		if (i >= numGfxParts) continue;
		const l = parts[i].locator;
		const x = l[12], y = l[13], z = l[14];
		const slot = x < 0 && z > 0 ? 48 : x > 0 && z > 0 ? 49 : x < 0 && z < 0 ? 50 : 51;
		wheelSlotToGfx[slot] = i;
		wheelSlotToPos[slot] = [x, y, z];
	}
	console.log(`[geom] bodyIdx=${bodyIdx} center=${JSON.stringify(center)} half=${JSON.stringify(half)}`);

	return {
		min: { x: mn.x, y: mn.y, z: mn.z }, max: { x: mx.x, y: mx.y, z: mx.z },
		center, half, bodyIdx, wheelSlotToGfx, wheelSlotToPos, numGfxParts, corners,
	};
}

// =============================================================================
// Rig
// =============================================================================

function main() {
	fs.mkdirSync(path.dirname(OUT!), { recursive: true });

	// Donor DeformationSpec.
	const donorAb = abOf(DONOR!);
	const donorBundle = parseBundle(donorAb);
	const donorRes = donorBundle.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID);
	if (!donorRes) throw new Error('donor _AT has no DeformationSpec (0x1001C)');
	const donor = parseDeformationSpecData(extractResourceRaw(donorAb, donorBundle, donorRes));
	console.log(`[donor] ik=${donor.ikParts.length} tag=${donor.tagPoints.length} glass=${donor.glassPanes.length} `
		+ `partTypes=[${donor.ikParts.map((p) => p.partType).join(',')}]`);

	// Donor body box (over its tag points) for the remap source extent.
	const p12min: Vec3 = [Infinity, Infinity, Infinity];
	const p12max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const t of donor.tagPoints) for (let k = 0; k < 3; k++) {
		p12min[k] = Math.min(p12min[k], t.initialPosition[k]);
		p12max[k] = Math.max(p12max[k], t.initialPosition[k]);
	}
	const dCenter: Vec3 = [(p12min[0] + p12max[0]) / 2, (p12min[1] + p12max[1]) / 2, (p12min[2] + p12max[2]) / 2];
	const dHalf: Vec3 = [(p12max[0] - p12min[0]) / 2, (p12max[1] - p12min[1]) / 2, (p12max[2] - p12min[2]) / 2];

	// Target geometry + box->box remap.
	const geom = decodeTargetGeometry(TARGET_GR!);
	const tCenter: Vec3 = [geom.center.x, geom.center.y, geom.center.z];
	const tHalf: Vec3 = [geom.half.x, geom.half.y, geom.half.z];
	const scale: Vec3 = [0, 1, 2].map((k) => (Math.abs(dHalf[k]) < 1e-4 ? 1 : tHalf[k] / dHalf[k])) as Vec3;
	console.log(`[remap] scale=${scale.map((v) => v.toFixed(3))}`);
	const R = (p: Vec3): Vec3 => [
		tCenter[0] + (p[0] - dCenter[0]) * scale[0],
		tCenter[1] + (p[1] - dCenter[1]) * scale[1],
		tCenter[2] + (p[2] - dCenter[2]) * scale[2],
	];

	const model: ParsedDeformationSpec = JSON.parse(JSON.stringify(donor));

	// Keep only the 6 IK parts (first occurrence per type, donor order).
	const kept: IKPart[] = [];
	const seen = new Set<number>();
	const oldPartIndexOfKept: number[] = [];
	model.ikParts.forEach((p, i) => {
		if (KEEP_TYPES.has(p.partType) && !seen.has(p.partType)) {
			seen.add(p.partType); kept.push(p); oldPartIndexOfKept.push(i);
		}
	});
	for (const t of KEEP_TYPES) if (!seen.has(t)) throw new Error(`donor missing required IK partType ${t}`);
	const oldToNewPart = new Map<number, number>();
	oldPartIndexOfKept.forEach((oldIdx, newIdx) => oldToNewPart.set(oldIdx, newIdx));
	const newBodyShellPartIdx = kept.findIndex((p) => p.partType === BODY_SHELL);

	// Rebuild global tagPoints / drivenPoints from the kept parts' slices.
	const newTagPoints: TagPointSpec[] = [];
	const oldToNewTag = new Map<number, number>();
	let tagCursor = 0;
	for (const part of kept) {
		const s = part.startIndexOfTagPoints, n = part.numberOfTagPoints;
		part.startIndexOfTagPoints = tagCursor;
		for (let k = 0; k < n; k++) { oldToNewTag.set(s + k, tagCursor); newTagPoints.push(donor.tagPoints[s + k]); tagCursor++; }
	}
	const newDrivenPoints: DrivenPoint[] = [];
	let drivenCursor = 0, danglingDriven = 0;
	for (const part of kept) {
		const s = part.startIndexOfDrivenPoints, n = part.numberOfDrivenPoints;
		part.startIndexOfDrivenPoints = drivenCursor;
		for (let k = 0; k < n; k++) {
			const dp: DrivenPoint = JSON.parse(JSON.stringify(donor.drivenPoints[s + k]));
			const mapIdx = (idx: number) => { if (idx < 0) return idx; const nn = oldToNewTag.get(idx); if (nn === undefined) { danglingDriven++; return -1; } return nn; };
			dp.tagPointIndexA = mapIdx(dp.tagPointIndexA);
			dp.tagPointIndexB = mapIdx(dp.tagPointIndexB);
			newDrivenPoints.push(dp); drivenCursor++;
		}
	}
	if (danglingDriven) console.warn(`[rig] ${danglingDriven} driven-point tag refs pointed at deleted parts -> -1`);

	// Remap every point onto the target body: sensors first (they feed tag offsets),
	// then tag points (recomputing offsetFromA/B), driven points, and the
	// transform-tag locator translations (FX / camera / light locators).
	for (const ssr of model.sensors) ssr.initialOffset = R(ssr.initialOffset as Vec3);
	for (const t of newTagPoints) {
		t.initialPosition = R(t.initialPosition as Vec3);
		const a = t.deformationSensorA, b = t.deformationSensorB;
		if (a >= 0 && a < model.sensors.length) { const so = model.sensors[a].initialOffset; t.offsetFromA = [t.initialPosition[0] - so[0], t.initialPosition[1] - so[1], t.initialPosition[2] - so[2]]; }
		if (b >= 0 && b < model.sensors.length) { const so = model.sensors[b].initialOffset; t.offsetFromB = [t.initialPosition[0] - so[0], t.initialPosition[1] - so[1], t.initialPosition[2] - so[2]]; }
	}
	for (const d of newDrivenPoints) d.initialPos = R(d.initialPos as Vec3);
	for (const arr of [model.genericTags, model.cameraTags, model.lightTags]) for (const tag of arr) {
		const tr = R([tag.locator[3][0], tag.locator[3][1], tag.locator[3][2]]);
		tag.locator[3][0] = tr[0]; tag.locator[3][1] = tr[1]; tag.locator[3][2] = tr[2];
		// Keep transform-tag ikPartIndex in-bounds after deletion: remap to the kept
		// part, else re-anchor to the body shell so the locator binds to a live part.
		if (tag.ikPartIndex >= 0) { const nn = oldToNewPart.get(tag.ikPartIndex); tag.ikPartIndex = nn !== undefined ? nn : newBodyShellPartIdx; }
	}

	// Fix up kept parts: no joints anywhere; body shell -> target body gfx +
	// never-detach; wheels -> matching corner gfx; root -> -1.
	for (const part of kept) {
		part.jointSpecs = [];
		if (part.partType === ROOT) {
			part.partGraphics = -1;
		} else if (part.partType === BODY_SHELL) {
			part.partGraphics = geom.bodyIdx;
			const s = part.startIndexOfTagPoints, n = part.numberOfTagPoints;
			for (let k = 0; k < n; k++) { const t = newTagPoints[s + k]; t.detachThreshold = NEVER_DETACH; t.fDetachThresholdSquared = NEVER_DETACH * NEVER_DETACH; }
		} else {
			const g = geom.wheelSlotToGfx[part.partType];
			part.partGraphics = g !== undefined ? g : -1;
		}
	}
	model.ikParts = kept;
	model.tagPoints = newTagPoints;
	model.drivenPoints = newDrivenPoints;

	// Header wheel mounts (order FR,FL,RR,RL) -> target wheel positions.
	const headerOrder = [49, 48, 51, 50];
	for (let i = 0; i < 4; i++) {
		const pos = geom.wheelSlotToPos[headerOrder[i]];
		if (pos) model.wheels[i].position = [pos[0], pos[1], pos[2], 1] as Vec4;
		else console.warn(`[wheels] no target locator for header wheel ${i}; keeping donor position`);
	}

	// No glass; handling box from the target; real gfx-part count.
	model.glassPanes = [];
	model.handlingBodyDimensions = [tHalf[0], tHalf[1], tHalf[2], donor.handlingBodyDimensions[3]] as Vec4;
	model.numGraphicsParts = geom.numGfxParts;
	model.numVehicleBodies = 1;
	model.numDeformationSensors = 20;

	// Write the new spec into the TARGET's own bundle wrapper (keeps its attribs/audio).
	const targetAtAb = abOf(TARGET_AT!);
	const targetAtBundle = parseBundle(targetAtAb);
	if (!targetAtBundle.resources.some((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID)) {
		throw new Error('target _AT has no DeformationSpec slot to overwrite');
	}
	const newSpecBytes = writeDeformationSpecData(model);
	const outAb = writeBundleFresh(targetAtBundle, targetAtAb, { overrides: { resources: { [DEFORMATION_SPEC_TYPE_ID]: newSpecBytes } } });
	fs.writeFileSync(OUT!, Buffer.from(outAb));
	console.log(`[write] spec ${newSpecBytes.length} B -> bundle ${outAb.byteLength} B -> ${OUT}`);

	verifyOutput(geom, tHalf);
}

// =============================================================================
// Verify the written bundle re-parses to the intended minimal rig.
// =============================================================================

function inside(p: Vec3, mn: Vec3T, mx: Vec3T, margin: Vec3): boolean {
	return p[0] >= mn.x - margin[0] && p[0] <= mx.x + margin[0]
		&& p[1] >= mn.y - margin[1] && p[1] <= mx.y + margin[1]
		&& p[2] >= mn.z - margin[2] && p[2] <= mx.z + margin[2];
}

function verifyOutput(geom: TargetGeom, tHalf: Vec3) {
	const ab = abOf(OUT!);
	const bundle = parseBundle(ab);
	const res = bundle.resources.find((r) => r.resourceTypeId === DEFORMATION_SPEC_TYPE_ID)!;
	const m = parseDeformationSpecData(extractResourceRaw(ab, bundle, res));

	const partTypes = m.ikParts.map((p) => p.partType).sort((a, b) => a - b);
	const allowedGfx = new Set<number>([geom.bodyIdx, ...geom.corners, -1]);
	const margin: Vec3 = [Math.max(0.25, tHalf[0] * 0.2), Math.max(0.25, tHalf[1] * 0.2), Math.max(0.25, tHalf[2] * 0.2)];
	const sensorsInside = m.sensors.filter((s) => inside(s.initialOffset as Vec3, geom.min, geom.max, margin)).length;
	const tagsInside = m.tagPoints.filter((t) => inside(t.initialPosition as Vec3, geom.min, geom.max, margin)).length;

	const v = {
		numIKParts: m.ikParts.length,
		partTypes,
		partTypesOk: m.ikParts.length === 6 && JSON.stringify(partTypes) === JSON.stringify([46, 48, 49, 50, 51, 999]),
		numGlass: m.glassPanes.length,
		numSensors: m.sensors.length,
		numWheels: m.wheels.length,
		numTagPoints: m.tagPoints.length,
		allPartGraphicsOk: m.ikParts.every((p) => allowedGfx.has(p.partGraphics)),
		anyJointSpecs: m.ikParts.some((p) => p.jointSpecs.length > 0),
		allSensorsInsideAABB: sensorsInside === m.sensors.length,
		allTagsInsideAABB: tagsInside === m.tagPoints.length,
		wheelPos: m.wheels.map((w) => (w.position as Vec4).map((x) => +x.toFixed(3))),
	};
	const pass = v.partTypesOk && v.numGlass === 0 && v.numSensors === 20 && v.numWheels === 4
		&& v.allPartGraphicsOk && !v.anyJointSpecs && v.allSensorsInsideAABB && v.allTagsInsideAABB;
	console.log('\n===== VERIFICATION =====');
	console.log(JSON.stringify({ ...v, allChecksPass: pass }, null, 2));
	if (!pass) throw new Error('verification FAILED');
	console.log('all checks pass');
}

main();
