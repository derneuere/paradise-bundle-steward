// A body part's collision box, as the game builds it when the part comes
// loose (and again every step while it hangs on its hinge). The spec's
// bounding-box data (IKPart orientation + ten skin bindings: eight corners,
// the centre and the joint point) gives ten part-local points, each skinned
// by its part's tag and driven points the way the part's vertices are, so a
// crumpled panel gets a crumpled box. The points are taken into the box's
// frame by the orientation; their extent (at least 0.1 m per side) is the
// box. A left-handed orientation is mirrored into a right-handed one first,
// as the game does when it loads the spec.
//
// As a loose body the part weighs 100 kg; its inertia is that of a solid box
// over the box's extent in the part's own axes (every side at least 5 % of the
// longest), times 1.2, plus 0.2.

import type { SkinBinding, Vec3 } from '../deformationSpec';
import { add, cross, dot, scale, sub, type SimState } from './state';
import { fromColumns, mulMat3, transpose3 } from './rotation';

export const PART_MASS = 100;
const INERTIA_MULTIPLIER = 1.2;
const INERTIA_FLOOR = 0.2;
const MIN_BOX_SIZE = 0.1;
const MIN_HALF_SIZE = 0.05;
const THIN_SIDE_FRACTION = 0.05;

export type PartBox = {
	centre: Vec3;          // mesh frame
	half: Vec3;            // along the box axes
	axes: [Vec3, Vec3, Vec3];  // the box axes, mesh frame
	partAxes: [Vec3, Vec3, Vec3];  // the part-local axes in the mesh frame (its graphics transform)
	extentInPart: Vec3;    // the box's half extent along the part-local axes
};

const xyz = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];

// A part's skin point moves by its bones' offsets from rest: tag points first,
// then the part's driven points.
function boneOffset(s: SimState, p: number, bone: number): Vec3 {
	const part = s.spec.ikParts[p];
	if (bone < part.numberOfTagPoints) {
		const i = part.startIndexOfTagPoints + bone;
		return s.tags[i] ? sub(s.tags[i], s.spec.tagPoints[i].initialPosition) : [0, 0, 0];
	}
	const i = part.startIndexOfDrivenPoints + bone - part.numberOfTagPoints;
	return s.driven[i] ? sub(s.driven[i], xyz(s.spec.drivenPoints[i].initialPos)) : [0, 0, 0];
}

function skinned(s: SimState, p: number, b: SkinBinding, vertex: Vec3): Vec3 {
	let v = vertex;
	for (let k = 0; k < 3; k++) v = add(v, scale(boneOffset(s, p, b.boneIndices[k]), b.weights[k]));
	return v;
}

// Row-vector affine transform: p.x * rows[0] + p.y * rows[1] + p.z * rows[2] + t.
const affine = (rows: Vec3[], t: Vec3, p: Vec3): Vec3 =>
	add(add(add(scale(rows[0], p[0]), scale(rows[1], p[1])), scale(rows[2], p[2])), t);

export function partBox(s: SimState, p: number): PartBox {
	const part = s.spec.ikParts[p];
	const o = [xyz(part.orientation[0]), xyz(part.orientation[1]), xyz(part.orientation[2])];
	const t = xyz(part.orientation[3]);
	const bindings = [...part.cornerSkin, part.centerSkin, part.jointSkin];
	let vertices = bindings.map((b) => xyz(b.vertex));
	if (!(dot(cross(o[0], o[1]), o[2]) >= 0)) {
		vertices = vertices.map((v) => {
			const d = sub(v, t), l: Vec3 = [-dot(o[0], d), dot(o[1], d), dot(o[2], d)];
			return affine(o, t, l);
		});
		o[0] = scale(o[0], -1);
	}
	const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	bindings.forEach((b, i) => {
		const q = affine(o, t, skinned(s, p, b, vertices[i]));
		for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
	});
	const half = [0, 1, 2].map((k) => Math.max(Math.max(hi[k] - lo[k], MIN_BOX_SIZE) / 2, MIN_HALF_SIZE)) as Vec3;
	const centreBox = [0, 1, 2].map((k) => lo[k] + Math.max(hi[k] - lo[k], MIN_BOX_SIZE) / 2) as Vec3;
	// Back out of the box frame (the orientation's inverse), then into the mesh
	// frame through the part's graphics transform.
	const local: Vec3 = [dot(o[0], sub(centreBox, t)), dot(o[1], sub(centreBox, t)), dot(o[2], sub(centreBox, t))];
	const g = [xyz(part.graphicsTransform[0]), xyz(part.graphicsTransform[1]), xyz(part.graphicsTransform[2])];
	const centre = affine(g, xyz(part.graphicsTransform[3]), local);
	const boxLocal = [0, 1, 2].map((k) => [o[0][k], o[1][k], o[2][k]] as Vec3);
	const axes = boxLocal.map((a) => affine(g, [0, 0, 0], a)) as PartBox['axes'];
	const extentInPart = [0, 1, 2].map((j) => boxLocal.reduce((sum, a, k) => sum + Math.abs(a[j]) * half[k], 0)) as Vec3;
	return { centre, half, axes, partAxes: g as PartBox['partAxes'], extentInPart };
}

// The box's eight corners about its centre, mesh frame.
export function boxCorners(box: PartBox): Vec3[] {
	const out: Vec3[] = [];
	for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
		out.push(add(add(scale(box.axes[0], sx * box.half[0]), scale(box.axes[1], sy * box.half[1])), scale(box.axes[2], sz * box.half[2])));
	}
	return out;
}

// Inverse inertia in the mesh frame (row-major) and the largest moment over
// the mass.
export function partInertia(box: PartBox): { invInertia: number[]; inertiaRatio: number } {
	const e = box.extentInPart;
	const floor = Math.max(Math.max(...e) * THIN_SIDE_FRACTION, 1e-7);
	const [x, y, z] = e.map((h) => Math.max(h, floor));
	const I = [(y * y + z * z) / 3, (x * x + z * z) / 3, (x * x + y * y) / 3].map((i) => i * PART_MASS * INERTIA_MULTIPLIER + INERTIA_FLOOR);
	const G = fromColumns(...box.partAxes);
	const D = [1 / I[0], 0, 0, 0, 1 / I[1], 0, 0, 0, 1 / I[2]];
	return { invInertia: mulMat3(mulMat3(G, D), transpose3(G)), inertiaRatio: Math.max(...I) / PART_MASS };
}
