// dragGuard — the pointer-travel guard that stops a drag-release (gizmo move /
// camera orbit) from being read as a selection click. See dragGuard.ts for the
// R3F `initialHits` background.

import { describe, it, expect } from 'vitest';
import {
	travelExceeds,
	recordPointerDown,
	isDragRelease,
} from '../dragGuard';

describe('travelExceeds — pure travel test', () => {
	it('returns false when no pointer-down was recorded', () => {
		expect(travelExceeds(null, 500, 500)).toBe(false);
	});

	it('returns false for a click that did not move', () => {
		expect(travelExceeds({ x: 100, y: 100 }, 100, 100)).toBe(false);
	});

	it('returns false within the 4px slack (hand jitter on a real click)', () => {
		// 3px diagonal = sqrt(2*3^2) ≈ 4.24 > 4? No: dx=2,dy=2 → dist≈2.83 < 4.
		expect(travelExceeds({ x: 100, y: 100 }, 102, 102)).toBe(false);
	});

	it('returns true once travel exceeds the threshold', () => {
		expect(travelExceeds({ x: 100, y: 100 }, 200, 200)).toBe(true);
	});

	it('honours a custom threshold', () => {
		expect(travelExceeds({ x: 0, y: 0 }, 10, 0, 20)).toBe(false);
		expect(travelExceeds({ x: 0, y: 0 }, 30, 0, 20)).toBe(true);
	});

	it('is exclusive at exactly the threshold distance (treated as a click)', () => {
		// dx=4, dy=0 → dist 4, threshold 4 → 16 > 16 is false → still a click.
		expect(travelExceeds({ x: 0, y: 0 }, 4, 0)).toBe(false);
	});
});

describe('isDragRelease — reads the recorded pointer-down', () => {
	it('reports a drag after a far pointer-down', () => {
		recordPointerDown({ clientX: 10, clientY: 10 });
		expect(isDragRelease(300, 300)).toBe(true);
	});

	it('reports a click after a co-located pointer-down', () => {
		recordPointerDown({ clientX: 50, clientY: 50 });
		expect(isDragRelease(51, 50)).toBe(false);
	});
});
