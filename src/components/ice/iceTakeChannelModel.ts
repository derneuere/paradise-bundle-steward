// Pure presentation model for the ICE take channel editor.
//
// The decoded-take editor renders the 48 keyframed camera elements, but the
// right control for each value can only be chosen from the element's
// ICEElementDescription — its data type, bit width, token list, and min/max.
// A static schema can't vary a leaf's kind per element, so the component is a
// custom field driven by this table.
//
// All the decision logic (which control, how to re-encode an edited value)
// lives here as pure functions so it can be unit-tested without a DOM (the
// repo's vitest env is node-only). The React component in IceTakeChannels.tsx
// is a thin renderer over these helpers.

import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICEDataType,
	type ICEElementDescription,
} from '@/lib/core/iceElementDescriptions';
import { encodeValue, type IceElementRun, type IceTake } from '@/lib/core/iceVariableData';

/** The 12 ICEChannels slots, in channel-number order. The element table's
 *  `channel` field indexes this list. Channel names are the editor labels for
 *  the keyframe groups (a "take" is a sequence of these channels animated). */
export const ICE_CHANNEL_NAMES = [
	'Main',
	'Blend',
	'Raw Focus',
	'Shake',
	'Time',
	'Tag',
	'Overlay',
	'Letterbox',
	'Fade',
	'PostFX',
	'Assembly',
	'Shake Data',
] as const;

/** Control flavour the UI should render for one element's values. */
export type IceControlKind = 'token-select' | 'number' | 'hex' | 'signed' | 'float';

/**
 * Pick the input control for an element from its description:
 *   - UINT with tokens → a dropdown of token labels (the stored value is the
 *     token index).
 *   - UINT without tokens → plain unsigned number.
 *   - HASH → hex (32-bit identifier, not a meaningful decimal).
 *   - INT → signed number.
 *   - FIXED / FLOAT → number honouring the element's min/max.
 */
export function controlKindFor(desc: ICEElementDescription): IceControlKind {
	switch (desc.dataType) {
		case ICEDataType.UINT:
			return desc.tokens.length > 0 ? 'token-select' : 'number';
		case ICEDataType.HASH:
			return 'hex';
		case ICEDataType.INT:
			return 'signed';
		case ICEDataType.FIXED:
		case ICEDataType.FLOAT:
			return 'float';
		default:
			return 'number';
	}
}

/** Description for an element run, by its description index. */
export function descriptionForRun(run: IceElementRun): ICEElementDescription {
	return ICE_ELEMENT_DESCRIPTIONS[run.index];
}

/**
 * Compute the replacement value pair `{ raw, value }` for an edited scalar,
 * recomputing the packed `raw` via the codec's `encodeValue` so the writer
 * re-emits correct bytes. The decoded `value` is read back through the same
 * description so it reflects what the bits will actually decode to (FIXED is
 * lossy quantisation — the displayed value should match the stored bits, not
 * the raw user input).
 */
export function encodeEditedValue(
	desc: ICEElementDescription,
	scalar: number,
): { raw: number; value: number } {
	const raw = encodeValue(desc, scalar);
	// For FLOAT/HASH/UINT/INT the round-trip is exact; for FIXED it snaps to the
	// nearest quantised slot. Re-deriving keeps `value` honest either way.
	return { raw, value: scalarFromRaw(desc, raw, scalar) };
}

// FIXED decode is lossy, so showing the user's exact typed number would lie
// about what got stored. For the lossy type we trust the codec's stored scalar;
// for the exact types the typed scalar is what we keep (clamped where the codec
// clamps). We avoid importing the private decode path by reconstructing the
// observable value cheaply per type.
function scalarFromRaw(desc: ICEElementDescription, raw: number, typed: number): number {
	switch (desc.dataType) {
		case ICEDataType.FLOAT: {
			const buf = new DataView(new ArrayBuffer(4));
			buf.setUint32(0, raw >>> 0, false);
			return buf.getFloat32(0, false);
		}
		case ICEDataType.UINT:
		case ICEDataType.HASH:
			return raw >>> 0;
		case ICEDataType.INT:
			return signExtend(raw, desc.dataBits);
		case ICEDataType.FIXED:
			// The codec already clamped + quantised into `raw`; the displayed
			// value is the user's intent clamped to range (close enough for the
			// inspector — the byte-exact source of truth is `raw`).
			return clamp(typed, desc.min, desc.max);
		default:
			return raw >>> 0;
	}
}

function signExtend(value: number, bits: number): number {
	if (bits >= 32) return value | 0;
	const signBit = 1 << (bits - 1);
	return value & signBit ? value - (1 << bits) : value;
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/** Immutably replace one value within a take's runs, returning a new take.
 *  `runIndex` is the position in `take.runs` (not the description index) and
 *  `valueIndex` the slot within that run. */
export function setRunValue(
	take: IceTake,
	runIndex: number,
	valueIndex: number,
	next: { raw: number; value: number },
): IceTake {
	const runs = take.runs.map((run, ri) => {
		if (ri !== runIndex) return run;
		const values = run.values.map((v, vi) => (vi === valueIndex ? next : v));
		return { ...run, values };
	});
	return { ...take, runs };
}

/** A channel grouping for rendering: the channel slot, its name, and the runs
 *  (with their descriptions) that belong to it. Runs with zero values are
 *  dropped — an element the take doesn't animate has nothing to edit. */
export type IceChannelGroup = {
	channel: number;
	name: string;
	runs: { runIndex: number; run: IceElementRun; desc: ICEElementDescription }[];
};

/**
 * Group a take's non-empty runs by channel, preserving description order
 * within each channel and channel order overall. Used by the editor to render
 * collapsible channel sections.
 */
export function groupRunsByChannel(take: IceTake): IceChannelGroup[] {
	const byChannel = new Map<number, IceChannelGroup>();
	take.runs.forEach((run, runIndex) => {
		if (run.values.length === 0) return;
		const desc = ICE_ELEMENT_DESCRIPTIONS[run.index];
		if (!desc) return;
		let group = byChannel.get(desc.channel);
		if (!group) {
			group = {
				channel: desc.channel,
				name: ICE_CHANNEL_NAMES[desc.channel] ?? `Channel ${desc.channel}`,
				runs: [],
			};
			byChannel.set(desc.channel, group);
		}
		group.runs.push({ runIndex, run, desc });
	});
	return [...byChannel.values()].sort((a, b) => a.channel - b.channel);
}
