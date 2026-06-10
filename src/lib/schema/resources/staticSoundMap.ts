// Hand-written schema for ParsedStaticSoundMap (resource type 0x10016).
//
// Mirrors the types in `src/lib/core/staticSoundMap.ts`. Keep these in
// lockstep with the parser/writer — any field added to the parser needs a
// matching entry here, or the schema walker reports it as drift.
//
// Domain: every track unit ships two StaticSoundMaps — an *emitter* map
// (looping positional sounds) and a *passby* map (one-shot whooshes for
// lampposts, trees, bridges, …). The role is NOT in the resource: meRootType
// is 0 in every retail map, and bundle order is a coin flip, so only the
// debug name (TRK_UNIT<N>_Emitter / _Passby) tells them apart. That is why
// muTypeOrDistance can't be an enum here: the same u16 is a passby type in
// one map and an audible distance in metres in the other.
//
// Entities are bucketed into a coarse XZ grid (subRegions): each cell owns a
// contiguous run of the entity array. The grid is an acceleration structure
// the game trusts, but it is fully DERIVED data: the write path runs
// rebucketStaticSoundMap, which recomputes bounds, dims, entity order and
// runs from entity positions (reproducing the retail convention byte-exactly
// on all 854 retail resources). Entities are therefore freely addable,
// removable and movable; the grid fields stay read-only because hand-editing
// them is pointless — they are overwritten on save.

import type {
	FieldSchema,
	RecordSchema,
	ResourceSchema,
	SchemaRegistry,
} from '../types';
import { PASSBY_TYPES } from '@/lib/core/staticSoundMap';

// ---------------------------------------------------------------------------
// Local helpers (mirroring propInstanceData.ts)
// ---------------------------------------------------------------------------

const f32 = (): FieldSchema => ({ kind: 'f32' });
const i32 = (): FieldSchema => ({ kind: 'i32' });
const i16 = (): FieldSchema => ({ kind: 'i16' });
const u16 = (): FieldSchema => ({ kind: 'u16' });
const u32 = (): FieldSchema => ({ kind: 'u32' });
const vec2 = (): FieldSchema => ({ kind: 'vec2' });
const vec3 = (): FieldSchema => ({ kind: 'vec3' });
const record = (type: string): FieldSchema => ({ kind: 'record', type });
const rawBytes = (): FieldSchema => ({ kind: 'custom', component: 'rawBytes' });

const fixedRecordList = (
	type: string,
	itemLabel?: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: false,
	removable: false,
	itemLabel: itemLabel ? (item, index) => itemLabel(item, index) : undefined,
});

const editableRecordList = (
	type: string,
	makeEmpty: () => unknown,
	itemLabel?: (item: unknown, index: number) => string,
): FieldSchema => ({
	kind: 'list',
	item: record(type),
	addable: true,
	removable: true,
	makeEmpty,
	itemLabel: itemLabel ? (item, index) => itemLabel(item, index) : undefined,
});

// ---------------------------------------------------------------------------
// Tree-label helpers
// ---------------------------------------------------------------------------

/** Best-effort reading of the dual-semantics u16: retail passby maps only use
 *  Tunnel/Camera/Collision, retail emitter distances run 14–259 m. The label
 *  shows both readings when ambiguous — the schema can't know the map's role. */
export function typeOrDistanceLabel(value: number): string {
	const name = value < PASSBY_TYPES.length ? PASSBY_TYPES[value] : null;
	return name ? `${name} / ${value} m` : `${value} m`;
}

function entityLabel(ent: unknown, index: number): string {
	try {
		if (!ent || typeof ent !== 'object') return `#${index}`;
		const e = ent as { mPosition?: { x?: number; z?: number }; muTypeOrDistance?: number; muSoundIndex?: number };
		const x = e.mPosition?.x != null ? e.mPosition.x.toFixed(0) : '?';
		const z = e.mPosition?.z != null ? e.mPosition.z.toFixed(0) : '?';
		const t = e.muTypeOrDistance != null ? typeOrDistanceLabel(e.muTypeOrDistance) : '?';
		return `#${index} · ${t} · snd ${e.muSoundIndex ?? '?'} · (${x}, ${z})`;
	} catch {
		return `#${index}`;
	}
}

function subRegionLabel(cell: unknown, index: number): string {
	try {
		if (!cell || typeof cell !== 'object') return `#${index}`;
		const c = cell as { mi16First?: number; mi16Count?: number };
		if (c.mi16First == null || c.mi16First < 0) return `#${index} · (empty)`;
		return `#${index} · entities ${c.mi16First}..${c.mi16First + (c.mi16Count ?? 0)}`;
	} catch {
		return `#${index}`;
	}
}

// ---------------------------------------------------------------------------
// Record schemas
// ---------------------------------------------------------------------------

const StaticSoundEntity: RecordSchema = {
	name: 'StaticSoundEntity',
	description: 'One placed sound — a world position plus two u16s packed into the fourth float of the on-disk Vector3Plus. Their meaning depends on the map\'s role (see muTypeOrDistance).',
	fields: {
		mPosition: vec3(),
		muTypeOrDistance: u16(),
		muSoundIndex: u16(),
	},
	fieldMetadata: {
		mPosition: {
			label: 'Position',
			description: 'World X/Y/Z where the sound lives. Safe to move anywhere — the culling grid is rebucketed from entity positions on save, so the sound always lands in the right subregion.',
		},
		muTypeOrDistance: {
			label: 'Type / distance',
			description: `Dual semantics, resolved by the map's debug name: in a _Passby map this is the passby type (retail uses 9 Tunnel, 10 Camera, 12 Collision; full table: ${PASSBY_TYPES.map((n, i) => `${i} ${n}`).join(', ')}); in an _Emitter map it is the audible distance in metres (retail range 14–259).`,
		},
		muSoundIndex: {
			label: 'Sound index',
			description: 'Index into mPassbyBins (passby) or mWorldEmitterList (emitter) in BurnoutGlobalData — the AttribSys vault that owns the actual sound assets.',
		},
	},
	propertyGroups: [
		{ title: 'Placement', properties: ['mPosition'] },
		{ title: 'Sound', properties: ['muTypeOrDistance', 'muSoundIndex'] },
	],
	label: (value, index) => entityLabel(value, index ?? 0),
};

const SubRegionDescriptor: RecordSchema = {
	name: 'SubRegionDescriptor',
	description: 'One cell of the coarse XZ culling grid. Owns a contiguous run [first, first+count) of the entity array; first is -1 for an empty cell. Fully derived: recomputed from entity positions on every save, so hand edits here are overwritten.',
	fields: {
		mi16First: i16(),
		mi16Count: i16(),
	},
	fieldMetadata: {
		mi16First: {
			label: 'First entity',
			description: 'Start index of this cell\'s run into the entity array; -1 = empty cell. Recomputed by rebucketing on save.',
			readOnly: true,
		},
		mi16Count: {
			label: 'Count',
			description: 'Number of entities in this cell\'s run. Recomputed by rebucketing on save.',
			readOnly: true,
		},
	},
	label: (value, index) => subRegionLabel(value, index ?? 0),
};

// ---------------------------------------------------------------------------
// Root + registry export
// ---------------------------------------------------------------------------

const ParsedStaticSoundMap: RecordSchema = {
	name: 'ParsedStaticSoundMap',
	description: 'Root record for the StaticSoundMap resource (0x10016): the ambient-sound placements for one track unit. Whether this is the emitter or the passby map lives ONLY in the resource\'s debug name — meRootType is 0 in every retail map.',
	fields: {
		mMin: vec2(),
		mMax: vec2(),
		mfSubRegionSize: f32(),
		miNumSubRegionsX: i32(),
		miNumSubRegionsZ: i32(),
		entities: editableRecordList(
			'StaticSoundEntity',
			() => ({ mPosition: { x: 0, y: 0, z: 0 }, muTypeOrDistance: 0, muSoundIndex: 0 }),
			entityLabel,
		),
		subRegions: fixedRecordList('SubRegionDescriptor', subRegionLabel),
		meRootType: u32(),
		_minLanes23: vec2(),
		_maxLanes23: vec2(),
		_pad3C: u32(),
		_trailingPad: rawBytes(),
	},
	fieldMetadata: {
		mMin: {
			label: 'Grid min (X, Z)',
			description: 'Minimum world X/Z corner of the culling grid. Sounds only play when the player is inside the grid bounds. Recomputed from entity positions on save (snapped down to a multiple of the cell size).',
			readOnly: true,
		},
		mMax: {
			label: 'Grid max (X, Z)',
			description: 'Maximum world X/Z corner of the culling grid. Recomputed from entity positions on save (snapped up to a multiple of the cell size).',
			readOnly: true,
		},
		mfSubRegionSize: {
			label: 'Cell size',
			description: 'Diameter of each grid cell in world units. Retail always uses 50; rebucketing keeps whatever value is here.',
			readOnly: true,
		},
		miNumSubRegionsX: {
			label: 'Grid cells X',
			description: 'Grid width in cells. Recomputed from the snapped bounds on save.',
			readOnly: true,
		},
		miNumSubRegionsZ: {
			label: 'Grid cells Z',
			description: 'Grid depth in cells. Recomputed from the snapped bounds on save.',
			readOnly: true,
		},
		entities: {
			label: 'Sounds',
			description: 'Every placed sound. Add, remove and move freely — saving rebuckets the culling grid from entity positions, re-sorting this array by grid cell (X varies fastest) so each cell\'s run stays contiguous.',
		},
		subRegions: {
			label: 'Culling grid',
			description: 'Flat grid of cells (X varies fastest: index = cellZ * cellsX + cellX), each owning a contiguous entity run. Fully derived — rebucketing recomputes every run from entity positions on save.',
		},
		meRootType: {
			label: 'Root type',
			description: 'ePassbyTypes root selector — 0 passby, 1 emitter on the wiki, but EVERY retail resource stores 0 regardless of role. Preserved verbatim, trusted for nothing.',
			readOnly: true,
		},
		_minLanes23: {
			label: 'mMin unused lanes',
			description: 'Unused vpu vector lanes (always 0 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_maxLanes23: {
			label: 'mMax unused lanes',
			description: 'Unused vpu vector lanes (always 0 in retail). Preserved for byte-exact round-trip.',
			hidden: true,
		},
		_pad3C: {
			label: 'pad +0x3C',
			description: 'Header pad (always 0 in retail); preserved verbatim.',
			hidden: true,
		},
		_trailingPad: {
			label: 'Trailing pad',
			description: 'Zero bytes padding the resource to 16-byte alignment. Re-emitted verbatim; users shouldn\'t edit this.',
			hidden: true,
		},
	},
	propertyGroups: [
		{ title: 'Grid', properties: ['mMin', 'mMax', 'mfSubRegionSize', 'miNumSubRegionsX', 'miNumSubRegionsZ'] },
		{ title: 'Sounds', properties: ['entities'] },
		{ title: 'Culling', properties: ['subRegions', 'meRootType'] },
	],
};

const registry: SchemaRegistry = {
	ParsedStaticSoundMap,
	StaticSoundEntity,
	SubRegionDescriptor,
};

export const staticSoundMapResourceSchema: ResourceSchema = {
	key: 'staticSoundMap',
	name: 'Static Sound Map',
	rootType: 'ParsedStaticSoundMap',
	registry,
};
