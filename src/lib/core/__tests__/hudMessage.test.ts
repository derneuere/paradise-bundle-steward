// Gold coverage for parseHudMessage / writeHudMessage.
//
// Retail ships exactly one HudMessage resource (HUDMESSAGES.HM — 308
// messages, decompressing from a 10 KB bundle to 0x1C040 bytes). This suite
// pins hand-verified decoded values, the retail-wide data invariants the
// implementation leans on (CgsID derivation, parallel string/param lanes,
// constant garbage pads), and byte-exact round-trip + writer idempotence.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseHudMessage,
	writeHudMessage,
	HUD_MESSAGE_LINES,
	HUD_MESSAGE_PARAMS_PER_LINE,
	type ParsedHudMessage,
} from '../hudMessage';
import { encodeCgsId } from '../cgsid';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const HUD_MESSAGE_TYPE_ID = 0x2c;

function loadRaw(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === HUD_MESSAGE_TYPE_ID);
	expect(resources.length).toBe(1); // the fixture carries exactly one 0x2C
	return extractResourceRaw(buffer, bundle, resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const raw = loadRaw('example/HUDMESSAGES.HM');
const model = parseHudMessage(raw);

describe('HudMessage gold values (example/HUDMESSAGES.HM)', () => {
	it('decompresses to the size the header declares and holds 308 messages', () => {
		expect(raw.byteLength).toBe(0x1c040);
		expect(model.messages.length).toBe(308);
	});

	it('decodes message 0 (online boost-start ticker)', () => {
		const m = model.messages[0];
		expect(m.lines[0].macStringId).toBe('HUDMESSAGE_ONLINE_BOOST_STARTS');
		expect(m.lines[1].macStringId).toBe('');
		expect(m.lines[2].macStringId).toBe('');
		expect(m.macMessageStyle).toBe('NeutralMessage');
		expect(m.macDefaultIcon).toBe('invisible');
		expect(m.macMessageId).toBe('AggDrBstStrt');
		expect(m.mMessageIdHash).toBe(0x4e8166694cee92d0n);
		expect(m.muAvailabilityBitSet).toBe(0x10); // online only
		expect(m.mfDuration).toBe(2.5);
		expect(m.mfTimeToWait).toBe(0.5);
		expect(m.miPriority).toBe(0);
		expect(m.miForceRemoveThreshold).toBe(0);
		expect(m.meMessageGroup).toBe(3); // in-game messages
		expect(m.lines.map((l) => l.miParamCount)).toEqual([1, 0, 0]);
		expect(m.lines[0].maeParamTypes).toEqual([1, 0, 0, 0]); // one String param
	});

	it('decodes message 307 (reverse-gear driving tip)', () => {
		const m = model.messages[307];
		expect(m.lines[0].macStringId).toBe('REVERSE_TIP');
		expect(m.macMessageId).toBe('ReverseTip');
		expect(m.muAvailabilityBitSet).toBe(0x3f); // everywhere
		expect(m.mfDuration).toBe(2);
		expect(m.miPriority).toBe(50);
		expect(m.lines.map((l) => l.miParamCount)).toEqual([0, 0, 0]);
	});

	it('decodes a three-line message (car awarded, message 13)', () => {
		const m = model.messages[13];
		expect(m.lines[0].macStringId).toBe('HUDMESSAGE_GENERIC1');
		expect(m.lines[1].macStringId).toBe('CAR_AWARDED');
		expect(m.lines[2].macStringId).toBe('POSTRACE_NEW_CAR_INSTRUCTIONS');
	});
});

describe('HudMessage retail-wide invariants', () => {
	it('every record fixes lines/param slots at the on-disk dimensions', () => {
		for (const m of model.messages) {
			expect(m.lines.length).toBe(HUD_MESSAGE_LINES);
			for (const line of m.lines) {
				expect(line.maeParamTypes.length).toBe(HUD_MESSAGE_PARAMS_PER_LINE);
			}
		}
	});

	it('mMessageIdHash is the CgsID of the uppercased message id in all 308 records', () => {
		// The game fires messages by this hash; the schema's derive hook and
		// the handler's rename scenario both rely on this exact relationship.
		for (const m of model.messages) {
			expect(m.mMessageIdHash, m.macMessageId).toBe(encodeCgsId(m.macMessageId.toUpperCase()));
		}
	});

	it('message ids are unique and at most 12 chars', () => {
		const ids = new Set(model.messages.map((m) => m.macMessageId));
		expect(ids.size).toBe(model.messages.length);
		for (const id of ids) expect(id.length).toBeLessThanOrEqual(12);
	});

	it('string/param lanes are parallel: params only appear on lines with a string id', () => {
		// This is what justifies regrouping the wiki's three parallel arrays
		// into per-line records.
		for (const m of model.messages) {
			for (const line of m.lines) {
				if (line.miParamCount > 0) expect(line.macStringId).not.toBe('');
				// Param slots are a packed prefix: non-Unused up to the count, Unused after.
				line.maeParamTypes.forEach((p, idx) => {
					if (idx < line.miParamCount) expect(p).not.toBe(0);
					else expect(p).toBe(0);
				});
			}
		}
	});

	it('retail uses param types Unused/String/Int/Float/StringId only (never Money/Time)', () => {
		const used = new Set<number>();
		for (const m of model.messages) {
			for (const line of m.lines) line.maeParamTypes.forEach((p) => used.add(p));
		}
		expect([...used].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 6]);
	});

	it('retail groups are 1/2/3 (ALL never appears) and availability stays in the 6 defined bits', () => {
		const groups = new Set(model.messages.map((m) => m.meMessageGroup));
		expect([...groups].sort((a, b) => a - b)).toEqual([1, 2, 3]);
		for (const m of model.messages) {
			expect(m.muAvailabilityBitSet & ~0x3f).toBe(0);
		}
	});

	it('second/third lines are genuinely used by retail (so the lanes are not dead)', () => {
		const usingLine1 = model.messages.filter((m) => m.lines[1].macStringId !== '').length;
		const usingLine2 = model.messages.filter((m) => m.lines[2].macStringId !== '').length;
		expect(usingLine1).toBe(163);
		expect(usingLine2).toBe(18);
	});

	it('record pads carry constant build-tool garbage, preserved verbatim', () => {
		for (const m of model.messages) {
			expect(m._padMessageId).toEqual([0xf9, 0x1c, 0x00]);
			expect(m._padTail).toBe(0x001cf974);
		}
	});
});

describe('HudMessage round-trip', () => {
	it('round-trips byte-for-byte', () => {
		const rewritten = writeHudMessage(model);
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('writer is idempotent', () => {
		const once = writeHudMessage(model);
		const twice = writeHudMessage(parseHudMessage(once));
		expect(bytesEqual(once, twice)).toBe(true);
	});

	it('shrinking and growing the catalogue keeps the layout self-consistent', () => {
		// Pointer array length and the 128-byte section pads both depend on the
		// count; reparse proves the writer recomputed them rather than copying.
		for (const messages of [model.messages.slice(0, 5), [...model.messages, model.messages[0]]]) {
			const reparsed = parseHudMessage(writeHudMessage({ messages }));
			expect(reparsed.messages.length).toBe(messages.length);
			expect(reparsed.messages[messages.length - 1].macMessageId).toBe(messages[messages.length - 1].macMessageId);
		}
	});

	it('writer rejects a message with the wrong line count', () => {
		const broken: ParsedHudMessage = {
			messages: [{ ...model.messages[0], lines: model.messages[0].lines.slice(0, 2) }],
		};
		expect(() => writeHudMessage(broken)).toThrow(/lines/);
	});

	it('writer rejects a line with the wrong param-slot count', () => {
		const m = model.messages[0];
		const broken: ParsedHudMessage = {
			messages: [{ ...m, lines: [{ ...m.lines[0], maeParamTypes: [1, 0, 0] }, m.lines[1], m.lines[2]] }],
		};
		expect(() => writeHudMessage(broken)).toThrow(/param slots/);
	});

	it('writer rejects an over-long message id (12 chars max + terminator)', () => {
		const broken: ParsedHudMessage = {
			messages: [{ ...model.messages[0], macMessageId: 'ThirteenChars' }],
		};
		expect(() => writeHudMessage(broken)).toThrow(/message id/);
	});
});
