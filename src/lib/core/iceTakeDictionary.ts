// ICE Take Dictionary (resource 0x41) — structured parser + byte-exact writer.
//
// Container layout (32-bit, see docs/ICETakeDictionary.md):
//
//   DictionaryBase @0 { miNumEntries u32, miDictionarySize u32, mpaIndex u32 }
//   pad to 16
//   DictEntry[miNumEntries] @mpaIndex   (16-byte stride)
//     { mKey s64, mpData u32, mxUserFlags u32 }
//   ICETakeData[...] packed contiguously after the entry table
//
// On disk, `mpaIndex` and each entry's `mpData` are FILE OFFSETS into the
// payload (they become runtime pointers after FixUp). In every observed retail
// bundle the entry table sits immediately after the 16-byte-aligned base and the
// takes follow contiguously in entry order, each take 4-byte aligned. The writer
// rebuilds those offsets from the layout (Tier-1 offset-recompute) so the bytes
// are reproduced exactly; the take payloads are re-emitted via the iceVariableData
// codec, which preserves each value's raw packed bits.
//
// A heuristic header scanner is kept as a labelled fallback for inputs that fail
// the structured parse (the old behaviour); structured parse is preferred.

import {
	object,
	arrayOf,
	u8,
	u16,
	u32,
	f32,
	type Parsed,
} from 'typed-binary';
import { BufferReader } from 'typed-binary';
import { parseBundle } from './bundle';
import { getResourceData, isNestedBundle, decompressData } from './resourceManager';
import type {
	ResourceEntry,
	ResourceContext,
	ParseOptions,
	ProgressCallback,
} from './types';
import { ResourceNotFoundError, BundleError } from './errors';
import {
	parseIceTakeData,
	writeIceTakeData,
	computeTakeSize,
	type IceTake,
} from './iceVariableData';

const DICT_BASE_SIZE = 12; // miNumEntries + miDictionarySize + mpaIndex (32-bit)
const DICT_ENTRY_STRIDE = 16; // mKey(8) + mpData(4) + mxUserFlags(4)
const DEFAULT_USER_FLAGS = 0x80000000;

// ============================================================================
// Structured model types (exported — the schema is built from these)
// ============================================================================

export type IceDictionaryEntry = {
	/** mKey — DictionaryKey, the CRC32-of-lowercase-name hash widened to s64. */
	key: bigint;
	/** mxUserFlags — always 0x80000000 in retail. */
	userFlags: number;
	/** The take payload this entry points at. */
	take: IceTake;
};

export type IceTakeDictionary = {
	/** Resolved by the structured parser. */
	kind: 'structured';
	/** mpaIndex — file offset of the entry table (preserved for byte-exact write). */
	indexOffset: number;
	entries: IceDictionaryEntry[];
};

// ============================================================================
// Legacy heuristic header model (fallback only)
// ============================================================================

const ICEElementCountSchema = object({ mu16Intervals: u16, mu16Keys: u16 });

export const ICETakeHeader32Schema = object({
	bNodeNext: u32,
	bNodePrev: u32,
	miGuid: u32,
	macTakeName: arrayOf(u8, 32),
	mfLength: f32,
	muAllocated: u32,
	mElementCounts: arrayOf(ICEElementCountSchema, 12),
});

type ICEElementCount = Parsed<typeof ICEElementCountSchema>;

type ICETakeHeader = {
	guid: number;
	name: string;
	lengthSeconds: number;
	allocated: number;
	elementCounts: ICEElementCount[];
	offset: number;
	is64Bit: boolean;
};

// NOTE: intentionally has NO `kind` discriminant — the legacy hand-written
// schema (src/lib/schema/resources/iceTakeDictionary.ts) walks this shape and
// asserts every field is declared. The union below discriminates structurally.
export type ParsedIceTakeDictionary = {
	takes: ICETakeHeader[];
	is64Bit: boolean;
	totalTakes: number;
};

/**
 * Union of the structured parse and the heuristic fallback. Discriminate via
 * {@link isStructuredDictionary} (structural — the structured model carries
 * `kind: 'structured'`, the heuristic one carries `takes`).
 */
export type IceTakeDictionaryModel = IceTakeDictionary | ParsedIceTakeDictionary;

/** Type guard: true when the model is the structured (writable) parse. */
export function isStructuredDictionary(model: IceTakeDictionaryModel): model is IceTakeDictionary {
	return (model as IceTakeDictionary).kind === 'structured';
}

// ============================================================================
// Structured parse
// ============================================================================

/**
 * Parse the 0x41 payload into the structured dictionary model. Throws if the
 * container header, entry table, or any take fails to line up — callers that
 * want graceful degradation catch and fall back to the heuristic scanner.
 */
export function parseIceTakeDictionary(data: Uint8Array, littleEndian = true): IceTakeDictionary {
	if (data.byteLength < DICT_BASE_SIZE) {
		throw new BundleError('ICE dictionary payload too small for DictionaryBase', 'ICE_PARSE_ERROR');
	}
	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const u32r = (o: number) => dv.getUint32(o, littleEndian);

	const numEntries = dv.getInt32(0, littleEndian);
	// miDictionarySize @4 is the dictionary span; it is recomputed on write so we
	// do not need to retain it.
	const indexOffset = u32r(8);

	if (numEntries < 0 || numEntries > 0x100000) {
		throw new BundleError(`ICE dictionary entry count out of range: ${numEntries}`, 'ICE_PARSE_ERROR');
	}
	const tableEnd = indexOffset + numEntries * DICT_ENTRY_STRIDE;
	if (indexOffset < DICT_BASE_SIZE || tableEnd > data.byteLength) {
		throw new BundleError('ICE dictionary entry table out of bounds', 'ICE_PARSE_ERROR');
	}

	const entries: IceDictionaryEntry[] = [];
	for (let i = 0; i < numEntries; i++) {
		const base = indexOffset + i * DICT_ENTRY_STRIDE;
		const key = readS64(dv, base, littleEndian);
		const mpData = u32r(base + 8);
		const userFlags = u32r(base + 12);
		if (mpData + 0x64 > data.byteLength) {
			throw new BundleError(`ICE take offset out of bounds at entry ${i}: ${mpData}`, 'ICE_PARSE_ERROR');
		}
		const take = parseIceTakeData(data, mpData, littleEndian);
		entries.push({ key, userFlags, take });
	}

	return { kind: 'structured', indexOffset, entries };
}

function readS64(dv: DataView, offset: number, littleEndian: boolean): bigint {
	const lo = BigInt(dv.getUint32(offset + (littleEndian ? 0 : 4), littleEndian));
	const hi = BigInt(dv.getInt32(offset + (littleEndian ? 4 : 0), littleEndian));
	return (hi << 32n) | (lo & 0xffffffffn);
}

function writeS64(dv: DataView, offset: number, value: bigint, littleEndian: boolean): void {
	const lo = Number(value & 0xffffffffn) >>> 0;
	const hi = Number((value >> 32n) & 0xffffffffn) >>> 0;
	dv.setUint32(offset + (littleEndian ? 0 : 4), lo, littleEndian);
	dv.setUint32(offset + (littleEndian ? 4 : 0), hi, littleEndian);
}

// ============================================================================
// Structured write (byte-exact)
// ============================================================================

/**
 * Rebuild the 0x41 payload byte-exact. Layout: DictionaryBase, pad to 16, the
 * entry table, then each take contiguously (4-byte aligned, which the take size
 * already guarantees) in entry order. mpaIndex/mpData offsets are recomputed
 * from the layout; miDictionarySize/miNumEntries are derived; node bases are 0.
 */
export function writeIceTakeDictionary(model: IceTakeDictionary, littleEndian = true): Uint8Array {
	const numEntries = model.entries.length;
	const indexOffset = roundUp(DICT_BASE_SIZE, 16); // 16
	const tableEnd = indexOffset + numEntries * DICT_ENTRY_STRIDE;

	// Pre-encode takes to learn their sizes and place them contiguously.
	const takeBytes = model.entries.map((e) => writeIceTakeData(e.take, littleEndian));
	let cursor = tableEnd;
	const takeOffsets: number[] = [];
	for (const tb of takeBytes) {
		takeOffsets.push(cursor);
		cursor += tb.byteLength;
	}
	const total = cursor;

	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);

	dv.setInt32(0, numEntries, littleEndian);
	// miDictionarySize: the doc describes this as "file size minus DictionaryBase
	// length", but every retail payload stores the FULL payload size here, so we
	// match the observed bytes.
	dv.setInt32(4, total, littleEndian);
	dv.setUint32(8, indexOffset, littleEndian);

	for (let i = 0; i < numEntries; i++) {
		const base = indexOffset + i * DICT_ENTRY_STRIDE;
		writeS64(dv, base, model.entries[i].key, littleEndian);
		dv.setUint32(base + 8, takeOffsets[i], littleEndian);
		dv.setUint32(base + 12, model.entries[i].userFlags >>> 0, littleEndian);
	}

	for (let i = 0; i < numEntries; i++) {
		out.set(takeBytes[i], takeOffsets[i]);
	}

	return out;
}

function roundUp(value: number, align: number): number {
	return (value + align - 1) & ~(align - 1);
}

// ============================================================================
// Heuristic fallback scanner (legacy)
// ============================================================================

function decodeFixedCStringFromBytes(bytesArr: number[]): string {
	const bytes = new Uint8Array(bytesArr.map((v) => v & 0xff));
	const nul = bytes.indexOf(0);
	const slice = nul >= 0 ? bytes.subarray(0, nul) : bytes;
	return new TextDecoder('utf-8').decode(slice).trim();
}

function isPrintableAscii(str: string): boolean {
	if (str.length === 0) return false;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		if (c < 0x20 || c > 0x7e) return false;
	}
	return true;
}

function isPlausibleHeader(h: { name: string; lengthSeconds: number; elementCounts: ICEElementCount[] }): boolean {
	if (!isPrintableAscii(h.name)) return false;
	if (h.name.length > 32) return false;
	if (!(h.lengthSeconds >= 0 && h.lengthSeconds < 6000)) return false;
	if (!h.elementCounts || h.elementCounts.length !== 12) return false;
	let totalKeys = 0;
	for (const ec of h.elementCounts) {
		if (ec.mu16Intervals > 0x4000 || ec.mu16Keys > 0x4000) return false;
		totalKeys += ec.mu16Keys;
	}
	return totalKeys < 20000;
}

function tryReadHeaderAt(data: Uint8Array, offset: number, endianness: 'little' | 'big'): ICETakeHeader | null {
	try {
		const headerSize = 0x64;
		if (offset + headerSize > data.byteLength) return null;
		const reader = new BufferReader(
			data.buffer.slice(data.byteOffset + offset, data.byteOffset + offset + headerSize),
			{ endianness },
		);
		const raw = ICETakeHeader32Schema.read(reader);
		const name = decodeFixedCStringFromBytes(raw.macTakeName as unknown as number[]);
		const header: ICETakeHeader = {
			guid: raw.miGuid >>> 0,
			name,
			lengthSeconds: raw.mfLength,
			allocated: raw.muAllocated >>> 0,
			elementCounts: raw.mElementCounts,
			offset,
			is64Bit: false,
		};
		return isPlausibleHeader(header) ? header : null;
	} catch {
		return null;
	}
}

function scanHeaders(data: Uint8Array, endianness: 'little' | 'big'): ICETakeHeader[] {
	const headers: ICETakeHeader[] = [];
	const headerSize = 0x64;
	for (let off = 0; off + headerSize <= data.byteLength; off += 4) {
		const h = tryReadHeaderAt(data, off, endianness);
		if (h) {
			if (!headers.some((e) => e.offset === h.offset)) headers.push(h);
			off += headerSize - 4;
		}
	}
	const seen = new Set<string>();
	const unique: ICETakeHeader[] = [];
	for (const h of headers) {
		const key = h.name.toLowerCase();
		if (key && !seen.has(key)) { seen.add(key); unique.push(h); }
	}
	return unique;
}

function scanHeuristic(data: Uint8Array): ParsedIceTakeDictionary {
	const le = scanHeaders(data, 'little');
	const be = scanHeaders(data, 'big');
	const takes = le.length >= be.length ? le : be;
	return { takes, is64Bit: false, totalTakes: takes.length };
}

// ============================================================================
// Public entry points
// ============================================================================

/**
 * Parse already-extracted, decompressed 0x41 bytes into the STRUCTURED model,
 * falling back to the labelled heuristic scanner only if structured parse
 * throws. This is the path the registry handler (and writer) uses.
 */
export function parseIceTakeDictionaryStructured(data: Uint8Array, littleEndian = true): IceTakeDictionaryModel {
	if (data.length >= 2 && data[0] === 0x78) {
		data = decompressData(data);
	}
	try {
		return parseIceTakeDictionary(data, littleEndian);
	} catch {
		return scanHeuristic(data);
	}
}

/**
 * Legacy heuristic-shape parse retained for the hex-viewer inspector and the
 * existing hand-written schema, which read `.takes` / `.totalTakes` / `.is64Bit`.
 * New code should prefer {@link parseIceTakeDictionaryStructured}.
 */
export function parseIceTakeDictionaryData(data: Uint8Array): ParsedIceTakeDictionary {
	if (data.length >= 2 && data[0] === 0x78) {
		data = decompressData(data);
	}
	return scanHeuristic(data);
}

/** Bundle-aware entry point (handles nested-bundle/decompression like other parsers). */
export function parseIceTakeDictionaryFromBundle(
	buffer: ArrayBuffer,
	resource: ResourceEntry,
	options: ParseOptions = {},
	progressCallback?: ProgressCallback,
): IceTakeDictionaryModel {
	try {
		reportProgress(progressCallback, 'parse', 0, 'Starting ICE dictionary parsing');
		const context: ResourceContext = { bundle: parseBundle(buffer), resource, buffer };
		let { data } = getResourceData(context);
		data = handleNestedBundle(data, buffer, resource);
		if (data.length >= 2 && data[0] === 0x78) data = decompressData(data);
		const littleEndian = options.littleEndian ?? true;
		const model = parseIceTakeDictionaryStructured(data, littleEndian);
		reportProgress(progressCallback, 'parse', 1.0, 'Parsed ICE dictionary');
		return model;
	} catch (error) {
		if (error instanceof BundleError) throw error;
		throw new BundleError(
			`Failed to parse ICE take dictionary: ${error instanceof Error ? error.message : String(error)}`,
			'ICE_TAKE_DICTIONARY_PARSE_ERROR',
			{ error, resourceId: resource.resourceId.toString() },
		);
	}
}

export function describeIceTakeDictionary(model: IceTakeDictionaryModel): string {
	if (isStructuredDictionary(model)) return `takes ${model.entries.length}`;
	return `takes ${model.totalTakes} (heuristic)`;
}

// ============================================================================
// Nested bundle handling (unchanged from the previous parser)
// ============================================================================

function handleNestedBundle(data: Uint8Array, originalBuffer: ArrayBuffer, resource: ResourceEntry): Uint8Array {
	if (!isNestedBundle(data)) return data;
	const innerBuffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
	const bundle = parseBundle(innerBuffer);
	const innerResource = bundle.resources.find((r) => r.resourceTypeId === resource.resourceTypeId);
	if (!innerResource) throw new ResourceNotFoundError(resource.resourceTypeId);

	const dataOffsets = bundle.header.resourceDataOffsets;
	let best: Uint8Array | null = null;
	for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
		const sectionOffset = dataOffsets[sectionIndex];
		if (sectionOffset === 0) continue;
		const absoluteOffset = data.byteOffset + sectionOffset;
		if (absoluteOffset >= originalBuffer.byteLength) continue;
		const maxSize = originalBuffer.byteLength - absoluteOffset;
		const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 500000));
		if (sectionData.length >= 2 && sectionData[0] === 0x78) return sectionData;
		if (!best || sectionData.length > best.length) best = sectionData;
	}
	return best ?? data;
}

function reportProgress(callback: ProgressCallback | undefined, type: string, progress: number, message?: string) {
	callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}

export { DEFAULT_USER_FLAGS };
