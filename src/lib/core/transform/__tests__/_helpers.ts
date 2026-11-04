// Shared assertion/builder helpers for the core transform suites.

import { expect } from 'vitest';

import type { Point, TransformDelta } from '../types';

export const ZERO: Point = { x: 0, y: 0, z: 0 };

/** A `TransformDelta` that is identity except for the fields under test. */
export function delta(over: Partial<TransformDelta> = {}): TransformDelta {
	return { translate: ZERO, rotate: ZERO, pivot: null, ...over };
}

/** Rotated coordinates carry trig error, so orbit results are compared
 *  approximately. Exact-equality cases assert with `toEqual` directly. */
export function expectPoint(actual: Point | null, expected: Point) {
	expect(actual).not.toBeNull();
	expect(actual!.x).toBeCloseTo(expected.x, 10);
	expect(actual!.y).toBeCloseTo(expected.y, 10);
	expect(actual!.z).toBeCloseTo(expected.z, 10);
}
