// ICE take camera sampler tests.
//
// Pins the keyframe timing/interpolation model against real two-key takes from
// CAMERAS.BUNDLE (JumpCam2 / JumpCam10) and exercises interval bracketing + the
// per-channel slicing of the flat indices/parameters arrays with a synthetic
// three-key take. Also unit-tests the lens->FOV and Dutch->roll helpers.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseBundle } from '../../core/bundle';
import { extractResourceRaw } from '../../core/registry';
import { parseIceTakeDictionary } from '../../core/iceTakeDictionary';
import {
	packIceParameter,
	type IceTake,
	type IceElementCount,
	type IceElementRun,
} from '../../core/iceVariableData';
import { ICE_ELEMENT_DESCRIPTIONS } from '../../core/iceElementDescriptions';
import {
	buildIceCameraTrack,
	sampleIceCameraTrack,
	lensMmToFovDeg,
	dutchToRollRad,
	ICE_PREVIEW_SENSOR_MM,
} from '../iceTakeSampler';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ICE_TYPE_ID = 0x41;
const ABS = path.resolve(REPO_ROOT, 'example/CAMERAS.BUNDLE');
const PRESENT = fs.existsSync(ABS);
const maybe = PRESENT ? it : it.skip;

function loadTakeByName(name: string): IceTake {
	const buf = fs.readFileSync(ABS);
	const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	const bundle = parseBundle(buffer);
	const resource = bundle.resources.find((r) => r.resourceTypeId === ICE_TYPE_ID)!;
	const raw = extractResourceRaw(buffer, bundle, resource);
	const model = parseIceTakeDictionary(raw, true);
	const entry = model.entries.find((e) => e.take.name === name)!;
	return entry.take;
}

describe('lensMmToFovDeg', () => {
	it('24mm default lands at a normal ~46deg vertical FOV', () => {
		expect(lensMmToFovDeg(24)).toBeCloseTo(46.05, 1);
		// In the requested neutral 40-50deg band.
		expect(lensMmToFovDeg(24)).toBeGreaterThan(40);
		expect(lensMmToFovDeg(24)).toBeLessThan(50);
	});

	it('500mm is a narrow telephoto, 5mm is a wide angle', () => {
		expect(lensMmToFovDeg(500)).toBeCloseTo(2.34, 1);
		expect(lensMmToFovDeg(500)).toBeLessThan(5);
		expect(lensMmToFovDeg(5)).toBeCloseTo(127.77, 0);
		expect(lensMmToFovDeg(5)).toBeGreaterThan(100);
	});

	it('longer lens => strictly narrower FOV', () => {
		expect(lensMmToFovDeg(50)).toBeLessThan(lensMmToFovDeg(24));
	});

	it('clamps a zero/garbage lens away from div-by-zero', () => {
		const fov = lensMmToFovDeg(0);
		expect(Number.isFinite(fov)).toBe(true);
		expect(fov).toBeGreaterThan(0);
		// Negative lens clamps to the same finite minimum.
		expect(lensMmToFovDeg(-100)).toBe(lensMmToFovDeg(0));
	});

	it('honours a custom sensor height', () => {
		expect(lensMmToFovDeg(24, ICE_PREVIEW_SENSOR_MM)).toBeCloseTo(lensMmToFovDeg(24), 6);
		expect(lensMmToFovDeg(24, 36)).toBeGreaterThan(lensMmToFovDeg(24, 20.4));
	});
});

describe('dutchToRollRad', () => {
	it('reads the dutch scalar as turns (dutch * 2pi)', () => {
		expect(dutchToRollRad(0)).toBe(0);
		expect(dutchToRollRad(0.25)).toBeCloseTo(Math.PI / 2, 6);
		expect(dutchToRollRad(-0.25)).toBeCloseTo(-Math.PI / 2, 6);
		expect(dutchToRollRad(0.5)).toBeCloseTo(Math.PI, 6);
	});
});

describe('sampleIceCameraTrack — real two-key takes', () => {
	maybe('JumpCam2: t=0 hits key0 eye/look, t=1 hits key1, lens => plausible FOV, Car space', () => {
		const track = buildIceCameraTrack(loadTakeByName('JumpCam2'));

		const s0 = sampleIceCameraTrack(track, 0);
		const s1 = sampleIceCameraTrack(track, 1);

		// Decoded key0 / key1 EYE values (channel 0).
		expect(s0.eye[0]).toBeCloseTo(-0.0019, 3);
		expect(s0.eye[1]).toBeCloseTo(1.178, 3);
		expect(s0.eye[2]).toBeCloseTo(-3.7581, 3);
		expect(s1.eye[0]).toBeCloseTo(-0.0016, 3);
		expect(s1.eye[1]).toBeCloseTo(1.681, 3);
		expect(s1.eye[2]).toBeCloseTo(-4.5731, 3);

		// Decoded key0 / key1 LOOK values.
		expect(s0.look[0]).toBeCloseTo(-0.0072, 3);
		expect(s0.look[1]).toBeCloseTo(-0.9742, 3);
		expect(s0.look[2]).toBeCloseTo(5.4077, 3);
		expect(s1.look[0]).toBeCloseTo(-0.008, 3);
		expect(s1.look[1]).toBeCloseTo(-1.1668, 3);
		expect(s1.look[2]).toBeCloseTo(4.4207, 3);

		// Lens 10.7mm -> 9.75mm: both wide, FOV in a plausible range.
		expect(s0.lensMm).toBeCloseTo(10.7, 1);
		expect(s1.lensMm).toBeCloseTo(9.75, 1);
		expect(s0.fovDeg).toBeCloseTo(87.26, 0);
		expect(s1.fovDeg).toBeCloseTo(92.58, 0);
		expect(s0.fovDeg).toBeGreaterThan(0);
		expect(s0.fovDeg).toBeLessThan(180);

		// SPACE_EYE / SPACE_LOOK token 0 == Car.
		expect(s0.spaceEye).toBe(0);
		expect(s0.spaceLook).toBe(0);
		expect(s1.spaceEye).toBe(0);

		// Dutch is ~0 here, so roll is ~0.
		expect(s0.dutchRollRad).toBeCloseTo(0, 3);
	});

	maybe('JumpCam2: midpoint eye stays within the key bounds (smooth ease)', () => {
		const track = buildIceCameraTrack(loadTakeByName('JumpCam2'));
		const mid = sampleIceCameraTrack(track, 0.5);
		// EYE_Y rises 1.178 -> 1.681; a monotonic ease keeps the midpoint between.
		expect(mid.eye[1]).toBeGreaterThan(1.178);
		expect(mid.eye[1]).toBeLessThan(1.681);
		// EYE_Z falls -3.7581 -> -4.5731.
		expect(mid.eye[2]).toBeLessThan(-3.7581);
		expect(mid.eye[2]).toBeGreaterThan(-4.5731);
	});

	maybe('JumpCam10: t=0 and t=1 hit the (identical) key eye/look; Car space', () => {
		const track = buildIceCameraTrack(loadTakeByName('JumpCam10'));
		const s0 = sampleIceCameraTrack(track, 0);
		const s1 = sampleIceCameraTrack(track, 1);

		// JumpCam10's two keys are identical, so the path is a static pose.
		expect(s0.eye[0]).toBeCloseTo(0.4427, 3);
		expect(s0.eye[1]).toBeCloseTo(0.2123, 3);
		expect(s0.eye[2]).toBeCloseTo(-0.3466, 3);
		// The two keys decode to all-but-bit-identical float32 values, so compare
		// component-wise rather than with a strict structural equal.
		for (let i = 0; i < 3; i++) expect(s1.eye[i]).toBeCloseTo(s0.eye[i], 4);

		expect(s0.look[0]).toBeCloseTo(0.3601, 3);
		expect(s0.look[1]).toBeCloseTo(0.2515, 3);
		expect(s0.look[2]).toBeCloseTo(9.0869, 3);
		for (let i = 0; i < 3; i++) expect(s1.look[i]).toBeCloseTo(s0.look[i], 4);

		expect(s0.lensMm).toBeCloseTo(18.3, 1);
		expect(s0.fovDeg).toBeCloseTo(58.27, 0);
		expect(s0.spaceEye).toBe(0);
		expect(s0.spaceLook).toBe(0);
	});
});

// --- synthetic multi-interval take (interval bracketing + per-channel slicing) --

function emptyCounts(): IceElementCount[] {
	return Array.from({ length: 12 }, () => ({ intervals: 0, keys: 0 }));
}

function run(index: number, isKey: boolean, values: number[]): IceElementRun {
	return { index, isKey, values: values.map((value) => ({ raw: 0, value })) };
}

/**
 * Hand-built take: channel 0 with 3 keys / 2 intervals. One interior boundary at
 * t=0.5 (params has length intervals-1 = 1; indices has length intervals-2 = 0).
 * EYE_X keys are 0, 10, 30 so each interval has a distinct slope; CUBIC flags off
 * so the segments are exactly linear and easy to assert.
 */
function buildSyntheticTake(): IceTake {
	const counts = emptyCounts();
	counts[0] = { intervals: 2, keys: 3 };

	const runs: IceElementRun[] = ICE_ELEMENT_DESCRIPTIONS.map((d) => {
		const isKey = d.index < 28;
		const count = d.channel === 0 ? (isKey ? 3 : 2) : 0;
		return run(d.index, isKey, Array.from({ length: count }, () => d.default));
	});

	const set = (index: number, values: number[]) => {
		const r = runs.find((x) => x.index === index)!;
		r.values = values.map((value) => ({ raw: 0, value }));
	};

	set(0, [0, 10, 30]); // EYE_X
	set(1, [1, 1, 1]); // EYE_Y
	set(2, [2, 2, 2]); // EYE_Z
	set(3, [0, 0, 0]); // LOOK_X
	set(4, [0, 0, 0]); // LOOK_Y
	set(5, [5, 5, 5]); // LOOK_Z
	set(28, [0, 0]); // CUBIC_EYE off -> linear
	set(29, [0, 0]); // CUBIC_LOOK off
	set(30, [1, 3]); // SPACE_EYE: World then Scene
	set(31, [0, 1]); // SPACE_LOOK: Car then World

	return {
		nodeBase: [0, 0],
		guid: 0,
		name: 'Synthetic',
		nameBytes: new Uint8Array(32),
		lengthSeconds: 2,
		allocated: 0,
		elementCounts: counts,
		indices: [],
		parameters: [packIceParameter(0.5)], // single interior boundary at t=0.5
		alignPadBytes: 0,
		runs,
	};
}

describe('sampleIceCameraTrack — synthetic 3-key / 2-interval take', () => {
	const track = buildIceCameraTrack(buildSyntheticTake());

	it('brackets the two intervals at the 0.5 boundary', () => {
		// The boundary is stored as a packed u16, so packIceParameter(0.5) quantizes
		// to 32767/65535 ~= 0.49999, not exactly 0.5; assert to ~3 decimals.
		// Interval 0 spans [0, ~0.5]: EYE_X 0 -> 10.
		expect(sampleIceCameraTrack(track, 0).eye[0]).toBeCloseTo(0, 6);
		expect(sampleIceCameraTrack(track, 0.25).eye[0]).toBeCloseTo(5, 3);
		// Just below the boundary is still interval 0 (approaching key1 = 10).
		expect(sampleIceCameraTrack(track, 0.4999).eye[0]).toBeCloseTo(10, 2);
		// Interval 1 spans [~0.5, 1]: EYE_X 10 -> 30.
		expect(sampleIceCameraTrack(track, 0.5).eye[0]).toBeCloseTo(10, 2);
		expect(sampleIceCameraTrack(track, 0.75).eye[0]).toBeCloseTo(20, 2);
		expect(sampleIceCameraTrack(track, 1).eye[0]).toBeCloseTo(30, 6);
	});

	it('steps the per-interval SPACE tokens (no interpolation)', () => {
		const a = sampleIceCameraTrack(track, 0.25);
		const b = sampleIceCameraTrack(track, 0.75);
		// Interval 0 tokens.
		expect(a.spaceEye).toBe(1); // World
		expect(a.spaceLook).toBe(0); // Car
		// Interval 1 tokens.
		expect(b.spaceEye).toBe(3); // Scene
		expect(b.spaceLook).toBe(1); // World
	});

	it('clamps out-of-range t to the path endpoints', () => {
		expect(sampleIceCameraTrack(track, -1).eye[0]).toBeCloseTo(0, 6);
		expect(sampleIceCameraTrack(track, 2).eye[0]).toBeCloseTo(30, 6);
	});
});

describe('buildIceCameraTrack — empty-channel fallback', () => {
	it('falls back to element defaults when a take stores no channel-0 keys', () => {
		const counts = emptyCounts(); // all zero -> no keys, no intervals
		const take: IceTake = {
			nodeBase: [0, 0],
			guid: 0,
			name: 'Empty',
			nameBytes: new Uint8Array(32),
			lengthSeconds: 1,
			allocated: 0,
			elementCounts: counts,
			indices: [],
			parameters: [],
			alignPadBytes: 0,
			runs: ICE_ELEMENT_DESCRIPTIONS.map((d) => run(d.index, d.index < 28, [])),
		};
		const track = buildIceCameraTrack(take);
		const s = sampleIceCameraTrack(track, 0.5);
		// EYE defaults are (0, 5, -8); LENS default 24 -> ~46deg.
		expect(s.eye).toEqual([0, 5, -8]);
		expect(s.lensMm).toBeCloseTo(24, 6);
		expect(s.fovDeg).toBeCloseTo(46.05, 1);
		// SPACE defaults to 0 (Car).
		expect(s.spaceEye).toBe(0);
		expect(s.spaceLook).toBe(0);
	});
});
