// Pieces shared between every AI Sections schema variant (V4, V6, V12).
//
// Local field-builder helpers and the enum/flag value tables live here so
// `v4.ts` and `v12.ts` only need to declare what is actually different
// between the layouts. The `BoundaryLine` record is also shared because
// the V4 portal-and-noGo wire shape is identical to V12's (16 bytes,
// startX/startY/endX/endY packed into a vec4).

import type {
	FieldSchema,
	RecordSchema,
	SchemaContext,
} from '../../types';
import {
	SectionSpeed,
	AISectionFlag,
	EResetSpeedType,
	LegacyDangerRating,
	LegacyAISectionFlagV4,
	LegacyAISectionFlagV6,
	LegacyEDistrict,
} from '@/lib/core/aiSections';

// ---------------------------------------------------------------------------
// Field-builder helpers — kept local to the schema folder so the wire-level
// `kind: 'u8'` / `'u32'` strings don't sprawl across the resource definition.
// ---------------------------------------------------------------------------

export const u8 = (): FieldSchema => ({ kind: 'u8' });
export const u16 = (): FieldSchema => ({ kind: 'u16' });
export const u32 = (): FieldSchema => ({ kind: 'u32' });
export const i16 = (): FieldSchema => ({ kind: 'i16' });
export const i32 = (): FieldSchema => ({ kind: 'i32' });
export const f32 = (): FieldSchema => ({ kind: 'f32' });
export const vec2 = (): FieldSchema => ({ kind: 'vec2' });
export const vec3 = (): FieldSchema => ({ kind: 'vec3' });
export const vec4 = (): FieldSchema => ({ kind: 'vec4' });
export const record = (type: string): FieldSchema => ({ kind: 'record', type });

/** Fixed-size primitive tuple — e.g. `sectionMinSpeeds: f32[5]`. */
export const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

/** Variable-length record list with an optional item-label callback. */
export const recordList = (
	type: string,
	itemLabel?: (item: unknown, index: number, ctx: SchemaContext) => string,
	customRenderer?: string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	itemLabel,
	customRenderer,
});

// ---------------------------------------------------------------------------
// Enum / flag value tables
// ---------------------------------------------------------------------------

/** V12 retail — five-step section speed enum. */
export const SECTION_SPEED_VALUES = [
	{ value: SectionSpeed.E_SECTION_SPEED_VERY_SLOW, label: 'Very Slow' },
	{ value: SectionSpeed.E_SECTION_SPEED_SLOW, label: 'Slow' },
	{ value: SectionSpeed.E_SECTION_SPEED_NORMAL, label: 'Normal' },
	{ value: SectionSpeed.E_SECTION_SPEED_FAST, label: 'Fast' },
	{ value: SectionSpeed.E_SECTION_SPEED_VERY_FAST, label: 'Very Fast' },
];

/** V12 retail — section flag bitmask. Names are the wiki labels (expanded
 *  from the abbreviated `FLAG_NAMES` used by the SectionsList badge grid). */
export const AI_SECTION_FLAG_BITS = [
	{ mask: AISectionFlag.SHORTCUT, label: 'Shortcut' },
	{ mask: AISectionFlag.NO_RESET, label: 'No Reset' },
	{ mask: AISectionFlag.IN_AIR, label: 'In Air' },
	{ mask: AISectionFlag.SPLIT, label: 'Split' },
	{ mask: AISectionFlag.JUNCTION, label: 'Junction' },
	{ mask: AISectionFlag.TERMINATOR, label: 'Terminator' },
	{ mask: AISectionFlag.AI_SHORTCUT, label: 'AI Shortcut' },
	{ mask: AISectionFlag.AI_INTERSTATE_EXIT, label: 'Interstate Exit' },
];

/** V12 retail — reset-speed enum (21 values; the wiki documents these as
 *  the canonical set used by `BrnAI::EResetSpeedType`). */
export const RESET_SPEED_VALUES = [
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_CUSTOM, label: 'Custom' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_NONE, label: 'None' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW, label: 'Slow' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_FAST, label: 'Fast' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_NORTH_FACE, label: 'Slow N' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_SOUTH_FACE, label: 'Slow S' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_EAST_FACE, label: 'Slow E' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_WEST_FACE, label: 'Slow W' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_SLOW_REVERSE, label: 'Slow Rev' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_REVERSE, label: 'Stop Rev' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_NORTH_FACE, label: 'Stop N' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_SOUTH_FACE, label: 'Stop S' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_EAST_FACE, label: 'Stop E' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_WEST_FACE, label: 'Stop W' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_NORTH_EAST_FACE, label: 'Stop NE' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_STOP_SOUTH_WEST_FACE, label: 'Stop SW' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_NONE_AND_IGNORE, label: 'None+Ign' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_WEST_AND_IGNORE, label: 'W+Ign' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE, label: 'Rev+Ign' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_REVERSE_AND_IGNORE_SLOW, label: 'RevSlow+Ign' },
	{ value: EResetSpeedType.E_RESET_SPEED_TYPE_EAST_AND_IGNORE, label: 'E+Ign' },
];

/** V4/V6 prototype — danger-rating enum (replaced by `speed` in V12). */
export const LEGACY_DANGER_RATING_VALUES = [
	{ value: LegacyDangerRating.E_DANGER_RATING_FREEWAY, label: 'Freeway' },
	{ value: LegacyDangerRating.E_DANGER_RATING_NORMAL, label: 'Normal' },
	{ value: LegacyDangerRating.E_DANGER_RATING_DANGEROUS, label: 'Dangerous' },
];

/** V4 prototype — only bit 0x01 known. The wiki documents it as a
 *  speculative "?" since no V4 build's runtime use of it has been pinned
 *  down; it correlates with V6's `IS_IN_AIR` so we label it that way with
 *  a hedged description. */
export const LEGACY_V4_FLAG_BITS = [
	{
		mask: LegacyAISectionFlagV4.UNKNOWN_BIT0,
		label: 'Bit 0 (?)',
		description: 'Sole flag bit observed in the 2006-11-13 X360 dev build. Likely the precursor to V6\'s IS_IN_AIR — exact runtime semantics not pinned down.',
	},
];

/** V6 prototype — a slightly larger flag set than V4. Surfaced here for
 *  the future V6 schema slice; unused by the V4 schema. */
export const LEGACY_V6_FLAG_BITS = [
	{ mask: LegacyAISectionFlagV6.IS_IN_AIR, label: 'In Air' },
	{ mask: LegacyAISectionFlagV6.IS_SHORTCUT, label: 'Shortcut' },
	{ mask: LegacyAISectionFlagV6.IS_JUNCTION, label: 'Junction' },
];

/** V6-only district enum. Always 0 in shipping retail data, but the wiki
 *  documents the full set seen in dev builds. Surfaced here for the V6
 *  schema slice; unused by the V4 schema. */
export const LEGACY_DISTRICT_VALUES = [
	{ value: LegacyEDistrict.E_DISTRICT_SUBURBS, label: 'Suburbs' },
	{ value: LegacyEDistrict.E_DISTRICT_INDUSTRIAL, label: 'Industrial' },
	{ value: LegacyEDistrict.E_DISTRICT_COUNTRY, label: 'Country' },
	{ value: LegacyEDistrict.E_DISTRICT_CITY, label: 'City' },
	{ value: LegacyEDistrict.E_DISTRICT_AIRPORT, label: 'Airport' },
];

// ---------------------------------------------------------------------------
// Convenience lookups for tree labels
// ---------------------------------------------------------------------------

export const SPEED_SHORT: Record<number, string> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: 'VSlow',
	[SectionSpeed.E_SECTION_SPEED_SLOW]: 'Slow',
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: 'Normal',
	[SectionSpeed.E_SECTION_SPEED_FAST]: 'Fast',
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: 'VFast',
};

export const RESET_SHORT: Record<number, string> = Object.fromEntries(
	RESET_SPEED_VALUES.map((v) => [v.value, v.label]),
);

export const DANGER_SHORT: Record<number, string> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: 'Freeway',
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: 'Normal',
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: 'Dangerous',
};

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

export function boundaryLineLabel(bl: unknown, index: number): string {
	try {
		if (!bl || typeof bl !== 'object') return `#${index}`;
		const b = bl as { verts?: { x: number; y: number; z: number; w: number } };
		const v = b.verts;
		if (!v) return `#${index}`;
		return `#${index} · (${v.x.toFixed(0)}, ${v.y.toFixed(0)}) → (${v.z.toFixed(0)}, ${v.w.toFixed(0)})`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Shared record schemas
// ---------------------------------------------------------------------------

/** Identical wire shape across V4 / V6 / V12 — 16 bytes, four floats packed
 *  as `(startX, startY, endX, endY)` into the vec4. */
export const BoundaryLine: RecordSchema = {
	name: 'BoundaryLine',
	description: 'A 2D line segment — packs (start, end) into a single vec4.',
	fields: {
		verts: vec4(),
	},
	fieldMetadata: {
		verts: {
			label: 'Verts (startX, startY, endX, endY)',
			description: 'Packs a 2D start point into (x, y) and a 2D end point into (z, w). The default vec4 editor shows them as plain xyzw — the semantics are positional, not spatial.',
			// Both endpoints live on the same XZ plane as the section's
			// corners, so a translate gizmo on the parent section shifts
			// every boundary line uniformly.
			spatial: 'segment2d-xz',
		},
	},
	label: (value, index) => boundaryLineLabel(value, index ?? 0),
};
