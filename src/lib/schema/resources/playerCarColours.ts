// Hand-written schema for PlayerCarColours (resource type 0x1001E).
//
// Mirrors the types in `src/lib/core/playerCarColors.ts`. The on-disk format
// is BrnWorld::GlobalColourPalette: 5 fixed palettes (Gloss, Metallic,
// Pearlescent, Special, Party), each with a paint + pearl color array
// (Vector4 f32, 0.0–1.0). Components outside that range are "neon" buffer-
// overread colors documented on the wiki.
//
// Editor shape: the tree drills into palettes → paint/pearl colors, and the
// inspector shows four f32 channel inputs per color. Derived fields
// (hexValue, rgbValue, isNeon, typeName, totalColors) are preserved on the
// model for round-trip coverage but marked hidden + readOnly so they don't
// clutter the form — the user edits red/green/blue/alpha and the parser
// recomputes them on the next parse.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';

// ---------------------------------------------------------------------------
// Local field helpers
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const f32 = (): FieldSchema => ({ kind: 'f32', min: 0, max: 1 });
const str = (): FieldSchema => ({ kind: 'string' });
const bool = (): FieldSchema => ({ kind: 'bool' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });

const fixedRecordList = (type: string, length: number): FieldSchema => ({
	kind: 'list',
	item: record(type),
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

const recordList = (type: string): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	makeEmpty: () => ({
		red: 0,
		green: 0,
		blue: 0,
		alpha: 1,
		hexValue: '#000000',
		rgbValue: 'rgb(0, 0, 0)',
		isNeon: false,
	}),
});

// ---------------------------------------------------------------------------
// Enum tables — PaletteType in playerCarColors.ts
// ---------------------------------------------------------------------------

// NUM_PALETTES (5) is a sentinel, not a real palette type — excluded here.
const PALETTE_TYPE_VALUES = [
	{ value: 0, label: 'Gloss' },
	{ value: 1, label: 'Metallic' },
	{ value: 2, label: 'Pearlescent' },
	{ value: 3, label: 'Special' },
	{ value: 4, label: 'Party' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function colorLabel(value: Record<string, unknown>, index: number | null): string {
	const c = value as {
		hexValue?: string;
		isNeon?: boolean;
		red?: number;
		green?: number;
		blue?: number;
	};
	const i = index ?? 0;
	const hex = c?.hexValue ?? '?';
	const neon = c?.isNeon ? ' · Neon' : '';
	return `#${i} · ${hex}${neon}`;
}

function paletteLabel(value: Record<string, unknown>, index: number | null): string {
	const p = value as { typeName?: string; numColours?: number };
	const i = index ?? 0;
	const name = p?.typeName ?? PALETTE_TYPE_VALUES[i]?.label ?? `#${i}`;
	const count = p?.numColours ?? 0;
	return `${name} · ${count} colors`;
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const PlayerCarColor: RecordSchema = {
	name: 'PlayerCarColor',
	description: 'RGBA color as four f32 channels (0.0–1.0). Values outside that range render as "neon" buffer-overread colors.',
	fields: {
		red: f32(),
		green: f32(),
		blue: f32(),
		alpha: f32(),
		hexValue: str(),
		rgbValue: str(),
		isNeon: bool(),
	},
	fieldMetadata: {
		red: { label: 'Red', description: 'f32 channel, scaled by 255 at render time.' },
		green: { label: 'Green', description: 'f32 channel, scaled by 255 at render time.' },
		blue: { label: 'Blue', description: 'f32 channel, scaled by 255 at render time.' },
		alpha: { label: 'Alpha', description: 'f32 channel. Game ignores alpha for opaque paint.' },
		hexValue: {
			hidden: true,
			readOnly: true,
			derivedFrom: 'red,green,blue',
			description: 'Computed #RRGGBB form, refreshed by the parser.',
		},
		rgbValue: {
			hidden: true,
			readOnly: true,
			derivedFrom: 'red,green,blue',
			description: 'Computed rgb(R, G, B) form, refreshed by the parser.',
		},
		isNeon: {
			hidden: true,
			readOnly: true,
			derivedFrom: 'red,green,blue',
			description: 'True when any channel is outside [0, 1] — the "neon" overread exploit.',
		},
	},
	label: (value, index) => colorLabel(value, index),
};

const PlayerCarColourPalette: RecordSchema = {
	name: 'PlayerCarColourPalette',
	description: 'One paint-type palette. BrnWorld::PlayerCarColourPalette holds parallel paint and pearl arrays of the same length.',
	fields: {
		type: {
			kind: 'enum',
			storage: 'u8',
			values: PALETTE_TYPE_VALUES,
		},
		typeName: str(),
		numColours: i32(),
		paintColours: recordList('PlayerCarColor'),
		pearlColours: recordList('PlayerCarColor'),
	},
	fieldMetadata: {
		type: {
			label: 'Palette type',
			readOnly: true,
			description: 'Fixed by array position — palettes[0]=Gloss, [1]=Metallic, [2]=Pearlescent, [3]=Special, [4]=Party.',
		},
		typeName: {
			hidden: true,
			readOnly: true,
			derivedFrom: 'type',
			description: 'Human label for `type`, computed by the parser.',
		},
		numColours: {
			label: 'Num colours',
			readOnly: true,
			derivedFrom: 'paintColours',
			description: 'Count stored in the on-disk header. The writer requires paintColours.length === pearlColours.length === numColours; keep this in sync when editing arrays.',
		},
		paintColours: {
			label: 'Paint colours',
			description: 'Base paint color list. Parallel to pearlColours — same length required.',
		},
		pearlColours: {
			label: 'Pearl colours',
			description: 'Pearl flake color list. Parallel to paintColours — same length required.',
		},
	},
	label: (value, index) => paletteLabel(value, index),
};

const PlayerCarColours: RecordSchema = {
	name: 'PlayerCarColours',
	description: 'Root — BrnWorld::GlobalColourPalette with exactly 5 palettes.',
	fields: {
		palettes: fixedRecordList('PlayerCarColourPalette', 5),
		totalColors: u32(),
	},
	fieldMetadata: {
		palettes: {
			label: 'Palettes',
			description: 'Fixed 5-element array: Gloss, Metallic, Pearlescent, Special, Party.',
		},
		totalColors: {
			label: 'Total colours',
			readOnly: true,
			derivedFrom: 'palettes',
			description: 'Sum of paintColours.length across all palettes. Informational — recomputed by the parser.',
		},
	},
	propertyGroups: [
		{ title: 'Summary', properties: ['totalColors'] },
		{ title: 'Palettes', properties: ['palettes'] },
	],
};

// ---------------------------------------------------------------------------
// Registry + resource
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	PlayerCarColours,
	PlayerCarColourPalette,
	PlayerCarColor,
};

export const playerCarColoursResourceSchema: ResourceSchema = {
	key: 'playerCarColours',
	name: 'Player Car Colours',
	rootType: 'PlayerCarColours',
	registry,
};
