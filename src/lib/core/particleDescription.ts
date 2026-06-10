// ParticleDescription parser and writer (resource type 0x1001D).
//
// The primary asset for Lion particle effects (exhaust smoke, boost flames,
// crash debris puffs, ...). PARTICLES.BUNDLE carries 42 of these; each is a
// memory dump of the Lion effect graph with pointers stored as offsets
// RELATIVE TO THE STRUCTURE THAT CONTAINS THE POINTER (not file-relative):
//
//   0x00 BrnParticle::ParticleDescription (0x10): FNV-1a hashed gamedb URI +
//        pointer to the effect definition (always 0x10) + 8 zero bytes.
//   0x10 cLionEffectDefinition (0x54 + 12B 0xCD pad): version 0x10003, m_key,
//        UTF-16LE name (LionChar[32]), pointer to the particle-effect chain.
//        m_key is NOT a hash: it is the lowercased first character of the
//        name ('Prop_...' → 0x70 'p') — verified on all 42 retail resources.
//   0x70 cLionParticleEffect (0xC + 4B 0xCD pad): mHash (0x065F5506 in every
//        retail resource) + descriptor-chain pointer (always 0x10).
//   0x80 cParticleDescriptor chain. Each descriptor blob is laid out as:
//        descriptor (0x60) → behaviours[mBehaviourCount] (0x4C0 each,
//        contiguous, linked via mpNext = +0x4C0) → optional serialized
//        scratch behaviour (the mpBehaviourTemp blend buffer, 38 of 141
//        retail descriptors have one) → cParticleMaterial (0xA4) → 12B 0xCD
//        pad to the next 16-byte boundary. mpNext links to the next blob.
//   Tail: string pool. Per descriptor, in this exact order: material strings
//        [texture, normal map, mesh, layer group, meshNames[0..4]] then the
//        descriptor name — each non-null reference gets its OWN copy (no
//        dedup; the many "(NULL)" strings are literal placeholder text from
//        the authoring tool, while genuinely-null pointers store 0). Zero
//        pad to 16-byte alignment ends the resource.
//
// Uninitialised-memory facts (constant across all 42 retail resources, so
// the parser asserts them and the writer regenerates them): inter-structure
// pads are 0xCD fill (MSVC debug-heap pattern); descriptor and material mID
// are 0xCDCDCDCD; behaviour pads at +0x461 and +0x49C are 0xCD fill; the
// behaviour AABB is 0xCDCDCDCD junk floats (decoded as f32 — a corpus scan
// found zero NaN-bit patterns in any float lane, so f32 decode is bit-exact).
// Variable junk (descriptor mpBehaviour runtime pointer, the scratch
// behaviour blob, the compiled base/variance cache) is preserved verbatim in
// _-prefixed fields.
//
// NO import tables: all 42 retail resources have importCount 0 — materials
// reference textures/meshes by NAME string, resolved at runtime via handles
// that are 0 on disk.
//
// Scope: 32-bit PC little-endian, like the rest of src/lib/core.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

/** cParticleDescriptor::eParticleDescriptorFlags. Retail uses DYNAMICPLACE,
 *  USE_MATRICES and PREFORM only; the rest are defined by the game. */
export const PARTICLE_DESCRIPTOR_FLAGS = [
	{ mask: 0x1, label: 'eDO_LIGHTING' },
	{ mask: 0x2, label: 'eDO_INTENSITY' },
	{ mask: 0x4, label: 'eDO_REPEAT' },
	{ mask: 0x8, label: 'eDO_CELLRENDER' },
	{ mask: 0x10, label: 'eDO_DYNAMICPLACE' },
	{ mask: 0x20, label: 'eDO_USE_MATRICES' },
	{ mask: 0x40, label: 'eDO_FACECAMERA' },
	{ mask: 0x80, label: 'eDO_WORLD_ACC' },
	{ mask: 0x100, label: 'eDO_IGNOREROT' },
	{ mask: 0x200, label: 'eDO_PHYSICS' },
	{ mask: 0x400, label: 'eDO_RGBA_INTERPOLANT' },
	{ mask: 0x800, label: 'eDO_RGBA_VARIANCE' },
	{ mask: 0x1000, label: 'eDO_LOCATOR_INSTANCING' },
	{ mask: 0x2000, label: 'eDO_TRIGGER_INSTANCING' },
	{ mask: 0x4000, label: 'eDO_PREFORM' },
	{ mask: 0x8000, label: 'eDO_DISABLED' },
	{ mask: 0x10000, label: 'eDO_RIBBON' },
] as const;

// =============================================================================
// Types
// =============================================================================

/** Lion cVector — four f32 lanes. The w lane usually holds 0 but carries
 *  uninitialised junk in several retail vectors, so it is always preserved. */
export type Vec4 = { x: number; y: number; z: number; w: number };

/** Lion cColour8 — one byte per channel in disk order R,G,B,A. */
export type Colour8 = { r: number; g: number; b: number; a: number };

/** The 28 leading cVectors of cParticleBehaviour, in on-disk order
 *  (0x000–0x1C0). Shared by reader, writer and schema so they can never
 *  drift apart. */
export const BEHAVIOUR_VEC_FIELDS = [
	'mAccBase', 'mAccVariance', 'mAxisBase',
	'mOffsetRotXYZBase', 'mOffsetRotXYZVariance',
	'mOffsetRotXYZVelBase', 'mOffsetRotXYZVelVariance',
	'mOffsetRotXYZAccBase', 'mOffsetRotXYZAccVariance',
	'mRotXYZBase', 'mRotXYZVariance',
	'mRotXYZVelBase', 'mRotXYZVelVariance',
	'mRotXYZAccBase', 'mRotXYZAccVariance',
	'mPivotPoint', 'mPosBase', 'mPosVariance', 'mRingRadius',
	'mSizeXYZBase', 'mSizeXYZVariance',
	'mSizeXYZVelBase', 'mSizeXYZVelVariance',
	'mSizeXYZAccBase', 'mSizeXYZAccVariance',
	'mVelBase', 'mVelVariance', 'mRGBADiff',
] as const;

/** The 22 f32 scalars at behaviour offset 0x268–0x2C0, in on-disk order. */
export const BEHAVIOUR_SCALAR_FIELDS = [
	'mZero',
	'mAlphaFadeOutPlusInvOneMinusAlphaFadeOut', 'mAlphaFadeInInv', 'mNegInvOneMinusAlphaFadeOut',
	'mAlphaFadeIn', 'mAlphaFadeOut',
	'mCellSize', 'mCloneScaleInTime', 'mDragFactor', 'mMass',
	'mSizeBase', 'mSizeVariance', 'mSizeVelBase', 'mSizeVelVariance',
	'mSizeAccBase', 'mSizeAccVariance',
	'mEmissionRateBase', 'mEmissionRateVariance',
	'mLifeBase', 'mLifeVariance', 'mRadius', 'mScale',
] as const;

/** The 12 f32 scalars in the behaviour tail (0x468–0x480 and 0x484–0x49C). */
export const BEHAVIOUR_TAIL_FIELDS_A = [
	'mEndOnAlphaFade', 'mEndOnScale', 'mEndOnStartAngle', 'mEndOnEndAngle',
	'mTimeScale', 'mTimeScaleVariance',
] as const;
export const BEHAVIOUR_TAIL_FIELDS_B = [
	'mDragFactorVel', 'mDragFactorRot', 'mDragFactorScale',
	'mEmitterStartWeight', 'mEmitterEndWeight', 'mEmitterVelWeight',
] as const;

type BehaviourVecName = typeof BEHAVIOUR_VEC_FIELDS[number];
type BehaviourScalarName =
	| typeof BEHAVIOUR_SCALAR_FIELDS[number]
	| typeof BEHAVIOUR_TAIL_FIELDS_A[number]
	| typeof BEHAVIOUR_TAIL_FIELDS_B[number];

export type ParticleBehaviour =
	Record<BehaviourVecName, Vec4> &
	Record<BehaviourScalarName, number> & {
		/** Up-to-4-step colour ramp as float vectors (w lanes are 0xCD junk, preserved). */
		mColourStepsRGBAv: Vec4[];
		mDivisors: number[];
		mRGBA0: Colour8;
		mRGBA1: Colour8;
		mRGBABase: Colour8;
		mRGBAVar: Colour8;
		mColour: Colour8[];
		mColourTime: number[];
		mColourStepRGBA: Colour8[];
		mRGBATime: number[];
		mColourSteps: number;
		mRGBAVarianceMode: number;
		mEmissionCountClamp: number;
		mFlags: number;
		/** cParticleBehaviourBaseVarianceCompiled (0x180) — a compiled cache of
		 *  base/variance pairs derived from the fields above. Preserved raw; the
		 *  game recompiles it when authoring, steward does not. */
		_bvCompiled: Uint8Array;
		mEmissionRateHasBeenScaled: number;
		mEmissionCountClampVariance: number;
		mRibbonParticleCount: number;
		/** 0xCDCDCDCD junk floats in every retail behaviour — never authored. */
		mAABBMin: Vec4;
		mAABBMax: Vec4;
	};

export type ParticleMaterial = {
	/** Uninitialised on disk (0xCDCDCDCD in retail) — preserved verbatim. */
	_mID: number;
	/** Runtime-resolved handles, 0 on disk. */
	mMaterialHandle: number;
	mMeshHandle: number;
	mTextureHandle: number;
	textureName: string | null;
	mNormalMapHandle: number;
	normalMapName: string | null;
	meshName: string | null;
	layerGroupName: string | null;
	mFlags: number;
	mFrameMask: number;
	mFrameBase: number;
	mFrameVariance: number;
	mFrameCount: number;
	mXFrames: number;
	mYFrames: number;
	mBlendMode: number;
	mAlphaTestMode: number;
	mAlphaTestValue: number;
	mZTestMode: number;
	/** mPad — 0xCD in every retail material; preserved verbatim. */
	_padByte: number;
	mUCoordOption: number;
	mVCoordOption: number;
	mAnimTexOptions: number;
	mShader: number;
	mNormalOption: number;
	mLayer: number;
	mRibbonStretch: number;
	mMeshHandles: number[];
	meshNames: (string | null)[];
	mPercentages: number[];
	mNumMeshes: number;
	mNormalBlend: number;
	mKeyLightAmount: number;
	mIBLAmount: number;
	mZBlendDistance: number;
	mFPS: number;
	mFPSVariance: number;
};

export type ParticleDescriptor = {
	/** Uninitialised on disk (0xCDCDCDCD in retail) — preserved verbatim. */
	_mID: number;
	mPauseTime: number;
	mPauseTimeVariance: number;
	mRepeatTime: number;
	mRepeatTimeVariance: number;
	mEmitterLifeBase: number;
	mEmitterLifeVariance: number;
	mEmitterLifeInfiniteFlag: number;
	mFlags: number;
	mLodGroup: number;
	mRenderGroup: number;
	mShape: number;
	mCollisionType: number;
	mBlendLast: number;
	/** Emitter name from the string pool (e.g. "GROUNDDUSTPUF"). */
	name: string | null;
	behaviours: ParticleBehaviour[];
	/** mpBehaviour — a stale runtime pointer serialized as-is; junk, varies
	 *  per descriptor. Preserved verbatim for byte-exact output. */
	_runtimeBehaviourPtr: number;
	/** Serialized mpBehaviourTemp scratch buffer (0x4C0) used by the runtime
	 *  to blend behaviours — mostly junk; preserved verbatim when present. */
	_tempBehaviourRaw: Uint8Array | null;
	material: ParticleMaterial;
};

export type ParsedParticleDescription = {
	/** FNV-1a hash of the gamedb:// URI — equals the bundle resource id. */
	muHashedGDBURI: number;
	/** Lowercased first character of `name` — see deriveParticleKey. */
	mKey: number;
	/** Effect name, UTF-16 on disk, max 31 chars (e.g. "Prop_Foilage.lef"). */
	name: string;
	/** cLionParticleEffect.mHash — 0x065F5506 in every retail resource. */
	mEffectHash: number;
	descriptors: ParticleDescriptor[];
};

// =============================================================================
// Constants
// =============================================================================

const EFFECT_DEF_OFFSET = 0x10;
const EFFECT_DEF_SIZE = 0x54;
const PARTICLE_EFFECT_OFFSET = 0x70;
const FIRST_DESCRIPTOR_OFFSET = 0x80;
const DESCRIPTOR_SIZE = 0x60;
const BEHAVIOUR_SIZE = 0x4c0;
const MATERIAL_SIZE = 0xa4;
const BV_COMPILED_SIZE = 0x180;
const NAME_CHARS = 32;
const CD = 0xcd;

/** m_key derivation verified on all 42 retail resources. */
export function deriveParticleKey(name: string): number {
	return name.length === 0 ? 0 : name.charAt(0).toLowerCase().charCodeAt(0);
}

const align16 = (n: number) => (n + 15) & ~15;

function fail(what: string): never {
	throw new Error(`ParticleDescription: ${what}`);
}

// =============================================================================
// Reader
// =============================================================================

/** One pool string reference in canonical pool order (write order). */
type StringRef = { text: string | null; abs: number };

class Ctx {
	constructor(public bytes: Uint8Array, public r: BinReader) {}
	refs: StringRef[] = [];
}

function expectEq(actual: number, expected: number, what: string) {
	if (actual !== expected) fail(`${what} is 0x${actual.toString(16)}, expected 0x${expected.toString(16)}`);
}

function expectCdPad(bytes: Uint8Array, start: number, len: number, what: string) {
	for (let i = 0; i < len; i++) {
		if (bytes[start + i] !== CD) fail(`${what} pad at 0x${(start + i).toString(16)} is 0x${bytes[start + i].toString(16)}, expected 0xCD fill`);
	}
}

/** Latin-1 NUL-terminated string at `abs`; pointers are 1 byte/char ASCII. */
function readPoolString(ctx: Ctx, base: number, rel: number): string | null {
	if (rel === 0) {
		ctx.refs.push({ text: null, abs: 0 });
		return null;
	}
	const abs = base + rel;
	let end = abs;
	while (end < ctx.bytes.byteLength && ctx.bytes[end] !== 0) end++;
	if (end >= ctx.bytes.byteLength) fail(`unterminated string at 0x${abs.toString(16)}`);
	let s = '';
	for (let i = abs; i < end; i++) s += String.fromCharCode(ctx.bytes[i]);
	ctx.refs.push({ text: s, abs });
	return s;
}

function readVec4(r: BinReader): Vec4 {
	return { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() };
}

function readColour8(r: BinReader): Colour8 {
	return { r: r.readU8(), g: r.readU8(), b: r.readU8(), a: r.readU8() };
}

function readBehaviour(ctx: Ctx, isLastInArray: boolean): ParticleBehaviour {
	const { r, bytes } = ctx;
	const start = r.position;

	const vecs = {} as Record<BehaviourVecName, Vec4>;
	for (const f of BEHAVIOUR_VEC_FIELDS) vecs[f] = readVec4(r);

	const mColourStepsRGBAv = [readVec4(r), readVec4(r), readVec4(r), readVec4(r)];
	const mDivisors = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];
	const mRGBA0 = readColour8(r);
	const mRGBA1 = readColour8(r);
	const mRGBABase = readColour8(r);
	const mRGBAVar = readColour8(r);
	const mColour = [readColour8(r), readColour8(r), readColour8(r), readColour8(r)];
	const mColourTime = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];
	const mColourStepRGBA = [readColour8(r), readColour8(r), readColour8(r), readColour8(r)];
	const mRGBATime = [r.readF32(), r.readF32(), r.readF32(), r.readF32()];
	const mColourSteps = r.readU32();
	const mRGBAVarianceMode = r.readU32();

	const scalars = {} as Record<BehaviourScalarName, number>;
	for (const f of BEHAVIOUR_SCALAR_FIELDS) scalars[f] = r.readF32();
	if (r.position !== start + 0x2c0) fail(`behaviour scalar block ended at +0x${(r.position - start).toString(16)}, expected +0x2C0`);

	const mEmissionCountClamp = r.readU32();
	const mFlags = r.readU32();
	// Waveform pointers — never used in retail PARTICLES.BUNDLE. A non-zero
	// value would mean an undocumented trailing cParticleWaveForm this parser
	// does not place, so fail loudly instead of mis-round-tripping.
	for (const lane of ['X', 'Y', 'Z', 'Alpha', 'RGB']) {
		const p = r.readU32();
		if (p !== 0) fail(`behaviour waveform ${lane} pointer is 0x${p.toString(16)} — waveforms are not supported (none exist in retail)`);
	}
	expectEq(r.readU32(), isLastInArray ? 0 : BEHAVIOUR_SIZE, 'behaviour mpNext');

	const _bvCompiled = bytes.slice(r.position, r.position + BV_COMPILED_SIZE);
	r.position += BV_COMPILED_SIZE;

	const mEmissionRateHasBeenScaled = r.readU8();
	expectCdPad(bytes, r.position, 3, 'behaviour +0x461');
	r.position += 3;
	const mEmissionCountClampVariance = r.readU32();
	for (const f of BEHAVIOUR_TAIL_FIELDS_A) scalars[f] = r.readF32();
	const mRibbonParticleCount = r.readU32();
	for (const f of BEHAVIOUR_TAIL_FIELDS_B) scalars[f] = r.readF32();
	expectCdPad(bytes, r.position, 4, 'behaviour +0x49C');
	r.position += 4;
	const mAABBMin = readVec4(r);
	const mAABBMax = readVec4(r);
	if (r.position !== start + BEHAVIOUR_SIZE) fail(`behaviour ended at +0x${(r.position - start).toString(16)}, expected +0x4C0`);

	return {
		...vecs, ...scalars,
		mColourStepsRGBAv, mDivisors, mRGBA0, mRGBA1, mRGBABase, mRGBAVar,
		mColour, mColourTime, mColourStepRGBA, mRGBATime, mColourSteps, mRGBAVarianceMode,
		mEmissionCountClamp, mFlags, _bvCompiled,
		mEmissionRateHasBeenScaled, mEmissionCountClampVariance, mRibbonParticleCount,
		mAABBMin, mAABBMax,
	};
}

function readMaterial(ctx: Ctx): ParticleMaterial {
	const { r } = ctx;
	const base = r.position;
	const _mID = r.readU32();
	const mMaterialHandle = r.readU32();
	const mMeshHandle = r.readU32();
	const mTextureHandle = r.readU32();
	const textureName = readPoolString(ctx, base, r.readU32());
	const mNormalMapHandle = r.readU32();
	const normalMapName = readPoolString(ctx, base, r.readU32());
	const meshName = readPoolString(ctx, base, r.readU32());
	const layerGroupName = readPoolString(ctx, base, r.readU32());
	const mFlags = r.readU32();
	const mFrameMask = r.readU32();
	const mFrameBase = r.readI32();
	const mFrameVariance = r.readI32();
	const mFrameCount = r.readI32();
	const mXFrames = r.readU8();
	const mYFrames = r.readU8();
	const mBlendMode = r.readU8();
	const mAlphaTestMode = r.readU8();
	const mAlphaTestValue = r.readU8();
	const mZTestMode = r.readU8();
	const _padByte = r.readU8();
	const mUCoordOption = r.readU8();
	const mVCoordOption = r.readU8();
	const mAnimTexOptions = r.readU8();
	const mShader = r.readU8();
	const mNormalOption = r.readU8();
	const mLayer = r.readU32();
	const mRibbonStretch = r.readF32();
	const mMeshHandles = [r.readU32(), r.readU32(), r.readU32(), r.readU32(), r.readU32()];
	const meshNames = [0, 1, 2, 3, 4].map(() => readPoolString(ctx, base, r.readU32()));
	const mPercentages = [r.readU32(), r.readU32(), r.readU32(), r.readU32(), r.readU32()];
	const mNumMeshes = r.readU32();
	const mNormalBlend = r.readF32();
	const mKeyLightAmount = r.readF32();
	const mIBLAmount = r.readF32();
	const mZBlendDistance = r.readF32();
	const mFPS = r.readF32();
	const mFPSVariance = r.readF32();
	if (r.position !== base + MATERIAL_SIZE) fail(`material ended at +0x${(r.position - base).toString(16)}, expected +0xA4`);
	return {
		_mID, mMaterialHandle, mMeshHandle, mTextureHandle, textureName,
		mNormalMapHandle, normalMapName, meshName, layerGroupName,
		mFlags, mFrameMask, mFrameBase, mFrameVariance, mFrameCount,
		mXFrames, mYFrames, mBlendMode, mAlphaTestMode, mAlphaTestValue, mZTestMode,
		_padByte, mUCoordOption, mVCoordOption, mAnimTexOptions, mShader, mNormalOption,
		mLayer, mRibbonStretch, mMeshHandles, meshNames, mPercentages, mNumMeshes,
		mNormalBlend, mKeyLightAmount, mIBLAmount, mZBlendDistance, mFPS, mFPSVariance,
	};
}

function readDescriptor(ctx: Ctx): { descriptor: ParticleDescriptor; nextRel: number } {
	const { r, bytes } = ctx;
	const base = r.position;
	const _mID = r.readU32();
	const mPauseTime = r.readF32();
	const mPauseTimeVariance = r.readF32();
	const mRepeatTime = r.readF32();
	const mRepeatTimeVariance = r.readF32();
	const mEmitterLifeBase = r.readF32();
	const mEmitterLifeVariance = r.readF32();
	const mEmitterLifeInfiniteFlag = r.readU32();
	const mFlags = r.readU32();
	const mLodGroup = r.readU32();
	const mRenderGroup = r.readU32();
	const mShape = r.readU32();
	const mCollisionType = r.readU32();
	const mBlendLast = r.readF32();
	const namePtr = r.readU32(); // resolved at the end so the ref lands AFTER the material strings (canonical pool order)
	const mBehaviourCount = r.readI32();
	if (mBehaviourCount < 0 || mBehaviourCount > 64) fail(`implausible mBehaviourCount ${mBehaviourCount}`);
	expectEq(r.readU32(), DESCRIPTOR_SIZE, 'descriptor mpBehaviours');
	const tempPtr = r.readU32();
	if (tempPtr !== 0) expectEq(tempPtr, DESCRIPTOR_SIZE + mBehaviourCount * BEHAVIOUR_SIZE, 'descriptor mpBehaviourTemp');
	const _runtimeBehaviourPtr = r.readU32();
	const materialPtr = r.readU32();
	expectEq(materialPtr, DESCRIPTOR_SIZE + mBehaviourCount * BEHAVIOUR_SIZE + (tempPtr !== 0 ? BEHAVIOUR_SIZE : 0), 'descriptor mpMaterial');
	expectEq(r.readU32(), 0, 'descriptor mpDef');
	const nextRel = r.readU32();
	expectEq(r.readU32(), 0, 'descriptor mpParent');
	expectEq(r.readU32(), 0, 'descriptor mpChild');
	if (r.position !== base + DESCRIPTOR_SIZE) fail('descriptor header size drift');

	const behaviours: ParticleBehaviour[] = [];
	for (let b = 0; b < mBehaviourCount; b++) behaviours.push(readBehaviour(ctx, b === mBehaviourCount - 1));

	let _tempBehaviourRaw: Uint8Array | null = null;
	if (tempPtr !== 0) {
		_tempBehaviourRaw = bytes.slice(r.position, r.position + BEHAVIOUR_SIZE);
		r.position += BEHAVIOUR_SIZE;
	}

	const material = readMaterial(ctx);
	const name = readPoolString(ctx, base, namePtr);

	expectCdPad(bytes, r.position, align16(r.position) - r.position, 'descriptor blob');
	r.position = align16(r.position);
	const blobSize = r.position - base;
	if (nextRel !== 0) expectEq(nextRel, blobSize, 'descriptor mpNext');

	return {
		descriptor: {
			_mID, mPauseTime, mPauseTimeVariance, mRepeatTime, mRepeatTimeVariance,
			mEmitterLifeBase, mEmitterLifeVariance, mEmitterLifeInfiniteFlag,
			mFlags, mLodGroup, mRenderGroup, mShape, mCollisionType, mBlendLast,
			name, behaviours, _runtimeBehaviourPtr, _tempBehaviourRaw, material,
		},
		nextRel,
	};
}

export function parseParticleDescription(raw: Uint8Array, littleEndian = true): ParsedParticleDescription {
	// Copy up front: extractResourceRaw can hand back a Node Buffer whose
	// .slice is a view, and we hand out _bvCompiled/_tempBehaviourRaw slices.
	const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
	const bytes = new Uint8Array(buf);
	if (bytes.byteLength < FIRST_DESCRIPTOR_OFFSET || bytes.byteLength % 16 !== 0) {
		fail(`implausible resource size 0x${bytes.byteLength.toString(16)}`);
	}
	const r = new BinReader(buf, littleEndian);
	const ctx = new Ctx(bytes, r);

	// --- BrnParticle::ParticleDescription header ---
	const muHashedGDBURI = r.readU32();
	expectEq(r.readU32(), EFFECT_DEF_OFFSET, 'mpLionEffectDefinition');
	expectEq(r.readU32(), 0, 'header pad +0x8');
	expectEq(r.readU32(), 0, 'header pad +0xC');

	// --- cLionEffectDefinition ---
	expectEq(r.readU32(), 0x10003, 'mVersion');
	const mKey = r.readU32();
	let name = '';
	let terminated = false;
	for (let i = 0; i < NAME_CHARS; i++) {
		const c = r.readU16();
		if (c === 0) { terminated = true; }
		else if (terminated) { fail('m_name has non-zero chars after the terminator'); }
		else { name += String.fromCharCode(c); }
	}
	expectEq(r.readU32(), PARTICLE_EFFECT_OFFSET - EFFECT_DEF_OFFSET, 'mpParticles');
	expectEq(r.readU32(), 0, 'mpBindings'); // never present in any retail resource (wiki agrees)
	expectEq(r.readU32(), 0, 'effectDef mpNext'); // single effect definition per resource in retail
	expectCdPad(bytes, EFFECT_DEF_OFFSET + EFFECT_DEF_SIZE, PARTICLE_EFFECT_OFFSET - (EFFECT_DEF_OFFSET + EFFECT_DEF_SIZE), 'effectDef');

	// --- cLionParticleEffect ---
	r.position = PARTICLE_EFFECT_OFFSET;
	const mEffectHash = r.readU32();
	expectEq(r.readU32(), 0x10, 'particleEffect mpDescriptors');
	expectEq(r.readU32(), 0, 'particleEffect mpNext'); // single effect per resource in retail
	expectCdPad(bytes, r.position, FIRST_DESCRIPTOR_OFFSET - r.position, 'particleEffect');

	// --- descriptor chain (canonical layout: each blob directly follows the previous) ---
	r.position = FIRST_DESCRIPTOR_OFFSET;
	const descriptors: ParticleDescriptor[] = [];
	for (;;) {
		const { descriptor, nextRel } = readDescriptor(ctx);
		descriptors.push(descriptor);
		if (nextRel === 0) break;
	}

	// --- string pool: verify canonical order so the writer's regenerated pool
	// is provably byte-identical instead of failing a round-trip later ---
	let expected = r.position;
	for (const ref of ctx.refs) {
		if (ref.text === null) continue;
		if (ref.abs !== expected) fail(`string at 0x${ref.abs.toString(16)} breaks canonical pool order (expected 0x${expected.toString(16)})`);
		expected += ref.text.length + 1;
	}
	if (align16(expected) !== bytes.byteLength) fail(`pool ends at 0x${expected.toString(16)} but resource is 0x${bytes.byteLength.toString(16)}`);
	for (let o = expected; o < bytes.byteLength; o++) {
		if (bytes[o] !== 0) fail(`non-zero tail pad at 0x${o.toString(16)}`);
	}

	return { muHashedGDBURI, mKey, name, mEffectHash, descriptors };
}

// =============================================================================
// Writer
// =============================================================================

function writeVec4(w: BinWriter, v: Vec4) {
	w.writeF32(v.x); w.writeF32(v.y); w.writeF32(v.z); w.writeF32(v.w);
}

function writeColour8(w: BinWriter, c: Colour8) {
	w.writeU8(c.r); w.writeU8(c.g); w.writeU8(c.b); w.writeU8(c.a);
}

function writeCdPad(w: BinWriter, len: number) {
	for (let i = 0; i < len; i++) w.writeU8(CD);
}

function expectLen(actual: number, expected: number, what: string) {
	if (actual !== expected) throw new Error(`ParticleDescription writer: ${what} has ${actual} entries, expected ${expected}`);
}

function poolBytes(s: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 0 || c > 0xff) throw new Error(`ParticleDescription writer: string "${s}" has a char outside the 1-byte charset`);
		out.push(c);
	}
	out.push(0);
	return out;
}

/** Canonical per-descriptor pool order — material strings then the name. */
function descriptorStrings(d: ParticleDescriptor): (string | null)[] {
	return [
		d.material.textureName, d.material.normalMapName, d.material.meshName,
		d.material.layerGroupName, ...d.material.meshNames, d.name,
	];
}

function descriptorBlobSize(d: ParticleDescriptor): number {
	return align16(
		DESCRIPTOR_SIZE + d.behaviours.length * BEHAVIOUR_SIZE +
		(d._tempBehaviourRaw ? BEHAVIOUR_SIZE : 0) + MATERIAL_SIZE,
	);
}

function writeBehaviour(w: BinWriter, b: ParticleBehaviour, isLastInArray: boolean) {
	const start = w.offset;
	for (const f of BEHAVIOUR_VEC_FIELDS) writeVec4(w, b[f]);
	expectLen(b.mColourStepsRGBAv.length, 4, 'mColourStepsRGBAv');
	for (const v of b.mColourStepsRGBAv) writeVec4(w, v);
	expectLen(b.mDivisors.length, 4, 'mDivisors');
	for (const v of b.mDivisors) w.writeF32(v);
	writeColour8(w, b.mRGBA0);
	writeColour8(w, b.mRGBA1);
	writeColour8(w, b.mRGBABase);
	writeColour8(w, b.mRGBAVar);
	expectLen(b.mColour.length, 4, 'mColour');
	for (const c of b.mColour) writeColour8(w, c);
	expectLen(b.mColourTime.length, 4, 'mColourTime');
	for (const v of b.mColourTime) w.writeF32(v);
	expectLen(b.mColourStepRGBA.length, 4, 'mColourStepRGBA');
	for (const c of b.mColourStepRGBA) writeColour8(w, c);
	expectLen(b.mRGBATime.length, 4, 'mRGBATime');
	for (const v of b.mRGBATime) w.writeF32(v);
	w.writeU32(b.mColourSteps);
	w.writeU32(b.mRGBAVarianceMode);
	for (const f of BEHAVIOUR_SCALAR_FIELDS) w.writeF32(b[f]);
	w.writeU32(b.mEmissionCountClamp);
	w.writeU32(b.mFlags);
	for (let i = 0; i < 5; i++) w.writeU32(0); // waveform pointers — unused in retail
	w.writeU32(isLastInArray ? 0 : BEHAVIOUR_SIZE); // mpNext
	if (b._bvCompiled.byteLength !== BV_COMPILED_SIZE) {
		throw new Error(`ParticleDescription writer: _bvCompiled is ${b._bvCompiled.byteLength} bytes, expected 0x180`);
	}
	w.writeBytes(b._bvCompiled);
	w.writeU8(b.mEmissionRateHasBeenScaled);
	writeCdPad(w, 3);
	w.writeU32(b.mEmissionCountClampVariance);
	for (const f of BEHAVIOUR_TAIL_FIELDS_A) w.writeF32(b[f]);
	w.writeU32(b.mRibbonParticleCount);
	for (const f of BEHAVIOUR_TAIL_FIELDS_B) w.writeF32(b[f]);
	writeCdPad(w, 4);
	writeVec4(w, b.mAABBMin);
	writeVec4(w, b.mAABBMax);
	if (w.offset !== start + BEHAVIOUR_SIZE) throw new Error('ParticleDescription writer: behaviour size drift');
}

/**
 * `stringOffsets` holds the absolute pool offset for each entry of
 * descriptorStrings(d) — material strings are indices 0..8 (0 = null pointer).
 * Lookups are positional so duplicate text (nine "(NULL)"s) keeps per-slot
 * copies, matching the retail no-dedup pool.
 */
function writeMaterial(w: BinWriter, m: ParticleMaterial, stringOffsets: number[]) {
	const base = w.offset;
	const rel = (i: number) => (stringOffsets[i] === 0 ? 0 : stringOffsets[i] - base);
	w.writeU32(m._mID);
	w.writeU32(m.mMaterialHandle);
	w.writeU32(m.mMeshHandle);
	w.writeU32(m.mTextureHandle);
	w.writeU32(rel(0)); // mpTextureName
	w.writeU32(m.mNormalMapHandle);
	w.writeU32(rel(1)); // mpNormalMapName
	w.writeU32(rel(2)); // mpMeshName
	w.writeU32(rel(3)); // mpLayerGroupName
	w.writeU32(m.mFlags);
	w.writeU32(m.mFrameMask);
	w.writeI32(m.mFrameBase);
	w.writeI32(m.mFrameVariance);
	w.writeI32(m.mFrameCount);
	w.writeU8(m.mXFrames);
	w.writeU8(m.mYFrames);
	w.writeU8(m.mBlendMode);
	w.writeU8(m.mAlphaTestMode);
	w.writeU8(m.mAlphaTestValue);
	w.writeU8(m.mZTestMode);
	w.writeU8(m._padByte);
	w.writeU8(m.mUCoordOption);
	w.writeU8(m.mVCoordOption);
	w.writeU8(m.mAnimTexOptions);
	w.writeU8(m.mShader);
	w.writeU8(m.mNormalOption);
	w.writeU32(m.mLayer);
	w.writeF32(m.mRibbonStretch);
	expectLen(m.mMeshHandles.length, 5, 'mMeshHandles');
	for (const h of m.mMeshHandles) w.writeU32(h);
	expectLen(m.meshNames.length, 5, 'meshNames');
	for (let i = 0; i < 5; i++) w.writeU32(rel(4 + i)); // mpMeshNames
	expectLen(m.mPercentages.length, 5, 'mPercentages');
	for (const p of m.mPercentages) w.writeU32(p);
	w.writeU32(m.mNumMeshes);
	w.writeF32(m.mNormalBlend);
	w.writeF32(m.mKeyLightAmount);
	w.writeF32(m.mIBLAmount);
	w.writeF32(m.mZBlendDistance);
	w.writeF32(m.mFPS);
	w.writeF32(m.mFPSVariance);
	if (w.offset !== base + MATERIAL_SIZE) throw new Error('ParticleDescription writer: material size drift');
}

export function writeParticleDescription(model: ParsedParticleDescription, littleEndian = true): Uint8Array {
	if (model.name.length > NAME_CHARS - 1) {
		throw new Error(`ParticleDescription writer: name "${model.name}" exceeds ${NAME_CHARS - 1} chars`);
	}

	// --- layout: descriptor blob offsets, then per-string pool offsets ---
	const descOffsets: number[] = [];
	let cursor = FIRST_DESCRIPTOR_OFFSET;
	for (const d of model.descriptors) {
		descOffsets.push(cursor);
		cursor += descriptorBlobSize(d);
	}
	const poolStart = cursor;
	// Per-descriptor absolute offsets, indexed like descriptorStrings(d).
	// Identical text in two slots gets two copies (the retail pool is not
	// deduped); 0 marks a genuinely-null pointer.
	const poolOffsets: number[][] = [];
	let poolCursor = poolStart;
	for (const d of model.descriptors) {
		const offs: number[] = [];
		for (const s of descriptorStrings(d)) {
			if (s === null) { offs.push(0); continue; }
			offs.push(poolCursor);
			poolCursor += s.length + 1;
		}
		poolOffsets.push(offs);
	}
	const totalSize = align16(poolCursor);

	const w = new BinWriter(totalSize, littleEndian);

	// --- header ---
	w.writeU32(model.muHashedGDBURI);
	w.writeU32(EFFECT_DEF_OFFSET);
	w.writeU32(0);
	w.writeU32(0);

	// --- cLionEffectDefinition ---
	w.writeU32(0x10003);
	w.writeU32(model.mKey);
	for (let i = 0; i < NAME_CHARS; i++) w.writeU16(i < model.name.length ? model.name.charCodeAt(i) : 0);
	w.writeU32(PARTICLE_EFFECT_OFFSET - EFFECT_DEF_OFFSET); // mpParticles → 0x70
	w.writeU32(0); // mpBindings
	w.writeU32(0); // mpNext
	writeCdPad(w, PARTICLE_EFFECT_OFFSET - (EFFECT_DEF_OFFSET + EFFECT_DEF_SIZE));

	// --- cLionParticleEffect ---
	w.writeU32(model.mEffectHash);
	w.writeU32(0x10); // mpDescriptors → 0x80
	w.writeU32(0); // mpNext
	writeCdPad(w, FIRST_DESCRIPTOR_OFFSET - w.offset);

	// --- descriptor blobs ---
	model.descriptors.forEach((d, di) => {
		const base = descOffsets[di];
		if (w.offset !== base) throw new Error(`ParticleDescription writer: descriptor ${di} lands at 0x${w.offset.toString(16)}, expected 0x${base.toString(16)}`);
		const offs = poolOffsets[di];
		const n = d.behaviours.length;
		const tempSize = d._tempBehaviourRaw ? BEHAVIOUR_SIZE : 0;

		w.writeU32(d._mID);
		w.writeF32(d.mPauseTime);
		w.writeF32(d.mPauseTimeVariance);
		w.writeF32(d.mRepeatTime);
		w.writeF32(d.mRepeatTimeVariance);
		w.writeF32(d.mEmitterLifeBase);
		w.writeF32(d.mEmitterLifeVariance);
		w.writeU32(d.mEmitterLifeInfiniteFlag);
		w.writeU32(d.mFlags);
		w.writeU32(d.mLodGroup);
		w.writeU32(d.mRenderGroup);
		w.writeU32(d.mShape);
		w.writeU32(d.mCollisionType);
		w.writeF32(d.mBlendLast);
		w.writeU32(offs[9] === 0 ? 0 : offs[9] - base); // mpName (index 9 in descriptorStrings)
		w.writeI32(n);
		w.writeU32(DESCRIPTOR_SIZE); // mpBehaviours
		w.writeU32(d._tempBehaviourRaw ? DESCRIPTOR_SIZE + n * BEHAVIOUR_SIZE : 0); // mpBehaviourTemp
		w.writeU32(d._runtimeBehaviourPtr); // mpBehaviour — stale runtime junk, preserved
		w.writeU32(DESCRIPTOR_SIZE + n * BEHAVIOUR_SIZE + tempSize); // mpMaterial
		w.writeU32(0); // mpDef
		w.writeU32(di < model.descriptors.length - 1 ? descriptorBlobSize(d) : 0); // mpNext
		w.writeU32(0); // mpParent
		w.writeU32(0); // mpChild

		d.behaviours.forEach((b, bi) => writeBehaviour(w, b, bi === n - 1));
		if (d._tempBehaviourRaw) {
			if (d._tempBehaviourRaw.byteLength !== BEHAVIOUR_SIZE) {
				throw new Error(`ParticleDescription writer: _tempBehaviourRaw is ${d._tempBehaviourRaw.byteLength} bytes, expected 0x4C0`);
			}
			w.writeBytes(d._tempBehaviourRaw);
		}

		writeMaterial(w, d.material, offs);
		writeCdPad(w, base + descriptorBlobSize(d) - w.offset);
	});

	// --- string pool ---
	if (w.offset !== poolStart) throw new Error('ParticleDescription writer: pool offset drift');
	for (const d of model.descriptors) {
		for (const s of descriptorStrings(d)) {
			if (s !== null) for (const c of poolBytes(s)) w.writeU8(c);
		}
	}
	w.writeZeroes(totalSize - w.offset);
	return w.bytes;
}
