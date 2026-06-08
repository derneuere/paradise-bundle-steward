// PropInstanceData parser and writer (resource type 0x10011).
//
// A PropZoneData places "props" (signs, lampposts, cones, spinning billboards,
// collectibles, …) into a track unit. The resource is a flat array of
// PropInstanceData records partitioned into spatial cells (a coarse XZ grid) so
// the runtime can stream/spawn props near the player. Each instance references a
// prop type (an index into prop-types — see propTypes.ts) and carries a full
// world transform.
//
// Ordering is load-bearing: within a cell the instances are grouped by respawn
// behaviour (muNumberOfRespawnDifferent first, then muNumberOfDontRespawn, then
// the rest). Collectibles and other respawn-sensitive props only work when laid
// out in that order, so the round-trip MUST preserve instance order within each
// cell exactly. The parser keeps the array as-is and the writer never reorders.
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
//    a larger logical count distinct from the stored record count. Both are
//    preserved verbatim on the model so the writer reproduces them exactly.
//  - The exact original byte length is reproduced by capturing the trailing zero
//    pad (end-of-cells → end-of-buffer) as _trailingPad and re-emitting it.
//  - Per-cell muStartIndex / muCount are derived from the partition (cells own a
//    contiguous run of instances) and recomputed on write.

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
	mn8RotSpeed: number;                // i8
	mn8MaxAngle: number;                // u8
	mn8MinAngle: number;                // u8
	// u8[3] trailing pad on the on-disk record — zero, preserved verbatim.
	_pad4D: [number, number, number];
};

export type PropCell = {
	muX: number;                        // PropCellId.muX — grid coord
	muZ: number;                        // PropCellId.muZ — grid coord
	muStartIndex: number;               // derived: running sum of prior muCount
	muCount: number;                    // derived: instances owned by this cell
	muNumberOfRespawnDifferent: number; // u16, ordered first within the cell
	muNumberOfDontRespawn: number;      // u16, ordered after the respawn-different ones
};

export type ParsedPropInstanceData = {
	muZoneId: number;                   // track-unit / zone id (editable)
	// Internal stored size field; does NOT equal the buffer length — preserved
	// verbatim so the writer reproduces the original header byte-for-byte.
	muSizeInBytes: number;
	// A larger logical count distinct from the stored record count (meaning not
	// fully understood) — preserved verbatim.
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
		const mn8RotSpeed = r.readI8();
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
			mn8RotSpeed,
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
		w.writeI8(inst.mn8RotSpeed);
		w.writeU8(inst.mn8MaxAngle);
		w.writeU8(inst.mn8MinAngle);
		w.writeU8(inst._pad4D[0]);
		w.writeU8(inst._pad4D[1]);
		w.writeU8(inst._pad4D[2]);
	}
	if (w.offset !== instancesEnd) throw new Error(`PropInstanceData writer: cells offset mismatch ${w.offset} vs ${instancesEnd}`);

	// --- Cells (12 bytes each) — muStartIndex / muCount derived from the
	// partition: each cell consumes the next muCount instances contiguously. We
	// recompute muStartIndex as the running sum of the cells' muCount so the
	// partition stays self-consistent after edits.
	let runningStart = 0;
	for (const cell of cells) {
		w.writeU16(cell.muX);
		w.writeU16(cell.muZ);
		w.writeU16(runningStart);
		w.writeU16(cell.muCount);
		w.writeU16(cell.muNumberOfRespawnDifferent);
		w.writeU16(cell.muNumberOfDontRespawn);
		runningStart += cell.muCount;
	}
	if (w.offset !== cellsEnd) throw new Error(`PropInstanceData writer: trailing-pad offset mismatch ${w.offset} vs ${cellsEnd}`);

	// --- Trailing pad (verbatim zeros) — reproduces the exact original length. ---
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}
