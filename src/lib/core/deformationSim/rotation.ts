// Small 3x3 rotation helpers (row-major, column vectors) shared by the hinge
// joints, the loose bodies and the part poses.

import type { Vec3 } from '../deformationSpec';
import { add, normalize, sub } from './state';

// Right-handed rotation by `angle` about `axis`. Joint angles run from 0
// (closed) to -maxJointAngle (fully open); with this sign a door on a -X
// hinge axis lifts its rear edge, i.e. opens upward.
export function jointRotation(axis: Vec3, angle: number): number[] {
	const [x, y, z] = normalize(axis);
	const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
	return [
		t * x * x + c, t * x * y - s * z, t * x * z + s * y,
		t * x * y + s * z, t * y * y + c, t * y * z - s * x,
		t * x * z - s * y, t * y * z + s * x, t * z * z + c,
	];
}

export const mul3 = (m: number[], v: Vec3): Vec3 => [
	m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const mulT3 = (m: number[], v: Vec3): Vec3 => [
	m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

export function mulMat3(a: number[], b: number[]): number[] {
	const o = new Array(9).fill(0);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
	return o;
}

export const transpose3 = (m: number[]): number[] => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// The matrix whose columns are a, b, c.
export const fromColumns = (a: Vec3, b: Vec3, c: Vec3): number[] => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];

// Re-orthonormalises a rotation that integration has let drift (Gram-Schmidt
// on its columns).
export function orthonormalize3(m: number[]): number[] {
	const x = normalize([m[0], m[3], m[6]]);
	let y: Vec3 = [m[1], m[4], m[7]];
	const d = x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
	y = normalize([y[0] - x[0] * d, y[1] - x[1] * d, y[2] - x[2] * d]);
	const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
	return fromColumns(x, y, z);
}

// Column-major 4x4 (three.js order): rotate by `rot` about `pivot`, then
// translate by `move`.
export function poseMatrix(rot: number[], pivot: Vec3, move: Vec3 = [0, 0, 0]): number[] {
	const t = sub(add(pivot, move), mul3(rot, pivot));
	return [rot[0], rot[3], rot[6], 0, rot[1], rot[4], rot[7], 0, rot[2], rot[5], rot[8], 0, t[0], t[1], t[2], 1];
}
