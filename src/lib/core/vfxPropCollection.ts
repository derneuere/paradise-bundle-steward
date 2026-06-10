// VFXPropCollection parser and writer (resource type 0x1001B,
// BrnParticle::VFXPropCollection).
//
// The single retail instance (vfx_props_collection in PARTICLES.BUNDLE) maps
// every breakable prop in the game to the particle effects it triggers: a prop
// (keyed by its GameDB id) owns 1–2 STATES (intact / wrecked), each state owns
// exactly one MATERIAL (the eVFXMaterialType picks the debris/dust effect set:
// metal sparks, wood splinters, water spray, …) plus optional CORONAS (light
// glows — traffic-light lenses, lamp heads), and a material owns zero or more
// LOCATORS (prop-local points where the effect is emitted; their debug names
// are tails of the authoring .lef effect-file paths, left-truncated to fit
// char[60]). Coronas reference shared VFXCoronaTypeData records (GameDB-id'd
// flash timing/size presets).
//
// Layout facts grounded against the retail bytes (the wiki types every
// cross-record field as a pointer — on disk they are NOT byte offsets):
//   - The six header table pointers ARE file-relative byte offsets, and the
//     tables are packed sequentially with no gaps: header(0x40) → props(0x10
//     each) → states(0x10) → materials(0xC) → locators(0x50) → coronas(0x50)
//     → coronaTypeData(0x20) → end of payload, exactly.
//   - Every nested reference (prop→state, state→material, state→corona,
//     material→locator, corona→typeData) is an ELEMENT INDEX into the target
//     table, not a pointer/offset. Runs are contiguous and strictly cumulative
//     in retail (each table is grouped by owner).
//   - "No entries" is index 0xFFFFFFFF (VFX_NULL_INDEX) with count 0 — used by
//     317/324 states (no coronas) and the locator-less materials.
//
// Round-trip strategy: the six table offsets and counts are recomputed from
// the array lengths on write (the parser asserts the stored values match the
// rigid sequential layout, throwing rather than mis-parsing). Element indices
// are model data, written verbatim. Pads observed zero are preserved verbatim
// in _-prefixed fields; locator names are asserted zero-padded after the NUL
// so the writer's fixed-string emit is provably byte-exact.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

export const VFX_PROP_COLLECTION_TYPE_ID = 0x1001b;

/** Element-index sentinel meaning "no entries" (paired with a zero count). */
export const VFX_NULL_INDEX = 0xffffffff;

// BrnParticle::eVFXMaterialType — selects the effect set a prop state emits.
// Retail usage: None ×270, Metal ×31, Wood ×13, Foliage/Plastic ×3 each,
// Water/Billboard ×2 each; the other values are unused but valid.
export const VFX_MATERIAL_TYPES = [
	'Dirt', 'Foliage', 'Metal', 'Plastic', 'StuntYellow', 'Wood', 'Water', 'Stone',
	'Paper', 'Billboard', 'RedBarrelExplo', 'Bindust', 'WaterBarrel', 'Debug', 'None', 'Max',
] as const;

/** eVFXCoronaType has 17 texture slots (VFXCorona_Texture_0..16). */
export const VFX_CORONA_TYPE_COUNT = 17;

// =============================================================================
// Types
// =============================================================================

export type VFXProp = {
	/** GameDB id of the prop (u64; high half is 0 in retail). */
	mPropID: bigint;
	/** Element index of this prop's first state in propStates. */
	mpPropStates: number; // u32
	/** Number of states (1 intact-only or 2 intact+wrecked in retail). */
	muNumPropStates: number; // u32
};

export type VFXPropState = {
	/** Element index of this state's first material (every retail state owns exactly 1). */
	mpVFXMaterial: number; // u32
	muNumVFXMaterials: number; // u32
	/** Element index of this state's first corona, or VFX_NULL_INDEX when none. */
	mpCoronaType: number; // u32
	muNumCoronas: number; // u32
};

export type VFXMaterial = {
	/** eVFXMaterialType — see VFX_MATERIAL_TYPES. */
	mType: number; // u32
	muNumLocators: number; // u32 (wiki: mNumLocators)
	/** Element index of this material's first locator, or VFX_NULL_INDEX when none. */
	mpLocators: number; // u32
};

export type VFXLocator = {
	/** Prop-local emit position (metres, relative to the prop's origin). */
	mPosition: { x: number; y: number; z: number };
	/** Unused 4th vpu lane of the position (0 in retail). Preserved verbatim. */
	_posW: number; // f32
	/** Hash of the authoring effect-file reference (not derivable from the truncated debug name). */
	mHashedName: number; // u32
	/** Debug tail of the .lef effect path, left-truncated to fit char[60]. */
	macDebugLefName: string;
};

export type VFXCoronaType = {
	/** Matrix44Affine, row-major 16 f32; translation lives in slots 12–14 (prop-local). */
	mTransform: number[];
	/** Element index into coronaTypeData. */
	mpTypeData: number; // u32
	/** Phase offset in master-time cycles (retail uses 0 / 0.5 for alternating flashers). */
	mrTimeOffset: number; // f32
	/** Record pad at +0x48 (two u32, 0 in retail). Preserved verbatim. */
	_pad48: [number, number];
};

export type VFXCoronaTypeData = {
	/** GameDB id of the corona preset. */
	mnID: number; // u32
	/** eVFXCoronaType — corona texture slot 0..16. */
	mType: number; // u32
	/** Seconds lit per flash cycle (0 = always on). */
	mrTimeOn: number; // f32
	/** Seconds dark per flash cycle. */
	mrTimeOff: number; // f32
	mrSizeMin: number; // f32
	mrSizeMax: number; // f32
	mrMasterTime: number; // f32
	mbSynchronised: boolean;
	/** Record pad at +0x1D (three bytes, 0 in retail). Preserved verbatim. */
	_pad1D: [number, number, number];
};

export type ParsedVFXPropCollection = {
	/** Always 3 in retail. */
	muVersion: number;
	props: VFXProp[];
	propStates: VFXPropState[];
	materials: VFXMaterial[];
	locators: VFXLocator[];
	coronas: VFXCoronaType[];
	coronaTypeData: VFXCoronaTypeData[];
	/** Header pad 0x34..0x40 (zeros in retail). Preserved verbatim. */
	_headerPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE = 0x40;
const HEADER_FIELDS_END = 0x34;
const PROP_SIZE = 0x10;
const STATE_SIZE = 0x10;
const MATERIAL_SIZE = 0x0c;
const LOCATOR_SIZE = 0x50;
const CORONA_SIZE = 0x50;
const CTD_SIZE = 0x20;
const LOCATOR_NAME_LEN = 0x3c;

// =============================================================================
// Reader
// =============================================================================

export function parseVFXPropCollection(raw: Uint8Array, littleEndian = true): ParsedVFXPropCollection {
	// Copy up front — raw can be a Node Buffer view over a shared pool, and the
	// verbatim pad slices below must stay stable after extraction.
	const bytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const r = new BinReader(bytes.buffer, littleEndian);

	const tables: { offset: number; count: number }[] = [];
	for (let i = 0; i < 6; i++) tables.push({ offset: r.readU32(), count: r.readU32() });
	const muVersion = r.readU32();
	if (muVersion !== 3) {
		throw new Error(`VFXPropCollection: muVersion is ${muVersion}, expected 3`);
	}
	const _headerPad = new Uint8Array(bytes.subarray(HEADER_FIELDS_END, HEADER_SIZE));

	// The tables are packed sequentially with no gaps; bail loudly on violations
	// rather than silently producing a model that won't round-trip.
	const sizes = [PROP_SIZE, STATE_SIZE, MATERIAL_SIZE, LOCATOR_SIZE, CORONA_SIZE, CTD_SIZE];
	const names = ['props', 'propStates', 'materials', 'locators', 'coronas', 'coronaTypeData'];
	let cursor = HEADER_SIZE;
	for (let i = 0; i < 6; i++) {
		if (tables[i].offset !== cursor) {
			throw new Error(`VFXPropCollection: ${names[i]} table at 0x${tables[i].offset.toString(16)}, expected 0x${cursor.toString(16)} (rigid sequential layout)`);
		}
		cursor += tables[i].count * sizes[i];
	}
	if (cursor !== bytes.byteLength) {
		throw new Error(`VFXPropCollection: tables end at 0x${cursor.toString(16)} but the resource is 0x${bytes.byteLength.toString(16)} bytes`);
	}

	const props: VFXProp[] = [];
	r.position = tables[0].offset;
	for (let i = 0; i < tables[0].count; i++) {
		const mPropID = r.readU64();
		const mpPropStates = r.readU32();
		const muNumPropStates = r.readU32();
		props.push({ mPropID, mpPropStates, muNumPropStates });
	}

	const propStates: VFXPropState[] = [];
	for (let i = 0; i < tables[1].count; i++) {
		const mpVFXMaterial = r.readU32();
		const muNumVFXMaterials = r.readU32();
		const mpCoronaType = r.readU32();
		const muNumCoronas = r.readU32();
		propStates.push({ mpVFXMaterial, muNumVFXMaterials, mpCoronaType, muNumCoronas });
	}

	const materials: VFXMaterial[] = [];
	for (let i = 0; i < tables[2].count; i++) {
		const mType = r.readU32();
		const muNumLocators = r.readU32();
		const mpLocators = r.readU32();
		materials.push({ mType, muNumLocators, mpLocators });
	}

	const locators: VFXLocator[] = [];
	for (let i = 0; i < tables[3].count; i++) {
		const x = r.readF32();
		const y = r.readF32();
		const z = r.readF32();
		const _posW = r.readF32();
		const mHashedName = r.readU32();
		const nameStart = tables[3].offset + i * LOCATOR_SIZE + 0x14;
		const nameBytes = bytes.subarray(nameStart, nameStart + LOCATOR_NAME_LEN);
		const nul = nameBytes.indexOf(0);
		if (nul < 0) throw new Error(`VFXPropCollection: locator ${i} debug name is not NUL-terminated`);
		for (let j = nul; j < LOCATOR_NAME_LEN; j++) {
			if (nameBytes[j] !== 0) throw new Error(`VFXPropCollection: locator ${i} has non-zero bytes after the name NUL`);
		}
		const macDebugLefName = new TextDecoder().decode(nameBytes.subarray(0, nul));
		r.position = nameStart + LOCATOR_NAME_LEN;
		locators.push({ mPosition: { x, y, z }, _posW, mHashedName, macDebugLefName });
	}

	const coronas: VFXCoronaType[] = [];
	for (let i = 0; i < tables[4].count; i++) {
		const mTransform: number[] = [];
		for (let f = 0; f < 16; f++) mTransform.push(r.readF32());
		const mpTypeData = r.readU32();
		const mrTimeOffset = r.readF32();
		const _pad48: [number, number] = [r.readU32(), r.readU32()];
		coronas.push({ mTransform, mpTypeData, mrTimeOffset, _pad48 });
	}

	const coronaTypeData: VFXCoronaTypeData[] = [];
	for (let i = 0; i < tables[5].count; i++) {
		const mnID = r.readU32();
		const mType = r.readU32();
		const mrTimeOn = r.readF32();
		const mrTimeOff = r.readF32();
		const mrSizeMin = r.readF32();
		const mrSizeMax = r.readF32();
		const mrMasterTime = r.readF32();
		const syncByte = r.readU8();
		if (syncByte > 1) throw new Error(`VFXPropCollection: coronaTypeData ${i} mbSynchronised byte is ${syncByte}, expected 0/1`);
		const _pad1D: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];
		coronaTypeData.push({ mnID, mType, mrTimeOn, mrTimeOff, mrSizeMin, mrSizeMax, mrMasterTime, mbSynchronised: syncByte === 1, _pad1D });
	}

	return { muVersion, props, propStates, materials, locators, coronas, coronaTypeData, _headerPad };
}

// =============================================================================
// Writer
// =============================================================================

export function writeVFXPropCollection(model: ParsedVFXPropCollection, littleEndian = true): Uint8Array {
	if (model._headerPad.byteLength !== HEADER_SIZE - HEADER_FIELDS_END) {
		throw new Error(`VFXPropCollection writer: _headerPad is ${model._headerPad.byteLength} bytes, expected ${HEADER_SIZE - HEADER_FIELDS_END}`);
	}

	// Table offsets recomputed from the array lengths, never stored.
	const arrays = [model.props, model.propStates, model.materials, model.locators, model.coronas, model.coronaTypeData];
	const sizes = [PROP_SIZE, STATE_SIZE, MATERIAL_SIZE, LOCATOR_SIZE, CORONA_SIZE, CTD_SIZE];
	const offsets: number[] = [];
	let cursor = HEADER_SIZE;
	for (let i = 0; i < 6; i++) {
		offsets.push(cursor);
		cursor += arrays[i].length * sizes[i];
	}

	const w = new BinWriter(cursor, littleEndian);
	for (let i = 0; i < 6; i++) {
		w.writeU32(offsets[i]);
		w.writeU32(arrays[i].length);
	}
	w.writeU32(model.muVersion);
	w.writeBytes(model._headerPad);
	if (w.offset !== HEADER_SIZE) throw new Error(`VFXPropCollection writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	for (const p of model.props) {
		w.writeU64(p.mPropID);
		w.writeU32(p.mpPropStates);
		w.writeU32(p.muNumPropStates);
	}
	for (const s of model.propStates) {
		w.writeU32(s.mpVFXMaterial);
		w.writeU32(s.muNumVFXMaterials);
		w.writeU32(s.mpCoronaType);
		w.writeU32(s.muNumCoronas);
	}
	for (const m of model.materials) {
		w.writeU32(m.mType);
		w.writeU32(m.muNumLocators);
		w.writeU32(m.mpLocators);
	}
	for (const l of model.locators) {
		const nameBytes = new TextEncoder().encode(l.macDebugLefName);
		if (nameBytes.length > LOCATOR_NAME_LEN - 1) {
			throw new Error(`VFXPropCollection writer: locator name "${l.macDebugLefName.slice(0, 20)}…" is ${nameBytes.length} bytes, max ${LOCATOR_NAME_LEN - 1}`);
		}
		w.writeF32(l.mPosition.x);
		w.writeF32(l.mPosition.y);
		w.writeF32(l.mPosition.z);
		w.writeF32(l._posW);
		w.writeU32(l.mHashedName);
		w.writeBytes(nameBytes);
		w.writeZeroes(LOCATOR_NAME_LEN - nameBytes.length);
	}
	for (const c of model.coronas) {
		if (c.mTransform.length !== 16) {
			throw new Error(`VFXPropCollection writer: corona transform has ${c.mTransform.length} floats, must be 16`);
		}
		for (const f of c.mTransform) w.writeF32(f);
		w.writeU32(c.mpTypeData);
		w.writeF32(c.mrTimeOffset);
		w.writeU32(c._pad48[0]);
		w.writeU32(c._pad48[1]);
	}
	for (const d of model.coronaTypeData) {
		w.writeU32(d.mnID);
		w.writeU32(d.mType);
		w.writeF32(d.mrTimeOn);
		w.writeF32(d.mrTimeOff);
		w.writeF32(d.mrSizeMin);
		w.writeF32(d.mrSizeMax);
		w.writeF32(d.mrMasterTime);
		w.writeU8(d.mbSynchronised ? 1 : 0);
		w.writeU8(d._pad1D[0]);
		w.writeU8(d._pad1D[1]);
		w.writeU8(d._pad1D[2]);
	}
	if (w.offset !== cursor) throw new Error(`VFXPropCollection writer: payload offset mismatch ${w.offset} vs ${cursor}`);
	return w.bytes;
}
