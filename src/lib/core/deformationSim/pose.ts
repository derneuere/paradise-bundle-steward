// The car's frames. The deformation spec's points are in its handling-body
// frame; the body meshes are in their model frame, which differs from it by
// the spec's carModelSpaceToHandlingBodySpace translation; the rigid body sits
// at the centre of mass in the world (ground at y = 0).

import type { ParsedDeformationSpec, Vec3 } from '../deformationSpec';
import { rotationMatrix, toBody, toBodyDir, toWorld, toWorldDir } from '../vehicleSim/body';
import { add, sub, type SimState } from './state';

// Handling frame minus mesh frame: add it to a mesh point to get the spec
// frame.
export function meshShift(spec: ParsedDeformationSpec): Vec3 {
	const t = spec.carModelSpaceToHandlingBodySpace[3];
	return [t[0], t[1], t[2]];
}

export const specToWorld = (s: SimState, p: Vec3): Vec3 => toWorld(s.body, sub(p, s.com));
export const meshToWorld = (s: SimState, p: Vec3): Vec3 => specToWorld(s, add(p, meshShift(s.spec)));
export const worldToMesh = (s: SimState, p: Vec3): Vec3 => sub(add(toBody(s.body, p), s.com), meshShift(s.spec));
export const meshDirToWorld = (s: SimState, d: Vec3): Vec3 => toWorldDir(s.body, d);
export const worldDirToMesh = (s: SimState, d: Vec3): Vec3 => toBodyDir(s.body, d);

// Column-major 4x4 (three.js order) taking the body mesh's frame to the world.
export function carMatrix(s: SimState): number[] {
	const r = rotationMatrix(s.body);
	const t = meshToWorld(s, [0, 0, 0]);
	return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

// a * b for column-major 4x4 affine matrices.
export function mulAffine(a: number[], b: number[]): number[] {
	const o = new Array(16).fill(0);
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
	return o;
}
