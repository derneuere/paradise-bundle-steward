// Gold coverage for parseNicotine / writeNicotine (resource type 0xA024).
//
// Pins hand-verified decoded values from both retail maps (probed against
// raw bytes before the parser existed), the byte-exact round-trip, and the
// headline finding: the stereo (Main) and surround maps share an identical
// 9-state structure and differ ONLY in 13 master-channel mixData attenuation
// words plus 3 stale-pointer event reserved words.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseNicotine, writeNicotine, packedExtraCount, threeDStateParamCount, type ParsedNicotine } from '../nicotine';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const NICOTINE_TYPE_ID = 0xa024;
const MAIN_BUNDLE = 'example/SOUND/NICOTINEASSETMAIN.BUNDLE';
const SURROUND_BUNDLE = 'example/SOUND/NICOTINEASSETSURROUND.BUNDLE';

function loadRaw(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const matches = bundle.resources.filter((r) => r.resourceTypeId === NICOTINE_TYPE_ID);
	expect(matches.length).toBe(1);
	return extractResourceRaw(buffer, bundle, matches[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Collect every differing numeric leaf between two models, as path strings. */
function numericDiffs(a: unknown, b: unknown, p: string, out: string[]) {
	if (typeof a === 'number' && typeof b === 'number') {
		if (a !== b) out.push(p);
		return;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		expect(b.length, p).toBe(a.length);
		a.forEach((x, i) => numericDiffs(x, b[i], `${p}[${i}]`, out));
		return;
	}
	if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
		for (const k of Object.keys(a as object)) {
			numericDiffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${p}.${k}`, out);
		}
		return;
	}
	// null-vs-object would mean a structural divergence between the maps
	expect(a === null ? 'null' : typeof a, p).toBe(b === null ? 'null' : typeof b);
}

const mainModel = parseNicotine(loadRaw(MAIN_BUNDLE));
const surroundModel = parseNicotine(loadRaw(SURROUND_BUNDLE));

describe('Nicotine gold values (NicotineAssetMain)', () => {
	it('decodes the map header shape', () => {
		expect(mainModel.mixMapId).toBe(0);
		expect(mainModel.states.length).toBe(9);
		// 4 trailing -1 slots after the 9 real entries — undocumented on the wiki.
		expect(mainModel._stateTableSentinelSlots).toBe(4);
	});

	it('state indices run 0x1F0000..0x1F0008 in table order', () => {
		mainModel.states.forEach((s, i) => expect(s.stateIndex).toBe(0x1f0000 + i));
	});

	it('pins the per-state section census', () => {
		const census = mainModel.states.map((s) => [
			s.mixControls?.controls.length ?? null,
			s.threeDControls?.controls.length ?? null,
			s.subMix?.channels.length ?? null,
			s.masterMix?.channels.length ?? null,
			s.presets?.length ?? null,
			s.events?.events.length ?? null,
		]);
		expect(census).toEqual([
			[15, null, 4, 25, 25, 18],
			[24, 8, 17, 49, 49, 29],
			[5, 2, 2, 15, 15, 5],
			[2, 4, 1, 13, 13, 1],
			[null, 1, 1, 3, 3, 1],
			[2, 1, 2, 4, 4, 1],
			[null, null, 1, null, null, null],
			[null, 1, 1, 2, 2, null],
			[null, null, 1, null, null, null],
		]);
	});

	it('decodes hand-verified state[0] records', () => {
		const s0 = mainModel.states[0];
		const master0 = s0.masterMix!.channels[0];
		expect(master0.mixChId).toBe(0xc0020000);
		// mixData low i16 is the -10000 (-100.00 dB) floor; high i16 0 = no attenuation.
		expect(master0.mixData).toBe(0x0000d8f0);
		expect(master0.sfxObjId).toBe(0x40000000);
		expect(master0.extraData.length).toBe(2);

		const sub0 = s0.subMix!.channels[0];
		expect(sub0.mixChId).toBe(0xd0010000);
		expect(sub0.upperLowerSwing).toBe(0xfe60);
		expect(sub0.procOffsets).toEqual([0x8028002]);

		const ev0 = s0.events!.events[0];
		expect(ev0.nEvtCtlId).toBe(0xa1000100);
		expect(ev0.nUScaleCntSwing).toBe(0xd8f0);
		expect(ev0.nTriggerId).toBe(0x60000002);
		expect(ev0.extraData.length).toBe(0);

		const ctl0 = s0.mixControls!.controls[0];
		expect(ctl0.nInputId).toBe(0xa8000001);
		expect(ctl0.nUScaleCntSwing).toBe(0);

		const preset0 = s0.presets![0];
		expect(preset0.header).toBe(0xe0000004);
		expect(preset0.extraData).toEqual([0xc03fcb9, 0x1405fca4, 0x24090000, 0x1004f6e6]);
	});

	it('decodes a 3D control with multiple packed state params', () => {
		const ctl = mainModel.states[1].threeDControls!.controls[0];
		expect(ctl.nInputId).toBe(0x82010070);
		expect(threeDStateParamCount(ctl.nInputId)).toBe(2);
		expect(ctl.stateParams.length).toBe(2);
		expect(ctl.stateParams[0].n3DStateInfoId).toBe(0x90010100);
		expect(ctl.stateParams[0].nQ0MinMax).toBe(0x3c0004);
	});

	it('pins the record-kind prefixes of the packed id words', () => {
		for (const s of mainModel.states) {
			for (const ch of s.masterMix?.channels ?? []) {
				expect([0xc0, 0xc1, 0xc2], `master 0x${ch.mixChId.toString(16)}`).toContain(ch.mixChId >>> 24);
			}
			for (const ch of s.subMix?.channels ?? []) {
				expect(ch.mixChId >>> 24, `submix 0x${ch.mixChId.toString(16)}`).toBe(0xd0);
			}
			for (const p of s.presets ?? []) {
				expect([0xe0, 0xe1, 0xe2], `preset 0x${p.header.toString(16)}`).toContain(p.header >>> 24);
			}
		}
	});

	it('event reserved words carry the garbage pattern, mirrored count first', () => {
		for (const s of mainModel.states) {
			if (!s.events) continue;
			expect(s.events._reserved01).toBe(s.events.events.length);
			// Constant across all six retail event sections — looks like a stale pointer.
			expect(s.events._reserved02).toBe(0x8e4ef64);
		}
	});

	it('mix control headers mirror the control count in numNewMixDataProcs', () => {
		for (const s of mainModel.states) {
			if (!s.mixControls) continue;
			expect(s.mixControls.numNewMixDataProcs).toBe(s.mixControls.controls.length);
			expect(s.mixControls.numMainMixDataProcs).toBe(0);
			expect(s.mixControls.numMainMixCtlOut).toBe(0);
		}
	});
});

describe('Nicotine stereo vs surround', () => {
	it('the maps share an identical structure and differ in exactly 16 words', () => {
		const diffs: string[] = [];
		numericDiffs(mainModel, surroundModel, '', diffs);
		const mixDataDiffs = diffs.filter((p) => p.endsWith('.mixData'));
		const reservedDiffs = diffs.filter((p) => p.endsWith('._reserved03'));
		expect(mixDataDiffs.length).toBe(13);
		expect(reservedDiffs.length).toBe(3);
		expect(diffs.length).toBe(16);
	});

	it('pins one attenuation difference: surround drops master ch0 by 3 dB', () => {
		// High i16 lane: 0 (stereo) vs 0xFED4 = -300 (surround) — hundredths of
		// a dB, i.e. -3.00 dB. Low lane stays the -10000 (-100.00 dB) floor.
		expect(mainModel.states[0].masterMix!.channels[0].mixData).toBe(0x0000d8f0);
		expect(surroundModel.states[0].masterMix!.channels[0].mixData).toBe(0xfed4d8f0);
	});
});

describe('Nicotine round-trip', () => {
	for (const bundleFile of [MAIN_BUNDLE, SURROUND_BUNDLE]) {
		it(`round-trips ${bundleFile} byte-for-byte and idempotently`, () => {
			const raw = loadRaw(bundleFile);
			const write1 = writeNicotine(parseNicotine(raw));
			expect(write1.byteLength).toBe(raw.byteLength);
			expect(bytesEqual(write1, raw)).toBe(true);
			const write2 = writeNicotine(parseNicotine(write1));
			expect(bytesEqual(write2, write1)).toBe(true);
		});
	}

	it('writer rejects extraData inconsistent with the packed count byte', () => {
		const m: ParsedNicotine = parseNicotine(loadRaw(MAIN_BUNDLE));
		const ch = m.states[0].masterMix!.channels[0];
		expect(packedExtraCount(ch.mixChId)).toBe(ch.extraData.length);
		ch.extraData = [...ch.extraData, 0];
		expect(() => writeNicotine(m)).toThrow(/packed count byte/);
	});

	it('writer rejects a preset array out of step with the master channels', () => {
		const m: ParsedNicotine = parseNicotine(loadRaw(MAIN_BUNDLE));
		m.states[0].presets = m.states[0].presets!.slice(0, -1);
		expect(() => writeNicotine(m)).toThrow(/counts must match/);
	});

	it('writer rejects 3D stateParams out of step with the packed nibble', () => {
		const m: ParsedNicotine = parseNicotine(loadRaw(MAIN_BUNDLE));
		const ctl = m.states[1].threeDControls!.controls[0];
		ctl.stateParams = ctl.stateParams.slice(0, 1);
		expect(() => writeNicotine(m)).toThrow(/packed nibble/);
	});
});
