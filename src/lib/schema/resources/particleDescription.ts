// Hand-written schema for ParsedParticleDescription (resource type 0x1001D).
//
// Mirrors the types in `src/lib/core/particleDescription.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift. The big
// behaviour record builds its vec4/f32 blocks from the SAME field-name arrays
// the parser and writer iterate, so those can never drift.
//
// Domain: one Lion particle effect. `descriptors` are the effect's emitters,
// chained on disk; each owns 1–2 `behaviours` (motion/colour/size programs —
// the runtime blends between them over the emitter's life) and one `material`
// (texture/mesh names plus blend state). Structure counts are FIXED here:
// adding or removing descriptors/behaviours would need authored content
// steward can't invent (a behaviour is 82 fields and a compiled cache), so
// lists are non-addable and editing focuses on values.
//
// Name fields ("(NULL)" vs null): the authoring tool wrote the literal text
// "(NULL)" as a placeholder string — a genuinely-null pointer parses as null
// instead. Both are preserved; don't "clean up" one into the other.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import {
	BEHAVIOUR_VEC_FIELDS,
	BEHAVIOUR_SCALAR_FIELDS,
	BEHAVIOUR_TAIL_FIELDS_A,
	BEHAVIOUR_TAIL_FIELDS_B,
	PARTICLE_DESCRIPTOR_FLAGS,
	deriveParticleKey,
} from '@/lib/core/particleDescription';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const str = (): FieldSchema => ({ kind: 'string' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const fixedList = (item: FieldSchema, length: number, itemLabel?: (item: unknown, index: number) => string): FieldSchema => ({
	kind: 'list',
	item,
	addable: false,
	removable: false,
	minLength: length,
	maxLength: length,
	itemLabel: itemLabel ? (it, index) => itemLabel(it, index) : undefined,
});

const descriptorFlags = (): FieldSchema => ({
	kind: 'flags',
	storage: 'u32',
	bits: PARTICLE_DESCRIPTOR_FLAGS.map((f) => ({ mask: f.mask, label: f.label })),
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function colourLabel(c: unknown, index: number): string {
	try {
		const v = c as { r?: number; g?: number; b?: number; a?: number };
		const hx = (n?: number) => (n ?? 0).toString(16).padStart(2, '0').toUpperCase();
		return `#${index} · #${hx(v.r)}${hx(v.g)}${hx(v.b)}${hx(v.a)}`;
	} catch {
		return `#${index}`;
	}
}

function behaviourLabel(b: unknown, index: number): string {
	try {
		if (!b || typeof b !== 'object') return `#${index}`;
		const v = b as { mLifeBase?: number; mEmissionRateBase?: number };
		return `#${index} · life ${v.mLifeBase ?? '?'}s · rate ${v.mEmissionRateBase ?? '?'}/s`;
	} catch {
		return `#${index}`;
	}
}

function descriptorLabel(d: unknown, index: number): string {
	try {
		if (!d || typeof d !== 'object') return `#${index}`;
		const v = d as { name?: string | null; material?: { textureName?: string | null }; behaviours?: unknown[]; mFlags?: number };
		const name = v.name ?? '(unnamed)';
		const tex = v.material?.textureName;
		const disabled = ((v.mFlags ?? 0) & 0x8000) !== 0 ? ' · DISABLED' : '';
		return `#${index} · ${name}${tex ? ` · tex ${tex}` : ''}${disabled}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const Colour8: RecordSchema = {
	name: 'Colour8',
	description: 'Lion cColour8 — one byte per channel, R/G/B/A in disk order.',
	fields: { r: u8(), g: u8(), b: u8(), a: u8() },
	label: (value, index) => colourLabel(value, index ?? 0),
};

function buildBehaviourFields(): Record<string, FieldSchema> {
	const fields: Record<string, FieldSchema> = {};
	for (const f of BEHAVIOUR_VEC_FIELDS) fields[f] = vec4();
	fields.mColourStepsRGBAv = fixedList(vec4(), 4);
	fields.mDivisors = fixedList(f32(), 4);
	fields.mRGBA0 = record('Colour8');
	fields.mRGBA1 = record('Colour8');
	fields.mRGBABase = record('Colour8');
	fields.mRGBAVar = record('Colour8');
	fields.mColour = fixedList(record('Colour8'), 4, colourLabel);
	fields.mColourTime = fixedList(f32(), 4);
	fields.mColourStepRGBA = fixedList(record('Colour8'), 4, colourLabel);
	fields.mRGBATime = fixedList(f32(), 4);
	fields.mColourSteps = u32();
	fields.mRGBAVarianceMode = u32();
	for (const f of BEHAVIOUR_SCALAR_FIELDS) fields[f] = f32();
	fields.mEmissionCountClamp = u32();
	fields.mFlags = u32();
	fields._bvCompiled = rawBytes();
	fields.mEmissionRateHasBeenScaled = u8();
	fields.mEmissionCountClampVariance = u32();
	for (const f of BEHAVIOUR_TAIL_FIELDS_A) fields[f] = f32();
	fields.mRibbonParticleCount = u32();
	for (const f of BEHAVIOUR_TAIL_FIELDS_B) fields[f] = f32();
	fields.mAABBMin = vec4();
	fields.mAABBMax = vec4();
	return fields;
}

const ParticleBehaviour: RecordSchema = {
	name: 'ParticleBehaviour',
	description: 'One motion/colour/size program for an emitter (cParticleBehaviour). Descriptors own 1–2 of these; with 2, the runtime blends between them over the emitter\'s life. Base/Variance pairs mean "value = base ± random(variance)".',
	fields: buildBehaviourFields(),
	fieldMetadata: {
		mEmissionRateBase: { label: 'Emission rate', description: 'Particles emitted per second (base).' },
		mEmissionRateVariance: { label: 'Emission rate variance', description: 'Random spread on the emission rate (particles/second).' },
		mEmissionCountClamp: { label: 'Emission clamp', description: 'Hard cap on live particles from this behaviour; 0 = unclamped.' },
		mLifeBase: { label: 'Particle life', description: 'Seconds each particle lives (base).' },
		mLifeVariance: { label: 'Particle life variance', description: 'Random spread on particle life (seconds).' },
		mVelBase: { label: 'Velocity', description: 'Initial particle velocity (world units/second); w lane unused.' },
		mPosBase: { label: 'Spawn offset', description: 'Particle spawn position relative to the emitter locator.' },
		mScale: { label: 'Scale', description: 'Overall scale multiplier for the whole behaviour.' },
		mAlphaFadeIn: { label: 'Alpha fade-in', description: 'Fraction of particle life spent fading in (0–1).' },
		mAlphaFadeOut: { label: 'Alpha fade-out', description: 'Fraction of particle life where fade-out starts (0–1).' },
		mAlphaFadeInInv: { label: 'Fade-in cache', description: 'Precomputed 1/fadeIn — derived from mAlphaFadeIn at export; not recomputed by steward.', readOnly: true },
		mAlphaFadeOutPlusInvOneMinusAlphaFadeOut: { label: 'Fade-out cache A', description: 'Precomputed fade-out combination — derived at export; not recomputed by steward.', readOnly: true },
		mNegInvOneMinusAlphaFadeOut: { label: 'Fade-out cache B', description: 'Precomputed -1/(1-fadeOut) — derived at export; not recomputed by steward.', readOnly: true },
		mZero: { label: 'Zero', description: 'Always 0 in retail; meaning unknown.', readOnly: true },
		mFlags: { label: 'Behaviour flags', description: 'Undocumented bit set (57 distinct values in retail; the wiki has no table for it). Edit with care.' },
		mColourSteps: { label: 'Colour steps', description: 'Number of entries used in the colour ramp (0–3 in retail, max 4).' },
		mRGBAVarianceMode: { label: 'RGBA variance mode', description: '0, 1 or 2 in retail; selects how mRGBAVar is applied.' },
		mEmissionRateHasBeenScaled: { label: 'Rate-scaled flag', description: 'Runtime bool, 0 on disk in every retail behaviour.', readOnly: true },
		mRibbonParticleCount: { label: 'Ribbon particles', description: 'Particle count for eDO_RIBBON effects; 0 in every retail behaviour.' },
		mAABBMin: { label: 'AABB min', description: 'Uninitialised memory in every retail behaviour (0xCDCDCDCD junk floats) — never authored, preserved for byte-exact output.', readOnly: true },
		mAABBMax: { label: 'AABB max', description: 'Uninitialised memory in every retail behaviour — see AABB min.', readOnly: true },
		_bvCompiled: { label: 'Compiled base/variance cache', description: 'cParticleBehaviourBaseVarianceCompiled (0x180 bytes) — a compiled cache of the base/variance fields above. The game tool recompiles it; steward preserves it verbatim, so heavy base/variance edits may not take effect until the runtime recompiles.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Emission', properties: ['mEmissionRateBase', 'mEmissionRateVariance', 'mEmissionCountClamp', 'mEmissionCountClampVariance', 'mEmissionRateHasBeenScaled'] },
		{ title: 'Lifetime', properties: ['mLifeBase', 'mLifeVariance', 'mTimeScale', 'mTimeScaleVariance'] },
		{ title: 'Position & velocity', properties: ['mPosBase', 'mPosVariance', 'mVelBase', 'mVelVariance', 'mAccBase', 'mAccVariance', 'mAxisBase', 'mRingRadius', 'mRadius'] },
		{ title: 'Rotation', properties: ['mRotXYZBase', 'mRotXYZVariance', 'mRotXYZVelBase', 'mRotXYZVelVariance', 'mRotXYZAccBase', 'mRotXYZAccVariance', 'mPivotPoint'] },
		{ title: 'Offset rotation', properties: ['mOffsetRotXYZBase', 'mOffsetRotXYZVariance', 'mOffsetRotXYZVelBase', 'mOffsetRotXYZVelVariance', 'mOffsetRotXYZAccBase', 'mOffsetRotXYZAccVariance'] },
		{ title: 'Size', properties: ['mSizeBase', 'mSizeVariance', 'mSizeVelBase', 'mSizeVelVariance', 'mSizeAccBase', 'mSizeAccVariance', 'mSizeXYZBase', 'mSizeXYZVariance', 'mSizeXYZVelBase', 'mSizeXYZVelVariance', 'mSizeXYZAccBase', 'mSizeXYZAccVariance', 'mScale', 'mCellSize'] },
		{ title: 'Colour', properties: ['mRGBABase', 'mRGBAVar', 'mRGBA0', 'mRGBA1', 'mRGBADiff', 'mColour', 'mColourTime', 'mColourSteps', 'mColourStepRGBA', 'mRGBATime', 'mColourStepsRGBAv', 'mDivisors', 'mRGBAVarianceMode'] },
		{ title: 'Alpha fades', properties: ['mAlphaFadeIn', 'mAlphaFadeOut', 'mAlphaFadeInInv', 'mAlphaFadeOutPlusInvOneMinusAlphaFadeOut', 'mNegInvOneMinusAlphaFadeOut', 'mEndOnAlphaFade'] },
		{ title: 'Physics', properties: ['mMass', 'mDragFactor', 'mDragFactorVel', 'mDragFactorRot', 'mDragFactorScale', 'mCloneScaleInTime'] },
		{ title: 'Emitter weights', properties: ['mEmitterStartWeight', 'mEmitterEndWeight', 'mEmitterVelWeight', 'mEndOnScale', 'mEndOnStartAngle', 'mEndOnEndAngle'] },
		{ title: 'Internals', properties: ['mFlags', 'mZero', 'mRibbonParticleCount', 'mAABBMin', 'mAABBMax'] },
	],
	label: (value, index) => behaviourLabel(value, index ?? 0),
};

const ParticleMaterial: RecordSchema = {
	name: 'ParticleMaterial',
	description: 'Render state for an emitter (cParticleMaterial): texture/mesh NAMES (resolved at runtime — the on-disk handles are always 0), sprite-sheet frame layout, and blend/test modes. Names are looked up in the texture dictionary; "(NULL)" is placeholder text from the authoring tool, not a null pointer.',
	fields: {
		_mID: u32(),
		mMaterialHandle: u32(),
		mMeshHandle: u32(),
		mTextureHandle: u32(),
		textureName: str(),
		mNormalMapHandle: u32(),
		normalMapName: str(),
		meshName: str(),
		layerGroupName: str(),
		mFlags: u32(),
		mFrameMask: u32(),
		mFrameBase: i32(),
		mFrameVariance: i32(),
		mFrameCount: i32(),
		mXFrames: u8(),
		mYFrames: u8(),
		mBlendMode: u8(),
		mAlphaTestMode: u8(),
		mAlphaTestValue: u8(),
		mZTestMode: u8(),
		_padByte: u8(),
		mUCoordOption: u8(),
		mVCoordOption: u8(),
		mAnimTexOptions: u8(),
		mShader: u8(),
		mNormalOption: u8(),
		mLayer: u32(),
		mRibbonStretch: f32(),
		mMeshHandles: fixedList(u32(), 5),
		meshNames: fixedList(str(), 5),
		mPercentages: fixedList(u32(), 5),
		mNumMeshes: u32(),
		mNormalBlend: f32(),
		mKeyLightAmount: f32(),
		mIBLAmount: f32(),
		mZBlendDistance: f32(),
		mFPS: f32(),
		mFPSVariance: f32(),
	},
	fieldMetadata: {
		textureName: { label: 'Texture', description: 'Texture name resolved at runtime (e.g. SMOKEAGE). null = genuinely unset; "(NULL)" = authoring-tool placeholder.' },
		normalMapName: { label: 'Normal map', description: 'Normal-map texture name; null in most retail materials.' },
		meshName: { label: 'Mesh', description: 'Mesh name for mesh-emitting effects; "(NULL)" placeholder in most retail materials.' },
		layerGroupName: { label: 'Layer group', description: 'Render layer group name.' },
		mXFrames: { label: 'Frames X', description: 'Sprite-sheet columns.' },
		mYFrames: { label: 'Frames Y', description: 'Sprite-sheet rows.' },
		mFrameCount: { label: 'Frame count', description: 'Frames used from the sprite sheet.' },
		mFPS: { label: 'Animation FPS', description: 'Sprite-sheet playback rate (frames/second).' },
		mFPSVariance: { label: 'FPS variance', description: 'Random spread on the playback rate.' },
		mBlendMode: { label: 'Blend mode', description: 'Undocumented enum; retail uses 1 (alpha) and 6 (additive-like).' },
		mAlphaTestMode: { label: 'Alpha-test mode', description: 'Undocumented enum; retail uses 0, 1 and 6.' },
		mZTestMode: { label: 'Z-test mode', description: '2 in every retail material.' },
		mLayer: { label: 'Layer', description: 'Render order layer (1–24 in retail; higher draws later).' },
		mShader: { label: 'Shader', description: '0 in every retail material.' },
		mMaterialHandle: { label: 'Material handle', description: 'Runtime handle, 0 on disk.', readOnly: true },
		mMeshHandle: { label: 'Mesh handle', description: 'Runtime handle, 0 on disk.', readOnly: true },
		mTextureHandle: { label: 'Texture handle', description: 'Runtime handle, 0 on disk.', readOnly: true },
		mNormalMapHandle: { label: 'Normal-map handle', description: 'Runtime handle, 0 on disk.', readOnly: true },
		mMeshHandles: { label: 'Mesh handles', description: 'Runtime handles, all 0 on disk.', readOnly: true },
		meshNames: { label: 'Mesh names', description: 'Up to five weighted debris meshes (see percentages); all "(NULL)" placeholders in retail.' },
		mPercentages: { label: 'Mesh percentages', description: 'Selection weights for the five mesh slots; all 0 in retail.' },
		mNumMeshes: { label: 'Mesh count', description: '0 in every retail material.' },
		_mID: { label: 'mID (uninitialised)', description: 'Uninitialised memory (0xCDCDCDCD in retail) — preserved for byte-exact output.', hidden: true },
		_padByte: { label: 'pad (uninitialised)', description: 'Uninitialised pad byte (0xCD in retail) — preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Texture', properties: ['textureName', 'normalMapName', 'layerGroupName', 'mNormalOption', 'mNormalBlend'] },
		{ title: 'Sprite sheet', properties: ['mXFrames', 'mYFrames', 'mFrameCount', 'mFrameBase', 'mFrameVariance', 'mFrameMask', 'mFPS', 'mFPSVariance', 'mAnimTexOptions'] },
		{ title: 'Blending', properties: ['mBlendMode', 'mAlphaTestMode', 'mAlphaTestValue', 'mZTestMode', 'mZBlendDistance', 'mLayer'] },
		{ title: 'Lighting', properties: ['mKeyLightAmount', 'mIBLAmount'] },
		{ title: 'Meshes', properties: ['meshName', 'meshNames', 'mPercentages', 'mNumMeshes'] },
		{ title: 'Misc', properties: ['mFlags', 'mUCoordOption', 'mVCoordOption', 'mShader', 'mRibbonStretch'] },
	],
};

const ParticleDescriptor: RecordSchema = {
	name: 'ParticleDescriptor',
	description: 'One emitter of the effect (cParticleDescriptor): repeat/pause timing, emitter life, shape, flags, plus its behaviours and material. Emitters fire in chain order when the effect plays.',
	fields: {
		_mID: u32(),
		mPauseTime: f32(),
		mPauseTimeVariance: f32(),
		mRepeatTime: f32(),
		mRepeatTimeVariance: f32(),
		mEmitterLifeBase: f32(),
		mEmitterLifeVariance: f32(),
		mEmitterLifeInfiniteFlag: { kind: 'u32', min: 0, max: 1 },
		mFlags: descriptorFlags(),
		mLodGroup: u32(),
		mRenderGroup: u32(),
		mShape: u32(),
		mCollisionType: u32(),
		mBlendLast: f32(),
		name: str(),
		behaviours: {
			kind: 'list',
			item: record('ParticleBehaviour'),
			addable: false,
			removable: false,
			minLength: 1,
			maxLength: 2,
			itemLabel: (it, index) => behaviourLabel(it, index),
		},
		_runtimeBehaviourPtr: u32(),
		_tempBehaviourRaw: rawBytes(),
		material: record('ParticleMaterial'),
	},
	fieldMetadata: {
		name: { label: 'Emitter name', description: 'Authored emitter name from the string pool (e.g. GROUNDDUSTPUF). Cosmetic at runtime; null is valid.' },
		mPauseTime: { label: 'Pause time', description: 'Seconds to wait before this emitter starts (base).' },
		mRepeatTime: { label: 'Repeat time', description: 'Seconds between repeats when eDO_REPEAT is set.' },
		mEmitterLifeBase: { label: 'Emitter life', description: 'Seconds the emitter runs (base); ignored when the infinite flag is set.' },
		mEmitterLifeInfiniteFlag: { label: 'Infinite life', description: '1 = emitter never expires (57 of 141 retail descriptors).' },
		mFlags: { label: 'Flags', description: 'eParticleDescriptorFlags. Retail only authors DYNAMICPLACE, USE_MATRICES and PREFORM; eDO_DISABLED turns the emitter off.' },
		mShape: { label: 'Shape', description: 'Emitter shape enum — undocumented on the wiki; retail uses 0, 1, 3 and 4.' },
		mLodGroup: { label: 'LOD group', description: '0 in every retail descriptor.' },
		mRenderGroup: { label: 'Render group', description: '0 in every retail descriptor.' },
		mCollisionType: { label: 'Collision type', description: '0 in every retail descriptor.' },
		mBlendLast: { label: 'Blend last', description: 'Behaviour-blend position serialized mid-flight; 0 in every retail descriptor.' },
		behaviours: { label: 'Behaviours', description: 'The 1–2 motion/colour programs; with 2, the runtime blends from the first to the second over the emitter\'s life. Fixed count — the on-disk blob layout and the compiled caches make adding one require the authoring tool.' },
		material: { label: 'Material' },
		_mID: { label: 'mID (uninitialised)', description: 'Uninitialised memory (0xCDCDCDCD in retail) — preserved for byte-exact output.', hidden: true },
		_runtimeBehaviourPtr: { label: 'Stale runtime pointer', description: 'mpBehaviour — a leftover heap pointer serialized as-is; junk that varies per descriptor, preserved for byte-exact output.', hidden: true },
		_tempBehaviourRaw: { label: 'Scratch behaviour blob', description: 'Serialized mpBehaviourTemp blend buffer (0x4C0 bytes, mostly junk); present on 38 of 141 retail descriptors, preserved verbatim.', hidden: true },
	},
	propertyGroups: [
		{ title: 'Identity', properties: ['name', 'mFlags', 'mShape'] },
		{ title: 'Timing', properties: ['mPauseTime', 'mPauseTimeVariance', 'mRepeatTime', 'mRepeatTimeVariance', 'mEmitterLifeBase', 'mEmitterLifeVariance', 'mEmitterLifeInfiniteFlag'] },
		{ title: 'Content', properties: ['behaviours', 'material'] },
		{ title: 'Unused in retail', properties: ['mLodGroup', 'mRenderGroup', 'mCollisionType', 'mBlendLast'] },
	],
	label: (value, index) => descriptorLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedParticleDescription: RecordSchema = {
	name: 'ParsedParticleDescription',
	description: 'Root record for a ParticleDescription resource (0x1001D): one Lion particle effect — an emitter chain with behaviours and materials. The resource id is the FNV-1a hash of the gamedb:// URI, not a CgsID.',
	fields: {
		muHashedGDBURI: u32(),
		mKey: u32(),
		name: str(),
		mEffectHash: u32(),
		descriptors: {
			kind: 'list',
			item: record('ParticleDescriptor'),
			addable: false,
			removable: false,
			minLength: 1,
			itemLabel: (it, index) => descriptorLabel(it, index),
		},
	},
	fieldMetadata: {
		muHashedGDBURI: {
			label: 'GDB URI hash',
			description: 'FNV-1a hash of the gamedb:// URI — must equal the bundle resource id or the game cannot find the effect.',
			readOnly: true,
		},
		mKey: {
			label: 'Key',
			description: 'Lowercased first character of the name (NOT a hash, despite the wiki\'s LionHash type) — re-derived when the name changes.',
			readOnly: true,
			derivedFrom: 'name',
		},
		name: {
			label: 'Effect name',
			description: 'Authored effect name (max 31 chars, e.g. Prop_Foilage.lef). Stored as UTF-16 on disk.',
		},
		mEffectHash: {
			label: 'Effect hash',
			description: 'cLionParticleEffect.mHash — the constant 0x065F5506 in every retail resource; meaning unknown.',
			readOnly: true,
		},
		descriptors: {
			label: 'Emitters',
			description: 'The effect\'s emitter chain, in firing order. Fixed count: each entry carries a 1.2 KB behaviour blob and compiled caches steward can\'t author from scratch.',
		},
	},
	propertyGroups: [
		{ title: 'Effect', properties: ['name', 'mKey', 'muHashedGDBURI', 'mEffectHash'] },
		{ title: 'Emitters', properties: ['descriptors'] },
	],
	derive: (prev, next) => {
		if (prev.name === next.name) return {};
		return { mKey: deriveParticleKey(String(next.name ?? '')) };
	},
};

const registry: SchemaRegistry = {
	ParsedParticleDescription,
	ParticleDescriptor,
	ParticleBehaviour,
	ParticleMaterial,
	Colour8,
};

export const particleDescriptionResourceSchema: ResourceSchema = {
	key: 'particleDescription',
	name: 'Particle Description',
	rootType: 'ParsedParticleDescription',
	registry,
};
