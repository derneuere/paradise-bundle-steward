// Coverage for the prop-instance rigid transform ops (propInstanceDataOps.ts) —
// the math behind the WorldViewport gizmo. Pure, so fully unit-tested here.

import { describe, it, expect } from 'vitest';
import {
	translatePropInstance,
	rotatePropInstance,
	translatePropInstances,
	rotatePropInstances,
	propInstancesPivot,
} from '../propInstanceDataOps';
import type { ParsedPropInstanceData, PropInstance } from '../propInstanceData';

// Identity Matrix44Affine with translation at [12,13,14] and pad slots 0 (the
// on-disk shape) — [15] is 0, not 1, mirroring a real placed prop.
function instAt(x: number, y: number, z: number): PropInstance {
	const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 0];
	return {
		mWorldTransform: m, typeId: 0, flags: 0, muInstanceID: 0,
		muAlternativeType: 0xffff, mn8RotSpeed: 0, mn8MaxAngle: 0, mn8MinAngle: 0,
		_pad4D: [0, 0, 0],
	};
}

function pid(instances: PropInstance[]): ParsedPropInstanceData {
	return { muZoneId: 0, muSizeInBytes: 0, muNumberOfInstances: instances.length, instances, cells: [], _trailingPad: new Uint8Array(0) };
}

describe('translatePropInstance', () => {
	it('shifts only the translation column', () => {
		const out = translatePropInstance(instAt(10, 20, 30), { x: 1, y: 2, z: 3 });
		expect(out.mWorldTransform[12]).toBe(11);
		expect(out.mWorldTransform[13]).toBe(22);
		expect(out.mWorldTransform[14]).toBe(33);
		// rotation portion + pad untouched
		expect(out.mWorldTransform.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
	});
	it('returns the same reference on a zero offset (byte-exact no-op)', () => {
		const inst = instAt(1, 2, 3);
		expect(translatePropInstance(inst, { x: 0, y: 0, z: 0 })).toBe(inst);
	});
});

describe('rotatePropInstance', () => {
	it('orbits the position around a remote pivot (180° about Y)', () => {
		// (10,0,0) rotated 180° about Y around origin → (-10,0,0).
		const out = rotatePropInstance(instAt(10, 0, 0), { x: 0, y: 0, z: 0 }, { x: 0, y: Math.PI, z: 0 });
		expect(out.mWorldTransform[12]).toBeCloseTo(-10, 5);
		expect(out.mWorldTransform[13]).toBeCloseTo(0, 5);
		expect(out.mWorldTransform[14]).toBeCloseTo(0, 5);
	});
	it('keeps position fixed when the pivot is the prop itself', () => {
		const out = rotatePropInstance(instAt(10, 5, -3), { x: 10, y: 5, z: -3 }, { x: 0, y: Math.PI / 2, z: 0 });
		expect(out.mWorldTransform[12]).toBeCloseTo(10, 5);
		expect(out.mWorldTransform[13]).toBeCloseTo(5, 5);
		expect(out.mWorldTransform[14]).toBeCloseTo(-3, 5);
	});
	it('writes pad slots [3],[7],[11],[15] back to 0 (byte-exact layout)', () => {
		const out = rotatePropInstance(instAt(1, 2, 3), { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.2, z: 0.3 });
		for (const i of [3, 7, 11, 15]) expect(out.mWorldTransform[i]).toBe(0);
	});
	it('returns the same reference on an identity delta', () => {
		const inst = instAt(1, 2, 3);
		expect(rotatePropInstance(inst, { x: 5, y: 5, z: 5 }, { x: 0, y: 0, z: 0 })).toBe(inst);
	});
});

describe('set-scoped ops', () => {
	it('translates only the addressed instances and leaves the rest by reference', () => {
		const data = pid([instAt(0, 0, 0), instAt(10, 0, 0), instAt(20, 0, 0)]);
		const out = translatePropInstances(data, [0, 2], { x: 5, y: 0, z: 0 });
		expect(out.instances[0].mWorldTransform[12]).toBe(5);
		expect(out.instances[2].mWorldTransform[12]).toBe(25);
		expect(out.instances[1]).toBe(data.instances[1]); // untouched, same ref
	});
	it('returns the same model reference on an empty index set', () => {
		const data = pid([instAt(0, 0, 0)]);
		expect(translatePropInstances(data, [], { x: 5, y: 0, z: 0 })).toBe(data);
		expect(rotatePropInstances(data, [], { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(data);
	});
	it('ignores out-of-range / duplicate indices', () => {
		const data = pid([instAt(0, 0, 0), instAt(10, 0, 0)]);
		const out = translatePropInstances(data, [1, 1, 9, -1], { x: 5, y: 0, z: 0 });
		expect(out.instances[1].mWorldTransform[12]).toBe(15);
		expect(out.instances[0]).toBe(data.instances[0]);
	});
});

describe('propInstancesPivot', () => {
	it('is the per-axis median of the addressed positions', () => {
		const data = pid([instAt(0, 0, 0), instAt(10, 4, 100), instAt(20, 8, -100)]);
		expect(propInstancesPivot(data, [0, 1, 2])).toEqual({ x: 10, y: 4, z: 0 });
	});
	it('is null for an empty set', () => {
		expect(propInstancesPivot(pid([instAt(0, 0, 0)]), [])).toBeNull();
	});
});
