// DeformationSpec edits shared by the riggers, plus the engine invariants every
// rig must satisfy before it goes near the game.
//
// LOAD-BEARING: the riggers never delete or reorder IK parts, tag points or
// driven points. The engine packs one 128-row skin-offset array per car (the
// leading run of skinned tag points, then every IK part's driven points in part
// order) and each body vertex reads its row by blend index. The mesh was
// skinned against one specific spec layout, so renumbering any point makes
// crashes dent the wrong vertices while the rest pose still looks perfect.
// Unwanted parts are neutralised in place instead.

import type { IKPart, Mat4, ParsedDeformationSpec, Vec3, Vec4 } from '../../../src/lib/core/deformationSpec';
import type { GfxPart, OwnWheelMeshes, TargetBody } from './geometry';
import {
	AXLE_PAIR_FRONT, AXLE_PAIR_REAR, HEADER_WHEEL_ARCHES, NEVER_DETACH_VALUE, PART_ROOT, WHEEL_PARTS,
} from './parts';

const MAX_IK_PARTS = 50;
const MAX_POINTS = 128;
const MAX_SENSORS = 20;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const IDENTITY: Mat4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

export type Remap = (p: Vec3) => Vec3;

// Every point in a DeformationSpec (sensors, tag/driven points, joint pivots,
// locators, header wheels) lives in the handling-body frame: the mesh frame
// shifted by carModelSpaceToHandlingBodySpace (no rotation in any retail car,
// translation == -meshOffset). Only graphicsTransform is in the mesh frame.
const handlingShift = (spec: ParsedDeformationSpec): Vec3 => {
	const t = spec.carModelSpaceToHandlingBodySpace[3];
	return [t[0], t[1], t[2]];
};
export const toMeshSpace = (spec: ParsedDeformationSpec, p: Vec3): Vec3 => sub(p, handlingShift(spec));
export const toHandlingSpace = (spec: ParsedDeformationSpec, p: Vec3): Vec3 => {
	const s = handlingShift(spec);
	return [p[0] + s[0], p[1] + s[1], p[2] + s[2]];
};

// Box->box affine map, done in mesh space, R(p) = targetCenter + (p -
// donorCenter) * targetHalf / donorHalf, then back into the TARGET's handling
// frame. The donor box is its own body mesh box when its _GR is given (exact:
// a car rigged onto itself maps to identity); otherwise its tag-point extent,
// which sits inside the bodywork and so stretches points slightly outward.
export function boxRemap(
	donor: ParsedDeformationSpec, targetSpec: ParsedDeformationSpec, target: TargetBody, donorBody?: TargetBody,
): { R: Remap; scale: Vec3 } {
	let mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
	if (donorBody) {
		mn = donorBody.min; mx = donorBody.max;
	} else {
		for (const t of donor.tagPoints) {
			const p = toMeshSpace(donor, t.initialPosition);
			for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
		}
	}
	const dc = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
	const scale = [0, 1, 2].map((k) => {
		const dh = (mx[k] - mn[k]) / 2;
		return Math.abs(dh) < 1e-4 ? 1 : target.half[k] / dh;
	}) as Vec3;
	const R: Remap = (p) => {
		const m = toMeshSpace(donor, p);
		return toHandlingSpace(targetSpec, [0, 1, 2].map((k) => target.center[k] + (m[k] - dc[k]) * scale[k]) as Vec3);
	};
	return { R, scale };
}

export function skinnedTagRun(spec: ParsedDeformationSpec): number {
	let n = 0;
	while (n < spec.tagPoints.length && spec.tagPoints[n].skinnedPoint) n++;
	return n;
}

export const specSkinRows = (spec: ParsedDeformationSpec): number =>
	skinnedTagRun(spec) + spec.ikParts.reduce((s, p) => s + p.numberOfDrivenPoints, 0);

export const partTags = (spec: ParsedDeformationSpec, part: IKPart) =>
	spec.tagPoints.slice(part.startIndexOfTagPoints, part.startIndexOfTagPoints + part.numberOfTagPoints);

export function recomputeTagOffsets(spec: ParsedDeformationSpec): void {
	for (const t of spec.tagPoints) {
		const a = spec.sensors[t.deformationSensorA], b = spec.sensors[t.deformationSensorB];
		if (a) t.offsetFromA = sub(t.initialPosition, a.initialOffset);
		if (b) t.offsetFromB = sub(t.initialPosition, b.initialOffset);
	}
}

// Moves every positional field through R: sensors, tag/driven points, the FX /
// camera / light locators, joint pivots and the part graphics frames.
export function remapSpec(spec: ParsedDeformationSpec, R: Remap): void {
	for (const s of spec.sensors.slice(0, spec.numDeformationSensors)) s.initialOffset = R(s.initialOffset);
	for (const t of spec.tagPoints) t.initialPosition = R(t.initialPosition);
	for (const d of spec.drivenPoints) d.initialPos = R(d.initialPos);
	for (const tag of [...spec.genericTags, ...spec.cameraTags, ...spec.lightTags]) {
		const p = R([tag.locator[3][0], tag.locator[3][1], tag.locator[3][2]]);
		tag.locator[3] = [p[0], p[1], p[2], tag.locator[3][3]];
	}
	for (const part of spec.ikParts) {
		const g = R([part.graphicsTransform[3][0], part.graphicsTransform[3][1], part.graphicsTransform[3][2]]);
		part.graphicsTransform[3] = [g[0], g[1], g[2], part.graphicsTransform[3][3]];
		for (const j of part.jointSpecs) {
			const p = R([j.position[0], j.position[1], j.position[2]]);
			j.position = [p[0], p[1], p[2], j.position[3]] as Vec4;
		}
	}
	recomputeTagOffsets(spec);
}

// In every retail car a part's graphicsTransform IS its GraphicsSpec part's
// locator. The engine renders a hinged or detached panel from that frame, so a
// mismatch makes the panel jump the moment it comes loose.
export function bindPartToGfx(part: IKPart, gfx: GfxPart): void {
	part.partGraphics = gfx.index;
	part.graphicsTransform = JSON.parse(JSON.stringify(gfx.locator));
}

export function stripJoints(spec: ParsedDeformationSpec, part: IKPart): void {
	part.jointSpecs = [];
	for (const t of partTags(spec, part)) t.jointIndex = -1;
}

export function makeNeverDetach(spec: ParsedDeformationSpec, part: IKPart): void {
	for (const t of partTags(spec, part)) {
		t.detachThreshold = NEVER_DETACH_VALUE;
		t.fDetachThresholdSquared = NEVER_DETACH_VALUE;
	}
}

// Keeps the part's tag and driven points (they still dent with the body skin)
// but it drives no mesh and can never hinge or come off.
export function neutralizePart(spec: ParsedDeformationSpec, part: IKPart): void {
	part.partGraphics = -1;
	part.graphicsTransform = JSON.parse(JSON.stringify(IDENTITY));
	stripJoints(spec, part);
	makeNeverDetach(spec, part);
}

// Header wheel i is the wheel at arch HEADER_WHEEL_ARCHES[i], and its tag point
// (a root tag in every retail car) sits exactly on the wheel centre. The axle
// centre is a handling value, not a mesh one (a wheel-arch part's locator sits
// well above it), so take it from the target's own spec and fall back to the
// corner mesh only when that spec has no wheels. The donor keeps its tag index.
export function placeWheels(spec: ParsedDeformationSpec, targetSpec: ParsedDeformationSpec, target: TargetBody): void {
	spec.wheels.forEach((w, i) => {
		const own = targetSpec.wheels[i];
		let pos: Vec3;
		if (own && Math.hypot(own.position[0], own.position[1], own.position[2]) > 0.1) {
			pos = [own.position[0], own.position[1], own.position[2]];
			w.direction = [...own.direction] as Vec4;
		} else {
			const corner = target.corners.get(HEADER_WHEEL_ARCHES[i]);
			if (!corner) return;
			console.warn(`[wheels] target spec has no wheel ${i}; using the wheel-corner mesh position`);
			pos = toHandlingSpace(targetSpec, corner.position);
		}
		w.position = [...pos, 1] as Vec4;
		const tag = spec.tagPoints[w.iValue];
		if (tag) tag.initialPosition = [...pos];
	});
	recomputeTagOffsets(spec);
}

// Rest height, collision and handling are tuned per vehicle: keep the target's
// own values, never the donor's or the graphics AABB (an over-tall handling box
// sinks the car into the road). numGraphicsParts is not read by the engine and
// is not the GraphicsSpec part count, so keep the target's value too.
export function adoptTargetPhysics(spec: ParsedDeformationSpec, target: ParsedDeformationSpec): void {
	spec.handlingBodyDimensions = target.handlingBodyDimensions;
	spec.currentCOMOffset = target.currentCOMOffset;
	spec.meshOffset = target.meshOffset;
	spec.rigidBodyOffset = target.rigidBodyOffset;
	spec.collisionOffset = target.collisionOffset;
	spec.inertiaTensor = target.inertiaTensor;
	spec.carModelSpaceToHandlingBodySpace = target.carModelSpaceToHandlingBodySpace;
	spec.numGraphicsParts = target.numGraphicsParts;
}

// Everything the engine asserts on or indexes blindly. Every retail car passes.
export function engineProblems(spec: ParsedDeformationSpec, gfxPartCount?: number, meshSkinRows?: number): string[] {
	const out: string[] = [];
	const nTags = spec.tagPoints.length, nDriven = spec.drivenPoints.length, nParts = spec.ikParts.length;
	if (nParts > MAX_IK_PARTS) out.push(`${nParts} IK parts > ${MAX_IK_PARTS}`);
	if (spec.numDeformationSensors > MAX_SENSORS) out.push(`${spec.numDeformationSensors} sensors > ${MAX_SENSORS}`);
	spec.ikParts.forEach((p, i) => {
		const tEnd = p.startIndexOfTagPoints + p.numberOfTagPoints;
		const dEnd = p.startIndexOfDrivenPoints + p.numberOfDrivenPoints;
		if (tEnd > nTags || tEnd >= MAX_POINTS) out.push(`part ${i}: tag range ends at ${tEnd}`);
		if (dEnd > nDriven || dEnd >= MAX_POINTS) out.push(`part ${i}: driven range ends at ${dEnd}`);
		for (const t of partTags(spec, p)) {
			if (t.jointIndex !== -1 && t.jointIndex >= p.jointSpecs.length) {
				out.push(`part ${i} (type ${p.partType}): tag joint ${t.jointIndex} >= ${p.jointSpecs.length} joints`);
			}
		}
		if (WHEEL_PARTS.has(p.partType) && p.numberOfTagPoints === 0) out.push(`wheel part ${i} has no tag points`);
		if (gfxPartCount !== undefined && (p.partGraphics < -1 || p.partGraphics >= gfxPartCount)) {
			out.push(`part ${i}: partGraphics ${p.partGraphics} outside [-1, ${gfxPartCount})`);
		}
	});
	spec.tagPoints.forEach((t, i) => {
		for (const s of [t.deformationSensorA, t.deformationSensorB]) {
			if (s < 0 || s >= spec.numDeformationSensors) out.push(`tag ${i}: sensor ${s} not live`);
		}
	});
	spec.drivenPoints.forEach((d, i) => {
		for (const t of [d.tagPointIndexA, d.tagPointIndexB]) if (t < -1 || t >= nTags) out.push(`driven ${i}: tag ${t}`);
	});
	const rows = specSkinRows(spec);
	if (rows > MAX_POINTS) out.push(`${rows} skin rows > ${MAX_POINTS}`);
	for (const tag of [...spec.genericTags, ...spec.cameraTags, ...spec.lightTags]) {
		if (tag.ikPartIndex < -1 || tag.ikPartIndex >= nParts) out.push(`locator ikPartIndex ${tag.ikPartIndex}`);
		if (tag.skinPoint >= MAX_POINTS) out.push(`locator skinPoint ${tag.skinPoint}`);
	}
	spec.wheels.forEach((w, i) => {
		if (w.iValue < 0 || w.iValue >= nTags) out.push(`header wheel ${i}: tag ${w.iValue}`);
	});
	for (const g of spec.glassPanes) {
		if (g.cornerTagIndices.some((t) => t < 0 || t >= nTags)) out.push('glass pane corner tag out of range');
	}
	if (meshSkinRows !== undefined && meshSkinRows > 0 && meshSkinRows !== rows) {
		out.push(`mesh skins ${meshSkinRows} rows but the spec provides ${rows}: crashes would dent the wrong vertices`);
	}
	return out;
}

export const rootPart = (spec: ParsedDeformationSpec) => spec.ikParts.find((p) => p.partType === PART_ROOT);

export function ownWheelMeshes(spec: ParsedDeformationSpec): OwnWheelMeshes {
	const arches = new Map<number, number>();
	for (const t of HEADER_WHEEL_ARCHES) {
		const g = spec.ikParts.find((p) => p.partType === t)?.partGraphics ?? -1;
		if (g >= 0) arches.set(t, g);
	}
	const pairs = new Map<number, number>();
	for (const t of [AXLE_PAIR_REAR, AXLE_PAIR_FRONT]) {
		const g = spec.ikParts.find((p) => p.partType === t)?.partGraphics ?? -1;
		if (g >= 0) pairs.set(t, g);
	}
	const all = spec.ikParts.filter((p) => WHEEL_PARTS.has(p.partType) && p.partGraphics >= 0).map((p) => p.partGraphics);
	return { arches, pairs, all };
}
