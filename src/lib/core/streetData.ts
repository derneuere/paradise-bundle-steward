// StreetData parser and writer (EntryType 0x10018)
//
// Ported from BaseHandlers/StreetData.cs in the C# Bundle Manager PR at
// https://github.com/derneuere/Bundle-Manager/tree/feature/road-editor.
// Layout reference: https://burnout.wiki/wiki/Street_Data
//
// 32-bit PC only. 64-bit (Paradise Remastered) and big-endian (X360/PS3)
// are not supported yet (matches the C# scope).
//
// The writer intentionally mirrors the C# lossy behaviour:
//   - per-junction exit arrays (mpaExits / miExitCount) are zeroed
//   - per-road span arrays (mpaSpans / miSpanCount) are zeroed
//   - after the ChallengeParScores array, zeros are padded up to
//     (challengesOffset + junctionCount * 0x28) to keep memory writeable
//     for the retail game's buggy StreetData::FixUp().
// See the comments in StreetData.cs (Junction.Write, Road.Write, StreetData.Write)
// for the motivation.

import * as pako from 'pako';
import { BinReader, BinWriter } from './binTools';
import type { ParsedBundle, ProgressCallback, ResourceContext, ResourceEntry } from './types';
import { getResourceData, isNestedBundle } from './resourceManager';
import { parseBundle } from './bundle';
import { BundleError, ResourceNotFoundError } from './errors';

// =============================================================================
// Types (mirror the C# model classes so a dumped JSON is easy to eyeball)
// =============================================================================

export enum ESpanType {
	Street = 0,
	Junction = 1,
	SpanTypeCount = 2,
}

export type SpanBase = {
	miRoadIndex: number; // int32
	miSpanIndex: number; // int16
	padding: number[]; // 2 bytes
	meSpanType: ESpanType; // int32
};

export type AIInfo = {
	muMaxSpeedMPS: number; // u8
	muMinSpeedMPS: number; // u8
};

export type Street = {
	superSpanBase: SpanBase;
	mAiInfo: AIInfo;
	padding: number[]; // 2 bytes
};

export type Junction = {
	superSpanBase: SpanBase;
	// Always zero on disk (see file header comment), kept so round-tripping
	// preserves the read value if a tool cares.
	mpaExits: number;
	miExitCount: number;
	macName: string; // 16 bytes ASCII
};

export type Road = {
	mReferencePosition: { x: number; y: number; z: number };
	// Zeroed by the writer; see the StreetData.cs FixUp commentary.
	mpaSpans: number;
	mId: bigint;
	miRoadLimitId0: bigint;
	miRoadLimitId1: bigint;
	macDebugName: string; // 16 bytes ASCII
	mChallenge: number; // int32
	miSpanCount: number; // zeroed by the writer
	unknown: number; // spec: uint32, always 1
	padding: number[]; // 4 bytes
};

export type ScoreList = {
	maScores: number[]; // int32[2]
};

export type ChallengeData = {
	mDirty: number[]; // 8 bytes BitArray<2>
	mValidScore: number[]; // 8 bytes BitArray<2>
	mScoreList: ScoreList;
};

export type ChallengeParScores = {
	challengeData: ChallengeData;
	mRivals: bigint[]; // int64[2]
};

export type ParsedStreetData = {
	miVersion: number;
	mpaStreets: number;
	mpaJunctions: number;
	mpaRoads: number;
	mpaChallengeParScores: number;
	streets: Street[];
	junctions: Junction[];
	roads: Road[];
	challenges: ChallengeParScores[];
};

// =============================================================================
// Constants matching the on-disk layout
// =============================================================================

const HEADER_SIZE = 0x24; // 9 × int32
const SIZEOF_STREET = 0x10;
const SIZEOF_JUNCTION = 0x24;
const SIZEOF_ROAD = 0x48;
const SIZEOF_CHALLENGE_PAR_SCORES = 0x28;

// =============================================================================
// Helpers
// =============================================================================

function readFixedAscii(r: BinReader, len: number): string {
	// Read `len` raw bytes and decode as ASCII; trimming of trailing NULs is
	// handled by UI display helpers. Keeping the full buffer preserves the
	// original byte content (including any intentional non-terminated data).
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) bytes[i] = r.readU8();
	let end = len;
	for (let i = 0; i < len; i++) {
		if (bytes[i] === 0) { end = i; break; }
	}
	return new TextDecoder('ascii').decode(bytes.subarray(0, end));
}

function writeFixedAscii(w: BinWriter, value: string, len: number) {
	const buf = new Uint8Array(len);
	const enc = new TextEncoder().encode(value ?? '');
	buf.set(enc.subarray(0, Math.min(enc.length, len)));
	for (let i = 0; i < len; i++) w.writeU8(buf[i]);
}

function readBytes(r: BinReader, n: number): number[] {
	const out: number[] = new Array(n);
	for (let i = 0; i < n; i++) out[i] = r.readU8();
	return out;
}

function writeBytes(w: BinWriter, bytes: number[] | undefined, n: number) {
	for (let i = 0; i < n; i++) w.writeU8(bytes?.[i] ?? 0);
}

function readSpanBase(r: BinReader): SpanBase {
	const miRoadIndex = r.readI32();
	const miSpanIndex = r.readI16();
	const padding = readBytes(r, 2);
	const meSpanType = r.readI32() as ESpanType;
	return { miRoadIndex, miSpanIndex, padding, meSpanType };
}

function writeSpanBase(w: BinWriter, s: SpanBase) {
	w.writeI32(s.miRoadIndex);
	w.writeI16(s.miSpanIndex);
	writeBytes(w, s.padding, 2);
	w.writeI32(s.meSpanType);
}

function readStreet(r: BinReader): Street {
	const superSpanBase = readSpanBase(r);
	const mAiInfo: AIInfo = { muMaxSpeedMPS: r.readU8(), muMinSpeedMPS: r.readU8() };
	const padding = readBytes(r, 2);
	return { superSpanBase, mAiInfo, padding };
}

function writeStreet(w: BinWriter, s: Street) {
	writeSpanBase(w, s.superSpanBase);
	w.writeU8(s.mAiInfo.muMaxSpeedMPS & 0xFF);
	w.writeU8(s.mAiInfo.muMinSpeedMPS & 0xFF);
	writeBytes(w, s.padding, 2);
}

function readJunction(r: BinReader): Junction {
	const superSpanBase = readSpanBase(r);
	const mpaExits = r.readI32();
	const miExitCount = r.readI32();
	const macName = readFixedAscii(r, 16);
	// Per StreetData.cs, we intentionally do NOT follow mpaExits into the
	// exit array — the retail game's FixUp() trashes that region.
	return { superSpanBase, mpaExits, miExitCount, macName };
}

function writeJunction(w: BinWriter, j: Junction) {
	writeSpanBase(w, j.superSpanBase);
	// Always zeroed (see file header comment).
	w.writeI32(0);
	w.writeI32(0);
	writeFixedAscii(w, j.macName, 16);
}

function readRoad(r: BinReader): Road {
	const mReferencePosition = { x: r.readF32(), y: r.readF32(), z: r.readF32() };
	const mpaSpans = r.readI32();
	const mId = BigInt.asIntN(64, r.readU64());
	const miRoadLimitId0 = BigInt.asIntN(64, r.readU64());
	const miRoadLimitId1 = BigInt.asIntN(64, r.readU64());
	const macDebugName = readFixedAscii(r, 16);
	const mChallenge = r.readI32();
	const miSpanCount = r.readI32();
	const unknown = r.readI32();
	const padding = readBytes(r, 4);
	return {
		mReferencePosition,
		mpaSpans,
		mId,
		miRoadLimitId0,
		miRoadLimitId1,
		macDebugName,
		mChallenge,
		miSpanCount,
		unknown,
		padding,
	};
}

function writeRoad(w: BinWriter, r: Road) {
	w.writeF32(r.mReferencePosition.x);
	w.writeF32(r.mReferencePosition.y);
	w.writeF32(r.mReferencePosition.z);
	// Always zeroed (see file header comment).
	w.writeI32(0);
	w.writeU64(BigInt.asUintN(64, r.mId));
	w.writeU64(BigInt.asUintN(64, r.miRoadLimitId0));
	w.writeU64(BigInt.asUintN(64, r.miRoadLimitId1));
	writeFixedAscii(w, r.macDebugName, 16);
	w.writeI32(r.mChallenge);
	w.writeI32(0); // miSpanCount, zeroed
	w.writeI32(r.unknown);
	writeBytes(w, r.padding, 4);
}

function readChallengeParScores(r: BinReader): ChallengeParScores {
	const mDirty = readBytes(r, 8);
	const mValidScore = readBytes(r, 8);
	const maScores = [r.readI32(), r.readI32()];
	const mRivals: bigint[] = [
		BigInt.asIntN(64, r.readU64()),
		BigInt.asIntN(64, r.readU64()),
	];
	return {
		challengeData: { mDirty, mValidScore, mScoreList: { maScores } },
		mRivals,
	};
}

function writeChallengeParScores(w: BinWriter, c: ChallengeParScores) {
	writeBytes(w, c.challengeData.mDirty, 8);
	writeBytes(w, c.challengeData.mValidScore, 8);
	w.writeI32(c.challengeData.mScoreList.maScores[0] ?? 0);
	w.writeI32(c.challengeData.mScoreList.maScores[1] ?? 0);
	w.writeU64(BigInt.asUintN(64, c.mRivals[0] ?? 0n));
	w.writeU64(BigInt.asUintN(64, c.mRivals[1] ?? 0n));
}

// =============================================================================
// Parsing
// =============================================================================

export function parseStreetDataData(data: Uint8Array, littleEndian: boolean = true): ParsedStreetData {
	const r = new BinReader(
		data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
		littleEndian,
	);

	const miVersion = r.readI32();
	/* miSize */ r.readI32();
	const mpaStreets = r.readI32();
	const mpaJunctions = r.readI32();
	const mpaRoads = r.readI32();
	const mpaChallengeParScores = r.readI32();
	const miStreetCount = r.readI32();
	const miJunctionCount = r.readI32();
	const miRoadCount = r.readI32();

	r.position = mpaStreets >>> 0;
	const streets: Street[] = [];
	for (let i = 0; i < miStreetCount; i++) streets.push(readStreet(r));

	r.position = mpaJunctions >>> 0;
	const junctions: Junction[] = [];
	for (let i = 0; i < miJunctionCount; i++) junctions.push(readJunction(r));

	r.position = mpaRoads >>> 0;
	const roads: Road[] = [];
	for (let i = 0; i < miRoadCount; i++) roads.push(readRoad(r));

	// Header has no miChallengeCount; retail FixUp() iterates miJunctionCount
	// times (a game bug) even though only miRoadCount real entries are stored.
	// The on-disk layout matches the game allocation, so we read miRoadCount
	// entries and stop — matching the C# reader.
	r.position = mpaChallengeParScores >>> 0;
	const challenges: ChallengeParScores[] = [];
	for (let i = 0; i < miRoadCount; i++) challenges.push(readChallengeParScores(r));

	return {
		miVersion,
		mpaStreets,
		mpaJunctions,
		mpaRoads,
		mpaChallengeParScores,
		streets,
		junctions,
		roads,
		challenges,
	};
}

// =============================================================================
// Writing
// =============================================================================

export function writeStreetDataData(sd: ParsedStreetData, littleEndian: boolean = true): Uint8Array {
	if (sd.challenges.length !== sd.roads.length) {
		throw new Error(
			`StreetData.write: challenges.length (${sd.challenges.length}) must equal roads.length (${sd.roads.length}).`,
		);
	}

	const w = new BinWriter(64 * 1024, littleEndian);

	// Header
	w.writeI32(sd.miVersion);
	const miSizePos = w.offset; w.writeI32(0); // miSize
	const mpaStreetsPos = w.offset; w.writeI32(0);
	const mpaJunctionsPos = w.offset; w.writeI32(0);
	const mpaRoadsPos = w.offset; w.writeI32(0);
	const mpaChallengesPos = w.offset; w.writeI32(0);
	w.writeI32(sd.streets.length);
	w.writeI32(sd.junctions.length);
	w.writeI32(sd.roads.length);

	w.align16();
	const streetsOffset = w.offset;
	for (const s of sd.streets) writeStreet(w, s);

	w.align16();
	const junctionsOffset = w.offset;
	for (const j of sd.junctions) writeJunction(w, j);

	w.align16();
	const roadsOffset = w.offset;
	for (const r of sd.roads) writeRoad(w, r);

	w.align16();
	const challengesOffset = w.offset;
	for (const c of sd.challenges) writeChallengeParScores(w, c);

	// FixUp() safety: retail Burnout Paradise iterates miJunctionCount (not
	// miRoadCount) when rebuilding mDirty/mValidScores BitArrays here. The
	// extra iterations stomp past the real challenge entries, so the resource
	// MUST extend at least to (challengesOffset + junctionCount * 0x28).
	const fixUpEnd = challengesOffset + sd.junctions.length * SIZEOF_CHALLENGE_PAR_SCORES;
	while (w.offset < fixUpEnd) w.writeU8(0);

	const miSizeOut = w.offset;
	w.align16();

	// Backpatch header
	w.setU32(miSizePos, miSizeOut >>> 0);
	w.setU32(mpaStreetsPos, streetsOffset >>> 0);
	w.setU32(mpaJunctionsPos, junctionsOffset >>> 0);
	w.setU32(mpaRoadsPos, roadsOffset >>> 0);
	w.setU32(mpaChallengesPos, challengesOffset >>> 0);

	return w.bytes;
}

// =============================================================================
// High-level wrappers
// =============================================================================

function reportProgress(
	callback: ProgressCallback | undefined,
	stage: string,
	progress: number,
	message?: string,
) {
	callback?.({ type: 'parse', stage, progress, message });
}

function handleNestedStreetDataBundle(
	data: Uint8Array,
	originalBuffer: ArrayBuffer,
	resource: ResourceEntry,
): Uint8Array {
	if (!isNestedBundle(data)) return data;

	try {
		const innerBuffer = data.buffer.slice(
			data.byteOffset,
			data.byteOffset + data.byteLength,
		) as ArrayBuffer;
		const bundle = parseBundle(innerBuffer);

		const innerResource = bundle.resources.find((r) => r.resourceTypeId === resource.resourceTypeId);
		if (!innerResource) {
			throw new ResourceNotFoundError(resource.resourceTypeId);
		}

		const dataOffsets = bundle.header.resourceDataOffsets;
		for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
			const sectionOffset = dataOffsets[sectionIndex];
			if (sectionOffset === 0) continue;

			const absoluteOffset = data.byteOffset + sectionOffset;
			if (absoluteOffset >= originalBuffer.byteLength) continue;

			const maxSize = originalBuffer.byteLength - absoluteOffset;
			const sectionData = new Uint8Array(
				originalBuffer,
				absoluteOffset,
				Math.min(maxSize, 1_000_000),
			);

			// Prefer compressed payloads first
			if (sectionData.length >= 2 && sectionData[0] === 0x78) {
				return sectionData;
			}

			// Heuristic: StreetData header starts with version (i32) and size (u32)
			// where size <= section length.
			if (sectionData.length >= 8) {
				const dv = new DataView(
					sectionData.buffer,
					sectionData.byteOffset,
					sectionData.byteLength,
				);
				const version = dv.getInt32(0, true);
				const size = dv.getUint32(4, true);
				if (version === 6 && size > 0 && size <= sectionData.length) {
					return sectionData;
				}
			}
		}

		const resourceOffset = innerResource.diskOffsets[0];
		if (resourceOffset === 0) {
			return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		}

		throw new BundleError(
			'Could not find valid StreetData in nested bundle',
			'STREET_DATA_NESTED_NOT_FOUND',
		);
	} catch (error) {
		console.warn('Failed to parse StreetData as nested bundle, treating as raw data:', error);
		return data;
	}
}

export function parseStreetData(
	buffer: ArrayBuffer,
	resource: ResourceEntry,
	options: { littleEndian?: boolean } = {},
	progressCallback?: ProgressCallback,
): ParsedStreetData {
	try {
		reportProgress(progressCallback, 'parse', 0.0, 'Starting StreetData parsing');

		const context: ResourceContext = {
			bundle: parseBundle(buffer),
			resource,
			buffer,
		};

		let { data } = getResourceData(context);

		reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
		data = handleNestedStreetDataBundle(data, buffer, resource);

		if (data.length >= 2 && data[0] === 0x78) {
			data = pako.inflate(data);
		}

		reportProgress(progressCallback, 'parse', 0.5, 'Parsing StreetData payload');
		const result = parseStreetDataData(data, options.littleEndian !== false);

		reportProgress(progressCallback, 'parse', 1.0, 'StreetData parsed successfully');
		return result;
	} catch (error) {
		if (error instanceof BundleError) throw error;
		throw new BundleError(
			`Failed to parse StreetData: ${error instanceof Error ? error.message : String(error)}`,
			'STREET_DATA_PARSE_ERROR',
			{ error },
		);
	}
}

export function writeStreetData(
	sd: ParsedStreetData,
	options: { littleEndian?: boolean } = {},
	progress?: ProgressCallback,
): Uint8Array {
	progress?.({ type: 'write', stage: 'write', progress: 0.0, message: 'Serializing StreetData' });
	const out = writeStreetDataData(sd, options.littleEndian !== false);
	progress?.({ type: 'write', stage: 'write', progress: 1.0, message: 'Done' });
	return out;
}
