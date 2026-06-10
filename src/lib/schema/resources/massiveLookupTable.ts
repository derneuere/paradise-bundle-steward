// Hand-written schema for ParsedMassiveLookupTable (resource type 0x1001A).
//
// Mirrors the types in `src/lib/core/massiveLookupTable.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: the lookup table the now-defunct Massive Incorporated ad service
// used to place served ads in the world. Each item is one placement: the ad
// quad's local-space bounding box, the Scene resource it lives in, an ad
// inventory slot ("IE index", -1 when unassigned), and the index of the
// Renderable whose texture the served ad replaced. The service is dead, so
// edits here are inert in retail — but the resource still parses and loads.

import type { FieldSchema, RecordSchema, ResourceSchema, SchemaRegistry } from '../types';
import { makeEmptyMassiveItem } from '@/lib/core/massiveLookupTable';

// ---------------------------------------------------------------------------
// Local helpers (mirroring staticSoundMap.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const u8 = (): FieldSchema => ({ kind: 'u8' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const resourceId = (): FieldSchema => ({ kind: 'bigint', bytes: 8, hex: true });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

function itemLabel(item: unknown, index: number): string {
	try {
		if (!item || typeof item !== 'object') return `#${index}`;
		const it = item as { mSceneId?: bigint; miIEIndex?: number; muRenderableIndex?: number };
		const scene = typeof it.mSceneId === 'bigint' ? `0x${it.mSceneId.toString(16).toUpperCase()}` : '?';
		const slot = it.miIEIndex != null && it.miIEIndex >= 0 ? `slot ${it.miIEIndex}` : 'no slot';
		return `#${index} · scene ${scene} · ${slot} · rend ${it.muRenderableIndex ?? '?'}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const MassiveLookupTableItem: RecordSchema = {
	name: 'MassiveLookupTableItem',
	description: 'One ad placement: where the ad quad sits (local-space AABB), which Scene owns it, which inventory slot it serves, and which Renderable\'s texture the ad replaces.',
	fields: {
		mBoundingBoxMin: vec3(),
		mBoundingBoxMax: vec3(),
		mSceneId: resourceId(),
		miIEIndex: i32(),
		muRenderableIndex: u8(),
		_minW: f32(),
		_maxW: f32(),
		_mpSubscriber: u32(),
		_pad31: rawBytes(),
	},
	fieldMetadata: {
		mBoundingBoxMin: {
			label: 'Bounding box min',
			description: 'Local-space AABB min corner of the ad quad in metres, relative to the owning Scene. Most retail placements are flat billboards (zero-depth boxes).',
		},
		mBoundingBoxMax: {
			label: 'Bounding box max',
			description: 'Local-space AABB max corner of the ad quad.',
		},
		mSceneId: {
			label: 'Scene ID',
			description: 'Resource ID of the Scene this placement belongs to.',
		},
		miIEIndex: {
			label: 'IE index',
			description: 'Ad inventory slot index the Massive client filled; -1 for placements without an assigned slot (retail uses 0-8 across 9 of the 20 items).',
		},
		muRenderableIndex: {
			label: 'Renderable index',
			description: 'Index of the Renderable whose texture the served ad replaced. Sequential 0-19 in retail.',
		},
		_minW: {
			label: 'min unused lane',
			description: 'Unused 4th vpu lane of the min vector (0 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_maxW: {
			label: 'max unused lane',
			description: 'Unused 4th vpu lane of the max vector (0 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_mpSubscriber: {
			label: 'Subscriber pointer',
			description: 'Runtime BrnMassiveSubscriber pointer — 0 on disk, set when the ad client subscribed. Preserved verbatim.',
			hidden: true,
		},
		_pad31: {
			label: 'pad +0x31',
			description: '15 pad bytes (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Placement', properties: ['mBoundingBoxMin', 'mBoundingBoxMax', 'mSceneId'] },
		{ title: 'Ad binding', properties: ['miIEIndex', 'muRenderableIndex'] },
	],
	label: (value, index) => itemLabel(value, index ?? 0),
};

const ParsedMassiveLookupTable: RecordSchema = {
	name: 'ParsedMassiveLookupTable',
	description: 'Root record for the MassiveLookupTable resource (0x1001A): every in-game ad placement of the defunct Massive Incorporated service. One retail resource exists (MASSIVETABLE.BIN, 20 placements).',
	fields: {
		items: {
			kind: 'list',
			item: record('MassiveLookupTableItem'),
			itemLabel: (item, index) => itemLabel(item, index),
			makeEmpty: () => makeEmptyMassiveItem(),
		},
		_pad08: rawBytes(),
	},
	fieldMetadata: {
		items: {
			label: 'Ad placements',
			description: 'Every placement in disk order. Count and the item-array pointer are re-derived on write, so adding/removing is safe.',
		},
		_pad08: {
			label: 'Header pad',
			description: '8 pad bytes aligning the item array to 16 (0 in retail); preserved verbatim.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Placements', properties: ['items'] },
	],
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

const registry: SchemaRegistry = {
	ParsedMassiveLookupTable,
	MassiveLookupTableItem,
};

export const massiveLookupTableResourceSchema: ResourceSchema = {
	key: 'massiveLookupTable',
	name: 'Massive Lookup Table',
	rootType: 'ParsedMassiveLookupTable',
	registry,
};
