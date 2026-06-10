// Gold coverage for parseEnvironmentKeyframe / writeEnvironmentKeyframe and
// parseEnvironmentTimeLine / writeEnvironmentTimeLine.
//
// A season bundle carries MANY keyframes (8–17 across the four fixtures) but
// the auto-generated registry fixture suite only exercises the first resource
// of a type per bundle — so this suite walks ALL of them (all 17 in SUN_A),
// pins hand-verified decoded values from FOG_A's city_1800 keyframe, and pins
// the timeline↔keyframe import relationship: every timeline entry's id is a
// keyframe in the same bundle, the set covers the bundle exactly once, and
// the ascending times match the keyframes' _HHMM debug-name suffixes.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
	parseEnvironmentKeyframe,
	writeEnvironmentKeyframe,
	parseEnvironmentTimeLine,
	writeEnvironmentTimeLine,
	formatTimeOfDay,
} from '../environmentSettings';
import { parseBundle } from '../bundle';
import { parseDebugDataFromXml, findDebugResourceById } from '../bundle/debugData';
import { extractResourceRaw } from '../registry';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const KEYFRAME_TYPE_ID = 0x10012;
const TIME_LINE_TYPE_ID = 0x10013;

const FIXTURES = [
	{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_FOG_A.BUNDLE', keyframes: 11 },
	{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_JUNKYARDT.BUNDLE', keyframes: 12 },
	{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_OC_A.BUNDLE', keyframes: 8 },
	{ bundle: 'example/ENVIRONMENTSETTINGS/000_DLC24HR_SUN_A.BUNDLE', keyframes: 17 },
] as const;

type Extracted = { name: string; id: bigint; raw: Uint8Array };
type LoadedBundle = { keyframes: Extracted[]; timelines: Extracted[] };

function loadEnvBundle(bundleFile: string): LoadedBundle {
	const buf = fs.readFileSync(path.resolve(REPO_ROOT, bundleFile));
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const debugResources = typeof bundle.debugData === 'string' ? parseDebugDataFromXml(bundle.debugData) : [];
	const extract = (typeId: number): Extracted[] =>
		bundle.resources
			.filter((r) => r.resourceTypeId === typeId)
			.map((r) => ({
				name: findDebugResourceById(debugResources, r.resourceId.low.toString(16))?.name ?? '?',
				id: (BigInt(r.resourceId.high) << 32n) | BigInt(r.resourceId.low >>> 0),
				raw: extractResourceRaw(buffer, bundle, r),
			}));
	return { keyframes: extract(KEYFRAME_TYPE_ID), timelines: extract(TIME_LINE_TYPE_ID) };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** ENV_KF names end in _HHMM — the clock time the keyframe is authored for. */
function secondsFromName(name: string): number {
	const m = name.match(/_(\d{2})(\d{2})$/);
	expect(m, `keyframe name "${name}" should end in _HHMM`).not.toBeNull();
	return parseInt(m![1], 10) * 3600 + parseInt(m![2], 10) * 60;
}

describe('EnvironmentKeyframe gold values (FOG_A city_1800)', () => {
	const { keyframes } = loadEnvBundle(FIXTURES[0].bundle);
	const gold = keyframes.find((k) => k.name === 'ENV_KF_000_DLC24hr_FOG_A_city_1800')!;
	const m = parseEnvironmentKeyframe(gold.raw);

	it('decodes the header and bloom block', () => {
		expect(m.muVersion).toBe(8);
		expect(m.mBloomData.mfLuminance).toBeCloseTo(1.55667, 4);
		expect(m.mBloomData.mfThreshold).toBeCloseTo(1 / 3, 5);
		expect(m.mBloomData.mv4Scale.x).toBeCloseTo(0.824813, 5);
		expect(m.mBloomData.mv4Scale.y).toBeCloseTo(0.694311, 5);
		expect(m.mBloomData.mv4Scale.z).toBeCloseTo(0.522678, 5);
		expect(m.mBloomData.mv4Scale.w).toBe(1);
	});

	it('decodes the vignette block', () => {
		expect(m.mVignetteData.mfAngle).toBe(0);
		expect(m.mVignetteData.mfSharpness).toBeCloseTo(0.26, 5);
		expect(m.mVignetteData.mv2Amount.x).toBeCloseTo(1 / 3, 5);
		expect(m.mVignetteData.mv2Amount.y).toBeCloseTo(0.746667, 5);
		expect(m.mVignetteData.mv2Centre.x).toBe(0.5);
		expect(m.mVignetteData.mv2Centre.y).toBeCloseTo(0.463333, 5);
		expect(m.mVignetteData.mv4InnerColour).toEqual({ x: 1, y: 1, z: 1, w: 0 });
		expect(m.mVignetteData.mv4OuterColour.x).toBeCloseTo(0.603083, 5);
		expect(m.mVignetteData.mv4OuterColour.w).toBe(1);
	});

	it('surfaces the ColourCube import id (TintData pointer is 0 on disk)', () => {
		expect(m.mColourCubeId).toBe(0x7e36af9dn);
	});

	it('decodes the scattering block', () => {
		expect(m.mScatteringData.mv3SkyTopColour.x).toBeCloseTo(0.610964, 5);
		expect(m.mScatteringData.mv3SkyTopColour.y).toBeCloseTo(0.641494, 5);
		expect(m.mScatteringData.mv3SkyTopColour.z).toBeCloseTo(0.675464, 5);
		expect(m.mScatteringData.mfSkyHorPow).toBeCloseTo(1.83333, 4);
		expect(m.mScatteringData.mfSkySunPow).toBe(50);
		expect(m.mScatteringData.mfSkyDrk).toBe(0);
		expect(m.mScatteringData.mfSkyHorBleedScl).toBeCloseTo(17.87, 4);
		expect(m.mScatteringData.mv3ScattTopColour.x).toBe(0);
		expect(m.mScatteringData.mv3ScattTopColour.y).toBeCloseTo(0.1, 5);
		expect(m.mScatteringData.mv3ScattTopColour.z).toBeCloseTo(0.3, 5);
		expect(m.mScatteringData.mv3ScattSunColour).toEqual({ x: 1, y: 1, z: 1 });
		expect(m.mScatteringData.mafScattDist.length).toBe(2);
		expect(m.mScatteringData.mafScattDist[0]).toBeCloseTo(2.33333, 4);
		expect(m.mScatteringData.mafScattDist[1]).toBe(200);
		expect(m.mScatteringData.mfScattPow).toBeCloseTo(0.566667, 5);
		expect(m.mScatteringData.mfScattCap).toBeCloseTo(0.93, 5);
	});

	it('decodes the lighting rig — fills go HDR-overbright (>1)', () => {
		expect(m.mLightingData.mv3KeyLightColour.x).toBeCloseTo(0.6409, 5);
		expect(m.mLightingData.mv3KeyLightColour.y).toBeCloseTo(0.538089, 5);
		expect(m.mLightingData.mv3KeyLightColour.z).toBeCloseTo(0.446052, 5);
		// Down-fill is the proof that these are NOT 0–1-clamped colours.
		expect(m.mLightingData.mv3DownFillColour.x).toBeCloseTo(3.2032, 4);
		expect(m.mLightingData.mv3DownFillColour.y).toBeCloseTo(3.14302, 4);
		expect(m.mLightingData.mv3DownFillColour.z).toBeCloseTo(2.93973, 4);
		expect(m.mLightingData.mfAmbientIrradianceScale).toBeCloseTo(0.2, 5);
	});

	it('decodes the cloud layers', () => {
		expect(m.mCloudsData.mav3LayerLiteColour.length).toBe(2);
		expect(m.mCloudsData.mav3LayerLiteColour[0].x).toBeCloseTo(0.20385, 5);
		expect(m.mCloudsData.mav3LayerLiteColour[1]).toEqual({ x: 0, y: 0, z: 0 });
		expect(m.mCloudsData.mav3LayerDarkColour[0].x).toBeCloseTo(0.0886667, 5);
		expect(m.mCloudsData.mafLayerDensity).toEqual([0, 0]);
		expect(m.mCloudsData.mafLayerFeathering[0]).toBeCloseTo(1.1, 5);
		expect(m.mCloudsData.mafLayerOpacity[0]).toBe(0.5);
		expect(m.mCloudsData.mafLayerSpeed).toEqual([3, 6]);
		expect(m.mCloudsData.mafLayerScale[1]).toBeCloseTo(3891.11, 2);
		expect(m.mCloudsData.mfDirectionAngle).toBeCloseTo(66.6667, 3);
	});
});

describe('EnvironmentKeyframe walks all 17 resources (SUN_A)', () => {
	const { keyframes } = loadEnvBundle(FIXTURES[3].bundle);

	it('finds exactly 17 keyframes with distinct _HHMM authoring times', () => {
		expect(keyframes.length).toBe(17);
		const times = keyframes.map((k) => secondsFromName(k.name));
		expect(new Set(times).size).toBe(17);
	});

	it('parses and byte-round-trips every keyframe, each importing a ColourCube', () => {
		for (const kf of keyframes) {
			const model = parseEnvironmentKeyframe(kf.raw);
			expect(model.muVersion, kf.name).toBe(8);
			expect(model.mColourCubeId, kf.name).not.toBe(0n);
			const rewritten = writeEnvironmentKeyframe(model);
			expect(bytesEqual(rewritten, kf.raw), kf.name).toBe(true);
		}
	});
});

describe('EnvironmentTimeLine gold values (FOG_A)', () => {
	const { keyframes, timelines } = loadEnvBundle(FIXTURES[0].bundle);
	const m = parseEnvironmentTimeLine(timelines[0].raw);

	it('has one location with 11 keyframes and the pinned time schedule', () => {
		expect(m.muVersion).toBe(1);
		expect(m.locations.length).toBe(1);
		expect(m.locations[0].keyframes.map((k) => k.mfTimeOfDay)).toEqual([
			0, 14400, 21600, 32400, 39600, 43200, 46800, 54000, 64800, 75600, 82800,
		]);
	});

	it('entry 0 references the midnight keyframe by resource id', () => {
		const midnight = keyframes.find((k) => k.name === 'ENV_KF_000_DLC24hr_FOG_A_city_0000')!;
		expect(m.locations[0].keyframes[0].mKeyframeId).toBe(midnight.id);
		expect(m.locations[0].keyframes[0].mKeyframeId).toBe(0xb78c4bc1n);
	});
});

for (const fixture of FIXTURES) {
	describe(`Environment settings relationship + round-trip (${path.basename(fixture.bundle)})`, () => {
		const { keyframes, timelines } = loadEnvBundle(fixture.bundle);

		it(`has ${fixture.keyframes} keyframes and exactly one timeline`, () => {
			expect(keyframes.length).toBe(fixture.keyframes);
			expect(timelines.length).toBe(1);
		});

		it('the timeline covers every keyframe in the bundle exactly once, ascending from 00:00', () => {
			const m = parseEnvironmentTimeLine(timelines[0].raw);
			expect(m.locations.length).toBe(1);
			const entries = m.locations[0].keyframes;
			expect(entries.length).toBe(keyframes.length);
			expect(new Set(entries.map((e) => e.mKeyframeId)).size).toBe(entries.length);
			const bundleIds = new Set(keyframes.map((k) => k.id));
			for (const e of entries) expect(bundleIds.has(e.mKeyframeId)).toBe(true);
			expect(entries[0].mfTimeOfDay).toBe(0);
			for (let i = 1; i < entries.length; i++) {
				expect(entries[i].mfTimeOfDay).toBeGreaterThan(entries[i - 1].mfTimeOfDay);
			}
		});

		it("each entry's time matches its keyframe's _HHMM debug-name suffix", () => {
			const byId = new Map(keyframes.map((k) => [k.id, k.name]));
			const m = parseEnvironmentTimeLine(timelines[0].raw);
			for (const e of m.locations[0].keyframes) {
				expect(secondsFromName(byId.get(e.mKeyframeId)!)).toBe(e.mfTimeOfDay);
			}
		});

		it('round-trips every keyframe and the timeline byte-for-byte, idempotently', () => {
			for (const kf of keyframes) {
				const write1 = writeEnvironmentKeyframe(parseEnvironmentKeyframe(kf.raw));
				expect(bytesEqual(write1, kf.raw), kf.name).toBe(true);
				const write2 = writeEnvironmentKeyframe(parseEnvironmentKeyframe(write1));
				expect(bytesEqual(write2, write1), `${kf.name} idempotence`).toBe(true);
			}
			const tl1 = writeEnvironmentTimeLine(parseEnvironmentTimeLine(timelines[0].raw));
			expect(bytesEqual(tl1, timelines[0].raw)).toBe(true);
			const tl2 = writeEnvironmentTimeLine(parseEnvironmentTimeLine(tl1));
			expect(bytesEqual(tl2, tl1)).toBe(true);
		});
	});
}

describe('Environment settings rigid-layout rejections', () => {
	const { keyframes, timelines } = loadEnvBundle(FIXTURES[0].bundle);

	it('keyframe parser rejects a truncated resource', () => {
		expect(() => parseEnvironmentKeyframe(keyframes[0].raw.slice(0, 0x240))).toThrow(/0x240 bytes, expected 0x250/);
	});

	it('keyframe parser rejects an unknown version', () => {
		// extractResourceRaw can hand back a Buffer view — copy before mutating.
		const bytes = new Uint8Array(keyframes[0].raw);
		bytes[0] = 9;
		expect(() => parseEnvironmentKeyframe(bytes)).toThrow(/muVersion 9/);
	});

	it('keyframe parser rejects a non-zero pad word', () => {
		const bytes = new Uint8Array(keyframes[0].raw);
		bytes[0x84] = 1; // tint pad
		expect(() => parseEnvironmentKeyframe(bytes)).toThrow(/non-zero pad/);
	});

	it('keyframe parser rejects an import not patching mpColourCube', () => {
		const bytes = new Uint8Array(keyframes[0].raw);
		bytes[0x248] = 0x84; // patch offset 0x80 → 0x84
		expect(() => parseEnvironmentKeyframe(bytes)).toThrow(/import patch offset/);
	});

	it('keyframe writer rejects a cloud array that is not exactly 2 entries', () => {
		const m = parseEnvironmentKeyframe(keyframes[0].raw);
		const broken = { ...m, mCloudsData: { ...m.mCloudsData, mafLayerSpeed: [3, 6, 9] } };
		expect(() => writeEnvironmentKeyframe(broken)).toThrow(/mafLayerSpeed/);
	});

	it('timeline parser rejects a non-canonical location pointer', () => {
		const bytes = new Uint8Array(timelines[0].raw);
		bytes[0x18] = 0x24; // mppKeyframes 0x20 → 0x24
		expect(() => parseEnvironmentTimeLine(bytes)).toThrow(/mppKeyframes/);
	});

	it('timeline parser rejects an on-disk pointer slot that is not 0', () => {
		const bytes = new Uint8Array(timelines[0].raw);
		bytes[0x20] = 1;
		expect(() => parseEnvironmentTimeLine(bytes)).toThrow(/pointer slots/);
	});

	it('timeline parser rejects a size inconsistent with the keyframe count', () => {
		const bytes = new Uint8Array(timelines[0].raw);
		bytes[0x10] = 12; // muKeyframeCnt 11 → 12 without growing the resource
		expect(() => parseEnvironmentTimeLine(bytes)).toThrow(/expected 0x/);
	});
});

describe('formatTimeOfDay', () => {
	it('formats whole-minute clock times', () => {
		expect(formatTimeOfDay(0)).toBe('00:00');
		expect(formatTimeOfDay(14400)).toBe('04:00');
		expect(formatTimeOfDay(82800)).toBe('23:00');
		expect(formatTimeOfDay(86340)).toBe('23:59');
	});

	it('only appends seconds when non-zero', () => {
		expect(formatTimeOfDay(45)).toBe('00:00:45');
	});
});
