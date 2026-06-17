// Prop-instance rigid transform ops — translate / rotate a set of placed props
// by editing their `mWorldTransform` (a Matrix44Affine, 16 f32s). Powers the
// WorldViewport transform gizmo + marquee multi-select, mirroring the
// static-traffic-vehicle ops (staticVehicleMatrix44.ts) — props are likewise a
// full 4×4 pose, so they get all three rotate axes.
//
// Matrix layout (load-bearing). Criterion's Matrix44Affine stores the
// translation column at elements [12],[13],[14] with the pad slots
// [3],[7],[11],[15] = 0 on disk. That is column-major from three.js's view, so
// `THREE.Matrix4.fromArray` maps it 1:1 (same as the prop renderer's
// `propInstanceMatrix`). We patch the bottom row to [0,0,0,1] before the
// homogeneous multiply, then write [3],[7],[11],[15] back to 0 so a placed
// prop's bytes round-trip exactly (the writer emits 16 f32s linearly).
//
// Rotate-around-pivot rule (same as the static vehicle / trigger-box gizmos):
//   M' = T(P) · R(delta) · T(-P) · M     (pre-multiply)
// which orbits the prop's position around the pivot AND composes the rotation
// delta into its facing. Euler order 'XYZ', matching every other WorldViewport
// gizmo so a future mixed Selection composes consistently.
//
// No-op contract: an identity gesture (zero translate / zero rotate) or an empty
// index set returns the SAME `ParsedPropInstanceData` reference, so the BND2
// byte-for-byte writeback survives a touch-free gizmo gesture.

import * as THREE from 'three';
import type { ParsedPropInstanceData, PropInstance } from './propInstanceData';

export const PROP_DELTA_EULER_ORDER: THREE.EulerOrder = 'XYZ';

type Vec3 = { x: number; y: number; z: number };

// --- Matrix44Affine ↔ THREE.Matrix4 ----------------------------------------

function readMatrix(mWorldTransform: readonly number[]): THREE.Matrix4 {
	const m = new THREE.Matrix4().fromArray(mWorldTransform);
	const e = m.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	return m;
}

function writeMatrix(mat: THREE.Matrix4): number[] {
	const arr = mat.toArray();
	arr[3] = 0; arr[7] = 0; arr[11] = 0; arr[15] = 0;
	return arr;
}

// --- Single-instance ops (exported for tests) -------------------------------

/** Translate one instance's transform by `(dx, dy, dz)`. Returns the input
 *  reference verbatim on a zero offset. */
export function translatePropInstance(inst: PropInstance, offset: Vec3): PropInstance {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return inst;
	const next = inst.mWorldTransform.slice();
	next[12] = (next[12] ?? 0) + offset.x;
	next[13] = (next[13] ?? 0) + offset.y;
	next[14] = (next[14] ?? 0) + offset.z;
	return { ...inst, mWorldTransform: next };
}

/** Rotate one instance's transform around `pivot` by the delta Euler. Returns
 *  the input reference verbatim on an identity delta. */
export function rotatePropInstance(inst: PropInstance, pivot: Vec3, deltaEuler: Vec3): PropInstance {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return inst;
	const M = readMatrix(inst.mWorldTransform);
	const R = new THREE.Matrix4().makeRotationFromEuler(
		new THREE.Euler(deltaEuler.x, deltaEuler.y, deltaEuler.z, PROP_DELTA_EULER_ORDER),
	);
	// composed = T(P) · R · T(-P), then M' = composed · M (see file header).
	M.premultiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
	M.premultiply(R);
	M.premultiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));
	return { ...inst, mWorldTransform: writeMatrix(M) };
}

// --- Set-scoped ops over ParsedPropInstanceData -----------------------------

function uniqueValidIndices(data: ParsedPropInstanceData, indices: Iterable<number>): number[] {
	const n = data.instances.length;
	const out = new Set<number>();
	for (const i of indices) if (Number.isInteger(i) && i >= 0 && i < n) out.add(i);
	return [...out];
}

/** Translate every instance in `indices` by `offset`. Returns the input model
 *  reference on a zero offset, empty set, or when no instance actually moved. */
export function translatePropInstances(
	data: ParsedPropInstanceData,
	indices: Iterable<number>,
	offset: Vec3,
): ParsedPropInstanceData {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return data;
	const targets = new Set(uniqueValidIndices(data, indices));
	if (targets.size === 0) return data;
	let changed = false;
	const instances = data.instances.map((inst, i) => {
		if (!targets.has(i)) return inst;
		const next = translatePropInstance(inst, offset);
		if (next !== inst) changed = true;
		return next;
	});
	return changed ? { ...data, instances } : data;
}

/** Rotate every instance in `indices` around `pivot` by the delta Euler.
 *  Returns the input model reference on an identity delta / empty set. */
export function rotatePropInstances(
	data: ParsedPropInstanceData,
	indices: Iterable<number>,
	pivot: Vec3,
	deltaEuler: Vec3,
): ParsedPropInstanceData {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return data;
	const targets = new Set(uniqueValidIndices(data, indices));
	if (targets.size === 0) return data;
	let changed = false;
	const instances = data.instances.map((inst, i) => {
		if (!targets.has(i)) return inst;
		const next = rotatePropInstance(inst, pivot, deltaEuler);
		if (next !== inst) changed = true;
		return next;
	});
	return changed ? { ...data, instances } : data;
}

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Median world position of the addressed instances — the gizmo pivot. Null for
 *  an empty / fully out-of-range set. Median (not mean) so one far outlier
 *  doesn't drag the pivot off the cluster, matching trafficDataSelectionPivot. */
export function propInstancesPivot(data: ParsedPropInstanceData, indices: Iterable<number>): Vec3 | null {
	const targets = uniqueValidIndices(data, indices);
	if (targets.length === 0) return null;
	const xs: number[] = [], ys: number[] = [], zs: number[] = [];
	for (const i of targets) {
		const t = data.instances[i].mWorldTransform;
		xs.push(t[12] ?? 0); ys.push(t[13] ?? 0); zs.push(t[14] ?? 0);
	}
	return { x: median(xs), y: median(ys), z: median(zs) };
}
