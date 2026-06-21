// ICE take camera sampler — turns a decoded ICE take (the keyframed camera
// channels inside an ICE Take Dictionary, resource 0x41) into a time-sampleable
// camera path for a 3D preview viewport.
//
// An ICE take stores, per channel, a set of KEY values (one per keyframe) and a
// set of INTERVAL values (one per interval, where intervals = keyframes - 1).
// Channel 0 carries the camera path we care about: eye position (EYE_X/Y/Z),
// look-at target (LOOK_X/Y/Z), a Dutch roll scalar, per-axis spline tangent
// scales, lens length, plus two per-interval reference-space tokens (SPACE_EYE /
// SPACE_LOOK) and the per-interval CUBIC_EYE / CUBIC_LOOK spline flags.
//
// TIMING MODEL: a channel's timeline is normalized to [0,1] and split into
// `intervals` intervals bracketed by keyframes. The take's flat `indices` and
// `parameters` arrays are concatenated per channel in channel order 0..11:
// channel c contributes max(intervals-2, 0) entries to `indices` (which keyframe
// each interior interval starts on) and max(intervals-1, 0) entries to
// `parameters` (the normalized boundary times between intervals). Per-channel
// base offsets are the running sum of those over channels < c.
//
// INTERPOLATION: between the two bracketing keys we ease linearly, or with a
// Hermite cubic when the interval's CUBIC flag is set (CUBIC_EYE for eye axes,
// CUBIC_LOOK for look axes). The Hermite tangents are scaled by the per-keyframe
// TANGENT_EYE / TANGENT_LOOK values; a tangent of 1 reproduces a Catmull-Rom-
// style smooth ease, and the end tangents are estimated from neighbouring keys'
// secants (falling back to the local segment secant at the ends). For the common
// two-key / one-interval take this is a smooth monotonic ease from k0 to k1 and
// the endpoints land exactly on the key values. See docs/ICEData.md and
// docs/ICEElementDescriptions.md for the channel/element layout.
//
// FIDELITY: the runtime camera additionally runs a smoothing follower over this
// path and resolves the reference-space tokens against live scene/car transforms.
// A preview therefore shows the INTENDED authored path in its own local frame,
// not a frame-perfect reproduction of what the camera does in motion.

import {
	ICE_ELEMENT_DESCRIPTIONS,
	type ICEElementDescription,
} from '../core/iceElementDescriptions';
import { unpackIceParameter, type IceTake, type IceElementRun } from '../core/iceVariableData';

// --- element indices (channel 0 camera path) -----------------------------------

const EL_EYE_X = 0;
const EL_EYE_Y = 1;
const EL_EYE_Z = 2;
const EL_LOOK_X = 3;
const EL_LOOK_Y = 4;
const EL_LOOK_Z = 5;
const EL_DUTCH = 6;
const EL_TANGENT_EYE = 7;
const EL_TANGENT_LOOK = 8;
const EL_LENS_LENGTH = 9;
const EL_CUBIC_EYE = 28;
const EL_CUBIC_LOOK = 29;
const EL_SPACE_EYE = 30;
const EL_SPACE_LOOK = 31;

/**
 * Preview film-back height in mm. The exact film-back constant the game uses is
 * not pinned, so this is a preview approximation chosen so the 24mm lens default
 * lands at a normal ~46° vertical FOV (a familiar "neutral" framing). Treat the
 * resulting FOV as indicative, not authoritative.
 */
export const ICE_PREVIEW_SENSOR_MM = 20.4;

/** Smallest lens length we evaluate, to keep the FOV math away from div-by-zero. */
const MIN_LENS_MM = 1;

export type CameraSample = {
	eye: [number, number, number];
	look: [number, number, number];
	dutchRollRad: number;
	lensMm: number;
	fovDeg: number;
	/** SPACE_EYE reference-frame token (0 = Car, 1 = World, 2 = Hybrid, 3 = Scene, ...). */
	spaceEye: number;
	/** SPACE_LOOK reference-frame token, same token space as spaceEye. */
	spaceLook: number;
};

/**
 * A single channel-0 keyed element prepared for cheap sampling: the decoded key
 * values plus the element's fallback default for when the take stored no keys.
 */
type KeyedChannel = {
	values: number[];
	fallback: number;
};

/**
 * Per-interval data needed to bracket time and pick the right pair of keys.
 * `params` has length intervals-1 (the interior boundary times); `startKeys` has
 * length intervals-2 (interior interval -> starting keyframe). `cubicEye` /
 * `cubicLook` have length `intervals` (per-interval spline flags).
 */
type IntervalTiming = {
	intervals: number;
	keys: number;
	params: number[];
	startKeys: number[];
	cubicEye: number[];
	cubicLook: number[];
	spaceEye: number[];
	spaceLook: number[];
};

export type IceCameraTrack = {
	lengthSeconds: number;
	eyeX: KeyedChannel;
	eyeY: KeyedChannel;
	eyeZ: KeyedChannel;
	lookX: KeyedChannel;
	lookY: KeyedChannel;
	lookZ: KeyedChannel;
	dutch: KeyedChannel;
	tangentEye: KeyedChannel;
	tangentLook: KeyedChannel;
	lens: KeyedChannel;
	timing: IntervalTiming;
};

// --- per-channel slicing of the flat indices/parameters arrays -----------------

/** indices entries contributed by a channel with `intervals` intervals. */
function indicesCountFor(intervals: number): number {
	return Math.max(intervals - 2, 0);
}

/** parameters entries contributed by a channel with `intervals` intervals. */
function parametersCountFor(intervals: number): number {
	return Math.max(intervals - 1, 0);
}

/** Running base offset into `indices` for channel `c`. */
function indicesBase(take: IceTake, c: number): number {
	let base = 0;
	for (let i = 0; i < c; i++) base += indicesCountFor(take.elementCounts[i].intervals);
	return base;
}

/** Running base offset into `parameters` for channel `c`. */
function parametersBase(take: IceTake, c: number): number {
	let base = 0;
	for (let i = 0; i < c; i++) base += parametersCountFor(take.elementCounts[i].intervals);
	return base;
}

// --- track build ---------------------------------------------------------------

function runValues(take: IceTake, index: number): number[] {
	const run: IceElementRun | undefined = take.runs.find((r) => r.index === index);
	return run ? run.values.map((v) => v.value) : [];
}

function defaultOf(index: number): number {
	const desc: ICEElementDescription = ICE_ELEMENT_DESCRIPTIONS[index];
	return desc.default;
}

function keyedChannel(take: IceTake, index: number): KeyedChannel {
	return { values: runValues(take, index), fallback: defaultOf(index) };
}

/**
 * Precompute the channel-0 keyed elements and the interval timing/flags so that
 * {@link sampleIceCameraTrack} does no array scanning per sample.
 */
export function buildIceCameraTrack(take: IceTake): IceCameraTrack {
	const ch0 = take.elementCounts[0];
	const intervals = ch0.intervals;
	const keys = ch0.keys;

	const pBase = parametersBase(take, 0);
	const iBase = indicesBase(take, 0);
	const pCount = parametersCountFor(intervals);
	const iCount = indicesCountFor(intervals);

	// `parameters` are stored as packed u16; unpack to normalized [0,1] boundary
	// times. `indices` are raw keyframe numbers and need no unpacking.
	const params = take.parameters.slice(pBase, pBase + pCount).map(unpackIceParameter);
	const startKeys = take.indices.slice(iBase, iBase + iCount);

	const cubicEyeRun = runValues(take, EL_CUBIC_EYE);
	const cubicLookRun = runValues(take, EL_CUBIC_LOOK);
	const spaceEyeRun = runValues(take, EL_SPACE_EYE);
	const spaceLookRun = runValues(take, EL_SPACE_LOOK);

	const fill = (run: number[], idx: number): number[] => {
		const fallback = defaultOf(idx);
		const out: number[] = [];
		for (let n = 0; n < intervals; n++) out.push(n < run.length ? run[n] : fallback);
		return out;
	};

	const timing: IntervalTiming = {
		intervals,
		keys,
		params,
		startKeys,
		cubicEye: fill(cubicEyeRun, EL_CUBIC_EYE),
		cubicLook: fill(cubicLookRun, EL_CUBIC_LOOK),
		spaceEye: fill(spaceEyeRun, EL_SPACE_EYE),
		spaceLook: fill(spaceLookRun, EL_SPACE_LOOK),
	};

	return {
		lengthSeconds: take.lengthSeconds,
		eyeX: keyedChannel(take, EL_EYE_X),
		eyeY: keyedChannel(take, EL_EYE_Y),
		eyeZ: keyedChannel(take, EL_EYE_Z),
		lookX: keyedChannel(take, EL_LOOK_X),
		lookY: keyedChannel(take, EL_LOOK_Y),
		lookZ: keyedChannel(take, EL_LOOK_Z),
		dutch: keyedChannel(take, EL_DUTCH),
		tangentEye: keyedChannel(take, EL_TANGENT_EYE),
		tangentLook: keyedChannel(take, EL_TANGENT_LOOK),
		lens: keyedChannel(take, EL_LENS_LENGTH),
		timing,
	};
}

// --- interval timing helpers ----------------------------------------------------

/** Normalized boundary time at interval boundary `n`: 0 at/below 0, 1 at/above I. */
function intervalParameter(timing: IntervalTiming, n: number): number {
	if (n <= 0) return 0;
	if (n >= timing.intervals) return 1;
	return timing.params[n - 1];
}

/** Starting keyframe index of interval `n`. */
function intervalStartKey(timing: IntervalTiming, n: number): number {
	const { intervals, keys } = timing;
	if (n === 0) return 0;
	if (n === intervals - 1) return keys - 2;
	return timing.startKeys[n - 1];
}

/** Find the interval index that normalized time `t01` falls in (last is inclusive). */
function intervalAt(timing: IntervalTiming, t01: number): number {
	const t = Math.min(1, Math.max(0, t01));
	const I = timing.intervals;
	if (I <= 1) return 0;
	for (let n = 0; n < I; n++) {
		const lo = intervalParameter(timing, n);
		const hi = intervalParameter(timing, n + 1);
		if (n === I - 1) {
			if (t >= lo) return n; // last interval is inclusive at its upper end
		} else if (t >= lo && t < hi) {
			return n;
		}
	}
	return I - 1;
}

// --- key-value sampling ---------------------------------------------------------

/** Read key `k` of a channel, clamped to range, or the channel fallback if empty. */
function keyAt(ch: KeyedChannel, k: number): number {
	if (ch.values.length === 0) return ch.fallback;
	const i = Math.min(ch.values.length - 1, Math.max(0, k));
	return ch.values[i];
}

/**
 * Hermite (cubic) interpolation between p0 and p1 over local u in [0,1] with end
 * tangents m0, m1 (tangents already expressed in value-per-unit-u). The endpoints
 * are reproduced exactly (basis h00(0)=1, h10/h01/h11 vanish at 0; symmetric at 1).
 */
function hermite(p0: number, p1: number, m0: number, m1: number, u: number): number {
	const u2 = u * u;
	const u3 = u2 * u;
	const h00 = 2 * u3 - 3 * u2 + 1;
	const h10 = u3 - 2 * u2 + u;
	const h01 = -2 * u3 + 3 * u2;
	const h11 = u3 - u2;
	return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

/**
 * Sample a channel value at normalized time `t01`. `cubic` selects Hermite vs
 * linear; `tangentScale` (from TANGENT_EYE/TANGENT_LOOK at the bracketing keys)
 * scales the Hermite tangents. Tangents are secant-based: interior keys use the
 * centered neighbour secant, ends use the local segment secant — so a tangent
 * scale of 1 gives a Catmull-Rom-style smooth ease with exact endpoints.
 */
function sampleKeyChannel(
	ch: KeyedChannel,
	timing: IntervalTiming,
	t01: number,
	cubicFlags: number[],
	tangent: KeyedChannel,
): number {
	if (ch.values.length <= 1) return keyAt(ch, 0);

	const t = Math.min(1, Math.max(0, t01));
	const n = intervalAt(timing, t);
	const lo = intervalParameter(timing, n);
	const hi = intervalParameter(timing, n + 1);
	const span = hi - lo;
	const u = span > 0 ? (t - lo) / span : 0;

	const k0 = intervalStartKey(timing, n);
	const k1 = k0 + 1;
	const p0 = keyAt(ch, k0);
	const p1 = keyAt(ch, k1);

	const cubic = (n < cubicFlags.length ? cubicFlags[n] : 0) !== 0;
	if (!cubic) return p0 + (p1 - p0) * u;

	// Secant tangents (centered for interior keys, one-sided at the ends), scaled
	// by the per-key authored tangent value. A scale of 1 reproduces Catmull-Rom.
	const prev = keyAt(ch, k0 - 1);
	const next = keyAt(ch, k1 + 1);
	const seg = p1 - p0;
	const m0Raw = k0 > 0 ? (p1 - prev) / 2 : seg;
	const m1Raw = k1 < ch.values.length - 1 ? (next - p0) / 2 : seg;
	const m0 = m0Raw * keyAt(tangent, k0);
	const m1 = m1Raw * keyAt(tangent, k1);
	return hermite(p0, p1, m0, m1, u);
}

/** Step (no interpolation) sample of a per-interval value at `t01`. */
function sampleIntervalValue(timing: IntervalTiming, t01: number, values: number[]): number {
	const n = intervalAt(timing, t01);
	return n < values.length ? values[n] : 0;
}

// --- public API -----------------------------------------------------------------

/**
 * Vertical FOV in degrees for a lens length, via the thin-lens relation
 * vFOV = 2*atan(sensor/(2*lens)). `lensMm` is clamped to a small positive
 * minimum so a zero/garbage lens can't produce a div-by-zero or NaN.
 */
export function lensMmToFovDeg(lensMm: number, sensorMm: number = ICE_PREVIEW_SENSOR_MM): number {
	const lens = Math.max(MIN_LENS_MM, lensMm);
	return (2 * Math.atan(sensorMm / (2 * lens)) * 180) / Math.PI;
}

/**
 * Map the DUTCH scalar to a roll angle in radians. The authored range is ±0.25;
 * we read it as turns (revolutions) so dutch -> dutch * 2π. Positive roll is a
 * right-handed rotation about the view forward axis (eye -> look); the consumer
 * applies the sign that matches its handedness.
 */
export function dutchToRollRad(dutch: number): number {
	return dutch * 2 * Math.PI;
}

/** Sample the camera path at normalized time `t01` (clamped to [0,1]). */
export function sampleIceCameraTrack(track: IceCameraTrack, t01: number): CameraSample {
	const t = Math.min(1, Math.max(0, t01));
	const { timing } = track;

	const eye: [number, number, number] = [
		sampleKeyChannel(track.eyeX, timing, t, timing.cubicEye, track.tangentEye),
		sampleKeyChannel(track.eyeY, timing, t, timing.cubicEye, track.tangentEye),
		sampleKeyChannel(track.eyeZ, timing, t, timing.cubicEye, track.tangentEye),
	];
	const look: [number, number, number] = [
		sampleKeyChannel(track.lookX, timing, t, timing.cubicLook, track.tangentLook),
		sampleKeyChannel(track.lookY, timing, t, timing.cubicLook, track.tangentLook),
		sampleKeyChannel(track.lookZ, timing, t, timing.cubicLook, track.tangentLook),
	];

	// DUTCH and LENS are keyed channels but author intent is a smooth blend, so we
	// reuse the look spline flags for their easing (channel-0 keys share timing).
	const dutch = sampleKeyChannel(track.dutch, timing, t, timing.cubicLook, track.tangentLook);
	const lensMm = sampleKeyChannel(track.lens, timing, t, timing.cubicLook, track.tangentLook);

	return {
		eye,
		look,
		dutchRollRad: dutchToRollRad(dutch),
		lensMm,
		fovDeg: lensMmToFovDeg(lensMm),
		spaceEye: sampleIntervalValue(timing, t, timing.spaceEye),
		spaceLook: sampleIntervalValue(timing, t, timing.spaceLook),
	};
}
