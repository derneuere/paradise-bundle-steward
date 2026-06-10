// StaticSoundMap parser and writer (resource type 0x10016).
//
// A StaticSoundMap places ambient sounds around a track unit. Every track unit
// ships exactly two of these resources: an *emitter* map (looping positional
// sounds — generators, surf, machinery) and a *passby* map (one-shot whooshes
// triggered when the player flies past lampposts, trees, bridge pylons, …).
// Which is which is NOT stored in the resource: meRootType is 0 (passby) in
// every retail resource regardless of role, so the game (and steward's UI)
// distinguish them by debug name suffix — TRK_UNIT<N>_Emitter / _Passby.
//
// Entities are bucketed into a coarse XZ grid of subregions (cell diameter
// mfSubRegionSize, mMin/mMax bound the grid). Each SubRegionDescriptor owns a
// contiguous run [mi16First, mi16First + mi16Count) of the entity array;
// mi16First is -1 for an empty cell. The runtime culls by cell, so entity
// order and the grid must stay consistent — the parser preserves the array
// as-is and the writer never reorders.
//
// Each entity is one Vector3Plus: world X/Y/Z plus two u16s packed into the
// fourth float's bytes. In a passby map the first u16 is the passby type
// (PASSBY_TYPES below) and in an emitter map it is the audible distance in
// metres; the second u16 indexes mPassbyBins / mWorldEmitterList in
// BurnoutGlobalData (the AttribSys vault that owns the actual sound assets).
//
// Scope: 32-bit PC, little-endian, matching propInstanceData / streetData.
// The wiki documents a 64-bit layout but notes all 64-bit variants shipped
// empty (Remastered lost its static sounds on every platform except PC).
//
// Round-trip strategy: the layout is rigid — header(0x40) → entities(0x10
// each, at 0x40) → subregions(0x4 each) → zero pad to 16-byte alignment.
// mpEntities/mpSubRegions are file-relative offsets fixed up to pointers at
// load; both stay valid (0x40) even in an empty map, unlike the null-pointer
// shape empty prop zones use. Pointers are recomputed from array lengths on
// write; the trailing pad is captured verbatim to reproduce the exact length.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

// AttribSys::Enums::ePassbyTypes — the first packed u16 of a passby entity.
// Emitter maps reuse that u16 as a distance, so this table only applies when
// the resource's debug name ends in _Passby.
export const PASSBY_TYPES = [
	'PassbyAzimuth',
	'PassbyPitch',
	'PassbyCutoff',
	'TrafficSmall',
	'TrafficMedium',
	'TrafficLarge',
	'LampPost',
	'Tree',
	'Bridge',
	'Tunnel',
	'Camera',
	'Misc',
	'Collision',
	'Overpass',
	'Warehouse',
	'Alley',
	'StaticMetal',
	'LargeOverheadObject',
	'PassbyBoostOffset',
] as const;

export const STATIC_SOUND_ROOT_TYPE = {
	PASSBY: 0,
	EMITTER: 1,
} as const;

// =============================================================================
// Types
// =============================================================================

// Vec values are {x,y(,z)} objects (not arrays) to match the repo-wide vec
// convention the schema editor's Vec2Field/Vec3Field render — see
// triggerData's Vector3. For the 2D grid bounds the renderer's "y" lane is
// world Z; the schema labels them "(X, Z)" so the inspector stays honest.
export type StaticSoundEntity = {
	/** World position (f32 X, Y, Z) — first three lanes of the Vector3Plus. */
	mPosition: { x: number; y: number; z: number };
	/** Passby type (passby map) or audible distance in metres (emitter map). */
	muTypeOrDistance: number; // u16
	/** Index into mPassbyBins / mWorldEmitterList in BurnoutGlobalData. */
	muSoundIndex: number; // u16
};

export type SubRegionDescriptor = {
	/** Start index into the entity array; -1 = empty cell. */
	mi16First: number;
	/** Number of entities owned by this cell. */
	mi16Count: number;
};

export type ParsedStaticSoundMap = {
	/** Grid bounds — world X/Z (stored in the y lane). The maps are 2D; world Y never participates. */
	mMin: { x: number; y: number };
	mMax: { x: number; y: number };
	// Unused vpu vector lanes of mMin/mMax (observed 0) — preserved verbatim so
	// the round-trip stays byte-exact even if some resource stores junk there.
	_minLanes23: { x: number; y: number };
	_maxLanes23: { x: number; y: number };
	/** Diameter of each grid cell (world units; retail uses 50). */
	mfSubRegionSize: number;
	miNumSubRegionsX: number;
	miNumSubRegionsZ: number;
	/** Flat X-major grid, miNumSubRegionsX * miNumSubRegionsZ cells. */
	subRegions: SubRegionDescriptor[];
	entities: StaticSoundEntity[];
	// Always PASSBY (0) in retail, even for emitter maps — the role lives in
	// the debug name. Preserved verbatim, not trusted for anything.
	meRootType: number;
	/** Header pad at 0x3C — preserved verbatim. */
	_pad3C: number;
	/** Zero pad from end-of-subregions to the 16-byte-aligned end. */
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x40;
const ENTITY_RECORD_SIZE = 0x10;
const SUBREGION_RECORD_SIZE = 0x4;
// mpEntities is 0x40 in every retail resource, populated or empty — empty maps
// keep valid pointers (1x1 grid, [-1,0] cell), unlike empty prop zones.
const ENTITIES_OFFSET = HEADER_SIZE;

// =============================================================================
// Reader
// =============================================================================

export function parseStaticSoundMap(raw: Uint8Array, littleEndian = true): ParsedStaticSoundMap {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header (0x40 bytes) ---
	const minX = r.readF32();
	const minZ = r.readF32();
	const minL2 = r.readF32();
	const minL3 = r.readF32();
	const maxX = r.readF32();
	const maxZ = r.readF32();
	const maxL2 = r.readF32();
	const maxL3 = r.readF32();
	const mfSubRegionSize = r.readF32();
	const mpSubRegions = r.readU32();
	const miNumSubRegionsX = r.readI32();
	const miNumSubRegionsZ = r.readI32();
	const mpEntities = r.readU32();
	const miNumEntities = r.readI32();
	const meRootType = r.readU32();
	const _pad3C = r.readU32();

	// The layout is rigid; bail loudly on violations rather than silently
	// producing a model that won't round-trip.
	const entitiesEnd = ENTITIES_OFFSET + miNumEntities * ENTITY_RECORD_SIZE;
	if (mpEntities !== ENTITIES_OFFSET) {
		throw new Error(`StaticSoundMap: mpEntities is 0x${mpEntities.toString(16)}, expected 0x40 (rigid layout)`);
	}
	if (mpSubRegions !== entitiesEnd) {
		throw new Error(`StaticSoundMap: mpSubRegions is 0x${mpSubRegions.toString(16)}, expected 0x${entitiesEnd.toString(16)} for ${miNumEntities} entities`);
	}
	const numCells = miNumSubRegionsX * miNumSubRegionsZ;
	const subRegionsEnd = entitiesEnd + numCells * SUBREGION_RECORD_SIZE;
	if (numCells < 0 || subRegionsEnd > raw.byteLength) {
		throw new Error(`StaticSoundMap: ${miNumSubRegionsX}x${miNumSubRegionsZ} grid overruns the ${raw.byteLength}-byte resource`);
	}

	// --- Entities (0x10 each, at 0x40) ---
	const entities: StaticSoundEntity[] = [];
	r.position = ENTITIES_OFFSET;
	for (let i = 0; i < miNumEntities; i++) {
		const x = r.readF32();
		const y = r.readF32();
		const z = r.readF32();
		const muTypeOrDistance = r.readU16();
		const muSoundIndex = r.readU16();
		entities.push({ mPosition: { x, y, z }, muTypeOrDistance, muSoundIndex });
	}

	// --- Subregion grid (4 bytes per cell, immediately after entities) ---
	const subRegions: SubRegionDescriptor[] = [];
	for (let i = 0; i < numCells; i++) {
		const mi16First = r.readI16();
		const mi16Count = r.readI16();
		subRegions.push({ mi16First, mi16Count });
	}

	// --- Trailing pad (zeros to 16-byte alignment) — captured verbatim. ---
	const _trailingPad = subRegionsEnd < raw.byteLength
		? raw.slice(subRegionsEnd, raw.byteLength)
		: new Uint8Array(0);

	return {
		mMin: { x: minX, y: minZ },
		mMax: { x: maxX, y: maxZ },
		_minLanes23: { x: minL2, y: minL3 },
		_maxLanes23: { x: maxL2, y: maxL3 },
		mfSubRegionSize,
		miNumSubRegionsX,
		miNumSubRegionsZ,
		subRegions,
		entities,
		meRootType,
		_pad3C,
		_trailingPad,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeStaticSoundMap(model: ParsedStaticSoundMap, littleEndian = true): Uint8Array {
	const { entities, subRegions } = model;
	const numCells = model.miNumSubRegionsX * model.miNumSubRegionsZ;
	if (subRegions.length !== numCells) {
		throw new Error(`StaticSoundMap writer: ${subRegions.length} subregions != ${model.miNumSubRegionsX}x${model.miNumSubRegionsZ} grid`);
	}

	// File-relative offsets recomputed from the array lengths, never stored.
	const entitiesEnd = ENTITIES_OFFSET + entities.length * ENTITY_RECORD_SIZE;
	const subRegionsEnd = entitiesEnd + subRegions.length * SUBREGION_RECORD_SIZE;
	const totalSize = subRegionsEnd + model._trailingPad.byteLength;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (0x40 bytes) ---
	w.writeF32(model.mMin.x);
	w.writeF32(model.mMin.y);
	w.writeF32(model._minLanes23.x);
	w.writeF32(model._minLanes23.y);
	w.writeF32(model.mMax.x);
	w.writeF32(model.mMax.y);
	w.writeF32(model._maxLanes23.x);
	w.writeF32(model._maxLanes23.y);
	w.writeF32(model.mfSubRegionSize);
	w.writeU32(entitiesEnd); // mpSubRegions
	w.writeI32(model.miNumSubRegionsX);
	w.writeI32(model.miNumSubRegionsZ);
	w.writeU32(ENTITIES_OFFSET); // mpEntities
	w.writeI32(entities.length);
	w.writeU32(model.meRootType);
	w.writeU32(model._pad3C);
	if (w.offset !== HEADER_SIZE) throw new Error(`StaticSoundMap writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	// --- Entities ---
	for (const ent of entities) {
		w.writeF32(ent.mPosition.x);
		w.writeF32(ent.mPosition.y);
		w.writeF32(ent.mPosition.z);
		w.writeU16(ent.muTypeOrDistance);
		w.writeU16(ent.muSoundIndex);
	}
	if (w.offset !== entitiesEnd) throw new Error(`StaticSoundMap writer: subregions offset mismatch ${w.offset} vs ${entitiesEnd}`);

	// --- Subregion grid ---
	for (const cell of subRegions) {
		w.writeI16(cell.mi16First);
		w.writeI16(cell.mi16Count);
	}
	if (w.offset !== subRegionsEnd) throw new Error(`StaticSoundMap writer: trailing-pad offset mismatch ${w.offset} vs ${subRegionsEnd}`);

	// --- Trailing pad (verbatim) — reproduces the exact original length. ---
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}
