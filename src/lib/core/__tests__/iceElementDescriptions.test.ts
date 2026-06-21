// Pins the ICE element-descriptions table (the per-build static schedule used to
// decode ICE take variable data). These checks guard the invariants the
// variable-data codec relies on — count, ordering, the key/interval split, and the
// per-type bit-width rules — so an accidental edit can't silently corrupt the
// slicing schedule.

import { describe, it, expect } from 'vitest';

import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICE_NUM_ELEMENTS,
	ICE_FIRST_INTERVAL_ELEMENT,
	ICEDataType,
	isIceKeyElement,
} from '../iceElementDescriptions';

describe('ICE element descriptions', () => {
	it('has exactly eICE_NUM_ELEMENTS entries in index order', () => {
		expect(ICE_ELEMENT_DESCRIPTIONS).toHaveLength(ICE_NUM_ELEMENTS);
		expect(ICE_NUM_ELEMENTS).toBe(48);
		ICE_ELEMENT_DESCRIPTIONS.forEach((d, i) => {
			expect(d.index).toBe(i);
		});
	});

	it('splits key vs interval elements at index 28', () => {
		expect(ICE_FIRST_INTERVAL_ELEMENT).toBe(28);
		for (const d of ICE_ELEMENT_DESCRIPTIONS) {
			expect(isIceKeyElement(d.index)).toBe(d.index < 28);
		}
	});

	it('keeps every element on a valid channel (0..11)', () => {
		for (const d of ICE_ELEMENT_DESCRIPTIONS) {
			expect(d.channel).toBeGreaterThanOrEqual(0);
			expect(d.channel).toBeLessThan(12);
		}
	});

	it('uses 32 data bits exactly for FLOAT and HASH elements', () => {
		for (const d of ICE_ELEMENT_DESCRIPTIONS) {
			if (d.dataType === ICEDataType.FLOAT || d.dataType === ICEDataType.HASH) {
				expect(d.dataBits).toBe(32);
			}
		}
		// FLOAT elements must be byte-aligned at the start of the list.
		const floats = ICE_ELEMENT_DESCRIPTIONS.filter(d => d.dataType === ICEDataType.FLOAT);
		expect(floats.map(d => d.index)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('only attaches tokens to UINT elements', () => {
		for (const d of ICE_ELEMENT_DESCRIPTIONS) {
			if (d.tokens.length > 0) {
				expect(d.dataType).toBe(ICEDataType.UINT);
			}
		}
	});

	it('pins a few load-bearing entries', () => {
		const byTag = (tag: string) => ICE_ELEMENT_DESCRIPTIONS.find(d => d.tag === tag)!;
		expect(byTag('EYE_Y')).toMatchObject({ index: 1, channel: 0, dataType: ICEDataType.FLOAT, default: 5 });
		expect(byTag('DUTCH')).toMatchObject({ index: 6, dataType: ICEDataType.FIXED, dataBits: 10, min: -0.25, max: 0.25 });
		expect(byTag('SPACE_EYE').tokens).toContain('LooseHeading');
		expect(byTag('EVENT_TAG')).toMatchObject({ index: 41, dataType: ICEDataType.HASH });
		// Interval element, channel 10, boolean drop-down.
		expect(byTag('CONTAINS_SUBTAKE')).toMatchObject({ index: 47, channel: 10, dataType: ICEDataType.UINT, dataBits: 1 });
	});
});
