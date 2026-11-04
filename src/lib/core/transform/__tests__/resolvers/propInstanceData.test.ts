// The prop-instance resolver: Matrix44Affine packing, basis composition via
// `SlotWrite.spin`, pad-slot survival, field/reference preservation, and the
// pure-3D axis profile.
//
// Ported from the deleted `propInstanceDataOps.test.ts`. The assertions that
// only re-verified median / rotate-about-pivot / identity-delta-guard maths are
// deliberately NOT ported — those live once in `__tests__/math.test.ts` and
// `__tests__/transform.test.ts` now.
//
// Two things are pinned here that nothing asserted before:
//   * a yaw delta changes the BASIS (elements [0..11]), not just the
//     translation column — a prop that orbits without turning is the bug
//     `SlotWrite.spin` exists to prevent;
//   * `transform()` agrees element-for-element with a hand-built
//     `T(P) · R · T(-P) · M` sandwich. The old op built that sandwich by hand
//     per resource, and its operand order was only ever guarded by
//     cross-validation, so the cross-validation moves here.
//
// Yaw sign: `theta = +PI/2` takes (10,0,0) to (0,0,-10), the true right-hand /
// three.js convention (design §5(g)).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';

import type { ParsedPropInstanceData, PropInstance } from '../../../propInstanceData';
import { parsePropInstanceData, writePropInstanceData } from '../../../propInstanceData';
import { TRANSFORM_AXES_FULL_3D } from '../../../transformAxes';
import {
	PROP_DELTA_EULER_ORDER,
	propInstanceResolver,
	type PropInstanceRef,
} from '../../resolvers/propInstanceData';
import { selectionPivot, transform } from '../../transform';
import { delta, expectPoint } from '../_helpers';

/** Identity Matrix44Affine with the translation at [12,13,14] and every pad
 *  slot 0 — the on-disk shape, where [15] is 0 rather than 1. */
function instAt(x: number, y: number, z: number, basis?: readonly number[]): PropInstance {
	const m = basis ? basis.slice() : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
	m[12] = x; m[13] = y; m[14] = z;
	// On disk all four pad slots are 0 — including [15]. three.js hands back a
	// homogeneous matrix with [15] = 1, so a supplied basis is flattened here.
	m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 0;
	return {
		mWorldTransform: m, typeId: 7, flags: 1, muInstanceID: 42,
		muAlternativeType: 0xffff, mRotationAxis: 0x40, mn8RotSpeed: 3,
		mn8MaxAngle: 9, mn8MinAngle: 2,
		_pad4D: [0, 0, 0],
	};
}

function pid(instances: PropInstance[]): ParsedPropInstanceData {
	return {
		muZoneId: 0, muSizeInBytes: 0, muNumberOfInstances: instances.length,
		instances,
		// muX/muZ are GRID INDICES into the streaming grid, never slots: a prop
		// that moves out of its cell is NOT re-binned (design §5.j).
		cells: [{ muX: 3, muZ: 5, muStartIndex: 0, muCount: instances.length, muNumberOfRespawnDifferent: 0, muNumberOfDontRespawn: 0 }],
		_trailingPad: new Uint8Array([0, 0, 0, 0]),
	};
}

const P0: PropInstanceRef = { kind: 'propInstance', instanceIdx: 0 };
const P1: PropInstanceRef = { kind: 'propInstance', instanceIdx: 1 };
const P2: PropInstanceRef = { kind: 'propInstance', instanceIdx: 2 };
const YAW_90 = { x: 0, y: Math.PI / 2, z: 0 };
const ORIGIN = { x: 0, y: 0, z: 0 };

/** A deliberately non-axis-aligned starting basis, so a composition-order bug
 *  cannot hide behind an identity matrix. */
const TILTED = new THREE.Matrix4()
	.makeRotationFromEuler(new THREE.Euler(0.3, -0.7, 0.4, PROP_DELTA_EULER_ORDER))
	.toArray();

describe('propInstanceResolver — slots', () => {
	it('expands an instance ref to exactly itself (a prop IS a leaf datum)', () => {
		const model = pid([instAt(0, 0, 0)]);
		expect(propInstanceResolver.expand(model, P0)).toEqual([P0]);
		expect(propInstanceResolver.key(P0)).toBe('propInstance:0');
		expect(propInstanceResolver.key(P1)).not.toBe(propInstanceResolver.key(P0));
	});

	it('resolves the position out of matrix elements [12],[13],[14] as a copy', () => {
		const model = pid([instAt(10, 20, 30, TILTED)]);
		const p = propInstanceResolver.resolve(model, P0);
		expect(p).toEqual({ x: 10, y: 20, z: 30 });
		// Mutating the resolved point must not reach back into the model.
		p!.x = 999;
		expect(model.instances[0].mWorldTransform[12]).toBe(10);
	});

	it('resolves an out-of-range instance to null instead of throwing', () => {
		const model = pid([instAt(0, 0, 0)]);
		expect(propInstanceResolver.resolve(model, { kind: 'propInstance', instanceIdx: 9 })).toBeNull();
		const next = transform(model, [{ kind: 'propInstance', instanceIdx: 9 }, P0], delta({ translate: { x: 5, y: 0, z: 0 } }), propInstanceResolver);
		expect(next.instances[0].mWorldTransform[12]).toBe(5);
		expect(next.instances).toHaveLength(1);
	});

	it('drops the gesture entirely when every ref is out of range', () => {
		const model = pid([instAt(0, 0, 0)]);
		const next = transform(model, [{ kind: 'propInstance', instanceIdx: -1 }], delta({ translate: { x: 5, y: 0, z: 0 } }), propInstanceResolver);
		expect(next).toBe(model);
	});
});

describe('propInstanceResolver — translate', () => {
	it('shifts only the translation column and leaves the basis + pads byte-identical', () => {
		const model = pid([instAt(10, 20, 30, TILTED)]);
		const next = transform(model, [P0], delta({ translate: { x: 1, y: 2, z: 3 } }), propInstanceResolver);
		const t = next.instances[0].mWorldTransform;
		expect([t[12], t[13], t[14]]).toEqual([11, 22, 33]);
		// Not "close to" — a pure translate must not round-trip the basis
		// through a matrix multiply at all.
		expect(t.slice(0, 12)).toEqual(model.instances[0].mWorldTransform.slice(0, 12));
		expect(t[15]).toBe(0);
	});

	it('moves only the addressed instances and returns the rest by reference', () => {
		const model = pid([instAt(0, 0, 0), instAt(10, 0, 0), instAt(20, 0, 0)]);
		const next = transform(model, [P0, P2], delta({ translate: { x: 5, y: 0, z: 0 } }), propInstanceResolver);
		expect(next.instances[0].mWorldTransform[12]).toBe(5);
		expect(next.instances[2].mWorldTransform[12]).toBe(25);
		expect(next.instances[1]).toBe(model.instances[1]);
	});

	it('preserves every non-spatial field of a moved instance', () => {
		const model = pid([instAt(0, 0, 0)]);
		const next = transform(model, [P0], delta({ translate: { x: 1, y: 0, z: 0 } }), propInstanceResolver);
		const inst = next.instances[0];
		expect(inst.typeId).toBe(7);
		expect(inst.flags).toBe(1);
		expect(inst.muInstanceID).toBe(42);
		expect(inst.muAlternativeType).toBe(0xffff);
		expect(inst.mRotationAxis).toBe(0x40);
		expect(inst.mn8RotSpeed).toBe(3);
		expect(inst.mn8MaxAngle).toBe(9);
		expect(inst.mn8MinAngle).toBe(2);
		// The record's trailing u8[3] pad rides along by reference.
		expect(inst._pad4D).toBe(model.instances[0]._pad4D);
	});

	it('shares cells and the trailing pad wholesale — a moved prop is never re-binned', () => {
		const model = pid([instAt(0, 0, 0)]);
		const next = transform(model, [P0], delta({ translate: { x: 500, y: 0, z: 500 } }), propInstanceResolver);
		expect(next.cells).toBe(model.cells);
		expect(next.cells[0].muX).toBe(3);
		expect(next.cells[0].muZ).toBe(5);
		expect(next._trailingPad).toBe(model._trailingPad);
		expect(next.muSizeInBytes).toBe(model.muSizeInBytes);
		expect(next.muNumberOfInstances).toBe(model.muNumberOfInstances);
	});

	it('returns the input model when a write lands a prop exactly where it already is', () => {
		// The resolver's own no-change guard, reached below transform()'s
		// identity-delta early-out.
		const model = pid([instAt(4, 5, 6)]);
		const same = propInstanceResolver.write(model, [{ slot: P0, point: { x: 4, y: 5, z: 6 }, spin: null }]);
		expect(same).toBe(model);
		expect(propInstanceResolver.write(model, [])).toBe(model);
	});
});

describe('propInstanceResolver — rotate', () => {
	it('orbits the prop about the pivot with the right-hand yaw sign', () => {
		const model = pid([instAt(10, 7, 0)]);
		const next = transform(model, [P0], delta({ rotate: YAW_90, pivot: ORIGIN }), propInstanceResolver);
		const t = next.instances[0].mWorldTransform;
		// +PI/2 about +Y takes +X toward -Z.
		expectPoint({ x: t[12], y: t[13], z: t[14] }, { x: 0, y: 7, z: -10 });
	});

	it('composes the delta into the BASIS, not just the position', () => {
		// The bug this pins: without `spin` every prop orbits the pivot while
		// still facing the old way — invisible on a cone, obvious on a sign.
		const model = pid([instAt(10, 0, 0)]);
		const next = transform(model, [P0], delta({ rotate: YAW_90, pivot: ORIGIN }), propInstanceResolver);
		const t = next.instances[0].mWorldTransform;
		const expected = new THREE.Matrix4().makeRotationFromEuler(
			new THREE.Euler(0, Math.PI / 2, 0, PROP_DELTA_EULER_ORDER),
		).toArray();
		for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(t[i]).toBeCloseTo(expected[i], 10);
	});

	it('keeps the position fixed when the pivot is the prop itself, but still turns it', () => {
		const model = pid([instAt(10, 5, -3)]);
		const next = transform(model, [P0], delta({ rotate: YAW_90, pivot: { x: 10, y: 5, z: -3 } }), propInstanceResolver);
		const t = next.instances[0].mWorldTransform;
		expectPoint({ x: t[12], y: t[13], z: t[14] }, { x: 10, y: 5, z: -3 });
		expect(t[0]).toBeCloseTo(0, 10);
		expect(t[8]).toBeCloseTo(1, 10);
	});

	it('forces the pad slots [3],[7],[11],[15] back to 0 after the matrix multiply', () => {
		// `readMatrix` sets [15] = 1 so the homogeneous multiply is well-formed;
		// on disk all four pads are 0, so all four must come back 0.
		const model = pid([instAt(1, 2, 3, TILTED)]);
		const next = transform(model, [P0], delta({ rotate: { x: 0.1, y: 0.2, z: 0.3 }, pivot: ORIGIN }), propInstanceResolver);
		for (const i of [3, 7, 11, 15]) expect(next.instances[0].mWorldTransform[i]).toBe(0);
	});

	it('agrees element-for-element with a hand-built T(P) · R · T(-P) · M sandwich', () => {
		// Cross-validation retargeted from the old per-resource sandwich, which
		// is exactly the code whose operand order was easy to get backwards.
		const pivot = { x: -12, y: 4, z: 30 };
		const rot = { x: 0.21, y: -1.1, z: 0.63 };
		const start = instAt(17, -3, 8, TILTED);
		const next = transform(pid([start]), [P0], delta({ rotate: rot, pivot }), propInstanceResolver);

		const M = new THREE.Matrix4().fromArray(start.mWorldTransform);
		M.elements[3] = 0; M.elements[7] = 0; M.elements[11] = 0; M.elements[15] = 1;
		M.premultiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
		M.premultiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, PROP_DELTA_EULER_ORDER)));
		M.premultiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z));
		const expected = M.toArray();

		const got = next.instances[0].mWorldTransform;
		for (let i = 0; i < 15; i++) if (i % 4 !== 3) expect(got[i]).toBeCloseTo(expected[i], 6);
	});

	it('composes the spin exactly once for a duplicated ref', () => {
		// Marquee ∪ inspector routinely produces the same index twice. With
		// `spin` in play a double-write is not a double-translate — it
		// double-turns the prop.
		const model = pid([instAt(10, 0, 0)]);
		const once = transform(model, [P0], delta({ rotate: YAW_90, pivot: ORIGIN }), propInstanceResolver);
		const dup = transform(model, [P0, { kind: 'propInstance', instanceIdx: 0 }], delta({ rotate: YAW_90, pivot: ORIGIN }), propInstanceResolver);
		expect(dup.instances[0].mWorldTransform).toEqual(once.instances[0].mWorldTransform);
	});

	it('rotates about the TRANSLATE-ADJUSTED pivot when a gesture mixes both', () => {
		const model = pid([instAt(0, 0, 0), instAt(10, 0, 0)]);
		const next = transform(
			model,
			[P0, P1],
			delta({ translate: { x: 100, y: 0, z: 0 }, rotate: YAW_90, pivot: ORIGIN }),
			propInstanceResolver,
		);
		const a = next.instances[0].mWorldTransform;
		const b = next.instances[1].mWorldTransform;
		expectPoint({ x: a[12], y: a[13], z: a[14] }, { x: 100, y: 0, z: 0 });
		expectPoint({ x: b[12], y: b[13], z: b[14] }, { x: 100, y: 0, z: -10 });
	});
});

describe('propInstanceResolver — pivot and axes', () => {
	it('anchors the gizmo at the per-component median of the addressed positions', () => {
		const model = pid([instAt(0, 0, 0), instAt(10, 4, 100), instAt(20, 8, -100)]);
		expect(selectionPivot(model, [P0, P1, P2], propInstanceResolver)).toEqual({ x: 10, y: 4, z: 0 });
	});

	it('reports full 3-axis translate AND rotate — a prop is a full 4x4 pose', () => {
		expect(propInstanceResolver.axes([P0])).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('reports the same profile for one prop as for many (cardinality is not a factor)', () => {
		expect(propInstanceResolver.axes([P0])).toEqual(propInstanceResolver.axes([P0, P1]));
	});

	it('returns null for an empty refs list so the caller renders no gizmo', () => {
		expect(propInstanceResolver.axes([])).toBeNull();
		expect(selectionPivot(pid([instAt(0, 0, 0)]), [], propInstanceResolver)).toBeNull();
	});
});

// Byte-exactness backstop against the real resource. Structural assertions can
// only claim the model is unchanged; this proves the bytes are.
describe('propInstanceResolver — real fixture', () => {
	const GOLD = path.resolve(__dirname, '../../../../../../example/BE_9F_C7_93.dat');

	function loadGold(): Uint8Array {
		const buf = fs.readFileSync(GOLD);
		const bytes = new Uint8Array(buf.byteLength);
		bytes.set(buf);
		return bytes;
	}

	it('re-encodes with ONLY instance 0 element [12] changed, every other byte identical', () => {
		const model = parsePropInstanceData(loadGold());
		const next = transform(model, [P0], delta({ translate: { x: 1, y: 0, z: 0 } }), propInstanceResolver);
		expect(next).not.toBe(model);
		// Untouched instances (and the whole cell table) survive by reference —
		// the Bundle-level dirty check and the byte-exact writeback both need it.
		for (let i = 1; i < model.instances.length; i++) expect(next.instances[i]).toBe(model.instances[i]);
		expect(next.cells).toBe(model.cells);

		const before = writePropInstanceData(model);
		const after = writePropInstanceData(next);
		expect(after.byteLength).toBe(before.byteLength);
		const diffs: number[] = [];
		for (let i = 0; i < before.byteLength; i++) if (before[i] !== after[i]) diffs.push(i);
		const base = 0x20; // maInstances — instance 0's record, element [12] at +48
		expect(diffs.length).toBeGreaterThan(0);
		expect(diffs.every((o) => o >= base + 48 && o <= base + 51)).toBe(true);
	});
});
