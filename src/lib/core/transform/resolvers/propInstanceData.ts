// The prop-instance half of the shared **Bulk transform**.
//
// A placed prop's only spatial datum is `mWorldTransform`, a Matrix44Affine
// (16 f32) that carries BOTH its position and its facing. That makes this the
// first resolver to consume `SlotWrite.spin`: the shared math orbits the
// position, and the resolver's only extra job is to compose the same rotation
// delta into the matrix basis so a rotated prop actually turns instead of
// sliding around the pivot still facing the old way.
//
// Matrix layout (load-bearing for byte-exact writeback). Criterion stores the
// translation column at elements [12],[13],[14] and leaves the pad slots
// [3],[7],[11],[15] as 0 on disk — [15] is 0, NOT 1, on a real placed prop.
// That is column-major from three.js's view, so `Matrix4.fromArray` maps it 1:1
// (same as the prop renderer's `propInstanceMatrix`). We patch the bottom row
// to [0,0,0,1] before any homogeneous multiply, then force all four pads back
// to 0 on the way out, so an edited prop's record re-encodes to the same shape
// the writer parsed.
//
// What this resolver deliberately does NOT touch (design §5.j): `PropCell.muX`
// / `muZ` are GRID INDICES into the coarse XZ streaming grid, not world
// coordinates and not slots. Moving a prop across a cell boundary does not
// re-bin it here — the cell partition (`muStartIndex` / `muCount`) is written
// verbatim by the writer because external tools set it by hand, and silently
// re-binning would reorder the instance array, which collectibles' respawn
// grouping depends on. Same for `_trailingPad` and each instance's `_pad4D`:
// pure byte-preservation, carried through untouched by the spread.

import * as THREE from 'three';

import type { ParsedPropInstanceData, PropInstance } from '../../propInstanceData';
import { TRANSFORM_AXES_FULL_3D } from '../../transformAxes';
import type { Resolver, Rotation, SlotWrite } from '../types';

/** Euler order for the gesture's rotation delta. 'XYZ' matches
 *  `math.ts:rotatePointAboutPivot`, so the basis this resolver composes and the
 *  orbit the shared math already applied to `point` agree exactly. */
export const PROP_DELTA_EULER_ORDER: THREE.EulerOrder = 'XYZ';

/**
 * Discriminated reference to one placed prop. A prop IS a leaf spatial datum
 * (exactly one position, exactly one basis), so refs and slots coincide and
 * nothing expands.
 */
export type PropInstanceRef = { kind: 'propInstance'; instanceIdx: number };

/** Narrowed alias so call sites can name the resolver's type. */
export type PropInstanceResolverT = Resolver<ParsedPropInstanceData, PropInstanceRef, PropInstanceRef>;

/** Read a Matrix44Affine into three.js, patching the bottom row to [0,0,0,1]
 *  so the homogeneous multiply is well-formed. */
function readMatrix(mWorldTransform: readonly number[]): THREE.Matrix4 {
	const m = new THREE.Matrix4().fromArray(mWorldTransform as number[]);
	const e = m.elements;
	e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
	return m;
}

/** Emit a Matrix44Affine, forcing the pad slots back to the 0 they hold on
 *  disk (including [15], which the homogeneous form set to 1). */
function writeMatrix(mat: THREE.Matrix4): number[] {
	const arr = mat.toArray();
	arr[3] = 0; arr[7] = 0; arr[11] = 0; arr[15] = 0;
	return arr;
}

/** Left-multiply the gesture's rotation into the prop's basis: `M' = R · M`.
 *  Left, not right — a right-multiply would rotate in the prop's own local
 *  frame, so two props facing different ways would swing by different amounts
 *  in world space. */
function spinBasis(m: THREE.Matrix4, spin: Rotation): void {
	m.premultiply(
		new THREE.Matrix4().makeRotationFromEuler(
			new THREE.Euler(spin.x, spin.y, spin.z, PROP_DELTA_EULER_ORDER),
		),
	);
}

function applyWrite(inst: PropInstance, w: SlotWrite<PropInstanceRef>): PropInstance {
	const t = inst.mWorldTransform;
	const still = t[12] === w.point.x && t[13] === w.point.y && t[14] === w.point.z;
	// Nothing to compose and nothing to move: hand the record straight back so
	// the model reference survives and the Bundle is never re-encoded.
	if (!w.spin && still) return inst;

	if (!w.spin) {
		// Translate-only fast path. Copying the array rather than rebuilding it
		// through three.js keeps the other 13 floats bit-identical — a
		// round-trip through Matrix4 would be lossless in practice, but "in
		// practice" is not the standard for bytes that go back into a BND2.
		const next = t.slice();
		next[12] = w.point.x; next[13] = w.point.y; next[14] = w.point.z;
		return { ...inst, mWorldTransform: next };
	}

	const m = readMatrix(t);
	spinBasis(m, w.spin);
	const arr = writeMatrix(m);
	// `point` is AUTHORITATIVE (contract W2). The orbit was computed once, in
	// `rotatePointAboutPivot`, for every resource; re-deriving the position from
	// the matrix here is what the old `T(P)·R·T(-P)·M` sandwich did, and getting
	// its operand order wrong was invisible until a prop was already rotated.
	arr[12] = w.point.x; arr[13] = w.point.y; arr[14] = w.point.z;
	return { ...inst, mWorldTransform: arr };
}

export const propInstanceResolver: PropInstanceResolverT = {
	id: 'propInstanceData',

	// A prop IS its own leaf spatial datum. Out-of-range refs are not filtered
	// here — `resolve` returns null and `resolveSlots` drops them, keeping one
	// silent-skip path rather than two.
	expand(_model, ref) {
		return [ref];
	},

	key(slot) {
		return `propInstance:${slot.instanceIdx}`;
	},

	resolve(model, slot) {
		const inst = model.instances[slot.instanceIdx];
		if (!inst) return null;
		const t = inst.mWorldTransform;
		// Copied, never aliased: the caller holds this point for the whole
		// gesture and it must not be a live handle into the pre-gesture model.
		// `?? 0` guards a short/truncated record rather than throwing.
		return { x: t[12] ?? 0, y: t[13] ?? 0, z: t[14] ?? 0 };
	},

	/**
	 * Batched, single-pass write.
	 *
	 * Reference identity (BND2 byte-for-byte writeback, not a perf tweak):
	 * unselected instances come back by reference, `cells` and `_trailingPad`
	 * are shared wholesale, and a write that moves nothing returns the INPUT
	 * model so the overlay's `next !== data` gate never dirties the Bundle.
	 */
	write(model, writes) {
		if (writes.length === 0) return model;

		const byInstance = new Map<number, SlotWrite<PropInstanceRef>>();
		for (const w of writes) byInstance.set(w.slot.instanceIdx, w);

		let changed = false;
		const instances = model.instances.map((inst, idx) => {
			const w = byInstance.get(idx);
			if (!w) return inst;
			const next = applyWrite(inst, w);
			if (next !== inst) changed = true;
			return next;
		});

		if (!changed) return model;
		// Cells are NOT rebuilt: muX/muZ are grid indices and the partition is
		// verbatim-written. See the file header.
		return { ...model, instances };
	},

	/**
	 * Pure 3D: a prop carries a full 4x4 pose, so all three translate arrows and
	 * all three rotate rings. It vetoes nothing in a mixed **Selection** — an
	 * XZ-packed contributor is what AND-s pitch and roll off (ADR-0011).
	 *
	 * Deliberately NOT cardinality-dependent (design §4): with a
	 * drag-repositionable pivot a lone prop genuinely orbits.
	 */
	axes(refs) {
		return refs.length === 0 ? null : TRANSFORM_AXES_FULL_3D;
	},
};
