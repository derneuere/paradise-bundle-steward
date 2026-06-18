// PropInstanceData parser and writer (resource type 0x10011).
//
// A PropZoneData places "props" (signs, lampposts, cones, spinning billboards,
// collectibles, …) into a track unit. The resource is a flat array of
// PropInstanceData records partitioned into spatial cells (a coarse XZ grid) so
// the runtime can stream/spawn props near the player. Each instance references a
// prop type (an index into prop-types — see propTypes.ts) and carries a full
// world transform.
//
// Ordering is load-bearing. A cell carries two counts — muNumberOfRespawnDifferent
// and muNumberOfDontRespawn — that partition its instances by respawn behaviour.
// The exact within-cell layout is BELIEVED to be the respawn-changed group first,
// then don't-respawn, then the rest — but only the two counts are certain; the
// precise ordering is unconfirmed. Either way, collectibles and other
// respawn-sensitive props depend on the order, so the round-trip MUST preserve
// instance order within each cell exactly: the parser keeps the array as-is and
// the writer never reorders.
//
// Scope: 32-bit PC, little-endian. The wiki documents a 64-bit (Paradise
// Remastered) layout and console (BE) variants; both are out of scope here,
// matching streetData / trafficData / zoneList.
//
// Round-trip strategy:
//  - The layout is rigid: header(32B) → instances(0x50 each, at 0x20) →
//    cells(0x0C each) → all-zero tail. maInstances/maCells are runtime pointers
//    fixed up at load: maInstances = 0x20 and maCells = 0x20 + props*0x50 when
//    those arrays are populated, but BOTH are null (0) for an empty prop zone
//    (no props, no cells) — ~40% of track units ship that all-zero shape. So
//    the pointers are recomputed from the array lengths on write (null when
//    empty) rather than stored on the model. muNumberOfProps == instances.length.
//  - muSizeInBytes does NOT track the buffer length (it is an internal stored
//    field — gold fixture has len-32, others differ), and muNumberOfInstances is
//    the total runtime instance slots (props + every prop's parts; see its field
//    comment). Neither can be auto-recomputed here, so both are editable and
//    written verbatim — the editor exposes them for hand-fixing and the writer
//    reproduces whatever the model carries (byte-exact for an untouched file).
//  - The exact original byte length is reproduced by capturing the trailing zero
//    pad (end-of-cells → end-of-buffer) as _trailingPad and re-emitting it.
//  - Per-cell muStartIndex / muCount describe the partition (each cell owns the
//    contiguous run [muStartIndex, muStartIndex+muCount) of the instance array).
//    They are written VERBATIM, not recomputed: some external tools (and the
//    "add new instances" workflow) need to set the partition by hand, so the
//    editor exposes both fields and the writer trusts the model. For a
//    well-formed file muStartIndex is the running sum of prior muCount, so an
//    untouched resource still round-trips byte-exact.

import { BinReader, BinWriter } from './binTools';
import { PROP_TYPE_ID_MASK, PROP_TYPE_ID_BITS } from './propTypes';

// =============================================================================
// Flags
// =============================================================================

// The upper 6 bits of muTypeIdAndFlags. Values are the flag bit positions within
// that 6-bit field (i.e. pre-shift); the wiki's KI_PROP_FLAG_DISABLEPHYSICS is
// bit value 1 within the field.
export const PROP_INSTANCE_FLAGS = {
	DISABLE_PHYSICS: 0x1,
} as const;

// =============================================================================
// Rotation byte (the on-disk i8 the wiki labels mn8RotSpeed) — the top 2 bits
// select the spinning axis (mask 0xC0) and the low 6 bits are the speed magnitude.
// =============================================================================

export const PROP_ROT_AXIS_MASK = 0xc0;
export const PROP_ROT_SPEED_MASK = 0x3f;

// Axis values stored in bits 6-7. 0x40/0x80/0xC0 are the known Y/Z/None values;
// 0x00 also occurs on disk (notably static props with speed 0) — treated as
// "unset" here.
export const PROP_ROT_AXIS = {
	UNSET: 0x00,
	Y: 0x40,
	Z: 0x80,
	NONE: 0xc0,
} as const;

// =============================================================================
// Types
// =============================================================================

/** 16 f32, row-major Matrix44Affine. Translation is indices 12,13,14 (world X,Y,Z). */
type Matrix44 = number[];

export type PropInstance = {
	mWorldTransform: Matrix44;          // 16 f32
	typeId: number;                     // muTypeIdAndFlags & 0x03FFFFFF (index into prop-types)
	flags: number;                      // muTypeIdAndFlags >>> 26 (6-bit field)
	muInstanceID: number;               // u32
	muAlternativeType: number;          // u16, 0xFFFF = none
	// The on-disk rotation byte (the field the wiki/old model called "mn8RotSpeed")
	// packs TWO things: the spinning AXIS in the top 2 bits (mask 0xC0; 0x40 Y /
	// 0x80 Z / 0xC0 none) and the speed magnitude in the low 6 bits. We model them
	// separately so the editor can edit each; the writer recombines
	// `(axis & 0xC0) | (speed & 0x3F)` byte-exactly.
	mRotationAxis: number;              // byte & 0xC0 — one of 0x00, 0x40(Y), 0x80(Z), 0xC0(none)
	mn8RotSpeed: number;                // byte & 0x3F — rotation speed magnitude (0..63)
	mn8MaxAngle: number;                // u8
	mn8MinAngle: number;                // u8
	// u8[3] trailing pad on the on-disk record — zero, preserved verbatim.
	_pad4D: [number, number, number];
};

export type PropCell = {
	muX: number;                        // PropCellId.muX — grid coord
	muZ: number;                        // PropCellId.muZ — grid coord
	// First instance index this cell owns, and how many it owns. The partition
	// is editable (see the round-trip note in the file header) — both are
	// written verbatim. For a well-formed file muStartIndex equals the running
	// sum of prior cells' muCount.
	muStartIndex: number;               // u16
	muCount: number;                    // u16
	muNumberOfRespawnDifferent: number; // u16, ordered first within the cell
	muNumberOfDontRespawn: number;      // u16, ordered after the respawn-different ones
};

export type ParsedPropInstanceData = {
	muZoneId: number;                   // track-unit / zone id (editable)
	// Internal stored size field; does NOT equal the buffer length. Editable and
	// written verbatim (not derived) — its exact formula is not pinned down, so the
	// editor exposes it for hand-fixing rather than auto-recomputing it on write.
	muSizeInBytes: number;
	// Total RUNTIME instance slots = muNumberOfProps + the sum of every prop's part
	// count (each prop and each of its parts takes one slot when a zone loads). So
	// it is >= the stored prop-record count (instances.length). The part counts come
	// from the PropGraphicsList (0x10010) catalogue, not this resource, so it can't
	// be recomputed here. Editable and written verbatim (not derived): adding prop
	// instances makes it stale, so the editor exposes it for hand-fixing.
	muNumberOfInstances: number;
	instances: PropInstance[];
	cells: PropCell[];
	// Bytes from end-of-cells to end-of-buffer (all zero). Re-emitted verbatim so
	// the exact original buffer length is reproduced.
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

const HEADER_SIZE_32 = 0x20;
const INSTANCE_RECORD_SIZE = 0x50;
const CELL_RECORD_SIZE = 0x0c;
const MATRIX_FLOATS = 16;
const INSTANCES_OFFSET = 0x20; // maInstances is always 0x20

// =============================================================================
// Reader
// =============================================================================

export function parsePropInstanceData(raw: Uint8Array, littleEndian = true): ParsedPropInstanceData {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header (32 bytes) ---
	const maCells = r.readU32();
	const muNumCells = r.readU8();
	r.readU8(); r.readU8(); r.readU8();          // 3 pad
	const maInstances = r.readU32();
	const muSizeInBytes = r.readU32();
	const muNumberOfInstances = r.readU32();
	const muNumberOfProps = r.readU32();
	const muZoneId = r.readU16();
	r.readU16();                                  // 2 pad (0x1A)
	r.readU32();                                  // 4 pad (0x1C) — header padded up to maInstances (0x20)

	// The layout is rigid; bail loudly if a populated fixture violates it rather
	// than silently producing a broken model that won't round-trip. An empty
	// prop zone is the exception — it stores null (0) pointers, so only validate
	// each pointer when its array is actually present.
	const instancesEnd = INSTANCES_OFFSET + muNumberOfProps * INSTANCE_RECORD_SIZE;
	if (muNumberOfProps > 0 && maInstances !== INSTANCES_OFFSET) {
		throw new Error(`PropInstanceData: maInstances is 0x${maInstances.toString(16)}, expected 0x20 (rigid layout)`);
	}
	if (muNumCells > 0 && maCells !== instancesEnd) {
		throw new Error(`PropInstanceData: maCells is 0x${maCells.toString(16)}, expected 0x${instancesEnd.toString(16)} for ${muNumberOfProps} props`);
	}

	// --- Instances (80 bytes each, at 0x20) ---
	const instances: PropInstance[] = [];
	r.position = INSTANCES_OFFSET;
	for (let i = 0; i < muNumberOfProps; i++) {
		const mWorldTransform: number[] = [];
		for (let f = 0; f < MATRIX_FLOATS; f++) mWorldTransform.push(r.readF32());
		const muTypeIdAndFlags = r.readU32();
		const muInstanceID = r.readU32();
		const muAlternativeType = r.readU16();
		// Rotation byte: top 2 bits = spinning axis, low 6 bits = speed magnitude.
		const rotByte = r.readU8();
		const mn8MaxAngle = r.readU8();
		const mn8MinAngle = r.readU8();
		const pad0 = r.readU8();
		const pad1 = r.readU8();
		const pad2 = r.readU8();
		instances.push({
			mWorldTransform,
			typeId: muTypeIdAndFlags & PROP_TYPE_ID_MASK,
			flags: muTypeIdAndFlags >>> PROP_TYPE_ID_BITS,
			muInstanceID,
			muAlternativeType,
			mRotationAxis: rotByte & PROP_ROT_AXIS_MASK,
			mn8RotSpeed: rotByte & PROP_ROT_SPEED_MASK,
			mn8MaxAngle,
			mn8MinAngle,
			_pad4D: [pad0, pad1, pad2],
		});
	}

	// --- Cells (12 bytes each, immediately after instances) ---
	// Read from the layout offset, not the stored maCells pointer: the two are
	// equal for populated zones (asserted above) but maCells is null (0) for an
	// empty zone, so trusting it would mis-seek to offset 0.
	const cells: PropCell[] = [];
	r.position = instancesEnd;
	for (let i = 0; i < muNumCells; i++) {
		const muX = r.readU16();
		const muZ = r.readU16();
		const muStartIndex = r.readU16();
		const muCount = r.readU16();
		const muNumberOfRespawnDifferent = r.readU16();
		const muNumberOfDontRespawn = r.readU16();
		cells.push({
			muX, muZ, muStartIndex, muCount,
			muNumberOfRespawnDifferent, muNumberOfDontRespawn,
		});
	}

	// --- Trailing pad (all zero) — captured to reproduce the exact length. ---
	const cellsEnd = instancesEnd + muNumCells * CELL_RECORD_SIZE;
	const _trailingPad = cellsEnd < raw.byteLength
		? raw.slice(cellsEnd, raw.byteLength)
		: new Uint8Array(0);

	return {
		muZoneId,
		muSizeInBytes,
		muNumberOfInstances,
		instances,
		cells,
		_trailingPad,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writePropInstanceData(model: ParsedPropInstanceData, littleEndian = true): Uint8Array {
	const { instances, cells } = model;
	const muNumberOfProps = instances.length;

	// Layout offsets (where the arrays physically live) recomputed from the
	// counts — never trust stored values.
	const instancesEnd = INSTANCES_OFFSET + muNumberOfProps * INSTANCE_RECORD_SIZE;
	const cellsEnd = instancesEnd + cells.length * CELL_RECORD_SIZE;
	const totalSize = cellsEnd + model._trailingPad.byteLength;

	// Stored pointers are null (0) when their array is empty — reproduces the
	// all-zero header an empty prop zone ships, keeping the round-trip byte-exact.
	const maInstances = muNumberOfProps > 0 ? INSTANCES_OFFSET : 0;
	const maCells = cells.length > 0 ? instancesEnd : 0;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (32 bytes) ---
	w.writeU32(maCells);
	w.writeU8(cells.length & 0xff);
	w.writeU8(0); w.writeU8(0); w.writeU8(0);    // 3 pad
	w.writeU32(maInstances);
	w.writeU32(model.muSizeInBytes);             // verbatim — not the buffer length
	w.writeU32(model.muNumberOfInstances);       // verbatim — distinct from prop count
	w.writeU32(muNumberOfProps);
	w.writeU16(model.muZoneId);
	w.writeU16(0);                               // 2 pad (0x1A)
	w.writeU32(0);                               // 4 pad (0x1C) — header padded up to maInstances (0x20)
	if (w.offset !== HEADER_SIZE_32) throw new Error(`PropInstanceData writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE_32}`);

	// --- Instances (80 bytes each) ---
	for (const inst of instances) {
		for (let f = 0; f < MATRIX_FLOATS; f++) w.writeF32(inst.mWorldTransform[f] ?? 0);
		// Recombine the type id (lower 26 bits) and the 6-bit flags field.
		const muTypeIdAndFlags = (((inst.flags << PROP_TYPE_ID_BITS) >>> 0) | (inst.typeId & PROP_TYPE_ID_MASK)) >>> 0;
		w.writeU32(muTypeIdAndFlags);
		w.writeU32(inst.muInstanceID);
		w.writeU16(inst.muAlternativeType);
		// Recombine the rotation byte from the split axis (top 2 bits) + speed
		// (low 6 bits) — byte-exact since the two masks are disjoint and cover 0xFF.
		w.writeU8(((inst.mRotationAxis & PROP_ROT_AXIS_MASK) | (inst.mn8RotSpeed & PROP_ROT_SPEED_MASK)) & 0xff);
		w.writeU8(inst.mn8MaxAngle);
		w.writeU8(inst.mn8MinAngle);
		w.writeU8(inst._pad4D[0]);
		w.writeU8(inst._pad4D[1]);
		w.writeU8(inst._pad4D[2]);
	}
	if (w.offset !== instancesEnd) throw new Error(`PropInstanceData writer: cells offset mismatch ${w.offset} vs ${instancesEnd}`);

	// --- Cells (12 bytes each) — muStartIndex / muCount written VERBATIM so the
	// editor can set the partition by hand (e.g. after adding instances). The
	// caller owns keeping it self-consistent; for an untouched file the stored
	// muStartIndex already equals the running sum, so this stays byte-exact.
	for (const cell of cells) {
		w.writeU16(cell.muX);
		w.writeU16(cell.muZ);
		w.writeU16(cell.muStartIndex);
		w.writeU16(cell.muCount);
		w.writeU16(cell.muNumberOfRespawnDifferent);
		w.writeU16(cell.muNumberOfDontRespawn);
	}
	if (w.offset !== cellsEnd) throw new Error(`PropInstanceData writer: trailing-pad offset mismatch ${w.offset} vs ${cellsEnd}`);

	// --- Trailing pad (verbatim zeros) — reproduces the exact original length. ---
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}
