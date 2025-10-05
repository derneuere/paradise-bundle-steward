// TriggerData schemas, types, and read/write functions (ported from C# Bundle Manager)

import type { ProgressCallback, ResourceEntry, ResourceContext, ParsedBundle } from './types';
import { object, arrayOf, u8, u16, u32, f32, type Parsed } from 'typed-binary';
import { getResourceData, isNestedBundle } from './resourceManager';
import { parseBundle } from './bundle';
import { ResourceNotFoundError, BundleError } from './errors';
import * as pako from 'pako';

// =============================================================================
// typed-binary Schemas (for header and basic structs)
// =============================================================================

export const Vector4Schema = object({
  x: f32,
  y: f32,
  z: f32,
  w: f32
});

export const BoxRegionSchema = object({
  positionX: f32,
  positionY: f32,
  positionZ: f32,
  rotationX: f32,
  rotationY: f32,
  rotationZ: f32,
  dimensionX: f32,
  dimensionY: f32,
  dimensionZ: f32,
});

// TriggerRegion base (miRegionIndex is technically signed short; read as u16 for hex-view friendliness)
export const TriggerRegionBaseSchema = object({
  box: BoxRegionSchema,
  id: u32,
  regionIndex: u16,
  type: u8,
  pad: u8
});

export const LandmarkHeaderSchema = object({
  base: TriggerRegionBaseSchema,
  startingGridOffset: u32,
  startingGridCount: u8,
  muDesignIndex: u8,
  muDistrict: u8,
  mu8Flags: u8
});

export const GenericRegionHeaderSchema = object({
  base: TriggerRegionBaseSchema,
  groupId: u32,
  cameraCut1: u16,
  cameraCut2: u16,
  cameraType1: u8,
  cameraType2: u8,
  genericType: u8,
  isOneWay: u8 // keep as unsigned for schema simplicity
});

export const BlackspotHeaderSchema = object({
  base: TriggerRegionBaseSchema,
  scoreType: u8,
  pad0: arrayOf(u8, 3),
  scoreAmount: u32
});

export const VFXBoxRegionHeaderSchema = TriggerRegionBaseSchema;

// Full TriggerData header up to consolidated trigger-region table pointer and count
export const TriggerDataHeaderSchema = object({
  miVersionNumber: u32, // treat as u32 for hex clarity
  muSize: u32,
  padding8: arrayOf(u8, 8),
  mPlayerStartPosition: Vector4Schema,
  mPlayerStartDirection: Vector4Schema,
  LandmarkTriggersOffset: u32,
  miLandmarkCount: u32,
  miOnlineLandmarkCount: u32,
  SignatureStuntsOffset: u32,
  miSignatureStuntCount: u32,
  GenericRegionsOffset: u32,
  miGenericRegionCount: u32,
  KillzoneOffset: u32,
  miKillzoneCount: u32,
  BlackspotOffset: u32,
  miBlackspotCount: u32,
  VFXBoxRegionOffset: u32,
  miVFXBoxRegionCount: u32,
  RoamingLocationOffset: u32,
  miRoamingLocationCount: u32,
  SpawnLocationOffset: u32,
  miSpawnLocationCount: u32,
  TriggerRegionOffset: u32,
  miRegionCount: u32,
  headerPad: u32
});

// =============================================================================
// Low-level Binary Utilities (kept for writer and pointer-chasing parse)
// =============================================================================

class BinReader {
	private view: DataView;
	private offset = 0;
	private little: boolean;

	constructor(buf: ArrayBufferLike, littleEndian: boolean) {
		this.view = new DataView(buf as ArrayBuffer);
		this.little = littleEndian;
	}

	get position(): number { return this.offset; }
	set position(pos: number) { this.offset = pos >>> 0; }

	readU8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
	readI8(): number { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
	readU16(): number { const v = this.view.getUint16(this.offset, this.little); this.offset += 2; return v; }
	readI16(): number { const v = this.view.getInt16(this.offset, this.little); this.offset += 2; return v; }
	readU32(): number { const v = this.view.getUint32(this.offset, this.little); this.offset += 4; return v >>> 0; }
	readI32(): number { const v = this.view.getInt32(this.offset, this.little); this.offset += 4; return v | 0; }
	readF32(): number { const v = this.view.getFloat32(this.offset, this.little); this.offset += 4; return v; }
	readF64(): number { const v = this.view.getFloat64(this.offset, this.little); this.offset += 8; return v; }
	readU64(): bigint {
		const low = BigInt(this.view.getUint32(this.offset + (this.little ? 0 : 4), this.little));
		const high = BigInt(this.view.getUint32(this.offset + (this.little ? 4 : 0), this.little));
		this.offset += 8;
		return (high << 32n) | (low & 0xFFFFFFFFn);
	}
}

class BinWriter {
	private buf: Uint8Array;
	private view: DataView;
	private little: boolean;
	private _offset = 0;

	constructor(initialSize: number, littleEndian: boolean) {
		this.buf = new Uint8Array(Math.max(1024, initialSize >>> 0));
		this.view = new DataView(this.buf.buffer);
		this.little = littleEndian;
	}

	get offset(): number { return this._offset; }
	get bytes(): Uint8Array { return this.buf.subarray(0, this._offset); }

	private ensure(extra: number) {
		const need = this._offset + extra;
		if (need <= this.buf.length) return;
		let size = this.buf.length;
		while (size < need) size <<= 1;
		const next = new Uint8Array(size);
		next.set(this.buf);
		this.buf = next;
		this.view = new DataView(this.buf.buffer);
	}

	setU32(at: number, value: number) { this.view.setUint32(at >>> 0, value >>> 0, this.little); }

	writeU8(v: number) { this.ensure(1); this.view.setUint8(this._offset, v & 0xFF); this._offset += 1; }
	writeI8(v: number) { this.ensure(1); this.view.setInt8(this._offset, v | 0); this._offset += 1; }
	writeU16(v: number) { this.ensure(2); this.view.setUint16(this._offset, v >>> 0, this.little); this._offset += 2; }
	writeI16(v: number) { this.ensure(2); this.view.setInt16(this._offset, v | 0, this.little); this._offset += 2; }
	writeU32(v: number) { this.ensure(4); this.view.setUint32(this._offset, v >>> 0, this.little); this._offset += 4; }
	writeI32(v: number) { this.ensure(4); this.view.setInt32(this._offset, v | 0, this.little); this._offset += 4; }
	writeF32(v: number) { this.ensure(4); this.view.setFloat32(this._offset, v, this.little); this._offset += 4; }
	writeF64(v: number) { this.ensure(8); this.view.setFloat64(this._offset, v, this.little); this._offset += 8; }
	writeU64(v: bigint) {
		const low = Number(v & 0xFFFFFFFFn) >>> 0;
		const high = Number((v >> 32n) & 0xFFFFFFFFn) >>> 0;
		if (this.little) { this.writeU32(low); this.writeU32(high); }
		else { this.writeU32(high); this.writeU32(low); }
	}
	writeBytes(arr: Uint8Array) { this.ensure(arr.length); this.buf.set(arr, this._offset); this._offset += arr.length; }
	writeZeroes(n: number) { this.ensure(n); this.buf.fill(0, this._offset, this._offset + n); this._offset += n; }
	align16() {
		const mod = this._offset % 16;
		if (mod !== 0) this.writeZeroes(16 - mod);
	}
}

// =============================================================================
// Types
// =============================================================================

export type Vector4 = { x: number; y: number; z: number; w: number };

export type BoxRegion = {
	positionX: number; positionY: number; positionZ: number;
	rotationX: number; rotationY: number; rotationZ: number;
	dimensionX: number; dimensionY: number; dimensionZ: number;
};

export enum TriggerRegionType {
	E_TYPE_LANDMARK = 0,
	E_TYPE_BLACKSPOT = 1,
	E_TYPE_GENERIC_REGION = 2,
	E_TYPE_VFXBOX_REGION = 3
}

export type TriggerRegion = {
	box: BoxRegion;
	id: number; // mId
	regionIndex: number; // miRegionIndex (short)
	type: TriggerRegionType;
};

export type StartingGrid = {
	startingPositions: Vector4[]; // 8
	startingDirections: Vector4[]; // 8
};

export type Landmark = TriggerRegion & {
	startingGrids: StartingGrid[];
	designIndex: number; // byte
	district: number; // byte
	flags: number; // byte
};

export enum StuntCameraType {
	E_STUNT_CAMERA_TYPE_NO_CUTS = 0,
	E_STUNT_CAMERA_TYPE_CUSTOM = 1,
	E_STUNT_CAMERA_TYPE_NORMAL = 2
}

export enum GenericRegionType {
	E_TYPE_JUNK_YARD = 0,
	E_TYPE_BIKE_SHOP = 1,
	E_TYPE_GAS_STATION = 2,
	E_TYPE_BODY_SHOP = 3,
	E_TYPE_PAINT_SHOP = 4,
	E_TYPE_CAR_PARK = 5,
	E_TYPE_SIGNATURE_TAKEDOWN = 6,
	E_TYPE_KILLZONE = 7,
	E_TYPE_JUMP = 8,
	E_TYPE_SMASH = 9,
	E_TYPE_SIGNATURE_CRASH = 10,
	E_TYPE_SIGNATURE_CRASH_CAMERA = 11,
	E_TYPE_ROAD_LIMIT = 12,
	E_TYPE_OVERDRIVE_BOOST = 13,
	E_TYPE_OVERDRIVE_STRENGTH = 14,
	E_TYPE_OVERDRIVE_SPEED = 15,
	E_TYPE_OVERDRIVE_CONTROL = 16,
	E_TYPE_TIRE_SHOP = 17,
	E_TYPE_TUNING_SHOP = 18,
	E_TYPE_PICTURE_PARADISE = 19,
	E_TYPE_TUNNEL = 20,
	E_TYPE_OVERPASS = 21,
	E_TYPE_BRIDGE = 22,
	E_TYPE_WAREHOUSE = 23,
	E_TYPE_LARGE_OVERHEAD_OBJECT = 24,
	E_TYPE_NARROW_ALLEY = 25,
	E_TYPE_PASS_TUNNEL = 26,
	E_TYPE_PASS_OVERPASS = 27,
	E_TYPE_PASS_BRIDGE = 28,
	E_TYPE_PASS_WAREHOUSE = 29,
	E_TYPE_PASS_LARGEOVERHEADOBJECT = 30,
	E_TYPE_PASS_NARROWALLEY = 31,
	E_TYPE_RAMP = 32,
	E_TYPE_GOLD = 33,
	E_TYPE_ISLAND_ENTITLEMENT = 34
}

export type GenericRegion = TriggerRegion & {
	groupId: number;
	cameraCut1: number;
	cameraCut2: number;
	cameraType1: StuntCameraType;
	cameraType2: StuntCameraType;
	genericType: GenericRegionType;
	isOneWay: number; // sbyte
};

export enum BlackspotScoreType {
	E_SCORE_TYPE_DISTANCE = 0,
	E_SCORE_TYPE_CAR_COUNT = 1
}

export type Blackspot = TriggerRegion & {
	scoreType: BlackspotScoreType;
	scoreAmount: number;
};

export type VFXBoxRegion = TriggerRegion;

export type Killzone = {
	triggerIds: number[]; // region.mId for generic regions
	regionIds: bigint[]; // CgsID[]
};

export type SignatureStunt = {
	id: bigint; // CgsID
	camera: bigint; // int64
	stuntElementRegionIds: number[]; // stores region.mId list
};

export type RoamingLocation = { position: Vector4; districtIndex: number };

export enum SpawnType {
	E_TYPE_PLAYER_SPAWN = 0,
	E_TYPE_CAR_SELECT_LEFT = 1,
	E_TYPE_CAR_SELECT_RIGHT = 2,
	E_TYPE_CAR_UNLOCK = 3
}

export type SpawnLocation = {
	position: Vector4;
	direction: Vector4;
	junkyardId: bigint; // CgsID
	type: SpawnType;
};

export type ParsedTriggerData = {
	version: number;
	size: number;
	playerStartPosition: Vector4;
	playerStartDirection: Vector4;
	landmarks: Landmark[];
	onlineLandmarkCount: number;
	signatureStunts: SignatureStunt[];
	genericRegions: GenericRegion[];
	killzones: Killzone[];
	blackspots: Blackspot[];
	vfxBoxRegions: VFXBoxRegion[];
	roamingLocations: RoamingLocation[];
	spawnLocations: SpawnLocation[];
};

// =============================================================================
// Helpers
// =============================================================================

function readVector4(r: BinReader): Vector4 {
	return { x: r.readF32(), y: r.readF32(), z: r.readF32(), w: r.readF32() };
}

function writeVector4(w: BinWriter, v: Vector4) {
	w.writeF32(v.x); w.writeF32(v.y); w.writeF32(v.z); w.writeF32(v.w);
}

function readBox(r: BinReader): BoxRegion {
	return {
		positionX: r.readF32(), positionY: r.readF32(), positionZ: r.readF32(),
		rotationX: r.readF32(), rotationY: r.readF32(), rotationZ: r.readF32(),
		dimensionX: r.readF32(), dimensionY: r.readF32(), dimensionZ: r.readF32(),
	};
}

function writeBox(w: BinWriter, b: BoxRegion) {
	w.writeF32(b.positionX); w.writeF32(b.positionY); w.writeF32(b.positionZ);
	w.writeF32(b.rotationX); w.writeF32(b.rotationY); w.writeF32(b.rotationZ);
	w.writeF32(b.dimensionX); w.writeF32(b.dimensionY); w.writeF32(b.dimensionZ);
}

function readTriggerRegionBase(r: BinReader): TriggerRegion {
	const box = readBox(r);
	const id = r.readI32();
	const regionIndex = r.readI16();
	const type = r.readU8() as TriggerRegionType;
	/* muPad */ r.readU8();
	return { box, id, regionIndex, type };
}

function writeTriggerRegionBase(w: BinWriter, t: TriggerRegion) {
	writeBox(w, t.box);
	w.writeI32(t.id);
	w.writeI16(t.regionIndex);
	w.writeU8(t.type);
	w.writeU8(0); // pad
}

// =============================================================================
// Parsing
// =============================================================================

export function parseTriggerDataData(data: Uint8Array, littleEndian: boolean = true): ParsedTriggerData {
	const r = new BinReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), littleEndian);

	const version = r.readI32();
	const size = r.readU32();
	/* padding */ r.readU64();
	const playerStartPosition = readVector4(r);
	const playerStartDirection = readVector4(r);

	const LandmarkOffset = r.readU32();
	const miLandmarkCount = r.readI32();
	const miOnlineLandmarkCount = r.readI32();

	const SignatureStuntsOffset = r.readU32();
	const miSignatureStuntCount = r.readI32();

	const GenericRegionsOffset = r.readU32();
	const miGenericRegionCount = r.readI32();

	const KillzoneOffset = r.readU32();
	const miKillzoneCount = r.readI32();

	const BlackspotOffset = r.readU32();
	const miBlackspotCount = r.readI32();

	const VFXBoxRegionOffset = r.readU32();
	const miVFXBoxRegionCount = r.readI32();

	const RoamingLocationOffset = r.readU32();
	const miRoamingLocationCount = r.readI32();

	const SpawnLocationOffset = r.readU32();
	const miSpawnLocationCount = r.readI32();

	const TriggerRegionOffset = r.readU32();
	/* miRegionCount */ r.readI32();

	// Landmarks
	const landmarks: Landmark[] = [];
	r.position = LandmarkOffset;
	for (let i = 0; i < miLandmarkCount; i++) {
		const base = readTriggerRegionBase(r);
		const startingGridOffset = r.readU32();
		const cnt = r.readU8();
		const designIndex = r.readU8();
		const district = r.readU8();
		const flags = r.readU8();
		const cur = r.position;
		const startingGrids: StartingGrid[] = [];
		const sgPos = startingGridOffset;
		if (sgPos !== 0) {
			r.position = sgPos;
			for (let g = 0; g < cnt; g++) {
				const positions: Vector4[] = [];
				for (let j = 0; j < 8; j++) positions.push(readVector4(r));
				const directions: Vector4[] = [];
				for (let j = 0; j < 8; j++) directions.push(readVector4(r));
				startingGrids.push({ startingPositions: positions, startingDirections: directions });
			}
		}
		r.position = cur;
		landmarks.push({ ...base, startingGrids, designIndex, district, flags });
	}

	// Signature Stunts
	const signatureStunts: SignatureStunt[] = [];
	r.position = SignatureStuntsOffset;
	for (let i = 0; i < miSignatureStuntCount; i++) {
		const id = r.readU64();
		// int64 as two i32s respecting endianness
		let low32 = 0, high32 = 0;
		if (littleEndian) { low32 = r.readI32(); high32 = r.readI32(); } else { high32 = r.readI32(); low32 = r.readI32(); }
		const camera = (BigInt(low32 >>> 0)) | (BigInt(high32 >>> 0) << 32n);
		const mppOffset = r.readU32();
		const cnt = r.readI32();
		const cur = r.position;
		const stuntElementRegionIds: number[] = [];
		if (mppOffset) {
			r.position = mppOffset;
			const ptrs: number[] = [];
			for (let j = 0; j < cnt; j++) ptrs.push(r.readU32());
			for (const p of ptrs) {
				r.position = p;
				const region = readTriggerRegionBase(r);
				// generic region extra
				/* skip extras */ r.readI32(); r.readI16(); r.readI16(); r.readI8(); r.readI8(); r.readU8(); r.readI8();
				stuntElementRegionIds.push(region.id);
			}
		}
		r.position = cur;
		signatureStunts.push({ id, camera, stuntElementRegionIds });
	}

	// Generic Regions
	const genericRegions: GenericRegion[] = [];
	r.position = GenericRegionsOffset;
	for (let i = 0; i < miGenericRegionCount; i++) {
		const base = readTriggerRegionBase(r);
		const groupId = r.readI32();
		const cameraCut1 = r.readI16();
		const cameraCut2 = r.readI16();
		const cameraType1 = r.readI8() as StuntCameraType;
		const cameraType2 = r.readI8() as StuntCameraType;
		const genericType = r.readU8() as GenericRegionType;
		const isOneWay = r.readI8();
		genericRegions.push({ ...base, groupId, cameraCut1, cameraCut2, cameraType1, cameraType2, genericType, isOneWay });
	}

	// Killzones
	const killzones: Killzone[] = [];
	r.position = KillzoneOffset;
	for (let i = 0; i < miKillzoneCount; i++) {
		const genericRegionPtrArrayOff = r.readU32();
		const triggerCount = r.readI32();
		const cgsOffset = r.readU32();
		const regionIdCount = r.readI32();
		const cur = r.position;
		const triggerIds: number[] = [];
		if (genericRegionPtrArrayOff) {
			r.position = genericRegionPtrArrayOff;
			const ptrs: number[] = [];
			for (let j = 0; j < triggerCount; j++) ptrs.push(r.readU32());
			for (const p of ptrs) {
				r.position = p;
				const base = readTriggerRegionBase(r);
				/* skip generic extras */ r.readI32(); r.readI16(); r.readI16(); r.readI8(); r.readI8(); r.readU8(); r.readI8();
				triggerIds.push(base.id);
			}
		}
		const regionIds: bigint[] = [];
		if (cgsOffset) {
			r.position = cgsOffset;
			for (let j = 0; j < regionIdCount; j++) regionIds.push(r.readU64());
		}
		r.position = cur;
		killzones.push({ triggerIds, regionIds });
	}

	// Blackspots
	const blackspots: Blackspot[] = [];
	r.position = BlackspotOffset;
	for (let i = 0; i < miBlackspotCount; i++) {
		const base = readTriggerRegionBase(r);
		const scoreType = r.readU8() as BlackspotScoreType;
		/* padding */ r.readU8(); r.readU8(); r.readU8();
		const scoreAmount = r.readI32();
		blackspots.push({ ...base, scoreType, scoreAmount });
	}

	// VFX Box Regions
	const vfxBoxRegions: VFXBoxRegion[] = [];
	r.position = VFXBoxRegionOffset;
	for (let i = 0; i < miVFXBoxRegionCount; i++) {
		const base = readTriggerRegionBase(r);
		vfxBoxRegions.push(base);
	}

	// Roaming Locations
	const roamingLocations: RoamingLocation[] = [];
	r.position = RoamingLocationOffset;
	for (let i = 0; i < miRoamingLocationCount; i++) {
		const position = readVector4(r);
		const districtIndex = r.readU8();
		/* padding 15 */ for (let p = 0; p < 15; p++) r.readU8();
		roamingLocations.push({ position, districtIndex });
	}

	// Spawn Locations
	const spawnLocations: SpawnLocation[] = [];
	r.position = SpawnLocationOffset;
	for (let i = 0; i < miSpawnLocationCount; i++) {
		const position = readVector4(r);
		const direction = readVector4(r);
		const junkyardId = r.readU64();
		const type = r.readU8() as SpawnType;
		/* padding 7 */ for (let p = 0; p < 7; p++) r.readU8();
		spawnLocations.push({ position, direction, junkyardId, type });
	}

	return {
		version,
		size,
		playerStartPosition,
		playerStartDirection,
		landmarks,
		onlineLandmarkCount: miOnlineLandmarkCount,
		signatureStunts,
		genericRegions,
		killzones,
		blackspots,
		vfxBoxRegions,
		roamingLocations,
		spawnLocations,
	};
}

// =============================================================================
// Writing
// =============================================================================

export function writeTriggerDataData(td: ParsedTriggerData, littleEndian: boolean = true): Uint8Array {
	// Assign miRegionIndex sequentially to avoid collisions (VFX, Blackspot, Generic, Landmark)
	const vfxCount = td.vfxBoxRegions.length;
	const blackspotCount = td.blackspots.length;
	const genericCount = td.genericRegions.length;
	const landmarkCount = td.landmarks.length;

	for (let i = 0; i < vfxCount; i++) td.vfxBoxRegions[i].regionIndex = i;
	for (let i = 0; i < blackspotCount; i++) td.blackspots[i].regionIndex = vfxCount + i;
	for (let i = 0; i < genericCount; i++) td.genericRegions[i].regionIndex = vfxCount + blackspotCount + i;
	for (let i = 0; i < landmarkCount; i++) td.landmarks[i].regionIndex = vfxCount + blackspotCount + genericCount + i;

	const w = new BinWriter(64 * 1024, littleEndian);

	// Header
	w.writeI32(td.version);
	const sizePos = w.offset; w.writeU32(0);
	w.writeZeroes(8);
	writeVector4(w, td.playerStartPosition);
	writeVector4(w, td.playerStartDirection);

	// Offsets and counts
	const landmarkOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.landmarks.length); w.writeI32(td.onlineLandmarkCount);
	const stuntOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.signatureStunts.length);
	const genericOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.genericRegions.length);
	const killzoneOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.killzones.length);
	const blackspotOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.blackspots.length);
	const vfxOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.vfxBoxRegions.length);
	const roamingOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.roamingLocations.length);
	const spawnOffsetPos = w.offset; w.writeU32(0); w.writeI32(td.spawnLocations.length);
	const triggerOffsetPos = w.offset; w.writeU32(0); w.writeI32(vfxCount + blackspotCount + genericCount + landmarkCount);
	// extra padding
	w.writeZeroes(4);

	// Landmarks (collect offsets)
	const landmarkOffsets: number[] = [];
	let cur = w.offset; w.setU32(landmarkOffsetPos, cur);
	for (const lm of td.landmarks) {
		landmarkOffsets.push(w.offset);
		writeTriggerRegionBase(w, lm);
		// placeholder for starting grid offset
		const sgOffsetPos = w.offset; w.writeU32(0);
		w.writeU8(lm.startingGrids.length & 0xFF);
		w.writeU8(lm.designIndex & 0xFF);
		w.writeU8(lm.district & 0xFF);
		w.writeU8(lm.flags & 0xFF);
		(lm as any).__sgOffsetPos = sgOffsetPos;
	}
	w.align16();

	// Signature Stunts (store placeholder positions)
	const stuntPlaceholders: { pos: number, count: number, ids: number[], id: bigint, camera: bigint }[] = [];
	cur = w.offset; w.setU32(stuntOffsetPos, cur);
	for (const st of td.signatureStunts) {
		w.writeU64(st.id);
		// write int64 camera as two i32s
		const camLow = Number(st.camera & 0xFFFFFFFFn);
		const camHigh = Number((st.camera >> 32n) & 0xFFFFFFFFn);
		if (littleEndian) { w.writeI32(camLow); w.writeI32(camHigh); } else { w.writeI32(camHigh); w.writeI32(camLow); }
		const pos = w.offset; w.writeU32(0); w.writeI32(st.stuntElementRegionIds.length);
		stuntPlaceholders.push({ pos, count: st.stuntElementRegionIds.length, ids: st.stuntElementRegionIds.slice(), id: st.id, camera: st.camera });
	}
	w.align16();

	// Generic Regions (record offsets by mId)
	const genericOffsetsById = new Map<number, number>();
	cur = w.offset; w.setU32(genericOffsetPos, cur);
	for (const gr of td.genericRegions) {
		genericOffsetsById.set(gr.id, w.offset);
		writeTriggerRegionBase(w, gr);
		w.writeI32(gr.groupId);
		w.writeI16(gr.cameraCut1);
		w.writeI16(gr.cameraCut2);
		w.writeI8(gr.cameraType1);
		w.writeI8(gr.cameraType2);
		w.writeU8(gr.genericType);
		w.writeI8(gr.isOneWay);
	}
	w.align16();

	// Killzones (placeholders, to be filled after we have generic offsets too)
	const killzonePlaceholders: { trigPos: number, cgsPos: number, kz: Killzone }[] = [];
	cur = w.offset; w.setU32(killzoneOffsetPos, cur);
	for (const kz of td.killzones) {
		const trigPos = w.offset; w.writeU32(0); w.writeI32(kz.triggerIds.length);
		const cgsPos = w.offset; w.writeU32(0); w.writeI32(kz.regionIds.length);
		killzonePlaceholders.push({ trigPos, cgsPos, kz });
	}
	w.align16();

	// Blackspots
	const blackspotOffsets: number[] = [];
	cur = w.offset; w.setU32(blackspotOffsetPos, cur);
	for (const bs of td.blackspots) {
		blackspotOffsets.push(w.offset);
		writeTriggerRegionBase(w, bs);
		w.writeU8(bs.scoreType);
		w.writeZeroes(3);
		w.writeI32(bs.scoreAmount);
	}
	w.align16();

	// VFX Box Regions
	const vfxOffsets: number[] = [];
	cur = w.offset; w.setU32(vfxOffsetPos, cur);
	for (const v of td.vfxBoxRegions) {
		vfxOffsets.push(w.offset);
		writeTriggerRegionBase(w, v);
	}
	w.align16();

	// Roaming
	cur = w.offset; w.setU32(roamingOffsetPos, cur);
	for (const rl of td.roamingLocations) {
		writeVector4(w, rl.position);
		w.writeU8(rl.districtIndex & 0xFF);
		w.writeZeroes(15);
	}
	w.align16();

	// Spawn
	cur = w.offset; w.setU32(spawnOffsetPos, cur);
	for (const sp of td.spawnLocations) {
		writeVector4(w, sp.position);
		writeVector4(w, sp.direction);
		w.writeU64(sp.junkyardId);
		w.writeU8(sp.type);
		w.writeZeroes(7);
	}
	w.align16();

	// Landmark starting grids payloads
	for (const lm of td.landmarks) {
		const pos = (lm as any).__sgOffsetPos as number;
		if (!pos) continue;
		const here = w.offset; w.setU32(pos, here);
		for (const grid of lm.startingGrids) {
			for (let j = 0; j < 8; j++) writeVector4(w, grid.startingPositions[j] ?? { x: 0, y: 0, z: 0, w: 0 });
			for (let j = 0; j < 8; j++) writeVector4(w, grid.startingDirections[j] ?? { x: 0, y: 0, z: 0, w: 0 });
		}
	}

	// Signature stunt element pointers (to GenericRegions)
	for (const st of stuntPlaceholders) {
		const here = w.offset; w.setU32(st.pos, here);
		for (const id of st.ids) {
			const grOff = genericOffsetsById.get(id);
			if (grOff == null) throw new Error(`Missing GenericRegion offset for id ${id}`);
			w.writeU32(grOff);
		}
	}

	// Killzone pointer arrays
	for (const ph of killzonePlaceholders) {
		let here = w.offset; w.setU32(ph.trigPos, here);
		for (const id of ph.kz.triggerIds) {
			const grOff = genericOffsetsById.get(id);
			if (grOff == null) throw new Error(`Missing GenericRegion offset for id ${id}`);
			w.writeU32(grOff);
		}
		w.align16();
		here = w.offset; w.setU32(ph.cgsPos, here);
		for (const cgs of ph.kz.regionIds) w.writeU64(cgs);
		w.align16();
	}

	// Consolidated TriggerRegion offsets table
	cur = w.offset; w.setU32(triggerOffsetPos, cur);
	for (const off of vfxOffsets) w.writeU32(off);
	for (const off of blackspotOffsets) w.writeU32(off);
	for (const off of td.genericRegions.map(gr => genericOffsetsById.get(gr.id) as number)) w.writeU32(off);
	for (const off of landmarkOffsets) w.writeU32(off);

	// Size backpatch
	const end = w.offset;
	// size is total size (uint32) at sizePos
	w.setU32(sizePos, end >>> 0);
	w.align16();

	return w.bytes;
}

// =============================================================================
// High-level wrapper with progress (optional)
// =============================================================================

export function writeTriggerData(td: ParsedTriggerData, options: { littleEndian?: boolean } = {}, progress?: ProgressCallback): Uint8Array {
	progress?.({ type: 'write', stage: 'write', progress: 0.0, message: 'Serializing TriggerData' });
	const out = writeTriggerDataData(td, options.littleEndian !== false);
	progress?.({ type: 'write', stage: 'write', progress: 1.0, message: 'Done' });
	return out;
}



// =============================================================================
// High-level parsing wrapper (mirrors vehicle list style)
// =============================================================================

function reportProgress(
  callback: ProgressCallback | undefined,
  stage: string,
  progress: number,
  message?: string
) {
  callback?.({ type: 'parse', stage, progress, message });
}

function handleNestedTriggerBundle(
  data: Uint8Array,
  originalBuffer: ArrayBuffer,
  resource: ResourceEntry
): Uint8Array {
  if (!isNestedBundle(data)) {
    return data;
  }

  try {
    const innerBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const bundle = parseBundle(innerBuffer);

    // Find the TriggerData resource in the nested bundle by matching type id
    const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
    if (!innerResource) {
      throw new ResourceNotFoundError(resource.resourceTypeId);
    }

    // Try to locate section data that contains the resource payload
    const dataOffsets = bundle.header.resourceDataOffsets;

    for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
      const sectionOffset = dataOffsets[sectionIndex];
      if (sectionOffset === 0) continue;

      const absoluteOffset = data.byteOffset + sectionOffset;
      if (absoluteOffset >= originalBuffer.byteLength) continue;

      const maxSize = originalBuffer.byteLength - absoluteOffset;
      const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 1000000));

      // Prefer compressed payloads first
      if (sectionData.length >= 2 && sectionData[0] === 0x78) {
        return sectionData;
      }

      // Heuristic: TriggerData header starts with version (i32) and size (u32) where size <= section length
      if (sectionData.length >= 8) {
        const dv = new DataView(sectionData.buffer, sectionData.byteOffset, sectionData.byteLength);
        const size = dv.getUint32(4, true);
        if (size > 0 && size <= sectionData.length) {
          return sectionData;
        }
      }
    }

    // Fallback: some nested bundles store payload at offset 0
    const resourceOffset = innerResource.diskOffsets[0];
    if (resourceOffset === 0) {
      const resourceData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return resourceData;
    }

    throw new BundleError('Could not find valid TriggerData in nested bundle', 'TRIGGER_DATA_NESTED_NOT_FOUND');
  } catch (error) {
    console.warn('Failed to parse TriggerData as nested bundle, treating as raw data:', error);
    return data;
  }
}

export function parseTriggerData(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  options: { littleEndian?: boolean } = {},
  progressCallback?: ProgressCallback
): ParsedTriggerData {
  try {
    reportProgress(progressCallback, 'parse', 0.0, 'Starting TriggerData parsing');

    const context: ResourceContext = {
      bundle: {} as ParsedBundle,
      resource,
      buffer
    };

    // Extract and prepare data
    let { data } = getResourceData(context);

    reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
    data = handleNestedTriggerBundle(data, buffer, resource);

    // Decompress if needed (zlib)
    if (data.length >= 2 && data[0] === 0x78) {
      data = pako.inflate(data);
    }

    reportProgress(progressCallback, 'parse', 0.5, 'Parsing TriggerData payload');
    const result = parseTriggerDataData(data, options.littleEndian !== false);

    console.log('TriggerData parsed successfully', result);

    reportProgress(progressCallback, 'parse', 1.0, 'TriggerData parsed successfully');
    return result;

  } catch (error) {
    if (error instanceof BundleError) {
      throw error;
    }
    throw new BundleError(
      `Failed to parse TriggerData: ${error instanceof Error ? error.message : String(error)}`,
      'TRIGGER_DATA_PARSE_ERROR',
      { error }
    );
  }
}
