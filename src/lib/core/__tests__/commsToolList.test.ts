// Gold coverage for parseCommsToolList / writeCommsToolList (0x46) and the
// cross-resource decode against its CommsToolListDefinition (0x45).
//
// Fixtures: the retail server-pushed pair — example/DOWNLOADED/GAMEPLAYDATA.BIN
// (the list) and example/DOWNLOADED/GAMEPLAY.BIN (its definition). They live
// in SEPARATE bundles; the link is pinned here: the list's name hash equals
// the definition's name hash (languageHash('Gameplay') — NOT the resource's
// own debug name 'GameplayData', diverging from the wiki's reading), the
// version hashes match, and the payload length equals the definition's
// declared list data length.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseCommsToolList,
	writeCommsToolList,
	decodeCommsToolListData,
	type DecodedCommsToolField,
} from '../commsToolList';
import { parseCommsToolListDefinition } from '../commsToolListDefinition';
import { languageHash } from '../languageHash';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function loadFirstResourceRaw(bundleFile: string, typeId: number): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const res = bundle.resources.filter((r) => r.resourceTypeId === typeId);
	expect(res.length).toBe(1);
	return new Uint8Array(extractResourceRaw(buffer, bundle, res[0]));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const listRaw = loadFirstResourceRaw('example/DOWNLOADED/GAMEPLAYDATA.BIN', 0x46);
const list = parseCommsToolList(listRaw);
const definition = parseCommsToolListDefinition(loadFirstResourceRaw('example/DOWNLOADED/GAMEPLAY.BIN', 0x45));

describe('CommsToolList gold values (example/DOWNLOADED/GAMEPLAYDATA.BIN)', () => {
	it('decodes the header and pins the definition link', () => {
		// The wiki reads offset 0x0 as the hash of the resource's own name, but
		// in the retail pair it is the DEFINITION's name ('Gameplay'), not
		// 'GameplayData' — this is how the list finds its field schema.
		expect(list.mNameHash).toBe(languageHash('Gameplay'));
		expect(list.mNameHash).not.toBe(languageHash('GameplayData'));
		expect(list.mNameHash).toBe(definition.mDefinitionNameHash);
		expect(list.mVersionHash).toBe(0x1931a153);
		expect(list.mVersionHash).toBe(definition.mVersionHash);
		expect(list.data.byteLength).toBe(0x491);
		expect(list.data.byteLength).toBe(definition.mListDataLength);
	});

	it('round-trips byte-for-byte', () => {
		const rewritten = writeCommsToolList(parseCommsToolList(listRaw));
		expect(rewritten.byteLength).toBe(listRaw.byteLength);
		expect(bytesEqual(rewritten, listRaw)).toBe(true);
	});

	it('survives a payload-resizing edit (sizes and pad recomputed)', () => {
		const grown = { ...list, data: new Uint8Array([...list.data, 1, 2, 3]) };
		const reparsed = parseCommsToolList(writeCommsToolList(grown));
		expect(reparsed.data.byteLength).toBe(list.data.byteLength + 3);
		expect(reparsed.data[reparsed.data.byteLength - 1]).toBe(3);
	});

	it('parser rejects a corrupted data pointer', () => {
		const broken = new Uint8Array(listRaw);
		broken[0x10] = 0x24;
		expect(() => parseCommsToolList(broken)).toThrow(/data pointer/);
	});

	it('parser rejects a resource size inconsistent with the data length', () => {
		const broken = new Uint8Array(listRaw);
		broken[0xc] = 0xb0; // resource size 0x4B1 -> 0x4B0
		expect(() => parseCommsToolList(broken)).toThrow(/resource size/);
	});

	it('parser rejects a non-zero pad byte (every byte is accounted for)', () => {
		const broken = new Uint8Array(listRaw);
		broken[0x4b8] = 1; // inside the trailing pad 0x4B1..0x4C0
		expect(() => parseCommsToolList(broken)).toThrow(/pad byte/);
	});
});

describe('cross-resource decode (GAMEPLAYDATA payload × GAMEPLAY definition)', () => {
	const decoded = decodeCommsToolListData(list, definition);
	const byName = new Map<string, DecodedCommsToolField>();
	for (const f of decoded) if (f.fieldName) byName.set(f.fieldName, f);

	it('decodes all 205 fields, every one with a resolved name, in definition order', () => {
		expect(decoded.length).toBe(205);
		expect(byName.size).toBe(205);
		expect(decoded[0].fieldName).toBe('TEMP_EXTRA_CAR_36');
		expect(decoded[204].fieldName).toBe('DISABLE_PROGRESSION_CARS');
	});

	it('every 8-byte ServerControls slot (cars + rewards) is zero in the retail push', () => {
		const u64s = decoded.filter((f) => f.length === 8);
		expect(u64s.length).toBe(112);
		for (const f of u64s) {
			expect(f.categoryName).toBe('ServerControls');
			expect(f.asU64).toBe(0n);
		}
	});

	it('GRAD_IDs are -1 sentinels while the surrounding u32 ServerControls are 0', () => {
		for (let i = 0; i < 8; i++) {
			expect(byName.get(`GRAD_ID_${i}`)!.asU32, `GRAD_ID_${i}`).toBe(0xffffffff);
		}
		// (BOOST_LIMIT / BOOST_MULTIPLIER exist only in the v1.3 Gameplay
		// definition — this fixture is the v1.4+ layout, which dropped them.)
		for (const name of ['EVENT_GRAD_ID', 'CARS_AVAILABILITY', 'REQUIRED_ACTION']) {
			expect(byName.get(name)!.asU32, name).toBe(0);
		}
	});

	it('pins the TakedownPhysics tuning floats', () => {
		expect(byName.get('SLAM_SITUATION_SCALES_AI_ON_AI')!.asF32).toBe(1);
		expect(byName.get('VICTIM_SLAM_POWER_SCALE_ONLINE')!.asF32).toBe(0.25);
		expect(byName.get('SLAM_MIN_STRENGTH_MODIFIER_ONLINE')!.asF32).toBeCloseTo(0.55, 5);
		expect(byName.get('ONLINE_VULNERABILITY_FACTOR_AI')!.asF32).toBe(8);
		expect(byName.get('SLAM_SITUATION_VULNERABLE_TIMES_AI_ON_AI')!.asF32).toBe(0);
	});

	it('all 33 u8 fields (REWARD_TYPEs + DISABLE_PROGRESSION_CARS) are zero', () => {
		const u8s = decoded.filter((f) => f.length === 1);
		expect(u8s.length).toBe(33);
		for (const f of u8s) expect(f.asU8, f.fieldName ?? '?').toBe(0);
	});

	it('typed views are length-gated, never NaN-prone misreads', () => {
		const u64 = byName.get('TEMP_EXTRA_CAR_36')!;
		expect(u64.asU32).toBeNull();
		expect(u64.asF32).toBeNull();
		expect(u64.asU8).toBeNull();
		const u8 = byName.get('DISABLE_PROGRESSION_CARS')!;
		expect(u8.asU64).toBeNull();
		expect(u8.asU32).toBeNull();
		expect(u8.bytes).toEqual(new Uint8Array([0]));
	});

	it('refuses a mismatched pair: wrong version hash', () => {
		expect(() => decodeCommsToolListData({ ...list, mVersionHash: 0xd7a6f29e }, definition)).toThrow(/version hash/);
	});

	it('refuses a mismatched pair: wrong payload length', () => {
		expect(() => decodeCommsToolListData({ ...list, data: new Uint8Array(16) }, definition)).toThrow(/expects/);
	});
});
