// SELECTION_THEME — sanity test that the canonical palette exists with the
// three documented colour roles. Real overlays import this directly; the
// only failure mode this test catches is "someone deleted a slot."

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SELECTION_THEME } from '../theme';

describe('SELECTION_THEME', () => {
	it('exposes the three canonical highlight colours', () => {
		expect(SELECTION_THEME.primary).toBeInstanceOf(THREE.Color);
		expect(SELECTION_THEME.bulk).toBeInstanceOf(THREE.Color);
		expect(SELECTION_THEME.hover).toBeInstanceOf(THREE.Color);
	});

	it('keeps the orange/blue convention every overlay used pre-extraction', () => {
		// Hex equality — these specific values are documented in
		// docs/adr/0001 commentary and are what existing overlays already use.
		expect(SELECTION_THEME.primary.getHex()).toBe(0xffaa33);
		expect(SELECTION_THEME.hover.getHex()).toBe(0x66aaff);
	});
});
