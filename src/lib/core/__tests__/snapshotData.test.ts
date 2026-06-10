// Gold coverage for parseSnapshotData / writeSnapshotData (resource type
// 0xA029), including the cross-resource relationship to the Nicotine map
// (0xA024) in the same bundle: every snapshot channel's mixChId is a master
// mix MIXCHID of the companion map (and never a submix id), and the two
// retail SnapshotData resources are byte-identical.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseSnapshotData, writeSnapshotData, type ParsedSnapshotData } from '../snapshotData';
import { parseNicotine } from '../nicotine';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SNAPSHOT_TYPE_ID = 0xa029;
const NICOTINE_TYPE_ID = 0xa024;
const MAIN_BUNDLE = 'example/SOUND/NICOTINEASSETMAIN.BUNDLE';
const SURROUND_BUNDLE = 'example/SOUND/NICOTINEASSETSURROUND.BUNDLE';

function loadRaw(bundleFile: string, typeId: number): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const matches = bundle.resources.filter((r) => r.resourceTypeId === typeId);
	expect(matches.length).toBe(1);
	return extractResourceRaw(buffer, bundle, matches[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const mainModel = parseSnapshotData(loadRaw(MAIN_BUNDLE, SNAPSHOT_TYPE_ID));

describe('SnapshotData gold values (NicotineAssetMain.mss)', () => {
	it('decodes the header shape', () => {
		expect(mainModel.snapshots.length).toBe(17);
		expect(mainModel.channels.length).toBe(72);
		expect(mainModel._pad08).toBe(1);
		expect(mainModel._pad0C).toBe(0x12345678);
	});

	it('decodes hand-verified channel records', () => {
		expect(mainModel.channels[0]).toEqual({ mixChId: 0xc0020003, channelId: 0x964954c4 });
		expect(mainModel.channels[1]).toEqual({ mixChId: 0xc005000d, channelId: 0xedaab975 });
		// mixChId ids are unique — the channel list is a set, not a sequence.
		expect(new Set(mainModel.channels.map((c) => c.mixChId)).size).toBe(72);
	});

	it('the top two bits of every mixChId are set (wiki bit-field note)', () => {
		for (const ch of mainModel.channels) {
			expect(ch.mixChId >>> 30, `0x${ch.mixChId.toString(16)}`).toBe(3);
		}
	});

	it('decodes hand-verified snapshot datums', () => {
		expect(mainModel.snapshots[0].entries[0].control).toBe(64225);
		expect(mainModel.snapshots[0].entries[0].value).toBeCloseTo(0.25, 6);
		expect(mainModel.snapshots[16].entries[71].control).toBe(0);
		for (const snap of mainModel.snapshots) expect(snap.entries.length).toBe(72);
	});

	it('pins observed value ranges (units still hypothetical)', () => {
		let maxControl = 0;
		let maxValue = -Infinity;
		let minValue = Infinity;
		for (const snap of mainModel.snapshots) {
			for (const e of snap.entries) {
				maxControl = Math.max(maxControl, e.control);
				maxValue = Math.max(maxValue, e.value);
				minValue = Math.min(minValue, e.value);
			}
		}
		// control fits 17 bits; low i16 lane consistent with centi-dB levels.
		expect(maxControl).toBe(130658);
		expect(minValue).toBe(0);
		expect(maxValue).toBeCloseTo(5.6, 5);
	});
});

describe('SnapshotData ↔ Nicotine relationship', () => {
	for (const bundleFile of [MAIN_BUNDLE, SURROUND_BUNDLE]) {
		it(`every channel of ${bundleFile} references a master mix MIXCHID of its companion map`, () => {
			const snap = parseSnapshotData(loadRaw(bundleFile, SNAPSHOT_TYPE_ID));
			const nic = parseNicotine(loadRaw(bundleFile, NICOTINE_TYPE_ID));
			const masterIds = new Set<number>();
			const submixIds = new Set<number>();
			for (const s of nic.states) {
				for (const ch of s.masterMix?.channels ?? []) masterIds.add(ch.mixChId);
				for (const ch of s.subMix?.channels ?? []) submixIds.add(ch.mixChId);
			}
			expect(masterIds.size).toBe(111);
			for (const ch of snap.channels) {
				expect(masterIds.has(ch.mixChId), `0x${ch.mixChId.toString(16)} not a master MIXCHID`).toBe(true);
				expect(submixIds.has(ch.mixChId)).toBe(false);
				// The hash-like channelId is NOT how the link works.
				expect(masterIds.has(ch.channelId)).toBe(false);
			}
		});
	}

	it('the stereo and surround SnapshotData resources are byte-identical', () => {
		// All stereo/surround divergence lives in the Nicotine maps' mixData
		// words — snapshots are shared verbatim between output formats.
		expect(bytesEqual(loadRaw(MAIN_BUNDLE, SNAPSHOT_TYPE_ID), loadRaw(SURROUND_BUNDLE, SNAPSHOT_TYPE_ID))).toBe(true);
	});
});

describe('SnapshotData round-trip', () => {
	for (const bundleFile of [MAIN_BUNDLE, SURROUND_BUNDLE]) {
		it(`round-trips ${bundleFile} byte-for-byte and idempotently`, () => {
			const raw = loadRaw(bundleFile, SNAPSHOT_TYPE_ID);
			const write1 = writeSnapshotData(parseSnapshotData(raw));
			expect(write1.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(write1, raw)).toBe(true);
			const write2 = writeSnapshotData(parseSnapshotData(write1));
			expect(bytesEqual(write2, write1)).toBe(true);
		});
	}

	it('writer rejects a snapshot whose entry count disagrees with the channel list', () => {
		const m: ParsedSnapshotData = parseSnapshotData(loadRaw(MAIN_BUNDLE, SNAPSHOT_TYPE_ID));
		m.snapshots[3] = { entries: m.snapshots[3].entries.slice(0, -1) };
		expect(() => writeSnapshotData(m)).toThrow(/one datum per channel/);
	});
});
