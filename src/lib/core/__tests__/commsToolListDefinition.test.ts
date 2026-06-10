// Gold coverage for parseCommsToolListDefinition / writeCommsToolListDefinition
// (0x45) and the languageHash (JAMCRC) identities the Comms Database hangs on.
//
// Fixture: example/DOWNLOADED/GAMEPLAY.BIN — the one retail server-pushed
// definition bundle, carrying exactly the 'Gameplay' definition (205 fields).
// Every field was validated against the wiki's Definitions subpage (Gameplay
// v1.4+ table): offsets, unknown hashes, and the JAMCRC identities of all
// category / field-name hashes match row for row.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';

import {
	parseCommsToolListDefinition,
	writeCommsToolListDefinition,
	COMMS_VERSION_HASH_NOTES,
} from '../commsToolListDefinition';
import { languageHash } from '../languageHash';
import { resolveCommsToolName, KNOWN_COMMS_DEFINITION_NAMES, KNOWN_COMMS_TOOL_NAMES } from '../commsToolNames';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const DEFINITION_TYPE_ID = 0x45;

function loadDefinitionRaw(): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/DOWNLOADED/GAMEPLAY.BIN'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const res = bundle.resources.filter((r) => r.resourceTypeId === DEFINITION_TYPE_ID);
	expect(res.length).toBe(1);
	return new Uint8Array(extractResourceRaw(buffer, bundle, res[0]));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

describe('languageHash (JAMCRC)', () => {
	it('reproduces every wiki definition-name hash', () => {
		expect(languageHash('Gameplay')).toBe(0x0e31492c);
		expect(languageHash('Car')).toBe(0xb08f5f82);
		expect(languageHash('Motorbike')).toBe(0x308faf92);
		expect(languageHash('PassThePadDef')).toBe(0x122624f9);
	});

	it('matches the bitwise NOT of node:zlib crc32 (JAMCRC = crc32 without the final XOR)', () => {
		for (const s of ['Gameplay', 'ServerControls', 'TEMP_EXTRA_CAR_36', 'DISABLE_PROGRESSION_CARS', '']) {
			expect(languageHash(s)).toBe(~crc32(Buffer.from(s)) >>> 0);
		}
	});

	it('is case-sensitive, unlike CgsID encoding', () => {
		expect(languageHash('GAMEPLAY')).not.toBe(languageHash('Gameplay'));
	});

	it('resolveCommsToolName round-trips the catalogue and rejects strangers', () => {
		expect(resolveCommsToolName(languageHash('Gameplay'))).toBe('Gameplay');
		expect(resolveCommsToolName(languageHash('TakedownPhysics'))).toBe('TakedownPhysics');
		expect(resolveCommsToolName(languageHash('REWARD_TYPE_31'))).toBe('REWARD_TYPE_31');
		expect(resolveCommsToolName(0xdeadbeef)).toBeNull();
	});

	it('the catalogue has no JAMCRC collisions (reverse lookup is unambiguous)', () => {
		const all = [...KNOWN_COMMS_DEFINITION_NAMES, ...KNOWN_COMMS_TOOL_NAMES];
		expect(new Set(all.map((n) => languageHash(n))).size).toBe(all.length);
	});
});

describe('CommsToolListDefinition gold values (example/DOWNLOADED/GAMEPLAY.BIN)', () => {
	const raw = loadDefinitionRaw();
	const model = parseCommsToolListDefinition(raw);

	it('decodes the header: the Gameplay definition, v1.4+ PC version', () => {
		expect(model.mDefinitionNameHash).toBe(languageHash('Gameplay'));
		expect(resolveCommsToolName(model.mDefinitionNameHash)).toBe('Gameplay');
		expect(model.mVersionHash).toBe(0x1931a153);
		expect(COMMS_VERSION_HASH_NOTES[model.mVersionHash]).toContain('Gameplay');
		expect(model.mListDataLength).toBe(0x491);
		expect(model.fields.length).toBe(205);
	});

	it('pins the first and last fields against the wiki table', () => {
		expect(model.fields[0]).toEqual({
			mUnknownHash: 0x220d0cd7,
			mCategoryNameHash: languageHash('ServerControls'),
			mFieldNameHash: languageHash('TEMP_EXTRA_CAR_36'),
			mOffset: 0x0,
		});
		expect(model.fields[204]).toEqual({
			mUnknownHash: 0xc63a40e4,
			mCategoryNameHash: languageHash('ServerControls'),
			mFieldNameHash: languageHash('DISABLE_PROGRESSION_CARS'),
			mOffset: 0x490,
		});
	});

	it('every category and field-name hash resolves to a wiki-known name', () => {
		for (const f of model.fields) {
			expect(resolveCommsToolName(f.mCategoryNameHash), `category 0x${f.mCategoryNameHash.toString(16)}`).not.toBeNull();
			expect(resolveCommsToolName(f.mFieldNameHash), `field 0x${f.mFieldNameHash.toString(16)}`).not.toBeNull();
		}
	});

	it('uses exactly two categories with the wiki block structure: ServerControls / TakedownPhysics / ServerControls', () => {
		const cats = model.fields.map((f) => resolveCommsToolName(f.mCategoryNameHash));
		expect(new Set(cats)).toEqual(new Set(['ServerControls', 'TakedownPhysics']));
		// Category runs flip at field 123 (offset 0x3AC, into TakedownPhysics)
		// and field 172 (offset 0x470, back to ServerControls REWARD_TYPEs).
		const flips: number[] = [];
		cats.forEach((c, i) => { if (i > 0 && c !== cats[i - 1]) flips.push(i); });
		expect(flips).toEqual([123, 172]);
		expect(model.fields[123].mOffset).toBe(0x3ac);
		expect(model.fields[172].mOffset).toBe(0x470);
	});

	it('stores offsets strictly ascending with derived sizes 112×8 + 60×4 + 33×1 = 0x491', () => {
		const offs = model.fields.map((f) => f.mOffset);
		for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThan(offs[i - 1]);
		const sizes = new Map<number, number>();
		for (let i = 0; i < offs.length; i++) {
			const len = (i + 1 < offs.length ? offs[i + 1] : model.mListDataLength) - offs[i];
			sizes.set(len, (sizes.get(len) ?? 0) + 1);
		}
		expect(sizes).toEqual(new Map([[8, 112], [4, 60], [1, 33]]));
		expect(112 * 8 + 60 * 4 + 33 * 1).toBe(0x491);
	});
});

describe('CommsToolListDefinition round-trip', () => {
	const raw = loadDefinitionRaw();

	it('round-trips byte-for-byte', () => {
		const rewritten = writeCommsToolListDefinition(parseCommsToolListDefinition(raw));
		expect(rewritten.byteLength).toBe(raw.byteLength);
		expect(bytesEqual(rewritten, raw)).toBe(true);
	});

	it('survives a count-changing edit (chunk pointers recomputed)', () => {
		const model = parseCommsToolListDefinition(raw);
		const grown = {
			...model,
			mListDataLength: model.mListDataLength + 4,
			fields: [...model.fields, {
				mUnknownHash: 0x12345678,
				mCategoryNameHash: languageHash('ServerControls'),
				mFieldNameHash: languageHash('REWARD_0'),
				mOffset: model.mListDataLength,
			}],
		};
		const reparsed = parseCommsToolListDefinition(writeCommsToolListDefinition(grown));
		expect(reparsed.fields.length).toBe(206);
		expect(reparsed.fields[205].mOffset).toBe(model.mListDataLength);
		expect(reparsed.mListDataLength).toBe(model.mListDataLength + 4);
	});

	it('writer rejects a field offset outside the list payload', () => {
		const model = parseCommsToolListDefinition(raw);
		const fields = model.fields.slice();
		fields[3] = { ...fields[3], mOffset: model.mListDataLength };
		expect(() => writeCommsToolListDefinition({ ...model, fields })).toThrow(/outside/);
	});

	it('parser rejects a corrupted chunk pointer', () => {
		const broken = new Uint8Array(raw);
		broken[0] = 0x44; // unknown-hash chunk pointer 0x40 -> 0x44
		expect(() => parseCommsToolListDefinition(broken)).toThrow(/chunk pointer/);
	});

	it('parser rejects a non-zero pad byte (every byte is accounted for)', () => {
		const broken = new Uint8Array(raw);
		broken[0x30] = 1; // inside the header pad 0x24..0x40
		expect(() => parseCommsToolListDefinition(broken)).toThrow(/pad byte/);
	});
});
