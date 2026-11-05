// Ambient light: the keyframe's six-direction fill rig turned into the
// irradiance quadrics the vehicle and world shaders evaluate per vertex.
//
// The engine builds a rig of three axes from the key light: the sun's
// horizontal heading, the vertical, and their cross product. Each axis carries
// two authored fill colours (one per side), each scaled by the keyframe's
// mfAmbientIrradianceScale. The six samples are projected onto the nine
// order-2 spherical harmonics and folded into one 4x4 irradiance matrix per
// colour channel (Ramamoorthi & Hanrahan 2001), so E(n) = [n 1] M [n 1]^T.
//
// The shaders don't take M directly: two 4x4 "quadric" constants are packed so
// a unit normal needs three dot products per channel (the z² term is folded
// into the constant via x² + y² + z² = 1):
//   E_c(n) = A[0][c] + dot(A[c+1], (n.x, n.y, n.z, n.x²))
//                    + dot(B[c],   (n.x·n.y, n.y·n.z, n.z·n.x, n.y²))
// IrradianceQuadricA = A, IrradianceQuadricB = B, rows in cb order.
//
// Sample directions are where the light ARRIVES FROM: the key fill comes from
// the sun's side, the "up" fill from below (it is the ground bounce: dark warm
// grey in the daylight keyframes) and the "down" fill from above (sky blue).

import type { EnvironmentLightingData, Vec3 } from '../environmentSettings';

/** Row-major 4x4 matrix, 16 floats. */
export type Matrix4Rows = number[];
/** Per-channel (R, G, B) irradiance matrices. */
export type IrradianceMatrices = [Matrix4Rows, Matrix4Rows, Matrix4Rows];

const SH_C1 = 0.28209479;
const SH_C2 = 0.488603;
const SH_C3 = 1.092548;
const SH_C4 = 0.315392;
const SH_C5 = 0.546274;
const IRR_C1 = 0.429043;
const IRR_C2 = 0.511664;
const IRR_C3 = 0.743125;
const IRR_C4 = 0.886227;
const IRR_C5 = 0.247708;

const scaled = (c: Vec3, s: number): Vec3 => ({ x: c.x * s, y: c.y * s, z: c.z * s });
const normalize = (v: Vec3): Vec3 => {
	const l = Math.hypot(v.x, v.y, v.z);
	return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });

function shBasis(d: Vec3): number[] {
	const { x, y, z } = d;
	return [
		SH_C1,
		SH_C2 * y, SH_C2 * z, SH_C2 * x,
		SH_C3 * x * y, SH_C3 * y * z,
		SH_C4 * (3 * z * z - 1),
		SH_C3 * x * z,
		SH_C5 * (x * x - y * y),
	];
}

/** The nine SH coefficients (each an RGB triple) of the keyframe fill rig. */
export function fillRigCoefficients(keyLightDir: Vec3, lighting: EnvironmentLightingData): Vec3[] {
	const s = lighting.mfAmbientIrradianceScale;
	const up: Vec3 = { x: 0, y: 1, z: 0 };
	const sunFill = normalize({ x: keyLightDir.x, y: 0, z: keyLightDir.z });
	const right = normalize({ x: up.y * sunFill.z - up.z * sunFill.y, y: up.z * sunFill.x - up.x * sunFill.z, z: up.x * sunFill.y - up.y * sunFill.x });
	const samples: [Vec3, Vec3][] = [
		[scaled(lighting.mv3KeyFillColour, s), neg(sunFill)],
		[scaled(lighting.mv3ShadowFillColour, s), sunFill],
		[scaled(lighting.mv3UpFillColour, s), neg(up)],
		[scaled(lighting.mv3DownFillColour, s), up],
		[scaled(lighting.mv3RightFillColour, s), neg(right)],
		[scaled(lighting.mv3LeftFillColour, s), right],
	];
	const coeffs: Vec3[] = Array.from({ length: 9 }, () => ({ x: 0, y: 0, z: 0 }));
	for (const [colour, dir] of samples) {
		const b = shBasis(dir);
		for (let i = 0; i < 9; i++) {
			coeffs[i].x += colour.x * b[i];
			coeffs[i].y += colour.y * b[i];
			coeffs[i].z += colour.z * b[i];
		}
	}
	return coeffs;
}

/** One channel's irradiance matrix from the nine SH coefficients. */
function irradianceMatrix(coeffs: Vec3[], channel: 'x' | 'y' | 'z'): Matrix4Rows {
	const [L00, L1m1, L10, L11, L2m2, L2m1, L20, L21, L22] = coeffs.map((c) => c[channel]);
	return [
		IRR_C1 * L22, IRR_C1 * L2m2, IRR_C1 * L21, IRR_C2 * L11,
		IRR_C1 * L2m2, -IRR_C1 * L22, IRR_C1 * L2m1, IRR_C2 * L1m1,
		IRR_C1 * L21, IRR_C1 * L2m1, IRR_C3 * L20, IRR_C2 * L10,
		IRR_C2 * L11, IRR_C2 * L1m1, IRR_C2 * L10, IRR_C4 * L00 - IRR_C5 * L20,
	];
}

export function irradianceMatrices(keyLightDir: Vec3, lighting: EnvironmentLightingData): IrradianceMatrices {
	const c = fillRigCoefficients(keyLightDir, lighting);
	return [irradianceMatrix(c, 'x'), irradianceMatrix(c, 'y'), irradianceMatrix(c, 'z')];
}

/** E(n) = [n 1] M [n 1]^T per channel. */
export function evaluateIrradianceMatrices(m: IrradianceMatrices, n: Vec3): Vec3 {
	const v = [n.x, n.y, n.z, 1];
	const e = m.map((mm) => {
		let s = 0;
		for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += v[r] * mm[r * 4 + c] * v[c];
		return s;
	});
	return { x: e[0], y: e[1], z: e[2] };
}

/** Pack the three channel matrices into the shaders' IrradianceQuadricA / B rows. */
export function packIrradianceQuadrics(m: IrradianceMatrices): { a: Matrix4Rows; b: Matrix4Rows } {
	const a = new Array<number>(16).fill(0);
	const b = new Array<number>(16).fill(0);
	for (let ch = 0; ch < 3; ch++) {
		const mm = m[ch];
		const czz = mm[10];
		a[ch] = mm[15] + czz;
		a.splice((ch + 1) * 4, 4, 2 * mm[3], 2 * mm[7], 2 * mm[11], mm[0] - czz);
		b.splice(ch * 4, 4, 2 * mm[1], 2 * mm[6], 2 * mm[8], mm[5] - czz);
	}
	b[15] = 1;
	return { a, b };
}

/** The shader-side evaluation of the packed quadrics (unsaturated). */
export function evaluateIrradianceQuadrics(q: { a: Matrix4Rows; b: Matrix4Rows }, n: Vec3): Vec3 {
	const p = [n.x, n.y, n.z, n.x * n.x];
	const s = [n.x * n.y, n.y * n.z, n.z * n.x, n.y * n.y];
	const dot = (m: Matrix4Rows, row: number, v: number[]) =>
		m[row * 4] * v[0] + m[row * 4 + 1] * v[1] + m[row * 4 + 2] * v[2] + m[row * 4 + 3] * v[3];
	const ch = (c: number) => q.a[c] + dot(q.a, c + 1, p) + dot(q.b, c, s);
	return { x: ch(0), y: ch(1), z: ch(2) };
}
