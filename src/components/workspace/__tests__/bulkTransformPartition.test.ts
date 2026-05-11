// bulkTransformPartition spec — issue #82.
//
// Pins the partition function the Bulk transform gizmo uses to decide what
// to move (transformable refs) vs what to skip + count for the hint
// (polygon-soup polys). The contract is exercised in three regimes:
//
//   1. Mixed Selection → both partitions populated, soup count > 0
//   2. Soup-only Selection → soup count == refs.length, transformable empty
//   3. Pure-transformable Selection → soup count == 0, transformable
//      equals the input
//
// The soup-count semantics are deliberately "distinct soups, not polys":
// the hint copy reads "N polygon soups not transformed", and marquees can
// rake in hundreds of polys inside two or three soups in dense scenes.

import { describe, it, expect } from 'vitest';
import {
	countSoups,
	isPolygonSoupRef,
	partitionForTransform,
	type BulkTransformRef,
} from '../bulkTransformPartition';

const aiSec = (tag: string): BulkTransformRef => ({ kind: 'transformable', tag });
const soupPoly = (
	bundleId: string,
	index: number,
	soupIdx: number,
	polyIdx: number,
): BulkTransformRef => ({
	kind: 'polygonSoupPoly',
	bundleId,
	index,
	soupIdx,
	polyIdx,
});

describe('partitionForTransform', () => {
	it('splits a mixed Selection so the gizmo only acts on non-soup refs', () => {
		const refs: BulkTransformRef[] = [
			aiSec('section:5'),
			soupPoly('a.dat', 0, 3, 12),
			aiSec('section:9'),
			soupPoly('a.dat', 0, 3, 13),
		];
		const { transformable, soups } = partitionForTransform(refs);
		expect(transformable.length).toBe(2);
		expect(soups.length).toBe(2);
		// The transformable partition preserves order — important for the
		// gizmo's pivot calculation (median across all entries).
		expect(transformable[0]).toEqual(aiSec('section:5'));
		expect(transformable[1]).toEqual(aiSec('section:9'));
	});

	it('routes a soup-only Selection entirely to the soups partition (gizmo should suppress)', () => {
		const refs: BulkTransformRef[] = [
			soupPoly('a.dat', 0, 3, 12),
			soupPoly('a.dat', 0, 3, 13),
		];
		const { transformable, soups } = partitionForTransform(refs);
		expect(transformable.length).toBe(0);
		expect(soups.length).toBe(2);
	});

	it('routes a pure-transformable Selection entirely to transformable (hint should hide)', () => {
		const refs: BulkTransformRef[] = [aiSec('a'), aiSec('b'), aiSec('c')];
		const { transformable, soups } = partitionForTransform(refs);
		expect(transformable.length).toBe(3);
		expect(soups.length).toBe(0);
	});

	it('handles an empty refs list — both partitions empty', () => {
		const { transformable, soups } = partitionForTransform([]);
		expect(transformable.length).toBe(0);
		expect(soups.length).toBe(0);
	});
});

describe('isPolygonSoupRef', () => {
	it('reports true only for the polygonSoupPoly variant', () => {
		expect(isPolygonSoupRef(soupPoly('a.dat', 0, 0, 0))).toBe(true);
		expect(isPolygonSoupRef(aiSec('section:1'))).toBe(false);
	});
});

describe('countSoups', () => {
	it('counts the number of distinct soups, not polys (200 polys inside 2 soups → 2)', () => {
		const refs: BulkTransformRef[] = [];
		for (let p = 0; p < 100; p++) {
			refs.push(soupPoly('a.dat', 0, 3, p));
			refs.push(soupPoly('a.dat', 0, 7, p));
		}
		// 100 polys in soup 3 + 100 in soup 7 = 2 distinct soups
		expect(countSoups(refs)).toBe(2);
	});

	it('treats soups in different bundles or different PSL instances as distinct', () => {
		const refs: BulkTransformRef[] = [
			soupPoly('a.dat', 0, 0, 0),
			soupPoly('a.dat', 1, 0, 0), // same bundle, different PSL instance
			soupPoly('b.dat', 0, 0, 0), // different bundle, same soupIdx
		];
		expect(countSoups(refs)).toBe(3);
	});

	it('returns 0 for a refs list with no soup entries (gizmo hint must hide)', () => {
		expect(countSoups([aiSec('x'), aiSec('y')])).toBe(0);
	});

	it('returns 0 for an empty refs list', () => {
		expect(countSoups([])).toBe(0);
	});

	it('updates downward when soups leave the Selection (200 → 100 polys in one soup → still 1)', () => {
		const before: BulkTransformRef[] = [];
		for (let p = 0; p < 200; p++) before.push(soupPoly('a.dat', 0, 3, p));
		expect(countSoups(before)).toBe(1);
		const after = before.filter((_, i) => i < 100);
		expect(countSoups(after)).toBe(1);
		const empty = after.filter(() => false);
		expect(countSoups(empty)).toBe(0);
	});
});
