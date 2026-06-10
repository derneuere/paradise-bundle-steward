// StaticSoundMapOverlay — overlay-level unit test.
//
// Covers the exported pure helpers (no DOM/R3F test infra in this repo —
// same approach as PropInstanceDataOverlay.test.ts):
//
//   - the path↔selection codec round-trips `['entities', i]` and rejects
//     anything that isn't an entity path,
//   - `audibleRadius` only reads the dual-semantics u16 as metres when the
//     value can't be a passby type (>= enum length),
//   - `soundEntityColor` is deterministic and spreads distinct values apart.

import { describe, it, expect } from 'vitest';
import {
	staticSoundSelectionCodec,
	audibleRadius,
	soundEntityColor,
} from '../StaticSoundMapOverlay';
import { PASSBY_TYPES, type StaticSoundEntity } from '@/lib/core/staticSoundMap';

function makeEntity(typeOrDistance: number): StaticSoundEntity {
	return { mPosition: { x: 10, y: 2, z: -30 }, muTypeOrDistance: typeOrDistance, muSoundIndex: 5 };
}

describe('staticSoundSelectionCodec', () => {
	it('maps an entity path to a selection and back', () => {
		const sel = staticSoundSelectionCodec.pathToSelection(['entities', 7]);
		expect(sel).toEqual({ kind: 'staticSoundEntity', indices: [7] });
		expect(staticSoundSelectionCodec.selectionToPath(sel!)).toEqual(['entities', 7]);
	});

	it('collapses a sub-path inside an entity to that entity', () => {
		const sel = staticSoundSelectionCodec.pathToSelection(['entities', 3, 'mPosition']);
		expect(sel).toEqual({ kind: 'staticSoundEntity', indices: [3] });
	});

	it('rejects non-entity paths', () => {
		expect(staticSoundSelectionCodec.pathToSelection([])).toBeNull();
		expect(staticSoundSelectionCodec.pathToSelection(['subRegions', 0])).toBeNull();
		expect(staticSoundSelectionCodec.pathToSelection(['entities'])).toBeNull();
	});
});

describe('audibleRadius', () => {
	it('treats values beyond the passby enum as metres', () => {
		expect(audibleRadius(makeEntity(86))).toBe(86);
		expect(audibleRadius(makeEntity(PASSBY_TYPES.length))).toBe(PASSBY_TYPES.length);
	});

	it('refuses to guess for values inside the passby enum', () => {
		// 12 = Collision in a passby map; a ring would be a lie half the time.
		expect(audibleRadius(makeEntity(12))).toBeNull();
		expect(audibleRadius(makeEntity(0))).toBeNull();
	});
});

describe('soundEntityColor', () => {
	it('is deterministic for the same value', () => {
		expect(soundEntityColor(12).getHexString()).toBe(soundEntityColor(12).getHexString());
	});

	it('spreads the three retail passby types apart', () => {
		const tunnel = soundEntityColor(9).getHexString();
		const camera = soundEntityColor(10).getHexString();
		const collision = soundEntityColor(12).getHexString();
		expect(new Set([tunnel, camera, collision]).size).toBe(3);
	});
});
