// ICE Element Descriptions — the per-build element table required to decode
// ICE take *variable data* (the keyframed camera channels inside each take of an
// ICE Take Dictionary, type 0x41).
//
// WHY this table exists as static data: the variable-data byte stream after each
// ICETakeData header has no self-describing structure. It can only be sliced if
// you know, for every one of the 48 elements, its channel, data type, and bit
// width. That schedule is NOT stored in the bundle — it is a per-build static
// table the game carries internally, so a parser must hold a copy matching the
// build it reads. Even a minor change (a reordered element, a changed bit width,
// an added token) re-slices the byte stream and corrupts the parse. See the
// burnout.wiki "ICE Element Descriptions" page for the human-readable table.
//
// The decode rules per data type are summarised on `ICEDataType` below; the
// variable-data codec that consumes this table lives in `iceVariableData.ts`.

/**
 * `ICE::eICE_DATA_TYPE`. Determines how a raw `miDataBits`-wide value pulled from
 * the bit stream is turned into a scalar:
 *
 * - `INT`   — sign-extend the `miDataBits`-bit integer to 32-bit.
 * - `UINT`  — index into `tokens`; if `index >= tokens.length` (or no tokens),
 *             the value is the index itself (unsigned 32-bit).
 * - `HASH`  — raw unsigned 32-bit value.
 * - `FIXED` — quantised fixed-point; decoded via the fixed-point quantization in
 *             `iceVariableData.ts` using `default`/`min`/`max` as floats.
 * - `FLOAT` — native-endian IEEE-754 32-bit float; `dataBits` is always 32 and
 *             the value is always byte-aligned. (Every other type is read
 *             MSB-first / big-endian bit order.)
 */
export enum ICEDataType {
	INT = 0,
	UINT = 1,
	HASH = 2,
	FIXED = 3,
	FLOAT = 4,
}

export type ICEElementDescription = {
	/** Description index 0..47. Index < 28 is a KEY element (value count =
	 *  mElementCounts[channel].mu16Keys); index >= 28 is an INTERVAL element
	 *  (value count = mElementCounts[channel].mu16Intervals). */
	index: number;
	/** `mpTag` — stable identifier string. */
	tag: string;
	/** `mpDisplayName` — editor label (may equal the tag, e.g. SHAKE_QUAT_*). */
	displayName: string;
	/** `miChannelNumber` — 0..11, the ICEChannels slot this element belongs to. */
	channel: number;
	/** `mDataType`. */
	dataType: ICEDataType;
	/** `miDataBits` — bit width of each stored value. */
	dataBits: number;
	/** `mDefault` — interpreted as float for FIXED/FLOAT, integer otherwise. */
	default: number;
	/** `mMin` — interpreted as float for FIXED/FLOAT, integer otherwise. */
	min: number;
	/** `mMax` — interpreted as float for FIXED/FLOAT, integer otherwise. */
	max: number;
	/** `mpTokens` — discreet value labels for UINT drop-downs (empty if none). */
	tokens: readonly string[];
};

/** First index that is an interval element; indices below this are key elements. */
export const ICE_FIRST_INTERVAL_ELEMENT = 28;

/** `eICE_NUM_ELEMENTS`. */
export const ICE_NUM_ELEMENTS = 48;

/** True if `index` is a key element (value count comes from mu16Keys). */
export function isIceKeyElement(index: number): boolean {
	return index < ICE_FIRST_INTERVAL_ELEMENT;
}

const NO_YES = ['No', 'Yes'] as const;
const SPACE_TOKENS = [
	'Car', 'World', 'Hybrid', 'Scene', 'Car 2', 'TrafficLight', 'Takedown',
	'Impact', 'ReverseTakedown', 'Gameplay', 'Heading', 'Bystander',
	'Heading2', 'LooseHeading',
] as const;

/**
 * The 48 ICE element descriptions, in index order. The order is load-bearing: the
 * variable-data value region is read element-by-element in this exact sequence.
 */
export const ICE_ELEMENT_DESCRIPTIONS: readonly ICEElementDescription[] = [
	{ index: 0, tag: 'EYE_X', displayName: 'Eye X', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: 0, min: -100000, max: 100000, tokens: [] },
	{ index: 1, tag: 'EYE_Y', displayName: 'Eye Y', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: 5, min: -100000, max: 100000, tokens: [] },
	{ index: 2, tag: 'EYE_Z', displayName: 'Eye Z', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: -8, min: -100000, max: 100000, tokens: [] },
	{ index: 3, tag: 'LOOK_X', displayName: 'Look X', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: 0, min: -100000, max: 100000, tokens: [] },
	{ index: 4, tag: 'LOOK_Y', displayName: 'Look Y', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: 0, min: -100000, max: 100000, tokens: [] },
	{ index: 5, tag: 'LOOK_Z', displayName: 'Look Z', channel: 0, dataType: ICEDataType.FLOAT, dataBits: 32, default: 0, min: -100000, max: 100000, tokens: [] },
	{ index: 6, tag: 'DUTCH', displayName: 'Dutch', channel: 0, dataType: ICEDataType.FIXED, dataBits: 10, default: 0, min: -0.25, max: 0.25, tokens: [] },
	{ index: 7, tag: 'TANGENT_EYE', displayName: 'Tangent Eye', channel: 0, dataType: ICEDataType.FIXED, dataBits: 6, default: 1, min: 0, max: 8, tokens: [] },
	{ index: 8, tag: 'TANGENT_LOOK', displayName: 'Tangent Look', channel: 0, dataType: ICEDataType.FIXED, dataBits: 6, default: 1, min: 0, max: 8, tokens: [] },
	{ index: 9, tag: 'LENS_LENGTH', displayName: 'Lens Length', channel: 0, dataType: ICEDataType.FIXED, dataBits: 9, default: 24, min: 5, max: 500, tokens: [] },
	{ index: 10, tag: 'CAMERA_BLEND_AMOUNT', displayName: 'Camera Blend Amount', channel: 1, dataType: ICEDataType.UINT, dataBits: 7, default: 0, min: 0, max: 100, tokens: [] },
	{ index: 11, tag: 'CAMERA_LAG_AMOUNT', displayName: 'Camera Lag Amount', channel: 1, dataType: ICEDataType.UINT, dataBits: 7, default: 0, min: 0, max: 100, tokens: [] },
	{ index: 12, tag: 'NEAR_FOCUS', displayName: 'Near Focus', channel: 2, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: 0, max: 10000, tokens: [] },
	{ index: 13, tag: 'FAR_FOCUS', displayName: 'Far Focus', channel: 2, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: 0, max: 10000, tokens: [] },
	{ index: 14, tag: 'BLUR_FALLOFF', displayName: 'Blur Falloff', channel: 2, dataType: ICEDataType.FIXED, dataBits: 7, default: 0, min: 0, max: 1, tokens: [] },
	{ index: 15, tag: 'BLUR_INTENSITY', displayName: 'Blur Intensity', channel: 2, dataType: ICEDataType.FIXED, dataBits: 7, default: 0, min: 0, max: 1, tokens: [] },
	{ index: 16, tag: 'TANGENT_RAWFOCUS', displayName: 'Tangent Focus', channel: 2, dataType: ICEDataType.FIXED, dataBits: 6, default: 1, min: 0, max: 8, tokens: [] },
	{ index: 17, tag: 'SHAKE_AMPLITUDE', displayName: 'Shake Amplitude', channel: 3, dataType: ICEDataType.FIXED, dataBits: 7, default: 0, min: 0, max: 1, tokens: [] },
	{ index: 18, tag: 'SHAKE_FREQUENCY', displayName: 'Shake Frequency', channel: 3, dataType: ICEDataType.FIXED, dataBits: 7, default: 0, min: 0, max: 1, tokens: [] },
	{ index: 19, tag: 'TIME_SCALE', displayName: 'Time Scale', channel: 4, dataType: ICEDataType.UINT, dataBits: 7, default: 100, min: 0, max: 100, tokens: [] },
	{ index: 20, tag: 'LETTERBOX', displayName: 'Letterbox', channel: 7, dataType: ICEDataType.UINT, dataBits: 7, default: 0, min: 0, max: 100, tokens: [] },
	{ index: 21, tag: 'FADE', displayName: 'Fade', channel: 8, dataType: ICEDataType.UINT, dataBits: 7, default: 0, min: 0, max: 100, tokens: [] },
	{ index: 22, tag: 'SHAKE_QUAT_X', displayName: 'SHAKE_QUAT_X', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	{ index: 23, tag: 'SHAKE_QUAT_Y', displayName: 'SHAKE_QUAT_Y', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	{ index: 24, tag: 'SHAKE_QUAT_Z', displayName: 'SHAKE_QUAT_Z', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	{ index: 25, tag: 'SHAKE_POS_X', displayName: 'SHAKE_POS_X', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	{ index: 26, tag: 'SHAKE_POS_Y', displayName: 'SHAKE_POS_Y', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	{ index: 27, tag: 'SHAKE_POS_Z', displayName: 'SHAKE_POS_Z', channel: 11, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: -1, max: 1, tokens: [] },
	// --- interval elements (index >= 28) ---
	{ index: 28, tag: 'CUBIC_EYE', displayName: 'Cubic Eye', channel: 0, dataType: ICEDataType.UINT, dataBits: 1, default: 1, min: 0, max: 1, tokens: NO_YES },
	{ index: 29, tag: 'CUBIC_LOOK', displayName: 'Cubic Look', channel: 0, dataType: ICEDataType.UINT, dataBits: 1, default: 1, min: 0, max: 1, tokens: NO_YES },
	{ index: 30, tag: 'SPACE_EYE', displayName: 'Eye Space', channel: 0, dataType: ICEDataType.UINT, dataBits: 4, default: 0, min: 0, max: 14, tokens: SPACE_TOKENS },
	{ index: 31, tag: 'SPACE_LOOK', displayName: 'Look Space', channel: 0, dataType: ICEDataType.UINT, dataBits: 4, default: 0, min: 0, max: 14, tokens: SPACE_TOKENS },
	{ index: 32, tag: 'AVATAR_EYE', displayName: 'Avatar Eye', channel: 0, dataType: ICEDataType.UINT, dataBits: 5, default: 0, min: 0, max: 31, tokens: [] },
	{ index: 33, tag: 'AVATAR_LOOK', displayName: 'Avatar Look', channel: 0, dataType: ICEDataType.UINT, dataBits: 5, default: 0, min: 0, max: 31, tokens: [] },
	{ index: 34, tag: 'CONSTRAIN_TO_CARS', displayName: 'Constrain to Cars', channel: 0, dataType: ICEDataType.UINT, dataBits: 1, default: 0, min: 0, max: 1, tokens: NO_YES },
	{ index: 35, tag: 'CONSTRAIN_TO_WORLD', displayName: 'Constrain to World', channel: 0, dataType: ICEDataType.UINT, dataBits: 1, default: 0, min: 0, max: 1, tokens: NO_YES },
	{ index: 36, tag: 'BLEND_CURVE', displayName: 'Blend Curve', channel: 1, dataType: ICEDataType.UINT, dataBits: 3, default: 0, min: 0, max: 4, tokens: ['Linear', 'Sinusoidal', 'Exponential Symmetrical', 'Exponential Out X-Cubed'] },
	{ index: 37, tag: 'INTERPOLATE_TYPE', displayName: 'Interpolate Type', channel: 1, dataType: ICEDataType.UINT, dataBits: 2, default: 0, min: 0, max: 2, tokens: ['Slerp', 'Rotate About Car'] },
	{ index: 38, tag: 'CUBIC_RAWFOCUS', displayName: 'Cubic Focus', channel: 2, dataType: ICEDataType.UINT, dataBits: 1, default: 1, min: 0, max: 1, tokens: NO_YES },
	{ index: 39, tag: 'RAWFOCUS_OVERRIDE', displayName: 'Override', channel: 2, dataType: ICEDataType.UINT, dataBits: 1, default: 0, min: 0, max: 1, tokens: NO_YES },
	// Display name "Shack Type" is a shipped typo in the game's display-name string (tag is correct).
	{ index: 40, tag: 'SHAKE_TYPE', displayName: 'Shack Type', channel: 3, dataType: ICEDataType.UINT, dataBits: 5, default: 0, min: 0, max: 6, tokens: ['None', 'Jog', 'Still', 'WalkFast', 'WalkSlow', 'Procedural'] },
	{ index: 41, tag: 'EVENT_TAG', displayName: 'Event Tag', channel: 5, dataType: ICEDataType.HASH, dataBits: 32, default: 0, min: 0, max: 0xFFFFFFFF, tokens: [] },
	{ index: 42, tag: 'OVERLAY', displayName: 'Overlay', channel: 6, dataType: ICEDataType.UINT, dataBits: 4, default: 0, min: 0, max: 15, tokens: [] },
	{ index: 43, tag: 'FADE_TO_COLOR', displayName: 'Fade to', channel: 8, dataType: ICEDataType.UINT, dataBits: 3, default: 0, min: 0, max: 5, tokens: ['Black', 'White', 'Red', 'Green', 'Blue'] },
	{ index: 44, tag: 'POSTFX_HOOK', displayName: 'PostFX Hook', channel: 9, dataType: ICEDataType.UINT, dataBits: 32, default: 0, min: 0, max: 0xFFFFFFFF, tokens: [] },
	{ index: 45, tag: 'TAKE_START', displayName: 'Take Start', channel: 10, dataType: ICEDataType.FIXED, dataBits: 16, default: 0, min: 0, max: 1, tokens: [] },
	{ index: 46, tag: 'TAKE_NUMBER', displayName: 'Take Number', channel: 10, dataType: ICEDataType.UINT, dataBits: 32, default: 0, min: 0, max: 0xFFFFFFFF, tokens: [] },
	{ index: 47, tag: 'CONTAINS_SUBTAKE', displayName: 'Contains Subtake', channel: 10, dataType: ICEDataType.UINT, dataBits: 1, default: 0, min: 0, max: 1, tokens: NO_YES },
];
