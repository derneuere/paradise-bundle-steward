// Hand-written schema for ParsedAISections.
//
// Mirrors the types in `src/lib/core/aiSections.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here or the walker will report it as an unknown field.
//
// Layout bookkeeping fields (muSizeInBytes, the raw section-header offsets)
// are patched at write time and never round-tripped through the model, so
// they don't appear in the schema at all — the parser discards them.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';
import {
	SectionSpeed,
	AISectionFlag,
	EResetSpeedType,
} from '@/lib/core/aiSections';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const u8 = (): FieldSchema => ({ kind: 'u8' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const vec4 = (): FieldSchema => ({ kind: 'vec4' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

// Fixed-size primitive tuple (e.g., `sectionMinSpeeds: f32[5]`).
const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

// Variable-length record list with an optional item-label callback.
const recordList = (
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
// Enum / flag tables — translated from `components/aisections/constants.ts`
// ---------------------------------------------------------------------------

const SECTION_SPEED_VALUES = [
	{ value: SectionSpeed.E_SECTION_SPEED_VERY_SLOW, label: 'Very Slow' },
	{ value: SectionSpeed.E_SECTION_SPEED_SLOW, label: 'Slow' },
	{ value: SectionSpeed.E_SECTION_SPEED_NORMAL, label: 'Normal' },
	{ value: SectionSpeed.E_SECTION_SPEED_FAST, label: 'Fast' },
	{ value: SectionSpeed.E_SECTION_SPEED_VERY_FAST, label: 'Very Fast' },
];

// Bit flags use full names in the schema (expanded from the `FLAG_NAMES`
// abbreviations, which are tuned for the compact SectionsList badge grid).
const AI_SECTION_FLAG_BITS = [
	{ mask: AISectionFlag.SHORTCUT, label: 'Shortcut' },
	{ mask: AISectionFlag.NO_RESET, label: 'No Reset' },
	{ mask: AISectionFlag.IN_AIR, label: 'In Air' },
	{ mask: AISectionFlag.SPLIT, label: 'Split' },
	{ mask: AISectionFlag.JUNCTION, label: 'Junction' },
	{ mask: AISectionFlag.TERMINATOR, label: 'Terminator' },
	{ mask: AISectionFlag.AI_SHORTCUT, label: 'AI Shortcut' },
	{ mask: AISectionFlag.AI_INTERSTATE_EXIT, label: 'Interstate Exit' },
];

const RESET_SPEED_VALUES = [
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

// Convenience lookup for tree labels.
const SPEED_SHORT: Record<number, string> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: 'VSlow',
	[SectionSpeed.E_SECTION_SPEED_SLOW]: 'Slow',
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: 'Normal',
	[SectionSpeed.E_SECTION_SPEED_FAST]: 'Fast',
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: 'VFast',
};

const RESET_SHORT: Record<number, string> = Object.fromEntries(
	RESET_SPEED_VALUES.map((v) => [v.value, v.label]),
);

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function sectionLabel(sec: unknown, index: number): string {
	try {
		if (!sec || typeof sec !== 'object') return `#${index}`;
		const s = sec as { id?: number; speed?: number };
		const idHex = s.id != null ? `0x${(s.id >>> 0).toString(16).toUpperCase()}` : '?';
		const speed = s.speed != null ? (SPEED_SHORT[s.speed] ?? `${s.speed}`) : '?';
		return `#${index} · ${idHex} · ${speed}`;
	} catch {
		return `#${index}`;
	}
}

function resetPairLabel(pair: unknown, index: number): string {
	try {
		if (!pair || typeof pair !== 'object') return `#${index}`;
		const p = pair as { resetSpeed?: number; startSectionIndex?: number; resetSectionIndex?: number };
		const speed = p.resetSpeed != null ? (RESET_SHORT[p.resetSpeed] ?? `${p.resetSpeed}`) : '?';
		const start = p.startSectionIndex ?? '?';
		const reset = p.resetSectionIndex ?? '?';
		return `#${index} · ${speed} · ${start}→${reset}`;
	} catch {
		return `#${index}`;
	}
}

function portalLabel(portal: unknown, index: number): string {
	try {
		if (!portal || typeof portal !== 'object') return `Portal ${index}`;
		const p = portal as { linkSection?: number; boundaryLines?: unknown[] };
		const link = p.linkSection ?? '?';
		const bls = p.boundaryLines?.length ?? 0;
		return `Portal ${index} · →#${link}${bls > 0 ? ` · ${bls} BL` : ''}`;
	} catch {
		return `Portal ${index}`;
	}
}

function boundaryLineLabel(bl: unknown, index: number): string {
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
// Record schemas
// ---------------------------------------------------------------------------

const BoundaryLine: RecordSchema = {
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

const Portal: RecordSchema = {
	name: 'Portal',
	description: 'Connection between two AI sections — a 3D anchor point plus a list of boundary lines bounding the portal opening.',
	fields: {
		position: vec3(),
		boundaryLines: recordList('BoundaryLine', boundaryLineLabel),
		linkSection: u16(),
	},
	fieldMetadata: {
		position: {
			label: 'Position',
			description: '3D anchor point of the portal in world space (Y-up display).',
			swapYZ: true,
			// Full 3D translate: dragging the parent section on the XZ plane
			// shifts the portal anchor along with it. The gizmo passes
			// `dy = 0`, so vertical position is preserved.
			spatial: 'vec3',
		},
		linkSection: { description: 'Index of the section this portal leads to.' },
	},
	label: (value, index) => portalLabel(value, index ?? 0),
};

const AISection: RecordSchema = {
	name: 'AISection',
	description: 'One AI navigation cell — a polygon of corners on the XZ plane, with portals to neighbours, optional no-go lines, and speed/flag metadata.',
	fields: {
		portals: recordList('Portal', portalLabel),
		noGoLines: recordList('BoundaryLine', boundaryLineLabel),
		// Retail data always has exactly 4 corners per section.
		corners: fixedList(vec2(), 4),
		id: u32(),
		spanIndex: i16(),
		speed: { kind: 'enum', storage: 'u8', values: SECTION_SPEED_VALUES },
		district: u8(),
		flags: { kind: 'flags', storage: 'u8', bits: AI_SECTION_FLAG_BITS },
	},
	fieldMetadata: {
		id: {
			label: 'Section ID',
			description: 'AISectionId — typically a GameDB hash. Displayed as a decimal in default forms; editors usually show it as hex.',
		},
		spanIndex: {
			label: 'Span index',
			description: 'Signed i16. -1 means "no span".',
		},
		district: {
			label: 'District',
			description: 'u8 — always 0 in retail data. Preserved for round-trip fidelity.',
		},
		flags: { label: 'Flags' },
		corners: {
			label: 'Corners (Vector2[4])',
			description: 'Four 2D points on the XZ plane forming the section polygon. Always 4 in retail data.',
			// Each Vector2 stores `(worldX, worldZ)`. The translate walker
			// shifts every corner by the gizmo's XZ delta.
			spatial: 'vec2-xz',
		},
	},
	propertyGroups: [
		{
			title: 'Identity',
			properties: ['id', 'spanIndex', 'speed', 'district', 'flags'],
		},
		{
			title: 'Portals',
			properties: ['portals'],
		},
		{
			title: 'NoGo Lines',
			properties: ['noGoLines'],
		},
		{
			title: 'Corners',
			properties: ['corners'],
		},
		{
			// Derived view of the polygon's edges. The renderer offers a
			// right-click action to duplicate the section through any edge
			// and auto-wire a mirrored portal pair — see
			// `aiSectionsOps.duplicateSectionThroughEdge`.
			title: 'Edges',
			component: 'AISectionEdges',
		},
	],
	label: (value, index) => sectionLabel(value, index ?? 0),
};

const SectionResetPair: RecordSchema = {
	name: 'SectionResetPair',
	description: 'A mapping from a start-section to the section the AI should reset to, with a reset-speed hint.',
	fields: {
		resetSpeed: { kind: 'enum', storage: 'u32', values: RESET_SPEED_VALUES },
		startSectionIndex: u16(),
		resetSectionIndex: u16(),
	},
	fieldMetadata: {
		resetSpeed: { label: 'Reset speed' },
		startSectionIndex: { label: 'Start section' },
		resetSectionIndex: { label: 'Reset section' },
	},
	label: (value, index) => resetPairLabel(value, index ?? 0),
};

// Root-level tabs. "Overview" reuses the existing overview tab as an
// extension; the three other tabs list the root's primitive / list fields,
// which the default form already knows how to render (the `sections` and
// `sectionResetPairs` lists then fall back to their customRenderer settings).
const AI_SECTIONS_GROUPS = [
	{ title: 'Overview', component: 'AISectionsOverview' },
	{ title: 'Header', properties: ['version', 'sectionMinSpeeds', 'sectionMaxSpeeds'] },
	{ title: 'Sections', properties: ['sections'] },
	{ title: 'Reset Pairs', properties: ['sectionResetPairs'] },
];

const ParsedAISections: RecordSchema = {
	name: 'ParsedAISections',
	description: 'Root record for the AI Sections resource (0x10001) — V12 retail variant. Contains the section polygons, per-speed limits, and the reset-pair table.',
	fields: {
		// Discriminator on the runtime model — always 'v12' on this schema.
		// Hidden + read-only because it's a structural tag the parser writes
		// and the writer ignores; users have no business editing it. Listed
		// in `fields` only so the schema-coverage walker doesn't flag it as
		// an undeclared field on the parsed model (ADR-0008).
		kind: { kind: 'string' },
		version: u32(),
		sectionMinSpeeds: fixedList(f32(), 5),
		sectionMaxSpeeds: fixedList(f32(), 5),
		sections: recordList('AISection', sectionLabel, 'AISectionsList'),
		sectionResetPairs: recordList('SectionResetPair', resetPairLabel, 'AISectionsResetPairs'),
	},
	fieldMetadata: {
		kind: { hidden: true, readOnly: true },
		version: { description: 'Always 12 in retail.' },
		sectionMinSpeeds: {
			label: 'Min speeds (m/s)',
			description: 'One entry per SectionSpeed enum value (Very Slow, Slow, Normal, Fast, Very Fast).',
		},
		sectionMaxSpeeds: {
			label: 'Max speeds (m/s)',
			description: 'One entry per SectionSpeed enum value. Parallel to sectionMinSpeeds.',
		},
	},
	propertyGroups: AI_SECTIONS_GROUPS,
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedAISections,
	AISection,
	Portal,
	BoundaryLine,
	SectionResetPair,
};

export const aiSectionsResourceSchema: ResourceSchema = {
	key: 'aiSections',
	name: 'AI Sections',
	rootType: 'ParsedAISections',
	registry,
};
