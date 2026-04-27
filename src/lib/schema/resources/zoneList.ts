// Hand-written schema for ParsedZoneList (resource type 0xB000).
//
// Mirrors the types in `src/lib/core/zoneList.ts`. Keep these in lockstep
// with the parser/writer — any field added to the parser needs a matching
// entry here, or the schema walker will report it as an unknown field.
//
// Layout note: each on-disk Vec2 is padded to 16 bytes for SIMD alignment.
// We expose `_padA / _padB` in the schema so byte-exact round-trip survives
// even when the user edits the model through the form renderer; in practice
// both are zero on every retail / prototype fixture.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaContext,
	SchemaRegistry,
} from '../types';
import { NEIGHBOUR_FLAGS } from '@/lib/core/zoneList';

// ---------------------------------------------------------------------------
// Local helpers (mirroring aiSections.ts)
// ---------------------------------------------------------------------------

const u32 = (): FieldSchema => ({ kind: 'u32' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const f32 = (): FieldSchema => ({ kind: 'f32' });
const u64Hex = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
// Raw byte buffer used for round-trip-only preservation fields. The schema
// declares them via `custom` so the walker doesn't flag them as drift; the
// default form renderer hides custom fields without a registered component,
// which is fine — users shouldn't edit these directly.
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const fixedList = (item: FieldSchema, length: number): FieldSchema => ({
	kind: 'list',
	item,
	minLength: length,
	maxLength: length,
	addable: false,
	removable: false,
});

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
// Enum / flag tables
// ---------------------------------------------------------------------------

const NEIGHBOUR_FLAG_BITS = [
	{ mask: NEIGHBOUR_FLAGS.RENDER, label: 'Render' },
	{ mask: NEIGHBOUR_FLAGS.IMMEDIATE, label: 'Immediate' },
];

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function zoneLabel(zone: unknown, index: number): string {
	try {
		if (!zone || typeof zone !== 'object') return `#${index}`;
		const z = zone as { muZoneId?: bigint; miZoneType?: number; safeNeighbours?: unknown[]; unsafeNeighbours?: unknown[] };
		const idHex = z.muZoneId != null ? `0x${z.muZoneId.toString(16).toUpperCase()}` : '?';
		const safe = z.safeNeighbours?.length ?? 0;
		const unsafe = z.unsafeNeighbours?.length ?? 0;
		return `#${index} · ${idHex} · ${safe}s/${unsafe}u`;
	} catch {
		return `#${index}`;
	}
}

function neighbourLabel(n: unknown, index: number): string {
	try {
		if (!n || typeof n !== 'object') return `#${index}`;
		const nn = n as { zoneIndex?: number; muFlags?: number };
		const target = nn.zoneIndex != null && nn.zoneIndex >= 0 ? `→#${nn.zoneIndex}` : '→?';
		const flags: string[] = [];
		if ((nn.muFlags ?? 0) & NEIGHBOUR_FLAGS.RENDER) flags.push('R');
		if ((nn.muFlags ?? 0) & NEIGHBOUR_FLAGS.IMMEDIATE) flags.push('I');
		const flagStr = flags.length > 0 ? ` [${flags.join('')}]` : '';
		return `#${index} ${target}${flagStr}`;
	} catch {
		return `#${index}`;
	}
}

function pointLabel(p: unknown, index: number): string {
	try {
		if (!p || typeof p !== 'object') return `#${index}`;
		const pp = p as { x?: number; y?: number };
		const x = pp.x != null ? pp.x.toFixed(1) : '?';
		const y = pp.y != null ? pp.y.toFixed(1) : '?';
		return `#${index} (${x}, ${y})`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const Vec2Padded: RecordSchema = {
	name: 'Vec2Padded',
	description: 'On-disk Vector2 padded to 16 bytes for SIMD alignment. (x, y) carry the position on the XZ plane; the trailing _padA / _padB are preserved verbatim for byte-exact round-trip and are zero in every observed fixture.',
	fields: {
		x: f32(),
		y: f32(),
		_padA: f32(),
		_padB: f32(),
	},
	fieldMetadata: {
		x: { label: 'X' },
		y: { label: 'Y (= world Z on the map)' },
		_padA: {
			label: 'pad A',
			description: 'Trailing SIMD-alignment pad. Zero in every retail / prototype fixture; preserved verbatim for byte-exact round-trip.',
		},
		_padB: { label: 'pad B' },
	},
	label: (value, index) => pointLabel(value, index ?? 0),
};

const Neighbour: RecordSchema = {
	name: 'Neighbour',
	description: 'A reference to a sibling zone with streaming flags. The on-disk pointer to the target zone is resolved to an integer index at parse time; the writer recomputes the pointer.',
	fields: {
		zoneIndex: { kind: 'i32' },
		muFlags: { kind: 'flags', storage: 'u32', bits: NEIGHBOUR_FLAG_BITS },
		_padA: u32(),
		_padB: u32(),
	},
	fieldMetadata: {
		zoneIndex: {
			label: 'Target zone',
			description: 'Index into the parent ZoneList.zones array. -1 means the on-disk pointer was zero (orphan).',
		},
		muFlags: {
			label: 'Flags',
			description: 'RENDER = streaming should keep this neighbour resident. IMMEDIATE = must be fully loaded before transit (typically zones a few seconds ahead at top speed).',
		},
		_padA: {
			label: 'pad A',
			description: 'Trailing 8-byte pad on the on-disk Neighbour record (two u32 slots). Preserved verbatim for byte-exact round-trip.',
		},
		_padB: { label: 'pad B' },
	},
	label: (value, index) => neighbourLabel(value, index ?? 0),
};

const Zone: RecordSchema = {
	name: 'Zone',
	description: 'One PVS streaming zone — a polygon (always 4 corners in retail) on the XZ plane with explicit safe / unsafe neighbour graphs.',
	fields: {
		muZoneId: u64Hex(),
		miZoneType: i16(),
		miNumPoints: i16(),
		muFlags: u32(),
		// Always 4 in retail, but we leave the schema open so the inspector
		// shows however many entries the parser produced.
		points: fixedList(record('Vec2Padded'), 4),
		safeNeighbours: recordList('Neighbour', neighbourLabel),
		unsafeNeighbours: recordList('Neighbour', neighbourLabel),
		_pad0C: u32(),
		_pad24: fixedList(u32(), 3),
		_trailingNeighbourPad: rawBytes(),
	},
	fieldMetadata: {
		muZoneId: {
			label: 'Zone ID',
			description: 'u64 — typically derived from the zone\'s GameDB hash. Shown in hex.',
		},
		miZoneType: {
			label: 'Zone type',
			description: 'i16. Always 0 in retail; preserved for round-trip fidelity.',
		},
		miNumPoints: {
			label: 'Num points',
			description: 'i16. Always 4 in retail; mirrors the length of the points list.',
		},
		muFlags: {
			label: 'Flags',
			description: 'u32. Unused per the wiki; preserved verbatim.',
		},
		points: {
			label: 'Corners (Vector2[4])',
			description: 'Four 2D points on the XZ plane forming the zone polygon. The shared on-disk point pool is recomputed from the per-zone slices at write time.',
		},
		safeNeighbours: {
			label: 'Safe neighbours',
			description: 'Zones reachable via "safe" transitions — typical streaming candidates. Always empty in retail.',
		},
		unsafeNeighbours: {
			label: 'Unsafe neighbours',
			description: 'Zones reachable via "unsafe" transitions (jumps, shortcuts) — used by the streaming hint system to pre-load a few seconds ahead.',
		},
		_pad0C: {
			label: 'pad +0x0C',
			description: 'Padding slot inside the on-disk Zone record. Preserved verbatim for byte-exact round-trip.',
		},
		_pad24: {
			label: 'pad +0x24',
			description: '12 bytes of trailing pad in the on-disk Zone record. Preserved verbatim.',
		},
		_trailingNeighbourPad: {
			label: 'Trailing neighbour pad',
			description: 'Bytes of zero pad that some fixtures place between the last unsafe-neighbour record of a zone and the start of the next zone\'s safe block. Preserved verbatim for byte-exact round-trip; users shouldn\'t edit this.',
		},
	},
	propertyGroups: [
		{
			title: 'Identity',
			properties: ['muZoneId', 'miZoneType', 'miNumPoints', 'muFlags'],
		},
		{
			title: 'Corners',
			properties: ['points'],
		},
		{
			title: 'Safe Neighbours',
			properties: ['safeNeighbours'],
		},
		{
			title: 'Unsafe Neighbours',
			properties: ['unsafeNeighbours'],
		},
		{
			title: 'Padding',
			properties: ['_pad0C', '_pad24'],
		},
	],
	label: (value, index) => zoneLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

// The 3D map is hosted by the schema editor's Scene pane (see
// `src/components/schema-editor/ViewportPane.tsx`), so we don't repeat it as
// an inspector tab here. The inspector just exposes the underlying data.
const ZONE_LIST_GROUPS = [
	{ title: 'Zones', properties: ['zones'] },
];

const ParsedZoneList: RecordSchema = {
	name: 'ParsedZoneList',
	description: 'Root record for the ZoneList resource (0xB000). Holds the artist-authored streaming PVS — a polygonal grid on the XZ plane with explicit safe / unsafe neighbour graphs per cell.',
	fields: {
		// No customRenderer — the default list renderer paginates and labels
		// each zone via the `zoneLabel` callback, which is enough for a v1
		// inspector. A bespoke table view can be added later if needed.
		zones: recordList('Zone', zoneLabel),
		_finalPad: rawBytes(),
	},
	fieldMetadata: {
		_finalPad: {
			label: 'Final pad',
			description: 'Trailing zero bytes after the last section of the on-disk payload (some fixtures pad more than the 16-byte minimum; we capture the surplus to keep the writer byte-exact).',
		},
	},
	propertyGroups: ZONE_LIST_GROUPS,
};

const registry: SchemaRegistry = {
	ParsedZoneList,
	Zone,
	Neighbour,
	Vec2Padded,
};

export const zoneListResourceSchema: ResourceSchema = {
	key: 'zoneList',
	name: 'Zone List',
	rootType: 'ParsedZoneList',
	registry,
};
