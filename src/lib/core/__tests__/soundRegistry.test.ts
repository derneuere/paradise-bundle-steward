// Gold coverage for parseRegistry / writeRegistry (resource type 0xA000).
//
// Four retail fixtures with deliberately different shapes:
//  - PLAYBACKREGISTRY.BUNDLE: 27 entities across FIVE payload kinds
//    (ContentClass / ContentType / SlotSchema / ParameterSchema /
//    FeatureSchema) — the playback graph vocabulary.
//  - RWACFEATUREREGISTRY.BUNDLE: 21 entities of ONE kind, the wiki-
//    undocumented ~GenericRwacFeatureImplementation~ — concrete DSP features
//    with uninitialised 0xCDCD pads that must survive verbatim.
//  - SOUND/SOUNDENTITY.BUNDLE: 168 entities adding the string-carrying
//    ContentSpec plus VoiceSchema / VoiceSpec — the global voice graph.
//  - SOUND/AEMS/CSIS.BUNDLE: THIRTY registries (an EntityReg / VoiceReg /
//    FactoryReg trio per AEMS effect group) adding the wiki-undocumented
//    ~AemsVoiceCsisClass~.
// The fixtures cross-reference each other (GinsuPlayer: FeatureSchema in
// PLAYBACK, DSP implementation in RWAC, VoiceSchema membership in
// SOUNDENTITY), pinned below.

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

function loadAllRaw(bundleFile: string): Uint8Array[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	return bundle.resources
		.filter((r) => r.resourceTypeId === REGISTRY_TYPE_ID)
		.map((r) => extractResourceRaw(buffer, bundle, r));
}

function loadRaw(bundleFile: string): Uint8Array {
	const raws = loadAllRaw(bundleFile);
	expect(raws.length).toBe(1);
	return raws[0];
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
const soundEntityRaw = loadRaw('example/SOUND/SOUNDENTITY.BUNDLE');
const csisRaws = loadAllRaw('example/SOUND/AEMS/CSIS.BUNDLE');

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
		// The wiki lists "AemsVoiceCsisClass" as a ContentClass VALUE (hash
		// 84D7FBE7 — really ~SplicerContent::SK_CONTENT_TYPE~); it is actually
		// an entity TYPE with its own hash.
		expect(soundHash('~AemsVoiceCsisClass~')).toBe(REGISTRY_TYPE_HASHES.AEMS_VOICE_CSIS);
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

describe('Registry gold values — SOUND/SOUNDENTITY.BUNDLE', () => {
	const m = parseRegistry(soundEntityRaw);

	it('decodes 168 entities across five payload kinds, none verbatim', () => {
		expect(soundEntityRaw.byteLength).toBe(0x64b0);
		expect(m.entities.length).toBe(168);
		expect(m.strings.length).toBe(184);
		const count = (pred: (e: RegistryEntity) => boolean) => m.entities.filter(pred).length;
		expect(count((e) => e.contentSpec != null)).toBe(82);
		expect(count((e) => e.parameterSchema != null)).toBe(41);
		expect(count((e) => e.featureSchema != null)).toBe(15);
		expect(count((e) => e.voiceSchema != null)).toBe(14);
		expect(count((e) => e.voiceSpec != null)).toBe(16);
		expect(count((e) => e._unknownPayload != null)).toBe(0);
	});

	it('entity 0 is the CollisionSpliceBank ContentSpec: splice-bank content type, name = path', () => {
		const e = m.entities[0];
		expect(e.mName).toBe(soundHash('CollisionSpliceBank'));
		expect(e.mTypeName).toBe(REGISTRY_TYPE_HASHES.CONTENT_SPEC);
		expect(e.contentSpec).toEqual({
			mpContentType: soundHash('~SplicerContent::SK_CONTENT_TYPE~'),
			mu8LoadMethod: 1,
			mu8LoadTime: 1,
			path: 'CollisionSpliceBank',
			_padTail: new Uint8Array(0),
		});
	});

	it('a gamedb:// wave ContentSpec keeps its 0xCD alignment pad verbatim', () => {
		const path = 'gamedb://burnout5/Burnout/Sound/World/Source/AI_Exotic_music1.wav.WaveFile?ID=567018';
		const e = byName(m, path);
		expect(e.contentSpec!.mpContentType).toBe(soundHash('~GenericRwacWaveContent::SK_WAVE_DATA_CONTENT_TYPE~'));
		expect(e.contentSpec!.path).toBe(path);
		// 84-char path + NUL = 85 bytes → 3 fill bytes reach the next 4-byte
		// boundary; retail's allocator left 0xCD there.
		expect(e.contentSpec!.path.length).toBe(84);
		expect(Array.from(e.contentSpec!._padTail)).toEqual([0xcd, 0xcd, 0xcd]);
		// This wave's entity name IS the hash of its path — but that is a
		// convention, not a rule: 34 of the 115 retail ContentSpecs (the CSIS
		// bank specs) use a name unrelated to the path.
		expect(e.mName).toBe(soundHash(path));
	});

	it('VoiceSchemas list the FeatureSchema chain by name hash; the three other counts are always 0', () => {
		expect(byName(m, 'GinsuPlayerVoiceSchema').voiceSchema!.featureSchemaHashes)
			.toEqual([soundHash('GinsuPlayer')]);
		expect(byName(m, 'MasterVoiceSchema').voiceSchema!.featureSchemaHashes).toEqual([
			soundHash('LowShelf'),
			soundHash('GainArray'),
			soundHash('Gain'),
			soundHash('Limiter'),
		]);
		expect(byName(m, 'StreamingFiltVoiceSchema').voiceSchema!.featureSchemaHashes).toEqual([
			soundHash('StreamingPlayer'),
			soundHash('Pause'),
			soundHash('HighPassButterworth'),
			soundHash('LowPassButterworth'),
			soundHash('Panning'),
		]);
		for (const e of m.entities) {
			if (e.voiceSchema == null) continue;
			expect(e.voiceSchema.mu32SlotCount).toBe(0);
			expect(e.voiceSchema.mu32ParameterCount).toBe(0);
			expect(e.voiceSchema.mu32OutputParamCount).toBe(0);
		}
	});

	it('VoiceSpecs bind a schema, channel layout, voice type, and send routing', () => {
		const master = byName(m, 'MasterVoiceSpec').voiceSpec!;
		expect(master).toEqual({
			mpVoiceSchema: soundHash('MasterVoiceSchema'),
			mu8ProcessingStage: 0,
			mu8ChannelCount: 6,
			mu8VoiceType: 2, // E_MASTER_VOICE — the only type-2 spec, and the only one with no sends
			sendHashes: [],
		});
		const playerCar = byName(m, 'PlayerCarSubmixVoiceSpec').voiceSpec!;
		expect(playerCar.mpVoiceSchema).toBe(soundHash('PlayerCarSubmixVoiceSchema'));
		expect(playerCar.mu8ProcessingStage).toBe(0x3f);
		expect(playerCar.mu8VoiceType).toBe(1);
		expect(playerCar.sendHashes).toEqual([soundHash('Send01'), soundHash('ReverbSend')]);
		const ginsu = byName(m, 'GinsuVoiceSpec').voiceSpec!;
		expect(ginsu.mpVoiceSchema).toBe(soundHash('GinsuPlayerVoiceSchema'));
		expect(ginsu.mu8VoiceType).toBe(0);
		expect(ginsu.sendHashes).toEqual([soundHash('Send01')]);
	});
});

describe('Registry gold values — SOUND/AEMS/CSIS.BUNDLE (30 registries)', () => {
	const models = csisRaws.map((raw) => parseRegistry(raw));

	it('all 30 registries parse: 198 entities across seven kinds, none verbatim', () => {
		expect(models.length).toBe(30);
		expect(models.map((m) => m.entities.length)).toEqual([
			3, 1, 1, 2, 12, 10, 12, 3, 3, 1, 1, 4, 7, 18, 3, 1, 1, 1, 12, 15, 6, 37, 1, 3, 10, 9, 8, 2, 3, 8,
		]);
		const all = models.flatMap((m) => m.entities);
		const count = (pred: (e: RegistryEntity) => boolean) => all.filter(pred).length;
		expect(count((e) => e.voiceSpec != null)).toBe(12);
		expect(count((e) => e.contentSpec != null)).toBe(33);
		expect(count((e) => e.aemsVoiceCsis != null)).toBe(12);
		expect(count((e) => e.parameterSchema != null)).toBe(105);
		expect(count((e) => e.mTypeName === REGISTRY_TYPE_HASHES.SLOT_SCHEMA)).toBe(12);
		expect(count((e) => e.featureSchema != null)).toBe(12);
		expect(count((e) => e.voiceSchema != null)).toBe(12);
		expect(count((e) => e._unknownPayload != null)).toBe(0);
	});

	it('every AemsVoiceCsisClass entity is named soundHash("AEMS_" + label) with mUnknown0C = 2', () => {
		for (const m of models) {
			for (const e of m.entities) {
				if (e.aemsVoiceCsis == null) continue;
				expect(e.mName).toBe(soundHash('AEMS_' + e.aemsVoiceCsis.label));
				expect(e.aemsVoiceCsis.mUnknown0C).toBe(2);
				expect(Array.from(e.aemsVoiceCsis._padTail).every((b) => b === 0xcd)).toBe(true);
			}
		}
	});

	it('AemsVoiceCsisClass entities in the same registry share mUnknown10 (bank id?)', () => {
		// The InAir factory registry holds PlayInAir + PlayTakeOff.
		const inAir = models.find((m) => m.entities.some((e) => e.aemsVoiceCsis?.label === 'PlayInAir'))!;
		const playInAir = byName(inAir, 'AEMS_PlayInAir').aemsVoiceCsis!;
		const takeOff = byName(inAir, 'AEMS_PlayTakeOff').aemsVoiceCsis!;
		expect(playInAir.mUnknown10).toBe(0x0ed7);
		expect(takeOff.mUnknown10).toBe(0x0ed7);
		expect(playInAir.mUnknown14).toBe(0x7896);
		expect(takeOff.mUnknown14).toBe(0x1641);
		expect(playInAir.mUnknown08).toBe(8);
	});

	it('CSIS ContentSpecs introduce the ~CsisContent::SK_CONTENT_TYPE~ content type', () => {
		const boost = models.find((m) => m.entities.some((e) => e.contentSpec?.path.includes('BoostCsis')))!;
		const spec = byName(boost, 'BoostCsis');
		expect(spec.contentSpec!.mpContentType).toBe(soundHash('~CsisContent::SK_CONTENT_TYPE~'));
		expect(spec.contentSpec!.path).toBe('gamedb://burnout5/Burnout/Sound/AEMS/Boost/PC/BoostCsis.Csis?ID=683624');
		// CSIS bank specs are the proof that ContentSpec names are independent
		// of their paths.
		expect(spec.mName).not.toBe(soundHash(spec.contentSpec!.path));
	});

	it('the Scrapes voice registry links its VoiceSpec to a VoiceSchema in ANOTHER registry', () => {
		// models[0] holds only the AEMS_ScrapeGranulator VoiceSpec + content;
		// the schema it references lives in the Scrapes entity registry.
		const voiceReg = models[0];
		expect(voiceReg.entities.length).toBe(3);
		const spec = byName(voiceReg, 'AEMS_ScrapeGranulator');
		expect(spec.voiceSpec).not.toBeNull();
		const schemaHash = spec.voiceSpec!.mpVoiceSchema;
		const owner = models.find((m) => m.entities.some(
			(e) => e.mName === schemaHash && e.voiceSchema != null,
		));
		expect(owner).toBeDefined();
		expect(owner).not.toBe(voiceReg);
	});
});

describe('Registry cross-fixture invariants', () => {
	const allModels = [
		parseRegistry(playbackRaw),
		parseRegistry(rwacRaw),
		parseRegistry(soundEntityRaw),
		...csisRaws.map((raw) => parseRegistry(raw)),
	];

	it('every retail ContentSpec uses load method 1 (resource module) and load time 1 (immediate)', () => {
		let n = 0;
		for (const m of allModels) {
			for (const e of m.entities) {
				if (e.contentSpec == null) continue;
				n++;
				expect(e.contentSpec.mu8LoadMethod).toBe(1);
				expect(e.contentSpec.mu8LoadTime).toBe(1);
				expect(Array.from(e.contentSpec._padTail).every((b) => b === 0xcd)).toBe(true);
			}
		}
		expect(n).toBe(115);
	});

	it('every retail VoiceSpec voice type is a valid EVoiceType and sends resolve in the string pool', () => {
		for (const m of allModels) {
			const pool = new Set(m.strings.map(soundHash));
			for (const e of m.entities) {
				if (e.voiceSpec == null) continue;
				expect(e.voiceSpec.mu8VoiceType).toBeLessThanOrEqual(2);
				expect([1, 2, 4, 6]).toContain(e.voiceSpec.mu8ChannelCount);
				for (const h of e.voiceSpec.sendHashes) expect(pool.has(h)).toBe(true);
				expect(pool.has(e.voiceSpec.mpVoiceSchema)).toBe(true);
			}
		}
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

	it('GinsuPlayer spans three fixtures: schema (playback), DSP impl (rwac), voice membership (soundentity)', () => {
		const hash = soundHash('GinsuPlayer');
		expect(byName(parseRegistry(playbackRaw), 'GinsuPlayer').featureSchema).not.toBeNull();
		expect(byName(parseRegistry(rwacRaw), 'GinsuPlayer').rwacFeature).not.toBeNull();
		const voiceSchema = byName(parseRegistry(soundEntityRaw), 'GinsuPlayerVoiceSchema').voiceSchema!;
		expect(voiceSchema.featureSchemaHashes).toContain(hash);
	});
});

describe('Registry round-trip', () => {
	for (const [label, raw] of [
		['PLAYBACKREGISTRY', playbackRaw],
		['RWACFEATUREREGISTRY', rwacRaw],
		['SOUNDENTITY', soundEntityRaw],
	] as const) {
		it(`round-trips ${label} byte-for-byte and the writer is idempotent`, () => {
			const first = writeRegistry(parseRegistry(raw));
			expect(bytesEqual(first, raw)).toBe(true);
			const second = writeRegistry(parseRegistry(first));
			expect(bytesEqual(second, first)).toBe(true);
		});
	}

	it('round-trips all 30 CSIS registries byte-for-byte with an idempotent writer', () => {
		for (let i = 0; i < csisRaws.length; i++) {
			const raw = csisRaws[i];
			const first = writeRegistry(parseRegistry(raw));
			expect(bytesEqual(first, raw), `CSIS registry ${i}`).toBe(true);
			const second = writeRegistry(parseRegistry(first));
			expect(bytesEqual(second, first), `CSIS registry ${i} (second pass)`).toBe(true);
		}
	});

	it('an undecoded entity type round-trips its payload verbatim', () => {
		const m = parseRegistry(playbackRaw);
		const added: RegistryEntity = {
			...makeEmptyRegistryEntity(),
			mName: soundHash('StewardSynthetic'),
			// All nine retail type names decode now, so a verbatim payload
			// needs a type hash the parser has never seen.
			mTypeName: soundHash('~StewardUnknownType~'),
			_unknownPayload: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]),
		};
		const reparsed = parseRegistry(writeRegistry({ ...m, entities: [...m.entities, added] }));
		const back = reparsed.entities[reparsed.entities.length - 1];
		expect(back.mName).toBe(soundHash('StewardSynthetic'));
		expect(Array.from(back._unknownPayload!)).toEqual([0xde, 0xad, 0xbe, 0xef, 0x01]);
	});

	it('resizing a ContentSpec path recomputes the alignment pad with 0xCD fill', () => {
		const m = parseRegistry(soundEntityRaw);
		const idx = m.entities.findIndex((e) => e.contentSpec != null);
		const e = m.entities[idx];
		// 18 chars + NUL = 19 → 1 fill byte; the stale 0-length _padTail no
		// longer fits, so the writer falls back to the retail 0xCD fill.
		const edited = {
			...e,
			contentSpec: { ...e.contentSpec!, path: 'StewardEditedPath1' },
		};
		const entities = m.entities.slice();
		entities[idx] = edited;
		const reparsed = parseRegistry(writeRegistry({ ...m, entities }));
		const back = reparsed.entities[idx].contentSpec!;
		expect(back.path).toBe('StewardEditedPath1');
		expect(Array.from(back._padTail)).toEqual([0xcd]);
	});

	it('editing an AemsVoiceCsisClass label round-trips through the recomputed length and pad', () => {
		const models = csisRaws.map((raw) => parseRegistry(raw));
		const m = models.find((mm) => mm.entities.some((e) => e.aemsVoiceCsis != null))!;
		const idx = m.entities.findIndex((e) => e.aemsVoiceCsis != null);
		const e = m.entities[idx];
		const edited = {
			...e,
			mName: soundHash('AEMS_StewardClass'),
			aemsVoiceCsis: { ...e.aemsVoiceCsis!, label: 'StewardClass' },
		};
		const entities = m.entities.slice();
		entities[idx] = edited;
		const reparsed = parseRegistry(writeRegistry({ ...m, entities }));
		const back = reparsed.entities.find((x) => x.mName === soundHash('AEMS_StewardClass'))!;
		expect(back.aemsVoiceCsis!.label).toBe('StewardClass');
		// 12 chars + NUL = 13 → 3 fill bytes.
		expect(Array.from(back.aemsVoiceCsis!._padTail)).toEqual([0xcd, 0xcd, 0xcd]);
	});

	it('adding a VoiceSpec send re-derives the u8 send count', () => {
		const m = parseRegistry(soundEntityRaw);
		const idx = m.entities.findIndex((e) => e.voiceSpec != null);
		const e = m.entities[idx];
		const edited = {
			...e,
			voiceSpec: { ...e.voiceSpec!, sendHashes: [...e.voiceSpec!.sendHashes, soundHash('ReverbSend')] },
		};
		const entities = m.entities.slice();
		entities[idx] = edited;
		const reparsed = parseRegistry(writeRegistry({ ...m, entities }));
		expect(reparsed.entities[idx].voiceSpec!.sendHashes).toEqual(edited.voiceSpec.sendHashes);
	});

	it('writer rejects a ContentSpec path with a byte-unrepresentable character', () => {
		const m = parseRegistry(soundEntityRaw);
		const idx = m.entities.findIndex((e) => e.contentSpec != null);
		const entities = m.entities.slice();
		entities[idx] = {
			...entities[idx],
			contentSpec: { ...entities[idx].contentSpec!, path: 'badĀpath' },
		};
		expect(() => writeRegistry({ ...m, entities })).toThrow(/byte-unrepresentable/);
	});

	it('parser rejects a ContentSpec whose declared path length disagrees with the payload', () => {
		const broken = new Uint8Array(soundEntityRaw);
		const dv = new DataView(broken.buffer);
		// Entity 0 (CollisionSpliceBank) sits at the data start; its u16
		// pathLength lives at +0xC into the entity.
		const dataStart = 0x1c + 0x800 * 4;
		dv.setUint16(dataStart + 0xc, 5, true);
		expect(() => parseRegistry(broken)).toThrow(/path length/);
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
