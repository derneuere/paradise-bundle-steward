// PropInstanceDataOverlay — overlay-level unit test.
//
// We assert the overlay's contracted behaviours against the same pure code
// paths the rendered component exercises (the repo has no DOM/R3F test infra,
// so we cover the exported helpers directly — same approach as
// ZoneListOverlay.test.ts):
//
//   - the path↔selection codec round-trips `['instances', i]` and rejects
//     anything that isn't an instance path,
//   - `propInstancePosition` reads the world translation out of the affine
//     transform's last row (indices 12,13,14),
//   - `propTypeColor` is deterministic and spreads distinct types apart.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
	propInstanceSelectionCodec,
	propInstancePosition,
	propInstanceMatrix,
	propTypeColor,
} from '../PropInstanceDataOverlay';
import type { PropInstance } from '@/lib/core/propInstanceData';

function makeInstance(x: number, y: number, z: number, typeId = 0): PropInstance {
	const m = new Array(16).fill(0);
	m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
	return {
		mWorldTransform: m,
		typeId,
		flags: 0,
		muInstanceID: 1234,
		muAlternativeType: 0xffff,
		mRotationAxis: 0,
		mn8RotSpeed: 0,
		mn8MaxAngle: 0,
		mn8MinAngle: 0,
		_pad4D: [0, 0, 0],
	};
}

describe('propInstanceSelectionCodec', () => {
	it('maps an instance path to a selection and back', () => {
		const sel = propInstanceSelectionCodec.pathToSelection(['instances', 7]);
		expect(sel).toEqual({ kind: 'propInstance', indices: [7] });
		expect(propInstanceSelectionCodec.selectionToPath(sel!)).toEqual(['instances', 7]);
	});

	it('collapses a sub-path inside an instance to that instance', () => {
		const sel = propInstanceSelectionCodec.pathToSelection(['instances', 3, 'mWorldTransform']);
		expect(sel).toEqual({ kind: 'propInstance', indices: [3] });
	});

	it('rejects non-instance paths', () => {
		expect(propInstanceSelectionCodec.pathToSelection([])).toBeNull();
		expect(propInstanceSelectionCodec.pathToSelection(['cells', 0])).toBeNull();
		expect(propInstanceSelectionCodec.pathToSelection(['instances'])).toBeNull();
	});
});

describe('propInstancePosition', () => {
	it('reads world X / Y(height) / Z from the transform translation row', () => {
		// Mirrors gold inst[10]: (2025.59, 11.67, -1292.24).
		const inst = makeInstance(2025.59, 11.67, -1292.24);
		expect(propInstancePosition(inst)).toEqual([2025.59, 11.67, -1292.24]);
	});
});

describe('propInstanceMatrix', () => {
	it('maps the transform to a THREE matrix with translation at [12..14] and a patched bottom row', () => {
		// Rotation-only upper 3x3 + translation in the last row, pad slots zero.
		const inst = makeInstance(10, 20, 30);
		inst.mWorldTransform[0] = 1; inst.mWorldTransform[5] = 1; inst.mWorldTransform[10] = 1;
		const m = propInstanceMatrix(inst, new THREE.Matrix4());
		const e = m.elements;
		// Translation column maps directly from floats 12/13/14.
		expect([e[12], e[13], e[14]]).toEqual([10, 20, 30]);
		// Bottom row patched to [0,0,0,1] so the homogeneous w is valid.
		expect([e[3], e[7], e[11], e[15]]).toEqual([0, 0, 0, 1]);
		// A point at the origin lands at the translation.
		const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
		expect([p.x, p.y, p.z]).toEqual([10, 20, 30]);
	});
});

describe('propTypeColor', () => {
	it('is deterministic per type', () => {
		expect(propTypeColor(8).getHex()).toBe(propTypeColor(8).getHex());
	});

	it('gives different types different colours', () => {
		expect(propTypeColor(8).getHex()).not.toBe(propTypeColor(9).getHex());
	});
});
