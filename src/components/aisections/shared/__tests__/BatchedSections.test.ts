// Spec test for the generic shared batched-sections builder. Pins the
// "accessor-based interface works for both V12-style Vector2 corners and
// V4-style cornersX/cornersZ parallel arrays" contract — the whole point
// of issue #35's primitive extraction.
//
// V4-specific projection + dangerRating colour buckets are covered in
// `AISectionsLegacyOverlay.test.ts` (which exercises the V4 wrapper around
// this builder). This file pins the generic invariants:
//   - face→section indexing stays aligned to the source array even when
//     degenerate sections are skipped
//   - both corner-storage shapes produce identical geometry given the
//     same logical input

import { describe, it, expect } from 'vitest';
import { buildBatchedSections, type SectionAccessor } from '../BatchedSections';

type V12Like = { corners: Array<{ x: number; y: number }>; tag: number };
type V4Like = { cornersX: number[]; cornersZ: number[]; tag: number };

const TAG_COLORS: Record<number, readonly [number, number, number]> = {
	0: [1, 0, 0],
	1: [0, 1, 0],
};

const v12Accessor: SectionAccessor<V12Like> = {
	cornerCount: (s) => s.corners.length,
	cornerX: (s, i) => s.corners[i].x,
	cornerZ: (s, i) => s.corners[i].y,
	color: (s) => TAG_COLORS[s.tag] ?? [0, 0, 0],
};

const v4Accessor: SectionAccessor<V4Like> = {
	cornerCount: (s) => Math.min(s.cornersX.length, s.cornersZ.length),
	cornerX: (s, i) => s.cornersX[i],
	cornerZ: (s, i) => s.cornersZ[i],
	color: (s) => TAG_COLORS[s.tag] ?? [0, 0, 0],
};

describe('shared buildBatchedSections', () => {
	it('produces identical geometry from V12-shape and V4-shape sections describing the same quad', () => {
		const v12: V12Like[] = [
			{ corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], tag: 0 },
		];
		const v4: V4Like[] = [
			{ cornersX: [0, 10, 10, 0], cornersZ: [0, 0, 10, 10], tag: 0 },
		];

		const a = buildBatchedSections(v12, v12Accessor);
		const b = buildBatchedSections(v4, v4Accessor);

		expect(Array.from(a.fillGeo.getAttribute('position').array as Float32Array))
			.toEqual(Array.from(b.fillGeo.getAttribute('position').array as Float32Array));
		expect(Array.from(a.fillGeo.getAttribute('color').array as Float32Array))
			.toEqual(Array.from(b.fillGeo.getAttribute('color').array as Float32Array));
		expect(Array.from(a.faceToSection)).toEqual(Array.from(b.faceToSection));
	});

	it('keeps face→section indices aligned to the source array when degenerates are skipped', () => {
		// Source-array index 0 has only two corners → skipped, contributes
		// zero faces, zero outline. Source-array index 1 has a valid quad →
		// faceToSection must report 1, never a remapped 0.
		const sections: V4Like[] = [
			{ cornersX: [0, 1], cornersZ: [0, 0], tag: 0 },
			{ cornersX: [0, 1, 1, 0], cornersZ: [0, 0, 1, 1], tag: 1 },
		];
		const scene = buildBatchedSections(sections, v4Accessor);
		expect(scene.faceToSection.length).toBe(2);
		expect(Array.from(scene.faceToSection)).toEqual([1, 1]);
	});

	it('handles an empty section list without throwing', () => {
		const scene = buildBatchedSections([] as V4Like[], v4Accessor);
		expect(scene.fillGeo.getAttribute('position').count).toBe(0);
		expect(scene.outlineGeo.getAttribute('position').count).toBe(0);
		expect(scene.faceToSection.length).toBe(0);
	});
});
