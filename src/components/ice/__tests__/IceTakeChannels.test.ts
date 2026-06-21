// Spec test for the decoded ICE-take channel editor.
//
// The repo's vitest env is node-only (no jsdom), so this exercises the pure
// presentation model that drives IceTakeChannels rather than the rendered DOM.
// It documents the load-bearing behaviours a future reader needs:
//   - a UINT element WITH tokens renders a dropdown of token labels;
//   - a FIXED element renders a number control honouring its range;
//   - editing a value recomputes the packed `raw` via the codec and replaces
//     only that one value in the take (everything else shares references).

import { describe, it, expect } from 'vitest';
import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICEDataType,
	type ICEElementDescription,
} from '@/lib/core/iceElementDescriptions';
import { encodeValue, type IceTake } from '@/lib/core/iceVariableData';
import {
	controlKindFor,
	encodeEditedValue,
	groupRunsByChannel,
	setRunValue,
} from '../iceTakeChannelModel';

const byTag = (tag: string): ICEElementDescription => {
	const d = ICE_ELEMENT_DESCRIPTIONS.find((e) => e.tag === tag);
	if (!d) throw new Error(`no element ${tag}`);
	return d;
};

describe('controlKindFor', () => {
	it('renders a token dropdown for a UINT element with tokens', () => {
		const fade = byTag('FADE_TO_COLOR'); // UINT with tokens ['Black','White',…]
		expect(fade.dataType).toBe(ICEDataType.UINT);
		expect(fade.tokens.length).toBeGreaterThan(0);
		expect(controlKindFor(fade)).toBe('token-select');
	});

	it('renders a plain number for a UINT element without tokens', () => {
		const blend = byTag('CAMERA_BLEND_AMOUNT'); // UINT, no tokens
		expect(controlKindFor(blend)).toBe('number');
	});

	it('renders a float control for a FIXED element', () => {
		const dutch = byTag('DUTCH'); // FIXED, range [-0.25, 0.25]
		expect(dutch.dataType).toBe(ICEDataType.FIXED);
		expect(controlKindFor(dutch)).toBe('float');
	});

	it('renders hex for a HASH element and signed for INT', () => {
		expect(controlKindFor(byTag('EVENT_TAG'))).toBe('hex'); // HASH
		const fakeInt = { ...byTag('DUTCH'), dataType: ICEDataType.INT };
		expect(controlKindFor(fakeInt)).toBe('signed');
	});
});

describe('encodeEditedValue', () => {
	it('recomputes the packed raw for a token edit (raw === token index)', () => {
		const fade = byTag('FADE_TO_COLOR');
		const edited = encodeEditedValue(fade, 2); // pick token index 2 ('Red')
		expect(edited.raw).toBe(2);
		expect(edited.raw).toBe(encodeValue(fade, 2));
	});

	it('recomputes the packed raw for a FIXED edit and snaps the displayed value', () => {
		const dutch = byTag('DUTCH');
		const edited = encodeEditedValue(dutch, 0.1);
		// raw is the quantised code the writer will emit verbatim.
		expect(edited.raw).toBe(encodeValue(dutch, 0.1));
		// displayed value stays within the element's range.
		expect(edited.value).toBeGreaterThanOrEqual(dutch.min);
		expect(edited.value).toBeLessThanOrEqual(dutch.max);
	});
});

describe('setRunValue / groupRunsByChannel', () => {
	const take: IceTake = {
		nodeBase: [0, 0],
		guid: 1,
		name: 'TEST',
		nameBytes: new Uint8Array(32),
		lengthSeconds: 1,
		allocated: 0,
		elementCounts: Array.from({ length: 12 }, () => ({ intervals: 0, keys: 0 })),
		indices: [],
		parameters: [],
		alignPadBytes: 0,
		runs: [
			{ index: byTag('DUTCH').index, isKey: true, values: [{ raw: 100, value: 0 }, { raw: 200, value: 0.05 }] },
			{ index: byTag('FADE_TO_COLOR').index, isKey: false, values: [{ raw: 0, value: 0 }] },
		],
	};

	it('groups runs by channel using the channel names', () => {
		const groups = groupRunsByChannel(take);
		const names = groups.map((g) => g.name);
		expect(names).toContain('Main'); // DUTCH is channel 0 (Main)
		expect(names).toContain('Fade'); // FADE_TO_COLOR is channel 8 (Fade)
	});

	it('replaces exactly one value and shares everything else', () => {
		const edited = encodeEditedValue(byTag('DUTCH'), 0.1);
		const next = setRunValue(take, 0, 1, edited);
		// The targeted value changed…
		expect(next.runs[0].values[1]).toEqual(edited);
		// …its sibling within the same run is untouched (same reference)…
		expect(next.runs[0].values[0]).toBe(take.runs[0].values[0]);
		// …and the other run is shared by reference.
		expect(next.runs[1]).toBe(take.runs[1]);
		// Original take untouched.
		expect(take.runs[0].values[1].raw).toBe(200);
	});
});
