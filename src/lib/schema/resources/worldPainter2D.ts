// Hand-written schema for ParsedWorldPainter2D (resource type 0x30).
//
// Mirrors the types in `src/lib/core/worldPainter2D.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: a WorldPainter2D resource is a dense byte grid painted over the
// world map — one district index per cell in DISTRICTS.DAT (BrnWorld::
// EDistrict, 0xFF = nothing painted), one ambience-zone id (0..20 in retail,
// no name table exists) per cell in SOUND/AMBIENCES.DAT. The container is
// byte-identical in shape; ONLY the debug name (Districts / Ambiences) says
// which palette applies, so every label here is variant-parameterised —
// resolve the variant with worldPainter2DVariantFromName(debugName) before
// asking for a cell label. The runtime scales the grid over the world with
// hardcoded origin/size values; nothing spatial is stored in the resource.
//
// The 98,304-cell payload is deliberately NOT exposed as a schema list — a
// PrimListField with 98k u8 rows would hang the inspector, and individual
// cell edits are meaningless without seeing the map. The grid waits for a
// painter overlay (a coloured plane over the track geometry); until then the
// `cells` field is hidden and the resource is effectively read-only in the
// schema editor, with the grid dims visible for orientation.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import {
	AMBIENCE_INDEX_COUNT,
	DISTRICT_NAMES,
	INVALID_CELL,
	type WorldPainter2DVariant,
} from '@/lib/core/worldPainter2D';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const u16 = (): FieldSchema => ({ kind: 'u16' });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Cell-label helper — exported for the future painter overlay's legend
// ---------------------------------------------------------------------------

/** Human reading of one cell byte, by variant. District names only apply to
 *  the Districts resource; an Ambiences map reuses the same values as
 *  ambience-zone ids that have NO name table anywhere, so they label
 *  numerically. Pass null when the debug name resolved to neither variant —
 *  the label stays palette-neutral rather than guessing. */
export function worldPainter2DCellLabel(value: number, variant: WorldPainter2DVariant | null): string {
	if (value === INVALID_CELL) return '255 (unpainted)';
	if (variant === 'districts') {
		const name = value < DISTRICT_NAMES.length ? DISTRICT_NAMES[value] : null;
		return name ? `${value} ${name}` : `${value} (no district name)`;
	}
	if (variant === 'ambiences') {
		return value < AMBIENCE_INDEX_COUNT ? `Ambience ${value}` : `${value} (beyond retail ambience ids)`;
	}
	return `${value}`;
}

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedWorldPainter2D: RecordSchema = {
	name: 'ParsedWorldPainter2D',
	description: 'Root record for the WorldPainter2D resource (0x30): a dense 2D byte grid mapping every world-map cell to a district (Districts) or ambience (Ambiences). Which palette applies lives only in the resource\'s debug name — the container is identical.',
	fields: {
		muWidth: u16(),
		muHeight: u16(),
		cells: rawBytes(),
		_wrapperPad: rawBytes(),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		muWidth: {
			label: 'Grid width',
			description: 'Cells per row. Retail v1.4+ uses 384 (the Big Surf Island update widened the map); v1.0 used 256. Read-only: resizing requires repainting the whole grid.',
			readOnly: true,
		},
		muHeight: {
			label: 'Grid height',
			description: 'Number of rows. Retail uses 256. Row 0 is the map\'s north edge.',
			readOnly: true,
		},
		cells: {
			label: 'Cell grid',
			description: `Row-major width*height bytes, row 0 = north, x eastward. Each byte indexes BrnWorld::EDistrict (${DISTRICT_NAMES.length} valid districts in v1.9/Remastered) in the Districts resource, or an unnamed ambience zone (retail paints ids 0..${AMBIENCE_INDEX_COUNT - 1}) in the Ambiences resource; 0xFF = nothing painted. Retail Ambiences mirrors the mainland district bytes cell-for-cell and repaints Big Surf Island with three zones. Hidden until a painter overlay exists — 98k cells are uneditable as a flat list.`,
			hidden: true,
		},
		_wrapperPad: {
			label: 'Wrapper pad',
			description: 'BinaryFile wrapper bytes 0x8..0xF (zero in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Zero bytes padding the resource to 16-byte alignment, counted inside the wrapper\'s mu32DataSize. Re-emitted verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Grid', properties: ['muWidth', 'muHeight'] },
	],
};

const registry: SchemaRegistry = {
	ParsedWorldPainter2D,
};

export const worldPainter2DResourceSchema: ResourceSchema = {
	key: 'worldPainter2D',
	name: 'World Painter 2D',
	rootType: 'ParsedWorldPainter2D',
	registry,
};
