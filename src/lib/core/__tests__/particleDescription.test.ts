// Gold coverage for parseParticleDescription / writeParticleDescription.
//
// PARTICLES.BUNDLE carries 42 ParticleDescription resources but the
// auto-generated registry fixture suite only exercises the first one
// (Prop_Foilage) — this suite walks ALL 42, pins hand-verified decoded
// values, and pins the corpus facts the parser's rigid-layout asserts are
// built on (constant effect hash, uninitialised mIDs, no imports, no
// waveforms, behaviour counts, scratch-blob population).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseParticleDescription,
	writeParticleDescription,
	deriveParticleKey,
	PARTICLE_DESCRIPTOR_FLAGS,
} from '../particleDescription';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const PARTICLE_DESCRIPTION_TYPE_ID = 0x1001d;

type Extracted = { name: string; idLow: number; importCount: number; raw: Uint8Array };

function loadAll(): Extracted[] {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, 'example/PARTICLES.BUNDLE'));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string'
		? parseDebugDataFromXml(bundle.debugData)
		: [];
	return bundle.resources
		.filter((r) => r.resourceTypeId === PARTICLE_DESCRIPTION_TYPE_ID)
		.map((r) => ({
			name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
			idLow: r.resourceId.low >>> 0,
			importCount: r.importCount,
			raw: extractResourceRaw(buffer, bundle, r),
		}));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

const all = loadAll();
const models = all.map((e) => parseParticleDescription(e.raw));

describe('ParticleDescription corpus shape (example/PARTICLES.BUNDLE)', () => {
	it('finds exactly 42 resources, none with import-table entries', () => {
		expect(all.length).toBe(42);
		// Materials reference textures by NAME, not via BND2 imports — this is
		// why the handler has no importTable() hook.
		for (const e of all) expect(e.importCount, e.name).toBe(0);
	});

	it('resource id is the muHashedGDBURI FNV-1a hash', () => {
		for (const [i, e] of all.entries()) {
			expect(models[i].muHashedGDBURI, e.name).toBe(e.idLow);
		}
	});

	it('m_key is the lowercased first character of the name on all 42', () => {
		for (const m of models) {
			expect(m.mKey, m.name).toBe(deriveParticleKey(m.name));
		}
	});

	it('cLionParticleEffect.mHash is the same constant in every resource', () => {
		for (const m of models) expect(m.mEffectHash, m.name).toBe(0x065f5506);
	});

	it('descriptor/material mIDs are uninitialised 0xCDCDCDCD everywhere', () => {
		for (const m of models) {
			for (const d of m.descriptors) {
				expect(d._mID).toBe(0xcdcdcdcd);
				expect(d.material._mID).toBe(0xcdcdcdcd);
				expect(d.material._padByte).toBe(0xcd);
			}
		}
	});

	it('behaviour counts are only ever 1 or 2; 38 descriptors carry a scratch blob', () => {
		let behaviours = 0;
		let temps = 0;
		let descriptors = 0;
		for (const m of models) {
			for (const d of m.descriptors) {
				descriptors++;
				expect([1, 2]).toContain(d.behaviours.length);
				behaviours += d.behaviours.length;
				if (d._tempBehaviourRaw) {
					temps++;
					expect(d._tempBehaviourRaw.byteLength).toBe(0x4c0);
				}
			}
		}
		expect(descriptors).toBe(141);
		expect(behaviours).toBe(179);
		expect(temps).toBe(38);
	});

	it('descriptor flags only use documented eParticleDescriptorFlags bits', () => {
		const known = PARTICLE_DESCRIPTOR_FLAGS.reduce((m, f) => m | f.mask, 0);
		const seen = new Set<number>();
		for (const m of models) {
			for (const d of m.descriptors) {
				expect(d.mFlags & ~known).toBe(0);
				seen.add(d.mFlags);
				// Retail never authored lod/render groups or collision either.
				expect(d.mLodGroup).toBe(0);
				expect(d.mRenderGroup).toBe(0);
				expect(d.mCollisionType).toBe(0);
				expect([0, 1, 3, 4]).toContain(d.mShape);
			}
		}
		// DYNAMICPLACE / USE_MATRICES / PREFORM are the only bits actually used.
		expect([...seen].sort((a, b) => a - b)).toEqual([0, 0x10, 0x20, 0x30, 0x4000, 0x4020, 0x4030]);
	});

	it('runtime handles are 0 on disk in every material', () => {
		for (const m of models) {
			for (const d of m.descriptors) {
				const mat = d.material;
				expect(mat.mMaterialHandle).toBe(0);
				expect(mat.mMeshHandle).toBe(0);
				expect(mat.mTextureHandle).toBe(0);
				expect(mat.mNormalMapHandle).toBe(0);
				expect(mat.mMeshHandles).toEqual([0, 0, 0, 0, 0]);
				expect(mat.mNumMeshes).toBe(0);
			}
		}
	});
});

describe('ParticleDescription gold values (Prop_Foilage, resource 0)', () => {
	const m = models[0];

	it('decodes the effect definition', () => {
		expect(all[0].name).toContain('Prop_Foilage.lef');
		expect(m.name).toBe('Prop_Foilage.lef');
		expect(m.mKey).toBe(0x70); // 'p'
		expect(m.muHashedGDBURI).toBe(0x03f6f1f4);
		expect(m.descriptors.length).toBe(2);
	});

	it('decodes descriptor 0 (GROUNDDUSTPUF)', () => {
		const d = m.descriptors[0];
		expect(d.name).toBe('GROUNDDUSTPUF');
		expect(d.mPauseTime).toBe(Math.fround(0.03));
		expect(d.mRepeatTime).toBe(2);
		expect(d.mEmitterLifeBase).toBe(Math.fround(0.1));
		expect(d.mEmitterLifeInfiniteFlag).toBe(0);
		expect(d.mFlags).toBe(0);
		expect(d.mShape).toBe(0);
		expect(d.behaviours.length).toBe(1);
		expect(d._tempBehaviourRaw).toBeNull();
	});

	it('decodes behaviour 0 of descriptor 0', () => {
		const b = m.descriptors[0].behaviours[0];
		expect(b.mVelBase).toEqual({ x: 1, y: Math.fround(0.2), z: 0, w: 0 });
		expect(b.mPosVariance).toEqual({ x: Math.fround(-0.4), y: 0.25, z: 1, w: 0 });
		expect(b.mEmissionRateBase).toBe(0);
		expect(b.mLifeBase).toBe(0.5);
		expect(b.mLifeVariance).toBe(0.5);
		expect(b.mSizeBase).toBe(1);
		expect(b.mScale).toBe(2);
		expect(b.mAlphaFadeOut).toBe(Math.fround(0.2));
		expect(b.mCellSize).toBe(1);
		expect(b.mFlags).toBe(0x341);
		expect(b.mEmissionCountClamp).toBe(10);
		expect(b.mColourSteps).toBe(0);
		expect(b.mRGBAVarianceMode).toBe(2);
		expect(b.mTimeScale).toBe(1);
		expect(b.mRGBABase).toEqual({ r: 19, g: 18, b: 15, a: 32 });
		expect(b.mRGBAVar).toEqual({ r: 32, g: 37, b: 30, a: 32 });
		// The AABB is uninitialised memory — 0xCDCDCDCD reinterpreted as f32.
		const cdJunk = new DataView(new Uint8Array([0xcd, 0xcd, 0xcd, 0xcd]).buffer).getFloat32(0, true);
		expect(b.mAABBMin.x).toBe(cdJunk);
		expect(b.mAABBMax.w).toBe(cdJunk);
		expect(b._bvCompiled.byteLength).toBe(0x180);
	});

	it('decodes material 0 — names are strings, "(NULL)" is literal placeholder text', () => {
		const mat = m.descriptors[0].material;
		expect(mat.textureName).toBe('SMOKEAGE');
		expect(mat.normalMapName).toBeNull(); // a genuinely-null pointer, distinct from "(NULL)"
		expect(mat.meshName).toBe('(NULL)');
		expect(mat.layerGroupName).toBe('(NULL)');
		expect(mat.meshNames).toEqual(['(NULL)', '(NULL)', '(NULL)', '(NULL)', '(NULL)']);
		expect(mat.mXFrames).toBe(2);
		expect(mat.mYFrames).toBe(2);
		expect(mat.mBlendMode).toBe(1);
		expect(mat.mZTestMode).toBe(2);
		expect(mat.mLayer).toBe(4);
		expect(mat.mFPS).toBe(15);
		expect(mat.mFrameCount).toBe(4);
		expect(mat.mFlags).toBe(0x13);
	});

	it('decodes descriptor 1 (LEAFS / DIRT)', () => {
		const d = m.descriptors[1];
		expect(d.name).toBe('LEAFS');
		expect(d.material.textureName).toBe('DIRT');
	});
});

describe('ParticleDescription round-trip (all 42 resources)', () => {
	it('writes every resource back byte-for-byte', () => {
		for (const [i, e] of all.entries()) {
			const rewritten = writeParticleDescription(models[i]);
			expect(rewritten.byteLength, e.name).toBe(e.raw.byteLength);
			expect(bytesEqual(rewritten, e.raw), e.name).toBe(true);
		}
	});

	it('writer is idempotent on every resource', () => {
		for (const [i, e] of all.entries()) {
			const once = writeParticleDescription(models[i]);
			const twice = writeParticleDescription(parseParticleDescription(once));
			expect(bytesEqual(once, twice), e.name).toBe(true);
		}
	});

	it('a rename that grows the string pool reparses cleanly with later strings intact', () => {
		const m0 = parseParticleDescription(all[0].raw);
		m0.descriptors[0].name = 'A_MUCH_LONGER_EMITTER_NAME_THAN_BEFORE';
		const reparsed = parseParticleDescription(writeParticleDescription(m0));
		expect(reparsed.descriptors[0].name).toBe('A_MUCH_LONGER_EMITTER_NAME_THAN_BEFORE');
		expect(reparsed.descriptors[1].name).toBe('LEAFS');
		expect(reparsed.descriptors[1].material.textureName).toBe('DIRT');
	});

	it('a rename to null drops the pool entry and writes a null pointer', () => {
		const m0 = parseParticleDescription(all[0].raw);
		m0.descriptors[0].name = null;
		const reparsed = parseParticleDescription(writeParticleDescription(m0));
		expect(reparsed.descriptors[0].name).toBeNull();
		expect(reparsed.descriptors[1].name).toBe('LEAFS');
	});

	it('round-trips the scratch-blob shape (BoostRecharge has 3 temp blobs)', () => {
		const boost = all.findIndex((e) => e.name.includes('BoostRecharge'));
		expect(boost).toBeGreaterThanOrEqual(0);
		const m = models[boost];
		expect(m.descriptors.every((d) => d._tempBehaviourRaw !== null)).toBe(true);
		expect(m.descriptors.every((d) => d.behaviours.length === 2)).toBe(true);
	});

	it('round-trips the largest resource (NativeFXTextures, 17 descriptors)', () => {
		const idx = all.findIndex((e) => e.name.includes('NativeFXTextures'));
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(models[idx].descriptors.length).toBe(17);
	});
});

describe('ParticleDescription writer guards', () => {
	it('rejects a name longer than 31 chars', () => {
		const m = parseParticleDescription(all[0].raw);
		m.name = 'X'.repeat(32);
		expect(() => writeParticleDescription(m)).toThrow(/exceeds 31 chars/);
	});

	it('rejects a malformed scratch blob', () => {
		const m = parseParticleDescription(all[0].raw);
		m.descriptors[0]._tempBehaviourRaw = new Uint8Array(8);
		expect(() => writeParticleDescription(m)).toThrow(/_tempBehaviourRaw/);
	});

	it('rejects a string with characters outside the 1-byte charset', () => {
		const m = parseParticleDescription(all[0].raw);
		m.descriptors[0].material.textureName = 'SMOKEǿAGE';
		expect(() => writeParticleDescription(m)).toThrow(/1-byte charset/);
	});

	it('rejects fixed arrays of the wrong length', () => {
		const m = parseParticleDescription(all[0].raw);
		m.descriptors[0].material.meshNames = ['(NULL)'];
		expect(() => writeParticleDescription(m)).toThrow(/meshNames/);
	});
});

describe('ParticleDescription parser guards', () => {
	it('rejects bytes whose pointer graph is broken', () => {
		const broken = new Uint8Array(all[0].raw.byteLength);
		broken.set(all[0].raw);
		new DataView(broken.buffer).setUint32(4, 0x20, true); // mpLionEffectDefinition must be 0x10
		expect(() => parseParticleDescription(broken)).toThrow(/mpLionEffectDefinition/);
	});

	it('rejects a truncated resource', () => {
		expect(() => parseParticleDescription(all[0].raw.slice(0, 0x40))).toThrow(/implausible resource size/);
	});
});
