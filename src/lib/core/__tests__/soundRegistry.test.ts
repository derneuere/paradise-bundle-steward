// Gold coverage for parseRegistry / writeRegistry (resource type 0xA000).
//
// Two retail fixtures with deliberately different shapes:
//  - PLAYBACKREGISTRY.BUNDLE: 27 entities across FIVE payload kinds
//    (ContentClass / ContentType / SlotSchema / ParameterSchema /
//    FeatureSchema) — the playback graph vocabulary.
//  - RWACFEATUREREGISTRY.BUNDLE: 21 entities of ONE kind, the wiki-
//    undocumented ~GenericRwacFeatureImplementation~ — concrete DSP features
//    with uninitialised 0xCDCD pads that must survive verbatim.
// The two cross-reference each other (GinsuPlayer's FeatureSchema parameter
// list matches its RWAC implementation's bindings), pinned below.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseRegistry,
	writeRegistry,
	soundHash,
	registrySlotOf,
	makeEmptyRegistryEntity,
	REGISTRY_TYPE_HASHES,
	type ParsedRegistry,
	type RegistryEntity,
} from '../soundRegistry';
import { parseBundle } from '../bundle';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const REGISTRY_TYPE_ID = 0xa000;

function loadRaw(bundleFile: string): Uint8Array {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resources = bundle.resources.filter((r) => r.resourceTypeId === REGISTRY_TYPE_ID);
	expect(resources.length).toBe(1);
	return extractResourceRaw(buffer, bundle, resources[0]);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

function byName(m: ParsedRegistry, name: string): RegistryEntity {
	const h = soundHash(name);
	const e = m.entities.find((x) => x.mName === h);
	expect(e, name).toBeDefined();
	return e!;
}

const playbackRaw = loadRaw('example/PLAYBACKREGISTRY.BUNDLE');
const rwacRaw = loadRaw('example/RWACFEATUREREGISTRY.BUNDLE');

describe('soundHash (CgsSound::Playback::Name::MakeHash)', () => {
	it('reproduces the wiki-documented type-name hashes', () => {
		expect(soundHash('~ParameterSchema~')).toBe(0x8d2c6829);
		expect(soundHash('~ContentSpec~')).toBe(0x511a448b);
		expect(soundHash('~FeatureSchema~')).toBe(0xcb8b64c5);
		expect(soundHash('~VoiceSchema~')).toBe(0xc7382281);
		expect(soundHash('~SlotSchema~')).toBe(0xeb396d83);
		expect(soundHash('~VoiceSpec~')).toBe(0x3597ad9b);
	});

	it('reproduces the wiki-UNdocumented type-name hashes seen in retail', () => {
		expect(soundHash('~ContentClass~')).toBe(REGISTRY_TYPE_HASHES.CONTENT_CLASS);
		expect(soundHash('~ContentType~')).toBe(REGISTRY_TYPE_HASHES.CONTENT_TYPE);
		expect(soundHash('~GenericRwacFeatureImplementation~')).toBe(REGISTRY_TYPE_HASHES.RWAC_FEATURE);
	});

	it('is NOT case-folded (unlike CgsID)', () => {
		expect(soundHash('GinsuPlayer')).toBe(0x720b821b);
		expect(soundHash('GINSUPLAYER')).not.toBe(0x720b821b);
	});
});

describe('Registry gold values — PLAYBACKREGISTRY.BUNDLE', () => {
	const m = parseRegistry(playbackRaw);

	it('decodes the header shape: 0x800-slot table, mask 0x7FF', () => {
		expect(playbackRaw.byteLength).toBe(0x2580);
		expect(m.mu32EntityCapacity).toBe(0x800);
		expect(m.muNameHashMask).toBe(0x7ff);
		expect(m.entities.length).toBe(27);
		expect(m.strings.length).toBe(35);
	});

	it('carries five payload kinds: 5 classes, 5 types, 4 slots, 9 params, 4 features', () => {
		const count = (pred: (e: RegistryEntity) => boolean) => m.entities.filter(pred).length;
		expect(count((e) => e.mTypeName === REGISTRY_TYPE_HASHES.CONTENT_CLASS)).toBe(5);
		expect(count((e) => e.mTypeName === REGISTRY_TYPE_HASHES.CONTENT_TYPE)).toBe(5);
		expect(count((e) => e.mTypeName === REGISTRY_TYPE_HASHES.SLOT_SCHEMA)).toBe(4);
		expect(count((e) => e.parameterSchema != null)).toBe(9);
		expect(count((e) => e.featureSchema != null)).toBe(4);
		expect(count((e) => e.rwacFeature != null)).toBe(0);
		expect(count((e) => e._unknownPayload != null)).toBe(0);
	});

	it('every entity name hash resolves to a string in the pool', () => {
		const pool = new Set(m.strings.map(soundHash));
		for (const e of m.entities) {
			expect(pool.has(e.mName), `0x${e.mName.toString(16)}`).toBe(true);
			expect(pool.has(e.mTypeName)).toBe(true);
		}
	});

	it('the pool also registers type names never instantiated here', () => {
		expect(m.strings).toContain('~ContentSpec~');
		expect(m.strings).toContain('~VoiceSchema~');
		expect(m.strings).toContain('~VoiceSpec~');
	});

	it('entity 0 is the wave-data ContentClass (no payload)', () => {
		expect(m.entities[0].mName).toBe(soundHash('~Content::SK_WAVE_DATA_CLASS~'));
		expect(m.entities[0].mTypeName).toBe(REGISTRY_TYPE_HASHES.CONTENT_CLASS);
		expect(m.entities[0].mpContentClass).toBeNull();
		expect(m.entities[0].parameterSchema).toBeNull();
	});

	it('ContentType / SlotSchema payloads reference ContentClass entities by name hash', () => {
		// The wiki lists 0x7CCDA2E7 as a "ContentClass class value" — it is
		// actually the NAME of this ContentType entity.
		const waveType = byName(m, '~GenericRwacWaveContent::SK_WAVE_DATA_CONTENT_TYPE~');
		expect(waveType.mTypeName).toBe(REGISTRY_TYPE_HASHES.CONTENT_TYPE);
		expect(waveType.mpContentClass).toBe(soundHash('~Content::SK_WAVE_DATA_CLASS~'));

		const playerSlot = byName(m, '~PlayerVoice::SK_PLAYER_SLOT_NAME~');
		expect(playerSlot.mTypeName).toBe(REGISTRY_TYPE_HASHES.SLOT_SCHEMA);
		expect(playerSlot.mpContentClass).toBe(soundHash('~Content::SK_WAVE_DATA_CLASS~'));
	});

	it('decodes ParameterSchema ranges and directions', () => {
		const pitch = byName(m, '~GenericRwacPlayerVoice::SK_PLAYER_PARAMETER_PITCH~').parameterSchema!;
		expect(pitch.mf32Minimum).toBe(0.125);
		expect(pitch.mf32Maximum).toBe(8);
		expect(pitch.mu32Direction).toBe(0);

		const freq = byName(m, 'GinsuFrequency').parameterSchema!;
		expect(freq.mf32Maximum).toBe(20000);

		// "Get*" parameters are outputs — the only direction=1 in retail.
		const getPitch = byName(m, 'GinsuGetCurrentPitch').parameterSchema!;
		expect(getPitch.mu32Direction).toBe(1);
		expect(m.entities.filter((e) => e.parameterSchema?.mu32Direction === 1).length).toBe(1);
	});

	it('decodes the GinsuPlayer FeatureSchema: 5 params then 1 slot, outCount 0', () => {
		const ginsu = byName(m, 'GinsuPlayer').featureSchema!;
		expect(ginsu.parameterHashes).toEqual([
			soundHash('GinsuFrequency'),
			soundHash('GinsuGetCurrentPitch'),
			soundHash('GinsuSetPitch'),
			soundHash('GinsuSetShuffleWidth'),
			soundHash('GinsuPause'),
		]);
		expect(ginsu.slotHashes).toEqual([soundHash('GinsuSlot')]);
		expect(ginsu.mu32OutputParamCount).toBe(0);
	});

	it('hash table: slot = (hash >> 1) & mask with linear probing on collision', () => {
		// GinsuSetPitch and GinsuSetShuffleWidth share home slot 1473; the
		// later-inserted (disk-order) entity was probed to 1474. The parser
		// asserts the rebuilt table matches, so parse succeeding proves the
		// rule — this just pins the collision so the fixture stays honest.
		expect(registrySlotOf(soundHash('GinsuSetPitch'), m.muNameHashMask)).toBe(1473);
		expect(registrySlotOf(soundHash('GinsuSetShuffleWidth'), m.muNameHashMask)).toBe(1473);
		const pitchIdx = m.entities.findIndex((e) => e.mName === soundHash('GinsuSetPitch'));
		const widthIdx = m.entities.findIndex((e) => e.mName === soundHash('GinsuSetShuffleWidth'));
		expect(pitchIdx).toBeLessThan(widthIdx);
	});
});

describe('Registry gold values — RWACFEATUREREGISTRY.BUNDLE', () => {
	const m = parseRegistry(rwacRaw);

	it('decodes 21 entities, all GenericRwacFeatureImplementation', () => {
		expect(rwacRaw.byteLength).toBe(0x29e0);
		expect(m.entities.length).toBe(21);
		expect(m.strings.length).toBe(80);
		for (const e of m.entities) {
			expect(e.mTypeName).toBe(REGISTRY_TYPE_HASHES.RWAC_FEATURE);
			expect(e.rwacFeature).not.toBeNull();
			// Uninitialised allocator fill, preserved verbatim.
			expect(e.rwacFeature!._uninit08).toBe(0xcdcdcdcd);
		}
	});

	it('decodes Panning: one Pn21 block exposing 7 parameters, no slots', () => {
		const panning = byName(m, 'Panning').rwacFeature!;
		expect(panning.blocks).toEqual([{ code: 'Pn21', mUnknown04: 0, mUnknown08: 6 }]);
		expect(panning.params.length).toBe(7);
		expect(panning.slots.length).toBe(0);
		expect(panning.params[0]).toEqual({
			mParamName: soundHash('PanningAngle'),
			mu16BlockIndex: 0,
			mu16ParamIndex: 0,
		});
		expect(panning.params[6].mParamName).toBe(soundHash('PanningLfeLevel'));
	});

	it('SimplePanning reuses the Pn21 block with a sparse parameter subset', () => {
		const simple = byName(m, 'SimplePanning').rwacFeature!;
		expect(simple.blocks[0].code).toBe('Pn21');
		expect(simple.params.map((p) => p.mu16ParamIndex)).toEqual([0, 1, 4, 5, 6]);
		expect(simple.params[4].mParamName).toBe(soundHash('SimplePanningLfeLevel'));
	});

	it('decodes GinsuPlayer: three DSP blocks with cross-block param bindings', () => {
		const ginsu = byName(m, 'GinsuPlayer').rwacFeature!;
		expect(ginsu.blocks.map((b) => b.code)).toEqual(['Gns0', 'Rsp0', 'Pau0']);
		const binding = (name: string) => ginsu.params.find((p) => p.mParamName === soundHash(name))!;
		// Semantically coherent routing: SetPitch drives the resampler block,
		// Pause drives the pause block, the rest live on the Ginsu block.
		expect(binding('GinsuSetPitch')).toMatchObject({ mu16BlockIndex: 1, mu16ParamIndex: 0 });
		expect(binding('GinsuPause')).toMatchObject({ mu16BlockIndex: 2, mu16ParamIndex: 0 });
		expect(binding('GinsuGetCurrentPitch')).toMatchObject({ mu16BlockIndex: 0, mu16ParamIndex: 2 });
		expect(ginsu.slots).toEqual([{
			mSlotName: soundHash('GinsuSlot'),
			mSlotClass: soundHash('~GinsuSlot~'),
			mu16Index: 0,
			_pad0A: 0xcdcd,
		}]);
	});

	it('StreamingPlayer streams through JStr → Rch0 → Rsp0', () => {
		const streaming = byName(m, 'StreamingPlayer').rwacFeature!;
		expect(streaming.blocks.map((b) => b.code)).toEqual(['JStr', 'Rch0', 'Rsp0']);
		expect(streaming.slots[0].mSlotClass).toBe(soundHash('~GenericRwacContentSlot~'));
	});
});

describe('Registry cross-fixture relationships', () => {
	it('GinsuPlayer schema (playback) and implementation (rwac) agree on the parameter list', () => {
		const schema = byName(parseRegistry(playbackRaw), 'GinsuPlayer').featureSchema!;
		const impl = byName(parseRegistry(rwacRaw), 'GinsuPlayer').rwacFeature!;
		expect(impl.params.map((p) => p.mParamName)).toEqual(schema.parameterHashes);
		expect(impl.slots.map((s) => s.mSlotName)).toEqual(schema.slotHashes);
	});

	it('SK_PLAYER_FEATURE exists in both registries under the same name hash', () => {
		const name = soundHash('~GenericRwacPlayerVoice::SK_PLAYER_FEATURE~');
		expect(byName(parseRegistry(playbackRaw), '~GenericRwacPlayerVoice::SK_PLAYER_FEATURE~').mName).toBe(name);
		const impl = byName(parseRegistry(rwacRaw), '~GenericRwacPlayerVoice::SK_PLAYER_FEATURE~');
		expect(impl.rwacFeature!.blocks.map((b) => b.code)).toEqual(['SnP1', 'Rch0', 'Rsp0']);
	});
});

describe('Registry round-trip', () => {
	for (const [label, raw] of [
		['PLAYBACKREGISTRY', playbackRaw],
		['RWACFEATUREREGISTRY', rwacRaw],
	] as const) {
		it(`round-trips ${label} byte-for-byte and the writer is idempotent`, () => {
			const first = writeRegistry(parseRegistry(raw));
			expect(bytesEqual(first, raw)).toBe(true);
			const second = writeRegistry(parseRegistry(first));
			expect(bytesEqual(second, first)).toBe(true);
		});
	}

	it('an undecoded entity type round-trips its payload verbatim', () => {
		const m = parseRegistry(playbackRaw);
		const added: RegistryEntity = {
			...makeEmptyRegistryEntity(),
			mName: soundHash('StewardSynthetic'),
			mTypeName: REGISTRY_TYPE_HASHES.CONTENT_SPEC,
			_unknownPayload: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]),
		};
		const reparsed = parseRegistry(writeRegistry({ ...m, entities: [...m.entities, added] }));
		const back = reparsed.entities[reparsed.entities.length - 1];
		expect(back.mName).toBe(soundHash('StewardSynthetic'));
		expect(Array.from(back._unknownPayload!)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x01]);
	});

	it('appending a string re-derives sizes and the 16-byte trailing pad', () => {
		const m = parseRegistry(playbackRaw);
		const written = writeRegistry({ ...m, strings: [...m.strings, 'StewardProbe'] });
		expect(written.byteLength % 16).toBe(0);
		const reparsed = parseRegistry(written);
		expect(reparsed.strings[reparsed.strings.length - 1]).toBe('StewardProbe');
	});

	it('writer rejects a mask that is not capacity-1', () => {
		const m = parseRegistry(playbackRaw);
		expect(() => writeRegistry({ ...m, muNameHashMask: 0x7fe })).toThrow(/muNameHashMask/);
	});

	it('writer rejects a DSP block code that is not 4 chars', () => {
		const m = parseRegistry(rwacRaw);
		const feature = m.entities[0].rwacFeature!;
		const broken = {
			...m.entities[0],
			rwacFeature: { ...feature, blocks: [{ ...feature.blocks[0], code: 'Pn215' }] },
		};
		expect(() => writeRegistry({ ...m, entities: [broken, ...m.entities.slice(1)] })).toThrow(/4 characters/);
	});

	it('parser rejects a corrupted hash-table slot', () => {
		const broken = new Uint8Array(playbackRaw);
		// Move the first occupied slot's pointer to an empty neighbour — the
		// rebuilt table no longer matches.
		const dv = new DataView(broken.buffer);
		for (let slot = 0; slot < 0x800; slot++) {
			const at = 0x1c + slot * 4;
			const v = dv.getUint32(at, true);
			if (v !== 0) {
				dv.setUint32(at, 0, true);
				dv.setUint32(at + 4, v, true);
				break;
			}
		}
		expect(() => parseRegistry(broken)).toThrow();
	});
});
