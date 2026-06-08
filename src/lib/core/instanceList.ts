// InstanceList parser and writer (resource type 0x23, CgsGraphics::InstanceList).
//
// An InstanceList places Models in the world at a transform — it is one of the
// top-level resource types used for track-unit loading. Each track unit's _GR
// bundle carries one InstanceList; rendering it (Model → Renderable per
// instance, positioned by the instance's mTransform) draws the track-unit
// geometry, in the same world space as PropInstanceData so props sit on the
// rendered track. The structure is near-identical to PropInstanceData.
//
// Scope: 32-bit PC, little-endian. The wiki documents a 64-bit (Paradise
// Remastered) layout too; like the other resources we implement 32-bit PC LE
// only.
//
// Round-trip strategy (byte-exact, same approach as PropInstanceData):
//  - The layout is rigid: header(0x10) → instances(0x50 each, at 0x10) →
//    trailing pad. mpaInstances is always 0x10 and muArraySize == instances
//    .length, so both are recomputed on write rather than trusted from disk.
//  - mpModel is stored as 0 on disk: the real Model id is a BND2 import keyed
//    by the instance's mpModel field offset, and parseRaw has no bundle access.
//    The payload round-trips byte-exact from mpModel(0)/pad/transform alone.
//  - The exact original byte length is reproduced by capturing the trailing pad
//    (end-of-array → end-of-buffer) as _trailingPad and re-emitting it verbatim.
//  - muNumInstances (the count of complete/renderable entries) and
//    muVersionNumber are preserved verbatim so the writer reproduces the header
//    byte-for-byte.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Types
// =============================================================================

/** 16 f32, row-major Matrix44Affine. Translation is indices 12,13,14 (world X,Y,Z). */
type Matrix44 = number[];

export type InstanceListEntry = {
	// Raw on-disk pointer (0) — the real Model id is a BND2 import resolved at
	// render time, not stored here. Preserved verbatim for round-trip.
	mpModel: number;
	mi16BackdropZoneID: number;          // i16, -1 when not a backdrop
	mfMaxVisibleDistanceSquared: number; // f32
	mWorldTransform: Matrix44;           // 16 f32
	// Padding slots on the on-disk record — preserved verbatim.
	_pad: { mu16Pad: number; mu32Pad: number };
};

export type ParsedInstanceList = {
	// Count of complete entries (indices 0..muNumInstances-1 have valid
	// transforms + locally-resolvable models). Distinct from muArraySize, which
	// over-allocates. Preserved verbatim.
	muNumInstances: number;
	muVersionNumber: number;             // always 1; preserved verbatim
	instances: InstanceListEntry[];      // length === muArraySize
	// Bytes from end-of-array to end-of-buffer. Re-emitted verbatim so the exact
	// original buffer length is reproduced.
	_trailingPad: Uint8Array;
};

// =============================================================================
// Constants
// =============================================================================

/** Resource type ID for CgsGraphics::InstanceList. */
export const INSTANCE_LIST_TYPE_ID = 0x23;

const HEADER_SIZE = 0x10;
const INSTANCE_RECORD_SIZE = 0x50;
const MATRIX_FLOATS = 16;
const INSTANCES_OFFSET = 0x10; // mpaInstances is always 0x10
const TRANSFORM_OFFSET = 0x10; // mTransform starts at record offset 0x10

// =============================================================================
// Reader
// =============================================================================

export function parseInstanceList(raw: Uint8Array, littleEndian = true): ParsedInstanceList {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header (16 bytes) ---
	const mpaInstances = r.readU32();
	const muArraySize = r.readU32();
	const muNumInstances = r.readU32();
	const muVersionNumber = r.readU32();

	// The layout is rigid; bail loudly if a fixture violates it rather than
	// silently producing a broken model that won't round-trip.
	if (mpaInstances !== INSTANCES_OFFSET) {
		throw new Error(`InstanceList: mpaInstances is 0x${mpaInstances.toString(16)}, expected 0x10 (rigid layout)`);
	}

	// --- Instances (80 bytes each, at 0x10) ---
	const instances: InstanceListEntry[] = [];
	r.position = INSTANCES_OFFSET;
	for (let i = 0; i < muArraySize; i++) {
		const mpModel = r.readU32();
		const mi16BackdropZoneID = r.readI16();
		const mu16Pad = r.readU16();
		const mu32Pad = r.readU32();
		const mfMaxVisibleDistanceSquared = r.readF32();
		const mWorldTransform: number[] = [];
		for (let f = 0; f < MATRIX_FLOATS; f++) mWorldTransform.push(r.readF32());
		instances.push({
			mpModel,
			mi16BackdropZoneID,
			mfMaxVisibleDistanceSquared,
			mWorldTransform,
			_pad: { mu16Pad, mu32Pad },
		});
	}

	// --- Trailing pad — captured to reproduce the exact length. ---
	const arrayEnd = INSTANCES_OFFSET + muArraySize * INSTANCE_RECORD_SIZE;
	const _trailingPad = arrayEnd < raw.byteLength
		? raw.slice(arrayEnd, raw.byteLength)
		: new Uint8Array(0);

	return {
		muNumInstances,
		muVersionNumber,
		instances,
		_trailingPad,
	};
}

// =============================================================================
// Writer
// =============================================================================

export function writeInstanceList(model: ParsedInstanceList, littleEndian = true): Uint8Array {
	const { instances } = model;
	const muArraySize = instances.length;

	// Recompute the rigid pointer from the layout (never trust a stored value).
	const mpaInstances = INSTANCES_OFFSET;
	const arrayEnd = INSTANCES_OFFSET + muArraySize * INSTANCE_RECORD_SIZE;
	const totalSize = arrayEnd + model._trailingPad.byteLength;

	const w = new BinWriter(totalSize, littleEndian);

	// --- Header (16 bytes) ---
	w.writeU32(mpaInstances);
	w.writeU32(muArraySize);
	// Verbatim — distinct from muArraySize (which over-allocates). Clamp so a bulk
	// removal that shrinks the array below the complete-count can't leave
	// muNumInstances > muArraySize; a no-op on every real fixture (muNumInstances ≤ size).
	w.writeU32(Math.min(model.muNumInstances, muArraySize));
	w.writeU32(model.muVersionNumber);  // verbatim
	if (w.offset !== HEADER_SIZE) throw new Error(`InstanceList writer: header offset mismatch ${w.offset} vs ${HEADER_SIZE}`);

	// --- Instances (80 bytes each) ---
	for (const inst of instances) {
		w.writeU32(inst.mpModel);                       // verbatim, 0 on disk
		w.writeI16(inst.mi16BackdropZoneID);
		w.writeU16(inst._pad.mu16Pad);
		w.writeU32(inst._pad.mu32Pad);
		w.writeF32(inst.mfMaxVisibleDistanceSquared);
		for (let f = 0; f < MATRIX_FLOATS; f++) w.writeF32(inst.mWorldTransform[f] ?? 0);
	}
	if (w.offset !== arrayEnd) throw new Error(`InstanceList writer: trailing-pad offset mismatch ${w.offset} vs ${arrayEnd}`);

	// --- Trailing pad (verbatim) — reproduces the exact original length. ---
	if (model._trailingPad.byteLength > 0) w.writeBytes(model._trailingPad);

	return w.bytes;
}

// Record offset of the transform within an Instance — exported so the renderer
// can map a per-instance field offset for import resolution without re-deriving
// the layout.
export const INSTANCE_TRANSFORM_OFFSET = TRANSFORM_OFFSET;
