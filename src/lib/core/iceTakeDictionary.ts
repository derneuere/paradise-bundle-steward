// ICE Take Dictionary - schemas, types, and reading functions

import {
	object,
	arrayOf,
	u8,
	u16,
	u32,
	f32,
	type Parsed
} from 'typed-binary';
import { BufferReader } from 'typed-binary';
import { parseBundle } from './bundle';
import { getResourceData, isNestedBundle, decompressData } from './resourceManager';
import type {
	ResourceEntry,
	ResourceContext,
	ParsedBundle,
	ParseOptions,
	ProgressCallback,
	RESOURCE_TYPE_IDS as _IGNORE
} from './types';
import { ResourceNotFoundError, BundleError } from './errors';

// ============================================================================
// Schemas (header-only; payload after header is variable and not parsed yet)
// ============================================================================

export const ICEElementCountSchema = object({
	mu16Intervals: u16,
	mu16Keys: u16
});

// 32-bit: bTNode is 8 bytes (next, prev pointers)
export const ICETakeHeader32Schema = object({
	// bTNode (next, prev) - ignored semantics
	bNodeNext: u32,
	bNodePrev: u32,
	miGuid: u32,
	macTakeName: arrayOf(u8, 32), // char[32]
	mfLength: f32,
	muAllocated: u32,
	mElementCounts: arrayOf(ICEElementCountSchema, 12)
});

// 64-bit: bTNode is 16 bytes (next, prev pointers)
export const ICETakeHeader64Schema = object({
	// bTNode (next, prev) - ignored semantics
	bNodeNextLow: u32,
	bNodeNextHigh: u32,
	bNodePrevLow: u32,
	bNodePrevHigh: u32,
	miGuid: u32,
	macTakeName: arrayOf(u8, 32), // char[32]
	mfLength: f32,
	muAllocated: u32,
	mElementCounts: arrayOf(ICEElementCountSchema, 12)
});

// ============================================================================
// Types
// ============================================================================

export enum ICEChannels {
	eICE_CHANNEL_MAIN = 0,
	eICE_CHANNEL_BLEND = 1,
	eICE_CHANNEL_RAWFOCUS = 2,
	eICE_CHANNEL_SHAKE = 3,
	eICE_CHANNEL_TIME = 4,
	eICE_CHANNEL_TAG = 5,
	eICE_CHANNEL_OVERLAY = 6,
	eICE_CHANNEL_LETTERBOX = 7,
	eICE_CHANNEL_FADE = 8,
	eICE_CHANNEL_POSTFX = 9,
	eICE_CHANNEL_ASSEMBLY = 10,
	eICE_CHANNEL_SHAKE_DATA = 11
}

export type ICEElementCount = Parsed<typeof ICEElementCountSchema>;

export type ICETakeHeader = {
	guid: number;
	name: string;
	lengthSeconds: number;
	allocated: number;
	elementCounts: ICEElementCount[]; // 12 channels
	offset: number; // offset in data where header was found
	is64Bit: boolean;
}

export type ParsedIceTakeDictionary = {
	takes: ICETakeHeader[];
	is64Bit: boolean;
	totalTakes: number;
}

// ============================================================================
// Utilities
// ============================================================================

function decodeFixedCStringFromBytes(bytesArr: number[]): string {
	const bytes = new Uint8Array(bytesArr.map(v => v & 0xFF));
	const nul = bytes.indexOf(0);
	const slice = nul >= 0 ? bytes.subarray(0, nul) : bytes;
	return new TextDecoder('utf-8').decode(slice).trim();
}

function isPrintableAscii(str: string): boolean {
	if (str.length === 0) return false;
	for (let i = 0; i < str.length; i++) {
		const c = str.charCodeAt(i);
		if (c < 0x20 || c > 0x7E) return false;
	}
	return true;
}

function isPlausibleHeader(h: {
	name: string;
	lengthSeconds: number;
	elementCounts: ICEElementCount[];
}): boolean {
	if (!isPrintableAscii(h.name)) return false;
	if (h.name.length > 32) return false;
	if (!(h.lengthSeconds >= 0 && h.lengthSeconds < 6000)) return false; // less than 100 minutes
	if (!h.elementCounts || h.elementCounts.length !== 12) return false;
	let totalKeys = 0;
	for (const ec of h.elementCounts) {
		if (ec.mu16Intervals > 0x4000 || ec.mu16Keys > 0x4000) return false;
		totalKeys += ec.mu16Keys;
	}
	return totalKeys < 20000; // conservative bound
}

// ============================================================================
// Core parsing (header scanning heuristic)
// ============================================================================

function tryReadHeaderAt(
	data: Uint8Array,
	offset: number,
	is64Bit: boolean,
	endianness: 'little' | 'big'
): ICETakeHeader | null {
	try {
		const headerSize = is64Bit ? 0x6C : 0x64; // 108 vs 100 bytes
		if (offset + headerSize > data.byteLength) return null;
		const reader = new BufferReader(
			data.buffer.slice(data.byteOffset + offset, data.byteOffset + offset + headerSize),
			{ endianness }
		);

		const raw = (is64Bit ? ICETakeHeader64Schema : ICETakeHeader32Schema).read(reader);
		const name = decodeFixedCStringFromBytes(raw.macTakeName as unknown as number[]);
		const header: ICETakeHeader = {
			guid: raw.miGuid >>> 0,
			name,
			lengthSeconds: raw.mfLength,
			allocated: raw.muAllocated >>> 0,
			elementCounts: raw.mElementCounts,
			offset,
			is64Bit
		};

		return isPlausibleHeader(header) ? header : null;
	} catch (_e) {
		return null;
	}
}

function scanHeaders(
	data: Uint8Array,
	is64Bit: boolean,
	endianness: 'little' | 'big'
): ICETakeHeader[] {
	const headers: ICETakeHeader[] = [];
	const headerSize = is64Bit ? 0x6C : 0x64;

	// Step through data with 4-byte alignment to find plausible headers
	for (let off = 0; off + headerSize <= data.byteLength; off += 4) {
		const h = tryReadHeaderAt(data, off, is64Bit, endianness);
		if (h) {
			// Prevent excessive duplicates in case of overlapping scans
			if (!headers.some(e => e.offset === h.offset)) {
				headers.push(h);
			}
			// Jump ahead by at least header size to avoid re-detecting inside payload
			off += headerSize - 4;
		}
	}

	// De-duplicate by name, prefer first occurrence
	const seen = new Set<string>();
	const unique: ICETakeHeader[] = [];
	for (const h of headers) {
		const key = h.name.toLowerCase();
		if (key && !seen.has(key)) {
			seen.add(key);
			unique.push(h);
		}
	}

	return unique;
}

// ============================================================================
// High-Level Parsing Functions
// ============================================================================

export function parseIceTakeDictionary(
	buffer: ArrayBuffer,
	resource: ResourceEntry,
	options: ParseOptions = {},
	progressCallback?: ProgressCallback
): ParsedIceTakeDictionary {
	try {
		reportProgress(progressCallback, 'parse', 0, 'Starting ICE dictionary parsing');

		const context: ResourceContext = {
			bundle: {} as ParsedBundle,
			resource,
			buffer
		};

		let { data } = getResourceData(context);

		reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
		data = handleNestedBundle(data, buffer, resource);

		// Decompress if needed after nested extraction
		if (data.length >= 2 && data[0] === 0x78) {
			data = decompressData(data);
		}

		reportProgress(progressCallback, 'parse', 0.4, 'Scanning for ICETake headers');


		// Try both endianness and both 32/64-bit layouts; pick best
		const candidates = [
			{ list: scanHeaders(data, true, 'little'), is64: true, end: 'little' as const },
			{ list: scanHeaders(data, false, 'little'), is64: false, end: 'little' as const },
			{ list: scanHeaders(data, true, 'big'), is64: true, end: 'big' as const },
			{ list: scanHeaders(data, false, 'big'), is64: false, end: 'big' as const }
		];
		candidates.sort((a, b) => b.list.length - a.list.length);
		const best = candidates[0];

		const picks = best.list;
		const is64Bit = best.is64;

		reportProgress(progressCallback, 'parse', 1.0, `Parsed ${picks.length} ICE takes`);

		return {
			takes: picks,
			is64Bit,
			totalTakes: picks.length
		};

	} catch (error) {
		if (error instanceof BundleError) {
			throw error;
		}
		throw new BundleError(
			`Failed to parse ICE take dictionary: ${error instanceof Error ? error.message : String(error)}`,
			'ICE_TAKE_DICTIONARY_PARSE_ERROR',
			{ error, resourceId: resource.resourceId.toString() }
		);
	}
}

// ============================================================================
// Nested Bundle Handling (similar to other parsers)
// ============================================================================

function handleNestedBundle(
	data: Uint8Array,
	originalBuffer: ArrayBuffer,
	resource: ResourceEntry
): Uint8Array {
	if (!isNestedBundle(data)) {
		return data;
	}

	const innerBuffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
	const bundle = parseBundle(innerBuffer);

	const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
	if (!innerResource) {
		throw new ResourceNotFoundError(resource.resourceTypeId);
	}

	const dataOffsets = bundle.header.resourceDataOffsets;
	let best: Uint8Array | null = null;
	for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
		const sectionOffset = dataOffsets[sectionIndex];
		if (sectionOffset === 0) continue;

		const absoluteOffset = data.byteOffset + sectionOffset;
		if (absoluteOffset >= originalBuffer.byteLength) continue;

		const maxSize = originalBuffer.byteLength - absoluteOffset;
		const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 500000));

		// Return compressed block immediately; we'll decompress later upstream
		if (sectionData.length >= 2 && sectionData[0] === 0x78) {
			return sectionData;
		}

		// Track the largest uncompressed candidate section
		if (!best || sectionData.length > best.length) {
			best = sectionData;
		}
	}

	// If no specific section matched, return the largest uncompressed candidate, else original
	return best ?? data;
}

// ============================================================================
// Public helpers
// ============================================================================

export function parseIceTakeDictionaryData(
	data: Uint8Array,
	is64BitHint?: boolean
): ParsedIceTakeDictionary {
	if (data.length >= 2 && data[0] === 0x78) {
		data = decompressData(data);
	}
	const candidates = [
		{ list: scanHeaders(data, true, 'little'), is64: true },
		{ list: scanHeaders(data, false, 'little'), is64: false },
		{ list: scanHeaders(data, true, 'big'), is64: true },
		{ list: scanHeaders(data, false, 'big'), is64: false }
	];
	candidates.sort((a, b) => b.list.length - a.list.length);
	const best = candidates[0];
	return { takes: best.list, is64Bit: best.is64, totalTakes: best.list.length };
}

function reportProgress(
	callback: ProgressCallback | undefined,
	type: string,
	progress: number,
	message?: string
) {
	callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}


