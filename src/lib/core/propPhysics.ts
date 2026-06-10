// PropPhysics parser and writer (resource type 0x1000F).
//
// The global prop-physics catalogue (PROPS/PROPPHYSICS.BUNDLE): one
// PropTypeData per prop type holding collision attributes — mass, inertia,
// speed thresholds for lean/move/smash (MPH), joint behaviour — plus the
// rw::collision Volumes the prop collides with, and optional breakable
// "parts" with their own mass/volumes. PropInstanceData (0x10011) placements
// reference these entries by index: PropTypeData[i] is the physics of
// PROP_TYPES[i] in propTypes.ts (verified: mResourceId / muSceneUriId match
// the wiki prop-types table at every index, 247 entries both).
//
// The wiki claims the volumes "are always box volumes" — retail disagrees:
// 442 boxes, 37 capsules, 1 sphere. The 12-byte type-specific union is
// modeled as three f32 lanes with per-type meaning (box: hx/hy/hz half
// extents; capsule: half height + 2 unused; sphere: all unused).
//
// On-disk layout (32-bit PC, little-endian):
//   header 0x2C94: counts, muSizeInBytes (== total resource size), then three
//   FIXED pointer tables — PropTypeData*[500] @0x10, PropPartTypeData*[300]
//   @0x7E0, Volume*[2048] @0xC90 — and muTimeStamp @0x2C90 (0 in Remastered).
//   Data region @0x2CA0 (12 pad bytes after the header), tiled exactly by the
//   records in canonical order: for each prop type — PropTypeData(0x70), its
//   parts(0x30 each), its own volumes(0x60 each), then each part's volumes in
//   part order. Verified: the 910 retail records tile [0x2CA0, end) with zero
//   gaps/overlaps, and the tables list records in that same file order.
//
// Round-trip strategy: every pointer is recomputed from the canonical layout
// on write — the parser ASSERTS the stored pointers match the derived ones,
// so a violating resource fails loudly instead of round-tripping wrong. The
// one exception: records whose count is 0 store an UNINITIALISED pointer
// (e.g. maParts = 0xfa62e800 garbage, not null) — preserved verbatim in
// `_raw*Ptr` fields and re-emitted as-is for byte-exact output.

import { BinReader, BinWriter } from './binTools';

// =============================================================================
// Enumerations
// =============================================================================

/** rw::collision::VolumeType — stored in the in-asset vTable slot. */
export const VOLUME_TYPE = {
	NULL: 0,
	SPHERE: 1,
	CAPSULE: 2,
	TRIANGLE: 3,
	BOX: 4,
	CYLINDER: 5,
	AGGREGATE: 6,
} as const;

export const VOLUME_TYPE_LABELS: Record<number, string> = {
	0: 'Null',
	1: 'Sphere',
	2: 'Capsule',
	3: 'Triangle',
	4: 'Box',
	5: 'Cylinder',
	6: 'Aggregate',
};

/** rw::collision::VolumeFlag — only ISENABLED is seen in retail PropPhysics. */
export const VOLUME_FLAGS = {
	IS_ENABLED: 0x1,
} as const;

/** PropTypeData.mu8JointType. */
export const PROP_JOINT_TYPES = [
	{ value: 0, label: 'None' },
	{ value: 1, label: 'Lean' },
	{ value: 2, label: 'Tilt (E_TILT)' },
] as const;

// =============================================================================
// Types
// =============================================================================

type Vec3 = { x: number; y: number; z: number };

export type PropPhysicsVolume = {
	/** Matrix44Affine local transform (16 f32) — volume placement relative to the prop model. */
	mTransform: number[];
	/** rw::collision::VolumeType (in-asset vTable slot). Retail: box/capsule/sphere. */
	vType: number;
	/**
	 * The 12-byte type-specific union as three f32 lanes.
	 * Box: hx/hy/hz half extents. Capsule: half height, rest unused.
	 * Sphere: all unused (size lives in mfRadius).
	 */
	mUnion: [number, number, number];
	/** Sphere radius / capsule cap radius / box edge fattening. */
	mfRadius: number;
	muGroupID: number;
	muSurfaceID: number;
	/** rw::collision::VolumeFlag bits — 0x1 IS_ENABLED in retail. */
	muFlags: number;
};

export type PropPartType = {
	/** Positional offset of the part relative to the prop model. */
	mOffset: Vec3;
	/** Inertia (likely kg·m²). */
	mInertia: Vec3;
	/** Mass (kg). */
	mfMass: number;
	mfSphereRadius: number;
	volumes: PropPhysicsVolume[];
	/** Stored maCollisionVolumes — garbage (not null) when volumes is empty; preserved verbatim. */
	_rawVolsPtr: number;
	/** u8[3] record pad — preserved verbatim. */
	_pad2D: [number, number, number];
};

export type PropPhysicsType = {
	/** Location of the joint relative to the prop model. */
	mJointLocator: Vec3;
	/** Centre-of-mass offset. */
	mCOMOffset: Vec3;
	/** Inertia (likely kg·m²). */
	mInertia: Vec3;
	/** Model resource ID — matches PROP_TYPES[index].resourceId. */
	mResourceId: bigint;
	/** Mass (kg). */
	mfMass: number;
	mfSphereRadius: number;
	/** Cosine of the maximum joint angle. */
	mfMaxJointAngleCos: number;
	/** Speed required to make the prop lean (MPH). */
	mfLeanThreshold: number;
	/** Speed required to move the prop (MPH). */
	mfMoveThreshold: number;
	/** Speed required to smash the prop (MPH). Only props with parts can be smashed. */
	mfSmashThreshold: number;
	/** Model GameDB ID — matches PROP_TYPES[index].gameDbId. */
	muSceneUriId: number;
	/** Always 0 in retail; seemingly unused. */
	muMaxState: number;
	/** PROP_JOINT_TYPES. */
	mu8JointType: number;
	/** 1 = is overhead sign. */
	mu8ExtraTypeInfo: number;
	parts: PropPartType[];
	volumes: PropPhysicsVolume[];
	/** Stored maCollisionVolumes / maParts — garbage when the array is empty; preserved verbatim. */
	_rawVolsPtr: number;
	_rawPartsPtr: number;
	/** u8[15] record tail pad — preserved verbatim. */
	_padTail: number[];
};

export type ParsedPropPhysics = {
	propTypes: PropPhysicsType[];
	/** time_t build stamp — 0 (null) in Remastered. */
	muTimeStamp: number;
};

// =============================================================================
// Constants
// =============================================================================

const PROP_TABLE_OFFSET = 0x10;
const PROP_TABLE_SLOTS = 500;
const PART_TABLE_OFFSET = 0x7e0;
const PART_TABLE_SLOTS = 300;
const VOL_TABLE_OFFSET = 0xc90;
const VOL_TABLE_SLOTS = 2048;
const TIMESTAMP_OFFSET = 0x2c90;
// Header ends 0x2C94; the data region starts at the next 16-byte boundary.
const DATA_OFFSET = 0x2ca0;

const PROP_RECORD_SIZE = 0x70;
const PART_RECORD_SIZE = 0x30;
const VOLUME_RECORD_SIZE = 0x60;
const MATRIX_FLOATS = 16;
const PROP_TAIL_PAD = 0xf;

// =============================================================================
// Layout derivation — shared by the parser (for asserts) and the writer.
// =============================================================================

/** Byte size of one prop type's canonical span: record + parts + all volumes. */
function propSpanSize(t: { parts: { volumes: unknown[] }[]; volumes: unknown[] }): number {
	const partVols = t.parts.reduce((n, p) => n + p.volumes.length, 0);
	return (
		PROP_RECORD_SIZE +
		t.parts.length * PART_RECORD_SIZE +
		(t.volumes.length + partVols) * VOLUME_RECORD_SIZE
	);
}

// =============================================================================
// Reader
// =============================================================================

function readVec3(r: BinReader, what: string): Vec3 {
	const x = r.readF32();
	const y = r.readF32();
	const z = r.readF32();
	const w = r.readF32();
	// The vpu Vector3's unused fourth lane is 0 in every retail record. Bail
	// loudly rather than silently dropping data the writer can't reproduce.
	if (w !== 0) throw new Error(`PropPhysics: non-zero Vector3 pad lane in ${what} (${w})`);
	return { x, y, z };
}

function readVolume(r: BinReader): PropPhysicsVolume {
	const mTransform: number[] = [];
	for (let i = 0; i < MATRIX_FLOATS; i++) mTransform.push(r.readF32());
	const vType = r.readU32();
	const mUnion: [number, number, number] = [r.readF32(), r.readF32(), r.readF32()];
	const mfRadius = r.readF32();
	const muGroupID = r.readU32();
	const muSurfaceID = r.readU32();
	const muFlags = r.readU32();
	return { mTransform, vType, mUnion, mfRadius, muGroupID, muSurfaceID, muFlags };
}

export function parsePropPhysics(raw: Uint8Array, littleEndian = true): ParsedPropPhysics {
	const r = new BinReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), littleEndian);

	// --- Header counts ---
	const numPropTypes = r.readU32();
	const numVolumes = r.readU32();
	const numParts = r.readU32();
	const muSizeInBytes = r.readU32();
	if (muSizeInBytes !== raw.byteLength) {
		throw new Error(`PropPhysics: muSizeInBytes ${muSizeInBytes} != resource size ${raw.byteLength}`);
	}
	if (numPropTypes > PROP_TABLE_SLOTS || numParts > PART_TABLE_SLOTS || numVolumes > VOL_TABLE_SLOTS) {
		throw new Error(`PropPhysics: counts ${numPropTypes}/${numParts}/${numVolumes} overflow the fixed tables`);
	}

	// --- Pointer tables (counts must occupy a contiguous prefix; rest null) ---
	const readTable = (offset: number, slots: number, used: number, what: string): number[] => {
		const ptrs: number[] = [];
		r.position = offset;
		for (let i = 0; i < slots; i++) {
			const p = r.readU32();
			if (i < used) {
				if (p === 0) throw new Error(`PropPhysics: null ${what} table slot ${i} inside the used prefix`);
				ptrs.push(p);
			} else if (p !== 0) {
				throw new Error(`PropPhysics: non-null ${what} table slot ${i} beyond count ${used}`);
			}
		}
		return ptrs;
	};
	const propPtrs = readTable(PROP_TABLE_OFFSET, PROP_TABLE_SLOTS, numPropTypes, 'prop');
	const partPtrs = readTable(PART_TABLE_OFFSET, PART_TABLE_SLOTS, numParts, 'part');
	const volPtrs = readTable(VOL_TABLE_OFFSET, VOL_TABLE_SLOTS, numVolumes, 'volume');
	r.position = TIMESTAMP_OFFSET;
	const muTimeStamp = r.readU32();

	// --- Records, walked in canonical layout order with stored-pointer asserts ---
	let cursor = DATA_OFFSET;
	let partTableIdx = 0;
	let volTableIdx = 0;
	const expectTableEntry = (table: number[], idx: number, off: number, what: string) => {
		if (table[idx] !== off) {
			throw new Error(`PropPhysics: ${what} table[${idx}] = 0x${(table[idx] ?? 0).toString(16)}, expected 0x${off.toString(16)} (canonical order violated)`);
		}
	};

	const propTypes: PropPhysicsType[] = [];
	for (let i = 0; i < numPropTypes; i++) {
		expectTableEntry(propPtrs, i, cursor, 'prop');
		r.position = cursor;
		const mJointLocator = readVec3(r, `propType[${i}].mJointLocator`);
		const mCOMOffset = readVec3(r, `propType[${i}].mCOMOffset`);
		const mInertia = readVec3(r, `propType[${i}].mInertia`);
		const mResourceId = r.readU64();
		const mfMass = r.readF32();
		const rawVolsPtr = r.readU32();
		const rawPartsPtr = r.readU32();
		const mfSphereRadius = r.readF32();
		const mfMaxJointAngleCos = r.readF32();
		const mfLeanThreshold = r.readF32();
		const mfMoveThreshold = r.readF32();
		const mfSmashThreshold = r.readF32();
		const muSceneUriId = r.readU32();
		const muMaxState = r.readU8();
		const numOwnParts = r.readU8();
		const numOwnVols = r.readU8();
		const mu8JointType = r.readU8();
		const mu8ExtraTypeInfo = r.readU8();
		const _padTail: number[] = [];
		for (let b = 0; b < PROP_TAIL_PAD; b++) _padTail.push(r.readU8());

		// Canonical span layout: parts, then prop volumes, then per-part volumes.
		const partsStart = cursor + PROP_RECORD_SIZE;
		const propVolsStart = partsStart + numOwnParts * PART_RECORD_SIZE;
		const partVolsStart = propVolsStart + numOwnVols * VOLUME_RECORD_SIZE;
		if (numOwnParts > 0 && rawPartsPtr !== partsStart) {
			throw new Error(`PropPhysics: propType[${i}] maParts 0x${rawPartsPtr.toString(16)} != derived 0x${partsStart.toString(16)}`);
		}
		if (numOwnVols > 0 && rawVolsPtr !== propVolsStart) {
			throw new Error(`PropPhysics: propType[${i}] maCollisionVolumes 0x${rawVolsPtr.toString(16)} != derived 0x${propVolsStart.toString(16)}`);
		}

		// Parts (their volumes live after the prop's own volumes, in part order).
		const parts: PropPartType[] = [];
		let nextPartVols = partVolsStart;
		let partVolsSoFar = 0;
		for (let p = 0; p < numOwnParts; p++) {
			const partOff = partsStart + p * PART_RECORD_SIZE;
			expectTableEntry(partPtrs, partTableIdx++, partOff, 'part');
			r.position = partOff;
			const mOffset = readVec3(r, `propType[${i}].part[${p}].mOffset`);
			const partInertia = readVec3(r, `propType[${i}].part[${p}].mInertia`);
			const partMass = r.readF32();
			const partRawVolsPtr = r.readU32();
			const partSphereRadius = r.readF32();
			const partNumVols = r.readU8();
			const _pad2D: [number, number, number] = [r.readU8(), r.readU8(), r.readU8()];
			if (partNumVols > 0 && partRawVolsPtr !== nextPartVols) {
				throw new Error(`PropPhysics: propType[${i}].part[${p}] maCollisionVolumes 0x${partRawVolsPtr.toString(16)} != derived 0x${nextPartVols.toString(16)}`);
			}
			const volumes: PropPhysicsVolume[] = [];
			for (let v = 0; v < partNumVols; v++) {
				const volOff = nextPartVols + v * VOLUME_RECORD_SIZE;
				expectTableEntry(volPtrs, volTableIdx + numOwnVols + partVolsSoFar + v, volOff, 'volume');
				r.position = volOff;
				volumes.push(readVolume(r));
			}
			nextPartVols += partNumVols * VOLUME_RECORD_SIZE;
			partVolsSoFar += partNumVols;
			parts.push({
				mOffset,
				mInertia: partInertia,
				mfMass: partMass,
				mfSphereRadius: partSphereRadius,
				volumes,
				_rawVolsPtr: partRawVolsPtr,
				_pad2D,
			});
		}

		// The prop's own volumes (they precede the part volumes on disk, and in
		// the volume table).
		const volumes: PropPhysicsVolume[] = [];
		for (let v = 0; v < numOwnVols; v++) {
			const volOff = propVolsStart + v * VOLUME_RECORD_SIZE;
			expectTableEntry(volPtrs, volTableIdx + v, volOff, 'volume');
			r.position = volOff;
			volumes.push(readVolume(r));
		}
		volTableIdx += numOwnVols + parts.reduce((n, p) => n + p.volumes.length, 0);

		const t: PropPhysicsType = {
			mJointLocator,
			mCOMOffset,
			mInertia,
			mResourceId,
			mfMass,
			mfSphereRadius,
			mfMaxJointAngleCos,
			mfLeanThreshold,
			mfMoveThreshold,
			mfSmashThreshold,
			muSceneUriId,
			muMaxState,
			mu8JointType,
			mu8ExtraTypeInfo,
			parts,
			volumes,
			_rawVolsPtr: rawVolsPtr,
			_rawPartsPtr: rawPartsPtr,
			_padTail,
		};
		cursor += propSpanSize(t);
		propTypes.push(t);
	}

	if (cursor !== raw.byteLength) {
		throw new Error(`PropPhysics: records end at 0x${cursor.toString(16)}, expected 0x${raw.byteLength.toString(16)} (data region must tile exactly)`);
	}
	if (volTableIdx !== numVolumes || partTableIdx !== numParts) {
		throw new Error(`PropPhysics: walked ${volTableIdx} volumes / ${partTableIdx} parts, header says ${numVolumes} / ${numParts}`);
	}

	return { propTypes, muTimeStamp };
}

// =============================================================================
// Writer
// =============================================================================

function writeVec3(w: BinWriter, v: Vec3) {
	w.writeF32(v.x);
	w.writeF32(v.y);
	w.writeF32(v.z);
	w.writeF32(0);
}

function writeVolume(w: BinWriter, v: PropPhysicsVolume) {
	for (let i = 0; i < MATRIX_FLOATS; i++) w.writeF32(v.mTransform[i] ?? 0);
	w.writeU32(v.vType);
	w.writeF32(v.mUnion[0]);
	w.writeF32(v.mUnion[1]);
	w.writeF32(v.mUnion[2]);
	w.writeF32(v.mfRadius);
	w.writeU32(v.muGroupID);
	w.writeU32(v.muSurfaceID);
	w.writeU32(v.muFlags);
}

export function writePropPhysics(model: ParsedPropPhysics, littleEndian = true): Uint8Array {
	const { propTypes } = model;
	const numParts = propTypes.reduce((n, t) => n + t.parts.length, 0);
	const numVolumes = propTypes.reduce(
		(n, t) => n + t.volumes.length + t.parts.reduce((m, p) => m + p.volumes.length, 0),
		0,
	);
	if (propTypes.length > PROP_TABLE_SLOTS || numParts > PART_TABLE_SLOTS || numVolumes > VOL_TABLE_SLOTS) {
		throw new Error(`PropPhysics writer: ${propTypes.length} types / ${numParts} parts / ${numVolumes} volumes overflow the fixed tables`);
	}

	const totalSize = DATA_OFFSET + propTypes.reduce((n, t) => n + propSpanSize(t), 0);
	const w = new BinWriter(totalSize, littleEndian);

	// --- Header counts ---
	w.writeU32(propTypes.length);
	w.writeU32(numVolumes);
	w.writeU32(numParts);
	w.writeU32(totalSize); // muSizeInBytes — equals the resource size in retail

	// --- Pointer tables, derived from the canonical layout ---
	const propOffsets: number[] = [];
	const partOffsets: number[] = [];
	const volOffsets: number[] = [];
	{
		let cursor = DATA_OFFSET;
		for (const t of propTypes) {
			propOffsets.push(cursor);
			const partsStart = cursor + PROP_RECORD_SIZE;
			const propVolsStart = partsStart + t.parts.length * PART_RECORD_SIZE;
			for (let p = 0; p < t.parts.length; p++) partOffsets.push(partsStart + p * PART_RECORD_SIZE);
			for (let v = 0; v < t.volumes.length; v++) volOffsets.push(propVolsStart + v * VOLUME_RECORD_SIZE);
			let partVolCursor = propVolsStart + t.volumes.length * VOLUME_RECORD_SIZE;
			for (const p of t.parts) {
				for (let v = 0; v < p.volumes.length; v++) volOffsets.push(partVolCursor + v * VOLUME_RECORD_SIZE);
				partVolCursor += p.volumes.length * VOLUME_RECORD_SIZE;
			}
			cursor += propSpanSize(t);
		}
	}
	const writeTable = (offsets: number[], slots: number) => {
		for (let i = 0; i < slots; i++) w.writeU32(offsets[i] ?? 0);
	};
	writeTable(propOffsets, PROP_TABLE_SLOTS);
	writeTable(partOffsets, PART_TABLE_SLOTS);
	writeTable(volOffsets, VOL_TABLE_SLOTS);
	w.writeU32(model.muTimeStamp);
	w.writeZeroes(DATA_OFFSET - 0x2c94); // header → data-region alignment pad
	if (w.offset !== DATA_OFFSET) throw new Error(`PropPhysics writer: data offset mismatch ${w.offset}`);

	// --- Records in canonical order ---
	for (const t of propTypes) {
		const recordStart = w.offset;
		const partsStart = recordStart + PROP_RECORD_SIZE;
		const propVolsStart = partsStart + t.parts.length * PART_RECORD_SIZE;
		writeVec3(w, t.mJointLocator);
		writeVec3(w, t.mCOMOffset);
		writeVec3(w, t.mInertia);
		w.writeU64(t.mResourceId);
		w.writeF32(t.mfMass);
		// Empty arrays keep their original (uninitialised) pointer bytes.
		w.writeU32(t.volumes.length > 0 ? propVolsStart : t._rawVolsPtr);
		w.writeU32(t.parts.length > 0 ? partsStart : t._rawPartsPtr);
		w.writeF32(t.mfSphereRadius);
		w.writeF32(t.mfMaxJointAngleCos);
		w.writeF32(t.mfLeanThreshold);
		w.writeF32(t.mfMoveThreshold);
		w.writeF32(t.mfSmashThreshold);
		w.writeU32(t.muSceneUriId);
		w.writeU8(t.muMaxState);
		w.writeU8(t.parts.length);
		w.writeU8(t.volumes.length);
		w.writeU8(t.mu8JointType);
		w.writeU8(t.mu8ExtraTypeInfo);
		for (let b = 0; b < PROP_TAIL_PAD; b++) w.writeU8(t._padTail[b] ?? 0);

		let partVolCursor = propVolsStart + t.volumes.length * VOLUME_RECORD_SIZE;
		const partVolStarts: number[] = [];
		for (const p of t.parts) {
			partVolStarts.push(partVolCursor);
			partVolCursor += p.volumes.length * VOLUME_RECORD_SIZE;
		}
		t.parts.forEach((p, idx) => {
			writeVec3(w, p.mOffset);
			writeVec3(w, p.mInertia);
			w.writeF32(p.mfMass);
			w.writeU32(p.volumes.length > 0 ? partVolStarts[idx] : p._rawVolsPtr);
			w.writeF32(p.mfSphereRadius);
			w.writeU8(p.volumes.length);
			w.writeU8(p._pad2D[0]);
			w.writeU8(p._pad2D[1]);
			w.writeU8(p._pad2D[2]);
		});
		for (const v of t.volumes) writeVolume(w, v);
		for (const p of t.parts) for (const v of p.volumes) writeVolume(w, v);
	}

	if (w.offset !== totalSize) throw new Error(`PropPhysics writer: wrote ${w.offset} bytes, expected ${totalSize}`);
	return w.bytes;
}
