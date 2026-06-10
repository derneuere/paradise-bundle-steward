// Gold coverage for HudMessageSequence (0x2E) and HudMessageSequenceDictionary
// (0x2F) — both live in the single retail bundle HUDMESSAGESEQUENCES.HMSC.
//
// The bundle carries SIX sequences but the auto-generated registry fixture
// suite only exercises the first resource of a type per bundle — so this
// suite walks ALL SIX, pins hand-verified decoded values, pins the
// dictionary↔sequence name relationship, and covers the rigid-layout asserts
// and structural edits (add/remove message, add/remove name).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseHudMessageSequence,
	writeHudMessageSequence,
	parseHudMessageSequenceDictionary,
	writeHudMessageSequenceDictionary,
	DEFAULT_MESSAGE_LENGTH_SECONDS,
} from '../hudMessageSequences';
import { encodeCgsId, decodeCgsId } from '../cgsid';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLE_FILE = 'example/HUDMESSAGESEQUENCES.HMSC';
const SEQUENCE_TYPE_ID = 0x2e;
const DICTIONARY_TYPE_ID = 0x2f;

type Extracted = { name: string; raw: Uint8Array };

function loadByType(typeId: number): Extracted[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, BUNDLE_FILE));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === typeId)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			raw: extractResourceRaw(buffer, bundle, r),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

// extractResourceRaw hands back a Node Buffer, whose .slice() is a VIEW —
// mutating it would corrupt the shared fixture bytes for later tests. Always
// copy before poking.
const copyOf = (a: Uint8Array) => new Uint8Array(a);

const sequences = loadByType(SEQUENCE_TYPE_ID);
const dictionaries = loadByType(DICTIONARY_TYPE_ID);

// Hand-verified from the probe: every sequence is the shared DTARMING message
// followed by one per-trick award/failure message.
const EXPECTED_SECOND_MESSAGE: Record<string, string> = {
	'DTArmBtLk.hms': 'DTAWDBTLK',
	'DTArmFail.hms': 'DTFAILARM',
	'DTArmBtRd.hms': 'DTAWDBTRD',
	'DTArmRvSt.hms': 'DTAWDRVST',
	'DTArmDtLk.hms': 'DTAWDDTLK',
	'DTArmSlow.hms': 'DTAWDDTSLOW', // 11 chars — exercises a near-full-width CgsID
};

describe('HudMessageSequence gold values (all six resources)', () => {
	it('finds exactly six sequences in bundle order', () => {
		expect(sequences.map((s) => s.name)).toEqual([
			'DTArmBtLk.hms',
			'DTArmFail.hms',
			'DTArmBtRd.hms',
			'DTArmRvSt.hms',
			'DTArmDtLk.hms',
			'DTArmSlow.hms',
		]);
	});

	it('every raw resource is the fixed 0x1D0 bytes (0x1C8 struct + 8 pad)', () => {
		for (const { name, raw } of sequences) {
			expect(raw.byteLength, name).toBe(0x1d0);
		}
	});

	for (const { name, raw } of sequences) {
		it(`decodes ${name}`, () => {
			const m = parseHudMessageSequence(raw);
			expect(m.macSequenceId).toBe(name.replace(/\.hms$/, ''));
			// The hash is derived data: uppercase-folded CgsID of the name.
			expect(m.mSequenceIdHash).toBe(encodeCgsId(m.macSequenceId.toUpperCase()));
			expect(m._pad15).toEqual([0, 0, 0]);
			expect(m.miPriority).toBe(1);
			expect(m.miParamCount).toBe(0);
			expect(m.maeParams).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
			expect(m.messages.length).toBe(2);
			for (const msg of m.messages) {
				expect(msg.mfMessageLength).toBe(DEFAULT_MESSAGE_LENGTH_SECONDS);
				expect(msg.maiParam1Ids).toEqual([-1, -1, -1, -1]);
				expect(msg.maiParam2Ids).toEqual([-1, -1, -1, -1]);
				expect(msg._pad2C).toBe(0);
			}
			expect(decodeCgsId(m.messages[0].mMessageId)).toBe('DTARMING');
			expect(decodeCgsId(m.messages[1].mMessageId)).toBe(EXPECTED_SECOND_MESSAGE[name]);
		});
	}
});

describe('HudMessageSequenceDictionary gold values', () => {
	it('finds exactly one dictionary', () => {
		expect(dictionaries.length).toBe(1);
		expect(dictionaries[0].name).toBe('HUDMESSAGESEQUENCES.hmsd');
	});

	it('decodes the six names in dictionary order (which differs from bundle order)', () => {
		const m = parseHudMessageSequenceDictionary(dictionaries[0].raw);
		expect(m.sequenceNames).toEqual([
			'DTArmDtLk',
			'DTArmSlow',
			'DTArmRvSt',
			'DTArmFail',
			'DTArmBtRd',
			'DTArmBtLk',
		]);
		expect(m._pad0C).toBe(0);
	});

	it('references every sequence by name: dictionary entries == macSequenceId set', () => {
		const dict = parseHudMessageSequenceDictionary(dictionaries[0].raw);
		const seqNames = sequences.map(({ raw }) => parseHudMessageSequence(raw).macSequenceId);
		expect(new Set(dict.sequenceNames)).toEqual(new Set(seqNames));
		expect(dict.sequenceNames.length).toBe(seqNames.length);
	});
});

describe('HudMessageSequence round-trip', () => {
	it('round-trips all six sequences byte-for-byte with an idempotent writer', () => {
		for (const { name, raw } of sequences) {
			const first = writeHudMessageSequence(parseHudMessageSequence(raw));
			expect(bytesEqual(first, raw), name).toBe(true);
			const second = writeHudMessageSequence(parseHudMessageSequence(first));
			expect(bytesEqual(second, first), `${name} (idempotence)`).toBe(true);
		}
	});

	it('round-trips the dictionary byte-for-byte with an idempotent writer', () => {
		const raw = dictionaries[0].raw;
		const first = writeHudMessageSequenceDictionary(parseHudMessageSequenceDictionary(raw));
		expect(bytesEqual(first, raw)).toBe(true);
		const second = writeHudMessageSequenceDictionary(parseHudMessageSequenceDictionary(first));
		expect(bytesEqual(second, first)).toBe(true);
	});
});

describe('HudMessageSequence rigid-layout asserts', () => {
	it('rejects a non-default unused message slot instead of dropping it', () => {
		const raw = copyOf(sequences[0].raw);
		// msg slot 2 (first unused) starts at 0x48 + 2*0x30 = 0xA8; poke its id.
		raw[0xa8] = 1;
		expect(() => parseHudMessageSequence(raw)).toThrow(/unused message slot/);
	});

	it('rejects a wrong miResourceSize', () => {
		const raw = copyOf(sequences[0].raw);
		raw[0x1c] = 0;
		expect(() => parseHudMessageSequence(raw)).toThrow(/miResourceSize/);
	});

	it('rejects a non-zero alignment-pad byte', () => {
		const raw = copyOf(sequences[0].raw);
		raw[0x1c8] = 1;
		expect(() => parseHudMessageSequence(raw)).toThrow(/alignment-pad/);
	});

	it('rejects a truncated resource', () => {
		expect(() => parseHudMessageSequence(copyOf(sequences[0].raw.subarray(0, 0x1c8)))).toThrow(/0x1d0/);
	});

	it('writer rejects more than 8 messages', () => {
		const m = parseHudMessageSequence(sequences[0].raw);
		const nine = { ...m, messages: Array.from({ length: 9 }, () => ({ ...m.messages[0] })) };
		expect(() => writeHudMessageSequence(nine)).toThrow(/8 on-disk slots/);
	});

	it('writer rejects a wrong-size maeParams array', () => {
		const m = parseHudMessageSequence(sequences[0].raw);
		expect(() => writeHudMessageSequence({ ...m, maeParams: m.maeParams.slice(0, 7) })).toThrow(/maeParams/);
	});

	it('writer rejects a name longer than the char[13] field allows', () => {
		const m = parseHudMessageSequence(sequences[0].raw);
		expect(() => writeHudMessageSequence({ ...m, macSequenceId: 'ThirteenChars' })).toThrow(/12 chars/);
	});
});

describe('HudMessageSequenceDictionary rigid-layout asserts', () => {
	it('rejects a name pointer off the 13-byte stride', () => {
		const raw = copyOf(dictionaries[0].raw);
		raw[0x10] += 1; // ptr[0]: 0x28 → 0x29
		expect(() => parseHudMessageSequenceDictionary(raw)).toThrow(/name pointer/);
	});

	it('rejects a wrong miResourceSize', () => {
		const raw = copyOf(dictionaries[0].raw);
		raw[0x0] = 0;
		expect(() => parseHudMessageSequenceDictionary(raw)).toThrow(/miResourceSize/);
	});

	it('rejects a non-zero alignment-pad byte', () => {
		const raw = copyOf(dictionaries[0].raw);
		raw[raw.byteLength - 1] = 1;
		expect(() => parseHudMessageSequenceDictionary(raw)).toThrow(/alignment-pad/);
	});

	it('writer rejects a name longer than the char[13] field allows', () => {
		const m = parseHudMessageSequenceDictionary(dictionaries[0].raw);
		const broken = { ...m, sequenceNames: [...m.sequenceNames, 'ThirteenChars'] };
		expect(() => writeHudMessageSequenceDictionary(broken)).toThrow(/12 chars/);
	});
});

describe('structural edits re-derive the layout', () => {
	it('appending a message consumes a default slot and keeps the fixed size', () => {
		const m = parseHudMessageSequence(sequences[0].raw);
		const grown = {
			...m,
			messages: [
				...m.messages,
				{
					mMessageId: encodeCgsId('GOLDTEST'),
					mfMessageLength: 2.5,
					maiParam1Ids: [-1, -1, -1, -1],
					maiParam2Ids: [-1, -1, -1, -1],
					_pad2C: 0,
				},
			],
		};
		const bytes = writeHudMessageSequence(grown);
		expect(bytes.byteLength).toBe(0x1d0); // fixed-size struct — growth uses a slot, not bytes
		const reparsed = parseHudMessageSequence(bytes);
		expect(reparsed.messages.length).toBe(3);
		expect(decodeCgsId(reparsed.messages[2].mMessageId)).toBe('GOLDTEST');
		expect(reparsed.messages[2].mfMessageLength).toBe(2.5);
	});

	it('removing the last message regenerates a default-initialised slot', () => {
		const m = parseHudMessageSequence(sequences[0].raw);
		const bytes = writeHudMessageSequence({ ...m, messages: m.messages.slice(0, 1) });
		const reparsed = parseHudMessageSequence(bytes); // would throw if the slot were stale
		expect(reparsed.messages.length).toBe(1);
		expect(decodeCgsId(reparsed.messages[0].mMessageId)).toBe('DTARMING');
	});

	it('appending a dictionary name grows size, count, pointers, and pad together', () => {
		const m = parseHudMessageSequenceDictionary(dictionaries[0].raw);
		const bytes = writeHudMessageSequenceDictionary({
			...m,
			sequenceNames: [...m.sequenceNames, 'GoldTestSeq'],
		});
		// 7 names: 0x10 header + 7*4 pointers + 7*13 names = 0x87, padded to 0x90.
		expect(bytes.byteLength).toBe(0x90);
		const reparsed = parseHudMessageSequenceDictionary(bytes);
		expect(reparsed.sequenceNames).toEqual([...m.sequenceNames, 'GoldTestSeq']);
	});

	it('an empty dictionary writes and reparses as just the header', () => {
		const bytes = writeHudMessageSequenceDictionary({ sequenceNames: [], _pad0C: 0 });
		expect(bytes.byteLength).toBe(0x10);
		expect(parseHudMessageSequenceDictionary(bytes).sequenceNames).toEqual([]);
	});
});
