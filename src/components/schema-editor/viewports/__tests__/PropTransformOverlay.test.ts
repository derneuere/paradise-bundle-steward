// Spec coverage for the PropTransformOverlay pure helpers — the bits the gizmo
// React layer relies on. The drag/gizmo interaction is exercised in the browser;
// these pin the selection-resolution + outline geometry.

import { describe, it, expect } from 'vitest';
import { buildTargetOutline, selectedInstanceIndex } from '../PropTransformOverlay';
import type { ParsedPropInstanceData, PropInstance } from '@/lib/core/propInstanceData';

function instAt(x: number, y: number, z: number): PropInstance {
	const m = new Array(16).fill(0);
	m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
	return {
		mWorldTransform: m, typeId: 0, flags: 0, muInstanceID: 0,
		muAlternativeType: 0xffff, mRotationAxis: 0, mn8RotSpeed: 0, mn8MaxAngle: 0, mn8MinAngle: 0,
		_pad4D: [0, 0, 0],
	};
}

function pid(instances: PropInstance[]): ParsedPropInstanceData {
	return { muZoneId: 0, muSizeInBytes: 0, muNumberOfInstances: instances.length, instances, cells: [], _trailingPad: new Uint8Array(0) };
}

describe('selectedInstanceIndex', () => {
	it('reads the instance index from an instances path, clamped to range', () => {
		expect(selectedInstanceIndex(['instances', 2], 5)).toBe(2);
		expect(selectedInstanceIndex(['instances', 9], 5)).toBe(-1);
		expect(selectedInstanceIndex(['instances', 2, 'mWorldTransform'], 5)).toBe(2);
	});
	it('is -1 for a non-instance path', () => {
		expect(selectedInstanceIndex(['cells', 0], 5)).toBe(-1);
		expect(selectedInstanceIndex([], 5)).toBe(-1);
	});
});

describe('buildTargetOutline', () => {
	it('is null when nothing is selected', () => {
		expect(buildTargetOutline(pid([instAt(0, 0, 0)]), [])).toBeNull();
	});
	it('emits one cube wireframe (24 edge endpoints) per target, centred on the prop', () => {
		const data = pid([instAt(100, 0, -50), instAt(0, 0, 0)]);
		const geo = buildTargetOutline(data, [0])!;
		const pos = geo.getAttribute('position');
		expect(pos.count).toBe(24); // 12 edges × 2 endpoints
		// Every vertex sits within the half-extent box around (100, 0, -50).
		for (let i = 0; i < pos.count; i++) {
			expect(Math.abs(pos.getX(i) - 100)).toBeLessThanOrEqual(2.5 + 1e-6);
			expect(Math.abs(pos.getZ(i) - -50)).toBeLessThanOrEqual(2.5 + 1e-6);
		}
		geo.dispose();
	});
	it('scales the vertex count with the number of targets', () => {
		const data = pid([instAt(0, 0, 0), instAt(10, 0, 0), instAt(20, 0, 0)]);
		const geo = buildTargetOutline(data, [0, 1, 2])!;
		expect(geo.getAttribute('position').count).toBe(24 * 3);
		geo.dispose();
	});
});
