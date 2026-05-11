// TransformAxes contribution from trigger-box refs (issue #77).
//
// Pins the per-resource axes profile that the overlay AND-intersects
// with other resource families (ADR-0011 / `intersectTransformAxes`).
// Mixed Selections — e.g. trigger box + AI section corner — collapse
// pitch and roll to disabled even though a pure trigger-box Selection
// would expose all three rings.

import { describe, expect, it } from 'vitest';
import {
	bulkTriggerBoxAxes,
	triggerBoxRefAxes,
} from './transformAxes';
import {
	intersectTransformAxes,
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
} from '../transformAxes';
import type { TriggerBoxEntityRef } from './bulk';

describe('triggerBoxRefAxes', () => {
	it('returns FULL_3D for every box-carrying kind', () => {
		const kinds: TriggerBoxEntityRef['kind'][] = ['landmark', 'generic', 'blackspot', 'vfx'];
		for (const kind of kinds) {
			const axes = triggerBoxRefAxes({ kind, idx: 0 } as TriggerBoxEntityRef);
			expect(axes).toEqual(TRANSFORM_AXES_FULL_3D);
		}
	});

	it('returns translate-only (rotate disabled) for roaming and spawn', () => {
		for (const kind of ['roaming', 'spawn'] as const) {
			const axes = triggerBoxRefAxes({ kind, idx: 0 } as TriggerBoxEntityRef);
			expect(axes.translate).toEqual({ x: true, y: true, z: true });
			expect(axes.rotate).toEqual({ x: false, y: false, z: false });
		}
	});
});

describe('bulkTriggerBoxAxes', () => {
	it('returns full 3-axis for a pure box-only Selection (acceptance: pitch/roll enabled)', () => {
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'generic', idx: 1 },
			{ kind: 'vfx', idx: 2 },
		];
		expect(bulkTriggerBoxAxes(refs)).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('collapses rotate to zeros when any roaming or spawn ref joins', () => {
		const refs: TriggerBoxEntityRef[] = [
			{ kind: 'landmark', idx: 0 },
			{ kind: 'roaming', idx: 0 },
		];
		const axes = bulkTriggerBoxAxes(refs);
		expect(axes?.translate).toEqual({ x: true, y: true, z: true });
		expect(axes?.rotate).toEqual({ x: false, y: false, z: false });
	});

	it('returns null on empty refs (caller shows no gizmo)', () => {
		expect(bulkTriggerBoxAxes([])).toBeNull();
	});
});

// The cross-resource AND-intersection ADR-0011 mandates. Trigger box +
// XZ-packed AI section corner → pitch and roll disabled (XZ wins).
describe('Cross-resource intersection (trigger box + XZ-packed)', () => {
	it('intersects to yaw-only when a trigger box is mixed with an XZ-packed resource', () => {
		const triggerOnly = bulkTriggerBoxAxes([{ kind: 'landmark', idx: 0 }]);
		expect(triggerOnly).toEqual(TRANSFORM_AXES_FULL_3D);
		const mixed = intersectTransformAxes([triggerOnly!, TRANSFORM_AXES_XZ_PACKED]);
		expect(mixed.rotate).toEqual({ x: false, y: true, z: false });
		expect(mixed.translate).toEqual({ x: true, y: true, z: true });
	});

	it('intersects to FULL_3D for pure trigger-box Selection (no XZ-packed contributor)', () => {
		const triggerOnly = bulkTriggerBoxAxes([
			{ kind: 'landmark', idx: 0 },
			{ kind: 'generic', idx: 0 },
		]);
		// Single-input intersection is identity.
		expect(intersectTransformAxes([triggerOnly!])).toEqual(TRANSFORM_AXES_FULL_3D);
	});
});
