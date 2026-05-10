// Unit tests for the per-resource transform-axis descriptor module.
//
// These tests exist because the descriptor is the keystone of ADR-0011's
// data-driven yaw-lock: future slices for trigger boxes (full 3-axis),
// static traffic vehicles (Matrix44, full 3-axis), and zone points (XZ-only)
// all plug in by declaring a `TransformAxes`. Pinning the AND-intersection
// rule prevents a regression where a heterogeneous selection accidentally
// re-enables a ring some member of the selection bans.

import { describe, it, expect } from 'vitest';
import {
	intersectTransformAxes,
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	type TransformAxes,
} from './transformAxes';

describe('TRANSFORM_AXES_FULL_3D', () => {
	it('enables every translate and rotate axis', () => {
		expect(TRANSFORM_AXES_FULL_3D).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: true, y: true, z: true },
		});
	});
});

describe('TRANSFORM_AXES_XZ_PACKED', () => {
	it('enables every translate axis but only yaw rotation (per ADR-0011)', () => {
		// Translate Y still enabled because shifting portal anchor Y is
		// meaningful even when corners are XZ-packed — only the X/Z
		// rotation rings are auto-disabled.
		expect(TRANSFORM_AXES_XZ_PACKED).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: false, y: true, z: false },
		});
	});
});

describe('intersectTransformAxes', () => {
	it('returns full 3D for an empty list (no Selection)', () => {
		// Edge case: an empty Selection has no per-resource axes to AND, so
		// the gizmo defaults to the most permissive shape. (In practice the
		// gizmo simply doesn't render when the Selection is empty, but the
		// pure function still has a defined behaviour.)
		expect(intersectTransformAxes([])).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('passes a single descriptor through unchanged', () => {
		expect(intersectTransformAxes([TRANSFORM_AXES_XZ_PACKED]))
			.toEqual(TRANSFORM_AXES_XZ_PACKED);
	});

	it('ANDs each flag — XZ-packed + full-3D yields XZ-packed (the more restrictive wins)', () => {
		// The canonical heterogeneous case: a future trigger box (full 3D)
		// + an AI section (XZ-packed) in the same Selection. The yaw-lock
		// from the AI section must veto the trigger box's pitch/roll.
		const result = intersectTransformAxes([TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED]);
		expect(result).toEqual(TRANSFORM_AXES_XZ_PACKED);
	});

	it('ANDs each flag in either order — commutative', () => {
		const a = intersectTransformAxes([TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED]);
		const b = intersectTransformAxes([TRANSFORM_AXES_XZ_PACKED, TRANSFORM_AXES_FULL_3D]);
		expect(a).toEqual(b);
	});

	it('disables any axis where any descriptor disables it', () => {
		const onlyTranslateX: TransformAxes = {
			translate: { x: true, y: false, z: false },
			rotate: { x: false, y: false, z: false },
		};
		const onlyRotateY: TransformAxes = {
			translate: { x: false, y: true, z: false },
			rotate: { x: false, y: true, z: false },
		};
		expect(intersectTransformAxes([onlyTranslateX, onlyRotateY])).toEqual({
			translate: { x: false, y: false, z: false },
			rotate: { x: false, y: false, z: false },
		});
	});
});
