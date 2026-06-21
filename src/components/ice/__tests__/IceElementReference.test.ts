// Spec test for the read-only ICE element-descriptions reference viewer.
//
// The repo's vitest env is node-only (no jsdom), so this exercises the pure
// presentation model that drives IceElementReference rather than the rendered
// DOM. It documents the load-bearing behaviours a future reader needs:
//   - the table derives 48 rows directly from ICE_ELEMENT_DESCRIPTIONS;
//   - key vs interval splits at index 28 (ICE_FIRST_INTERVAL_ELEMENT);
//   - channel numbers map to their channel names;
//   - token elements (e.g. SPACE_EYE) carry their token list through;
//   - hash elements (e.g. EVENT_TAG) format their bounds as zero-padded hex.

import { describe, it, expect } from 'vitest';
import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICE_FIRST_INTERVAL_ELEMENT,
	ICE_NUM_ELEMENTS,
} from '@/lib/core/iceElementDescriptions';
import {
	buildIceElementReferenceRows,
	formatElementValue,
	groupReferenceRowsByChannel,
} from '../iceElementReferenceModel';

const rows = buildIceElementReferenceRows();
const byTag = (tag: string) => {
	const r = rows.find((row) => row.tag === tag);
	if (!r) throw new Error(`no reference row for ${tag}`);
	return r;
};

describe('buildIceElementReferenceRows', () => {
	it('derives exactly one row per element description (48)', () => {
		expect(rows).toHaveLength(ICE_NUM_ELEMENTS);
		expect(rows).toHaveLength(ICE_ELEMENT_DESCRIPTIONS.length);
		expect(rows.map((r) => r.index)).toEqual(
			ICE_ELEMENT_DESCRIPTIONS.map((d) => d.index),
		);
	});

	it('splits key vs interval elements at index 28', () => {
		for (const row of rows) {
			expect(row.isKey).toBe(row.index < ICE_FIRST_INTERVAL_ELEMENT);
		}
		expect(byTag('DUTCH').isKey).toBe(true); // index 6
		expect(byTag('CUBIC_EYE').isKey).toBe(false); // index 28
	});

	it('maps channel numbers to their channel names', () => {
		expect(byTag('EYE_X').channelName).toBe('Main'); // channel 0
		expect(byTag('FADE_TO_COLOR').channelName).toBe('Fade'); // channel 8
		expect(byTag('EVENT_TAG').channelName).toBe('Tag'); // channel 5
	});

	it('carries the token list for a token element through', () => {
		const spaceEye = byTag('SPACE_EYE'); // UINT with the SPACE token list
		expect(spaceEye.tokens.length).toBeGreaterThan(0);
		expect(spaceEye.tokens).toContain('Car');
		expect(spaceEye.tokens).toContain('World');
	});

	it('leaves token list empty for a non-token element', () => {
		expect(byTag('EYE_X').tokens).toHaveLength(0);
	});
});

describe('formatElementValue', () => {
	it('formats a HASH element as zero-padded 32-bit hex', () => {
		const eventTag = byTag('EVENT_TAG'); // HASH, max 0xFFFFFFFF
		expect(eventTag.dataTypeName).toBe('HASH');
		expect(eventTag.maxText).toBe('0xFFFFFFFF');
		expect(eventTag.minText).toBe('0x00000000');
	});

	it('formats FLOAT/FIXED bounds as floats', () => {
		const dutch = byTag('DUTCH'); // FIXED, range [-0.25, 0.25]
		expect(dutch.minText).toBe('-0.25');
		expect(dutch.maxText).toBe('0.25');
		expect(byTag('EYE_Y').defaultText).toBe('5.0'); // FLOAT default 5
	});

	it('formats a 32-bit UINT field as hex but a narrow UINT as decimal', () => {
		const desc = ICE_ELEMENT_DESCRIPTIONS.find((d) => d.tag === 'POSTFX_HOOK')!; // UINT, 32 bits
		expect(formatElementValue(desc, 0xABCD)).toBe('0x0000ABCD');
		const blend = ICE_ELEMENT_DESCRIPTIONS.find((d) => d.tag === 'CAMERA_BLEND_AMOUNT')!; // UINT, 7 bits
		expect(formatElementValue(blend, 100)).toBe('100');
	});
});

describe('groupReferenceRowsByChannel', () => {
	it('groups rows by channel in channel-number order, covering all 48', () => {
		const groups = groupReferenceRowsByChannel(rows);
		expect(groups.map((g) => g.channel)).toEqual(
			[...groups.map((g) => g.channel)].sort((a, b) => a - b),
		);
		const total = groups.reduce((n, g) => n + g.rows.length, 0);
		expect(total).toBe(ICE_NUM_ELEMENTS);
		expect(groups[0].name).toBe('Main'); // channel 0 sorts first
	});
});
