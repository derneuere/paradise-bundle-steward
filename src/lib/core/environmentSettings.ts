// EnvironmentKeyframe (0x10012) + EnvironmentTimeLine (0x10013) parsers and
// writers — the BrnWorld::EnvironmentSettings family (with EnvironmentDictionary
// / 0x10014, see environmentDictionary.ts).
//
// A "season" bundle (ENVIRONMENTSETTINGS/000_*.BUNDLE) carries one TimeLine
// plus its Keyframes. A Keyframe is a full snapshot of the environment look at
// one time of day: bloom, vignette, post-process tint (a ColourCube texture),
// atmospheric scattering (sky + in-scattering colour ramps), the eight-direction
// fill-light rig, and the two cloud layers. The TimeLine is the schedule: per
// location, an ascending list of (time-of-day seconds, keyframe) pairs the game
// interpolates between as the clock advances. Fixture sweep (4 DLC24HR bundles,
// 48 keyframes + 4 timelines): keyframe counts vary per season (8/11/12/17) and
// every timeline has exactly ONE location ("city" — see the dictionary's
// LocationData), whose entries cover all of that bundle's keyframes.
//
// Colour values are linear float RGB. Nominal range is 0–1 but fills and sky
// colours go HDR-overbright (observed max ≈ 3.5 on lighting fills, ≈ 2.19 on
// sky colours) — do not clamp to 1.
//
// Cross-resource references ride the BND2 INLINE import table at the tail of
// each resource's own payload (entries: u64 resourceId, u32 ptrOffset, u32 pad;
// the pointer-to-patch is 0 on disk):
//   - Keyframe: exactly one import — the ColourCube (0x50) patched into
//     TintData::mpColourCube at 0x80. Surfaced as mColourCubeId.
//   - TimeLine: one import per keyframe, patched into the mppKeyframes pointer
//     slots IN ORDER — so import i pairs with mpfKeyframeTimes[i]. Surfaced as
//     keyframes[i].mKeyframeId (resource ids are crc32(lowercase debug name)).
// The import table is part of the payload these writers emit, but the bundle
// envelope's ResourceEntry.importOffset/importCount are separate metadata —
// adding/removing timeline keyframes changes both, which the envelope writer
// does not currently recompute. Field edits (times, colours, retargeting an
// existing slot's id) are safe; count-changing edits need envelope support.
//
// Scope: 32-bit PC, little-endian, matching the rest of src/lib/core.
//
// Round-trip strategy: both layouts are rigid and fully derivable, so NOTHING
// is preserved verbatim — every pad, unused vector lane, pointer slot, and
// import patch-offset is asserted on parse (throwing on violations instead of
// silently mis-parsing) and regenerated on write. Byte-exactness was verified
// across every resource in all four fixture bundles.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type Vec4 = { x: number; y: number; z: number; w: number };

export type EnvironmentBloomData = {
	mfLuminance: number;
	mfThreshold: number;
	/** Per-channel bloom scale (RGB in xyz; w observed 0–1). */
	mv4Scale: Vec4;
};

export type EnvironmentVignetteData = {
	mfAngle: number;
	mfSharpness: number;
	mv2Amount: Vec2;
	mv2Centre: Vec2;
	/** Linear RGBA colour at the vignette centre. */
	mv4InnerColour: Vec4;
	/** Linear RGBA colour at the screen edges. */
	mv4OuterColour: Vec4;
};

export type EnvironmentScatteringData = {
	mv3SkyTopColour: Vec3;
	mv3SkyHorColour: Vec3;
	mv3SkySunColour: Vec3;
	mfSkyHorPow: number;
	mfSkySunPow: number;
	mfSkyDrk: number;
	mfSkyHorBleedScl: number;
	mfSkyHorBleedPow: number;
	mfSkySunBleedPow: number;
	mv3ScattTopColour: Vec3;
	mv3ScattHorColour: Vec3;
	mv3ScattSunColour: Vec3;
	mfScattHorPow: number;
	mfScattSunPow: number;
	mfScattDrk: number;
	mfScattHorBleedScl: number;
	mfScattHorBleedPow: number;
	mfScattSunBleedPow: number;
	/** Near/far in-scattering distances (world units; retail 1–2000). */
	mafScattDist: number[]; // f32[2]
	mfScattPow: number;
	mfScattCap: number;
};

export type EnvironmentLightingData = {
	mv3KeyLightColour: Vec3;
	mv3SpecularColour: Vec3;
	mv3KeyFillColour: Vec3;
	mv3ShadowFillColour: Vec3;
	mv3RightFillColour: Vec3;
	mv3LeftFillColour: Vec3;
	mv3UpFillColour: Vec3;
	mv3DownFillColour: Vec3;
	mfAmbientIrradianceScale: number;
};

export type EnvironmentCloudsData = {
	/** Sun-lit colour per cloud layer. */
	mav3LayerLiteColour: Vec3[]; // [2]
	/** Shadowed colour per cloud layer. */
	mav3LayerDarkColour: Vec3[]; // [2]
	mafLayerDensity: number[]; // f32[2]
	mafLayerFeathering: number[]; // f32[2]
	mafLayerOpacity: number[]; // f32[2]
	mafLayerSpeed: number[]; // f32[2]
	mafLayerScale: number[]; // f32[2]
	/** Cloud drift direction in degrees (retail 0–100). */
	mfDirectionAngle: number;
};

export type ParsedEnvironmentKeyframe = {
	/** Format version — 8 in retail; the parser rejects anything else. */
	muVersion: number;
	mBloomData: EnvironmentBloomData;
	mVignetteData: EnvironmentVignetteData;
	/** ColourCube (0x50) resource id from the inline import patching TintData::mpColourCube. */
	mColourCubeId: bigint;
	mScatteringData: EnvironmentScatteringData;
	mLightingData: EnvironmentLightingData;
	mCloudsData: EnvironmentCloudsData;
};

export type EnvironmentTimeLineKeyframe = {
	/** Time of day in seconds (0–86400; 4:00 AM = 14400). */
	mfTimeOfDay: number;
	/** EnvironmentKeyframe (0x10012) resource id — crc32(lowercase debug name). */
	mKeyframeId: bigint;
};

export type EnvironmentTimeLineLocation = {
	/** Ascending schedule the game interpolates through as the clock advances. */
	keyframes: EnvironmentTimeLineKeyframe[];
};

export type ParsedEnvironmentTimeLine = {
	/** Format version — 1 in retail; the parser rejects anything else. */
	muVersion: number;
	/** Every retail timeline has exactly one location ("city"). */
	locations: EnvironmentTimeLineLocation[];
};

// =============================================================================
// Constants
// =============================================================================

export const ENVIRONMENT_KEYFRAME_TYPE_ID = 0x10012;
export const ENVIRONMENT_TIME_LINE_TYPE_ID = 0x10013;

export const ENVIRONMENT_KEYFRAME_VERSION = 8;
export const ENVIRONMENT_TIME_LINE_VERSION = 1;

const KEYFRAME_STRUCT_SIZE = 0x240;
const IMPORT_ENTRY_SIZE = 0x10;
const KEYFRAME_RAW_SIZE = KEYFRAME_STRUCT_SIZE + IMPORT_ENTRY_SIZE; // 0x250
/** TintData::mpColourCube — the field the keyframe's single import patches. */
const TINT_COLOUR_CUBE_OFFSET = 0x80;

const TIMELINE_HEADER_SIZE = 0x10;
const TIMELINE_LOCATION_SIZE = 0x0c;

const align16 = (n: number) => (n + 15) & ~15;

/** Seconds → "HH:MM" (clock time of day; appends ":SS" only when non-zero). */
export function formatTimeOfDay(seconds: number): string {
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600) % 24;
	const m = Math.floor((total % 3600) / 60);
	const s = ((total % 60) + 60) % 60;
	const hm = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
	return s !== 0 ? `${hm}:${s.toString().padStart(2, '0')}` : hm;
}

// =============================================================================
// Shared helpers
// =============================================================================

// Zero checks read raw u32 bit patterns (not floats) so a -0.0 or NaN-payload
// byte in a "pad" lane can't slip past the assert and break byte-exactness.
function assertZeroWords(r: BinReader, words: number, what: string, type: string) {
	for (let i = 0; i < words; i++) {
		const v = r.readU32();
		if (v !== 0) {
			throw new Error(`${type}: ${what} has non-zero pad word 0x${v.toString(16)} — layout not as expected`);
		}
	}
}

// Vector3 occupies a full 0x10 vpu register on disk; the w lane is unused and
// 0 in all 48 retail keyframes, so it is asserted instead of preserved.
function readVec3(r: BinReader, what: string, type: string): Vec3 {
	const x = r.readF32();
	const y = r.readF32();
	const z = r.readF32();
	assertZeroWords(r, 1, `${what}.w`, type);
	return { x, y, z };
}

function readVec4(r: BinReader): Vec4 {
	return { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() };
}

// Vector2 also occupies a full 0x10 register; lanes 2–3 unused, asserted 0.
function readVec2(r: BinReader, what: string, type: string): Vec2 {
	const x = r.readF32();
	const y = r.readF32();
	assertZeroWords(r, 2, `${what}.zw`, type);
	return { x, y };
}

function writeVec3(w: BinWriter, v: Vec3) {
	w.writeF32(v.x);
	w.writeF32(v.y);
	w.writeF32(v.z);
	w.writeU32(0);
}

function writeVec4(w: BinWriter, v: Vec4) {
	w.writeF32(v.x);
	w.writeF32(v.y);
	w.writeF32(v.z);
	w.writeF32(v.w);
}

function writeVec2(w: BinWriter, v: Vec2) {
	w.writeF32(v.x);
	w.writeF32(v.y);
	w.writeU32(0);
	w.writeU32(0);
}

function readF32Pair(r: BinReader): number[] {
	return [r.readF32(), r.readF32()];
}

function assertPair(arr: number[], what: string, type: string) {
	if (arr.length !== 2) {
		throw new Error(`${type} writer: ${what} has ${arr.length} entries, the on-disk array is fixed at 2`);
	}
}

function checkOffset(actual: number, expected: number, what: string, type: string) {
	if (actual !== expected) {
		throw new Error(`${type}: ${what} at 0x${actual.toString(16)}, expected 0x${expected.toString(16)}`);
	}
}

// =============================================================================
// EnvironmentKeyframe (0x10012)
// =============================================================================

export function parseEnvironmentKeyframe(raw: Uint8Array, littleEndian = true): ParsedEnvironmentKeyframe {
	const T = 'EnvironmentKeyframe';
	if (raw.byteLength !== KEYFRAME_RAW_SIZE) {
		throw new Error(`${T}: resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${KEYFRAME_RAW_SIZE.toString(16)} (fixed struct + one import entry)`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	const muVersion = r.readU32();
	if (muVersion !== ENVIRONMENT_KEYFRAME_VERSION) {
		throw new Error(`${T}: muVersion ${muVersion}, only version ${ENVIRONMENT_KEYFRAME_VERSION} is supported`);
	}
	assertZeroWords(r, 3, 'header pad', T);

	// --- BloomData (0x10) ---
	const mfLuminance = r.readF32();
	const mfThreshold = r.readF32();
	assertZeroWords(r, 2, 'bloom pad', T);
	const mv4Scale = readVec4(r);

	// --- VignetteData (0x30) ---
	const mfAngle = r.readF32();
	const mfSharpness = r.readF32();
	assertZeroWords(r, 2, 'vignette pad', T);
	const mv2Amount = readVec2(r, 'mv2Amount', T);
	const mv2Centre = readVec2(r, 'mv2Centre', T);
	const mv4InnerColour = readVec4(r);
	const mv4OuterColour = readVec4(r);

	// --- TintData (0x80) — mpColourCube is 0 on disk, patched by the import ---
	checkOffset(r.position, TINT_COLOUR_CUBE_OFFSET, 'TintData', T);
	assertZeroWords(r, 1, 'mpColourCube on-disk pointer', T);
	assertZeroWords(r, 3, 'tint pad', T);

	// --- ScatteringData (0x90) ---
	const mv3SkyTopColour = readVec3(r, 'mv3SkyTopColour', T);
	const mv3SkyHorColour = readVec3(r, 'mv3SkyHorColour', T);
	const mv3SkySunColour = readVec3(r, 'mv3SkySunColour', T);
	const mfSkyHorPow = r.readF32();
	const mfSkySunPow = r.readF32();
	const mfSkyDrk = r.readF32();
	const mfSkyHorBleedScl = r.readF32();
	const mfSkyHorBleedPow = r.readF32();
	const mfSkySunBleedPow = r.readF32();
	assertZeroWords(r, 2, 'scattering sky pad', T);
	const mv3ScattTopColour = readVec3(r, 'mv3ScattTopColour', T);
	const mv3ScattHorColour = readVec3(r, 'mv3ScattHorColour', T);
	const mv3ScattSunColour = readVec3(r, 'mv3ScattSunColour', T);
	const mfScattHorPow = r.readF32();
	const mfScattSunPow = r.readF32();
	const mfScattDrk = r.readF32();
	const mfScattHorBleedScl = r.readF32();
	const mfScattHorBleedPow = r.readF32();
	const mfScattSunBleedPow = r.readF32();
	const mafScattDist = readF32Pair(r);
	const mfScattPow = r.readF32();
	const mfScattCap = r.readF32();
	assertZeroWords(r, 2, 'scattering tail pad', T);

	// --- LightingData (0x140) ---
	checkOffset(r.position, 0x140, 'LightingData', T);
	const mv3KeyLightColour = readVec3(r, 'mv3KeyLightColour', T);
	const mv3SpecularColour = readVec3(r, 'mv3SpecularColour', T);
	const mv3KeyFillColour = readVec3(r, 'mv3KeyFillColour', T);
	const mv3ShadowFillColour = readVec3(r, 'mv3ShadowFillColour', T);
	const mv3RightFillColour = readVec3(r, 'mv3RightFillColour', T);
	const mv3LeftFillColour = readVec3(r, 'mv3LeftFillColour', T);
	const mv3UpFillColour = readVec3(r, 'mv3UpFillColour', T);
	const mv3DownFillColour = readVec3(r, 'mv3DownFillColour', T);
	const mfAmbientIrradianceScale = r.readF32();
	assertZeroWords(r, 3, 'lighting pad', T);

	// --- CloudsData (0x1D0) ---
	checkOffset(r.position, 0x1d0, 'CloudsData', T);
	const mav3LayerLiteColour = [readVec3(r, 'mav3LayerLiteColour[0]', T), readVec3(r, 'mav3LayerLiteColour[1]', T)];
	const mav3LayerDarkColour = [readVec3(r, 'mav3LayerDarkColour[0]', T), readVec3(r, 'mav3LayerDarkColour[1]', T)];
	const mafLayerDensity = readF32Pair(r);
	const mafLayerFeathering = readF32Pair(r);
	const mafLayerOpacity = readF32Pair(r);
	const mafLayerSpeed = readF32Pair(r);
	const mafLayerScale = readF32Pair(r);
	const mfDirectionAngle = r.readF32();
	assertZeroWords(r, 1, 'clouds pad', T);

	// --- Inline import table: exactly one ColourCube entry ---
	checkOffset(r.position, KEYFRAME_STRUCT_SIZE, 'import table', T);
	const mColourCubeId = r.readU64();
	const patchOffset = r.readU32();
	if (patchOffset !== TINT_COLOUR_CUBE_OFFSET) {
		throw new Error(`${T}: import patch offset 0x${patchOffset.toString(16)}, expected 0x${TINT_COLOUR_CUBE_OFFSET.toString(16)} (mpColourCube)`);
	}
	assertZeroWords(r, 1, 'import entry pad', T);

	return {
		muVersion,
		mBloomData: { mfLuminance, mfThreshold, mv4Scale },
		mVignetteData: { mfAngle, mfSharpness, mv2Amount, mv2Centre, mv4InnerColour, mv4OuterColour },
		mColourCubeId,
		mScatteringData: {
			mv3SkyTopColour, mv3SkyHorColour, mv3SkySunColour,
			mfSkyHorPow, mfSkySunPow, mfSkyDrk, mfSkyHorBleedScl, mfSkyHorBleedPow, mfSkySunBleedPow,
			mv3ScattTopColour, mv3ScattHorColour, mv3ScattSunColour,
			mfScattHorPow, mfScattSunPow, mfScattDrk, mfScattHorBleedScl, mfScattHorBleedPow, mfScattSunBleedPow,
			mafScattDist, mfScattPow, mfScattCap,
		},
		mLightingData: {
			mv3KeyLightColour, mv3SpecularColour, mv3KeyFillColour, mv3ShadowFillColour,
			mv3RightFillColour, mv3LeftFillColour, mv3UpFillColour, mv3DownFillColour,
			mfAmbientIrradianceScale,
		},
		mCloudsData: {
			mav3LayerLiteColour, mav3LayerDarkColour,
			mafLayerDensity, mafLayerFeathering, mafLayerOpacity, mafLayerSpeed, mafLayerScale,
			mfDirectionAngle,
		},
	};
}

export function writeEnvironmentKeyframe(model: ParsedEnvironmentKeyframe, littleEndian = true): Uint8Array {
	const T = 'EnvironmentKeyframe';
	if (model.muVersion !== ENVIRONMENT_KEYFRAME_VERSION) {
		throw new Error(`${T} writer: muVersion ${model.muVersion}, only version ${ENVIRONMENT_KEYFRAME_VERSION} is supported`);
	}
	const { mBloomData: b, mVignetteData: v, mScatteringData: s, mLightingData: l, mCloudsData: c } = model;
	assertPair(s.mafScattDist, 'mafScattDist', T);
	for (const [name, arr] of [
		['mav3LayerLiteColour', c.mav3LayerLiteColour],
		['mav3LayerDarkColour', c.mav3LayerDarkColour],
		['mafLayerDensity', c.mafLayerDensity],
		['mafLayerFeathering', c.mafLayerFeathering],
		['mafLayerOpacity', c.mafLayerOpacity],
		['mafLayerSpeed', c.mafLayerSpeed],
		['mafLayerScale', c.mafLayerScale],
	] as const) {
		assertPair(arr as number[], name, T);
	}

	const w = new BinWriter(KEYFRAME_RAW_SIZE, littleEndian);
	w.writeU32(ENVIRONMENT_KEYFRAME_VERSION);
	w.writeZeroes(0xc);

	w.writeF32(b.mfLuminance);
	w.writeF32(b.mfThreshold);
	w.writeZeroes(8);
	writeVec4(w, b.mv4Scale);

	w.writeF32(v.mfAngle);
	w.writeF32(v.mfSharpness);
	w.writeZeroes(8);
	writeVec2(w, v.mv2Amount);
	writeVec2(w, v.mv2Centre);
	writeVec4(w, v.mv4InnerColour);
	writeVec4(w, v.mv4OuterColour);

	checkOffset(w.offset, TINT_COLOUR_CUBE_OFFSET, 'writer TintData', T);
	w.writeU32(0); // mpColourCube — patched at load from the import entry below
	w.writeZeroes(0xc);

	writeVec3(w, s.mv3SkyTopColour);
	writeVec3(w, s.mv3SkyHorColour);
	writeVec3(w, s.mv3SkySunColour);
	w.writeF32(s.mfSkyHorPow);
	w.writeF32(s.mfSkySunPow);
	w.writeF32(s.mfSkyDrk);
	w.writeF32(s.mfSkyHorBleedScl);
	w.writeF32(s.mfSkyHorBleedPow);
	w.writeF32(s.mfSkySunBleedPow);
	w.writeZeroes(8);
	writeVec3(w, s.mv3ScattTopColour);
	writeVec3(w, s.mv3ScattHorColour);
	writeVec3(w, s.mv3ScattSunColour);
	w.writeF32(s.mfScattHorPow);
	w.writeF32(s.mfScattSunPow);
	w.writeF32(s.mfScattDrk);
	w.writeF32(s.mfScattHorBleedScl);
	w.writeF32(s.mfScattHorBleedPow);
	w.writeF32(s.mfScattSunBleedPow);
	w.writeF32(s.mafScattDist[0]);
	w.writeF32(s.mafScattDist[1]);
	w.writeF32(s.mfScattPow);
	w.writeF32(s.mfScattCap);
	w.writeZeroes(8);

	checkOffset(w.offset, 0x140, 'writer LightingData', T);
	writeVec3(w, l.mv3KeyLightColour);
	writeVec3(w, l.mv3SpecularColour);
	writeVec3(w, l.mv3KeyFillColour);
	writeVec3(w, l.mv3ShadowFillColour);
	writeVec3(w, l.mv3RightFillColour);
	writeVec3(w, l.mv3LeftFillColour);
	writeVec3(w, l.mv3UpFillColour);
	writeVec3(w, l.mv3DownFillColour);
	w.writeF32(l.mfAmbientIrradianceScale);
	w.writeZeroes(0xc);

	checkOffset(w.offset, 0x1d0, 'writer CloudsData', T);
	writeVec3(w, c.mav3LayerLiteColour[0]);
	writeVec3(w, c.mav3LayerLiteColour[1]);
	writeVec3(w, c.mav3LayerDarkColour[0]);
	writeVec3(w, c.mav3LayerDarkColour[1]);
	for (const arr of [c.mafLayerDensity, c.mafLayerFeathering, c.mafLayerOpacity, c.mafLayerSpeed, c.mafLayerScale]) {
		w.writeF32(arr[0]);
		w.writeF32(arr[1]);
	}
	w.writeF32(c.mfDirectionAngle);
	w.writeU32(0);

	checkOffset(w.offset, KEYFRAME_STRUCT_SIZE, 'writer import table', T);
	w.writeU64(model.mColourCubeId);
	w.writeU32(TINT_COLOUR_CUBE_OFFSET);
	w.writeU32(0);

	checkOffset(w.offset, KEYFRAME_RAW_SIZE, 'writer end', T);
	return w.bytes;
}

// =============================================================================
// EnvironmentTimeLine (0x10013)
// =============================================================================

// Canonical layout (every fixture matches; the parser THROWS on any other):
//   header(0x10: version, locationCnt, mpLocationDatii=0x10, pad) →
//   LocationData[N] (0xC each: cnt, mpfKeyframeTimes, mppKeyframes, packed) →
//   per location, each segment align16 with zero gaps:
//     mppKeyframes slots (u32[cnt], 0 on disk — patched from imports) →
//     mpfKeyframeTimes (f32[cnt]) →
//   import table (cnt entries per location, patching the pointer slots in
//   order — which is what pins keyframes[i] to times[i]).
// With N=1 the bytes cannot distinguish "0xC-packed locations + align16" from
// a 0x10 location stride; the asserts below would catch a multi-location
// resource that disagrees with this reading.

type TimeLineLayout = {
	locationHeaders: { cnt: number; timesPtr: number; kfPtr: number }[];
	importOffset: number;
	totalKeyframes: number;
};

function timeLineCanonicalLayout(counts: number[]): TimeLineLayout {
	let cursor = align16(TIMELINE_HEADER_SIZE + TIMELINE_LOCATION_SIZE * counts.length);
	const locationHeaders = counts.map((cnt) => {
		const kfPtr = cursor;
		cursor = align16(kfPtr + 4 * cnt);
		const timesPtr = cursor;
		cursor = align16(timesPtr + 4 * cnt);
		return { cnt, timesPtr, kfPtr };
	});
	return {
		locationHeaders,
		importOffset: cursor,
		totalKeyframes: counts.reduce((a, b) => a + b, 0),
	};
}

export function parseEnvironmentTimeLine(raw: Uint8Array, littleEndian = true): ParsedEnvironmentTimeLine {
	const T = 'EnvironmentTimeLine';
	if (raw.byteLength < TIMELINE_HEADER_SIZE) {
		throw new Error(`${T}: resource is ${raw.byteLength} bytes, smaller than the 0x10 header`);
	}
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	const muVersion = r.readU32();
	if (muVersion !== ENVIRONMENT_TIME_LINE_VERSION) {
		throw new Error(`${T}: muVersion ${muVersion}, only version ${ENVIRONMENT_TIME_LINE_VERSION} is supported`);
	}
	const locationCnt = r.readU32();
	const mpLocationDatii = r.readU32();
	checkOffset(mpLocationDatii, TIMELINE_HEADER_SIZE, 'mpLocationDatii', T);
	assertZeroWords(r, 1, 'header pad', T);

	const stored: { cnt: number; timesPtr: number; kfPtr: number }[] = [];
	for (let i = 0; i < locationCnt; i++) {
		const cnt = r.readU32();
		const timesPtr = r.readU32();
		const kfPtr = r.readU32();
		stored.push({ cnt, timesPtr, kfPtr });
	}

	const layout = timeLineCanonicalLayout(stored.map((h) => h.cnt));
	if (raw.byteLength !== layout.importOffset + layout.totalKeyframes * IMPORT_ENTRY_SIZE) {
		throw new Error(`${T}: resource is 0x${raw.byteLength.toString(16)} bytes, expected 0x${(layout.importOffset + layout.totalKeyframes * IMPORT_ENTRY_SIZE).toString(16)} for ${layout.totalKeyframes} keyframes`);
	}
	for (let i = 0; i < locationCnt; i++) {
		checkOffset(stored[i].kfPtr, layout.locationHeaders[i].kfPtr, `locations[${i}].mppKeyframes`, T);
		checkOffset(stored[i].timesPtr, layout.locationHeaders[i].timesPtr, `locations[${i}].mpfKeyframeTimes`, T);
	}

	// Align gaps and pointer slots are regenerated as zero on write — assert
	// every word between the location headers and the import table that is not
	// a time value, including the slots themselves (0 on disk; the runtime
	// patches them from the imports).
	const times: number[][] = [];
	for (let i = 0; i < locationCnt; i++) {
		const h = layout.locationHeaders[i];
		const segStart = i === 0 ? TIMELINE_HEADER_SIZE + TIMELINE_LOCATION_SIZE * locationCnt : align16(layout.locationHeaders[i - 1].timesPtr + 4 * layout.locationHeaders[i - 1].cnt);
		r.position = segStart;
		assertZeroWords(r, (h.kfPtr - segStart) / 4, `pad before locations[${i}] pointer slots`, T);
		assertZeroWords(r, h.cnt, `locations[${i}] on-disk pointer slots`, T);
		assertZeroWords(r, (h.timesPtr - (h.kfPtr + 4 * h.cnt)) / 4, `pad before locations[${i}] times`, T);
		const t: number[] = [];
		for (let j = 0; j < h.cnt; j++) t.push(r.readF32());
		times.push(t);
	}
	const lastEnd = locationCnt > 0
		? layout.locationHeaders[locationCnt - 1].timesPtr + 4 * layout.locationHeaders[locationCnt - 1].cnt
		: TIMELINE_HEADER_SIZE;
	r.position = lastEnd;
	assertZeroWords(r, (layout.importOffset - lastEnd) / 4, 'pad before import table', T);

	// --- Inline import table: one keyframe id per pointer slot, in order ---
	const locations: EnvironmentTimeLineLocation[] = [];
	r.position = layout.importOffset;
	for (let i = 0; i < locationCnt; i++) {
		const h = layout.locationHeaders[i];
		const keyframes: EnvironmentTimeLineKeyframe[] = [];
		for (let j = 0; j < h.cnt; j++) {
			const mKeyframeId = r.readU64();
			const patchOffset = r.readU32();
			checkOffset(patchOffset, h.kfPtr + 4 * j, `import patch offset for locations[${i}].keyframes[${j}]`, T);
			assertZeroWords(r, 1, 'import entry pad', T);
			keyframes.push({ mfTimeOfDay: times[i][j], mKeyframeId });
		}
		locations.push({ keyframes });
	}

	return { muVersion, locations };
}

export function writeEnvironmentTimeLine(model: ParsedEnvironmentTimeLine, littleEndian = true): Uint8Array {
	const T = 'EnvironmentTimeLine';
	if (model.muVersion !== ENVIRONMENT_TIME_LINE_VERSION) {
		throw new Error(`${T} writer: muVersion ${model.muVersion}, only version ${ENVIRONMENT_TIME_LINE_VERSION} is supported`);
	}
	const layout = timeLineCanonicalLayout(model.locations.map((l) => l.keyframes.length));
	const totalSize = layout.importOffset + layout.totalKeyframes * IMPORT_ENTRY_SIZE;
	const w = new BinWriter(totalSize, littleEndian);

	w.writeU32(ENVIRONMENT_TIME_LINE_VERSION);
	w.writeU32(model.locations.length);
	w.writeU32(TIMELINE_HEADER_SIZE); // mpLocationDatii
	w.writeU32(0);
	for (const h of layout.locationHeaders) {
		w.writeU32(h.cnt);
		w.writeU32(h.timesPtr);
		w.writeU32(h.kfPtr);
	}
	for (let i = 0; i < model.locations.length; i++) {
		const h = layout.locationHeaders[i];
		while (w.offset < h.kfPtr) w.writeU8(0);
		w.writeZeroes(4 * h.cnt); // mppKeyframes slots — patched at load from imports
		while (w.offset < h.timesPtr) w.writeU8(0);
		for (const kf of model.locations[i].keyframes) w.writeF32(kf.mfTimeOfDay);
	}
	while (w.offset < layout.importOffset) w.writeU8(0);

	for (let i = 0; i < model.locations.length; i++) {
		const h = layout.locationHeaders[i];
		model.locations[i].keyframes.forEach((kf, j) => {
			w.writeU64(kf.mKeyframeId);
			w.writeU32(h.kfPtr + 4 * j);
			w.writeU32(0);
		});
	}

	checkOffset(w.offset, totalSize, 'writer end', T);
	return w.bytes;
}
