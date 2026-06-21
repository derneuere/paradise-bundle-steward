// Pure presentation model for the ICE element-descriptions reference viewer.
//
// The element schedule (ICE_ELEMENT_DESCRIPTIONS) is a per-build static table,
// not bundle data — it can't be edited, only consulted. This module turns each
// of the 48 descriptions into a flat, display-ready row (formatted defaults,
// data-type name, channel name, key-vs-interval flag, token list) so the
// read-only viewer is a thin renderer and the formatting is unit-testable in
// the repo's node-only vitest env.

import {
	ICE_ELEMENT_DESCRIPTIONS,
	ICEDataType,
	isIceKeyElement,
	type ICEElementDescription,
} from '@/lib/core/iceElementDescriptions';
import { ICE_CHANNEL_NAMES } from './iceTakeChannelModel';

/** Human label for an `ICEDataType` member. */
export const ICE_DATA_TYPE_NAMES: Record<ICEDataType, string> = {
	[ICEDataType.INT]: 'INT',
	[ICEDataType.UINT]: 'UINT',
	[ICEDataType.HASH]: 'HASH',
	[ICEDataType.FIXED]: 'FIXED',
	[ICEDataType.FLOAT]: 'FLOAT',
};

/** A flattened, display-ready row for one element description. */
export type IceElementReferenceRow = {
	index: number;
	tag: string;
	displayName: string;
	channel: number;
	channelName: string;
	/** index < ICE_FIRST_INTERVAL_ELEMENT → key element; else interval. */
	isKey: boolean;
	dataType: ICEDataType;
	dataTypeName: string;
	dataBits: number;
	/** Pre-formatted default/min/max strings (float vs unsigned/hex per type). */
	defaultText: string;
	minText: string;
	maxText: string;
	tokens: readonly string[];
};

/**
 * Format a numeric field for display. HASH and 32-bit UINT values are opaque
 * identifiers/bitfields, so they read as zero-padded hex; FIXED/FLOAT are real
 * quantities shown as floats; narrow UINT/INT are plain decimals.
 *
 * `which` distinguishes the field because min/max of a hash span the full
 * 32-bit range and are clearer as hex bounds too.
 */
export function formatElementValue(desc: ICEElementDescription, value: number): string {
	switch (desc.dataType) {
		case ICEDataType.HASH:
			return toHex32(value);
		case ICEDataType.UINT:
			// A 32-bit UINT field is an opaque identifier (e.g. a hook id), not a
			// human decimal; show it as hex like a hash. Narrow token/enum UINTs
			// stay decimal so they line up with their token indices.
			return desc.dataBits >= 32 ? toHex32(value) : String(value >>> 0);
		case ICEDataType.FLOAT:
		case ICEDataType.FIXED:
			return formatFloat(value);
		case ICEDataType.INT:
		default:
			return String(value);
	}
}

function toHex32(value: number): string {
	return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function formatFloat(value: number): string {
	if (Number.isInteger(value)) return value.toFixed(1);
	// Trim trailing zeros from a fixed representation so 0.25 stays 0.25 but
	// 100000 doesn't become 100000.000000.
	return String(value);
}

/** Derive the full reference table (48 rows) from the static descriptions. */
export function buildIceElementReferenceRows(): IceElementReferenceRow[] {
	return ICE_ELEMENT_DESCRIPTIONS.map((desc) => ({
		index: desc.index,
		tag: desc.tag,
		displayName: desc.displayName,
		channel: desc.channel,
		channelName: ICE_CHANNEL_NAMES[desc.channel] ?? `Channel ${desc.channel}`,
		isKey: isIceKeyElement(desc.index),
		dataType: desc.dataType,
		dataTypeName: ICE_DATA_TYPE_NAMES[desc.dataType],
		dataBits: desc.dataBits,
		defaultText: formatElementValue(desc, desc.default),
		minText: formatElementValue(desc, desc.min),
		maxText: formatElementValue(desc, desc.max),
		tokens: desc.tokens,
	}));
}

/** A channel-grouped view of the reference rows, in channel-number order. */
export type IceElementReferenceGroup = {
	channel: number;
	name: string;
	rows: IceElementReferenceRow[];
};

/** Group the reference rows by channel for a sectioned read-only layout. */
export function groupReferenceRowsByChannel(
	rows: IceElementReferenceRow[],
): IceElementReferenceGroup[] {
	const byChannel = new Map<number, IceElementReferenceGroup>();
	for (const row of rows) {
		let group = byChannel.get(row.channel);
		if (!group) {
			group = { channel: row.channel, name: row.channelName, rows: [] };
			byChannel.set(row.channel, group);
		}
		group.rows.push(row);
	}
	return [...byChannel.values()].sort((a, b) => a.channel - b.channel);
}
