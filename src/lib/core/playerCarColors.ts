// Player Car Colours reader (32-bit PC only).
//
// Layout reference: docs/PlayerCarColours.md (Burnout Wiki snapshot).
//
// BrnWorld::GlobalColourPalette is a fixed 0x3C struct containing
// PlayerCarColourPalette[5] (one per EPallettesTypes value: Gloss, Metallic,
// Pearlescent, Special, Party).
//
// BrnWorld::PlayerCarColourPalette, 32-bit:
//   0x0  u32   mpPaintColours   absolute offset to Vector4[] paint colors
//   0x4  u32   mpPearlColours   absolute offset to Vector4[] pearl colors
//   0x8  i32   miNumColours     number of entries in both arrays
//
// Each color entry is a Vector4 (RGBA f32, 16 bytes). Components are stored
// as percentages of 255 (1.0 == 255). Out-of-range values create the
// "neon" colors documented on the wiki.
//
// This file does NOT support 64-bit Paradise Remastered. All is64Bit code
// paths were deliberately removed during the CLI-first refactor.

import { BinReader } from './binTools';
import { parseBundle } from './bundle';
import { getResourceData, isNestedBundle, decompressData } from './resourceManager';
import type {
	ResourceEntry,
	ResourceContext,
	ParseOptions,
	ProgressCallback,
} from './types';
import { BundleError, ResourceNotFoundError } from './errors';

// =============================================================================
// Types
// =============================================================================

export enum PaletteType {
	GLOSS = 0,
	METALLIC = 1,
	PEARLESCENT = 2,
	SPECIAL = 3,
	PARTY = 4,
	NUM_PALETTES = 5,
}

export const PALETTE_TYPE_NAMES: Record<PaletteType, string> = {
	[PaletteType.GLOSS]: 'Gloss',
	[PaletteType.METALLIC]: 'Metallic',
	[PaletteType.PEARLESCENT]: 'Pearlescent',
	[PaletteType.SPECIAL]: 'Special',
	[PaletteType.PARTY]: 'Party',
	[PaletteType.NUM_PALETTES]: 'Invalid',
};

export type PlayerCarColor = {
	red: number;
	green: number;
	blue: number;
	alpha: number;
	hexValue: string;
	rgbValue: string;
	isNeon: boolean;
};

export type PlayerCarColourPalette = {
	type: PaletteType;
	typeName: string;
	numColours: number;
	paintColours: PlayerCarColor[];
	pearlColours: PlayerCarColor[];
};

export type PlayerCarColours = {
	palettes: PlayerCarColourPalette[];
	totalColors: number;
};

// =============================================================================
// Vector4 → PlayerCarColor conversion
// =============================================================================

function readColor(r: BinReader): PlayerCarColor {
	const red = r.readF32();
	const green = r.readF32();
	const blue = r.readF32();
	const alpha = r.readF32();

	// Neon colors are values outside [0, 1] — the game overreads into memory
	// outside the resource when indices exceed the palette, producing garbage
	// floats. See docs/PlayerCarColours.md §Exploitation.
	const isNeon = red > 1.0 || green > 1.0 || blue > 1.0 || red < 0 || green < 0 || blue < 0;

	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	const r255 = Math.round(clamp(red) * 255);
	const g255 = Math.round(clamp(green) * 255);
	const b255 = Math.round(clamp(blue) * 255);

	return {
		red,
		green,
		blue,
		alpha,
		hexValue: `#${r255.toString(16).padStart(2, '0')}${g255.toString(16).padStart(2, '0')}${b255.toString(16).padStart(2, '0')}`,
		rgbValue: `rgb(${r255}, ${g255}, ${b255})`,
		isNeon,
	};
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parses PlayerCarColours from the 32-bit on-disk layout.
 * Expects already-decompressed bytes.
 */
export function parsePlayerCarColoursData(data: Uint8Array): PlayerCarColours {
	const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
	const reader = new BinReader(buf, true); // 32-bit PC is little-endian

	// Read the 5 palette headers (0xC each, 0x3C total).
	type Header = { paintOff: number; pearlOff: number; numColours: number };
	const headers: Header[] = [];
	for (let i = 0; i < 5; i++) {
		headers.push({
			paintOff: reader.readU32(),
			pearlOff: reader.readU32(),
			numColours: reader.readI32(),
		});
	}

	const palettes: PlayerCarColourPalette[] = [];
	let totalColors = 0;

	for (let i = 0; i < 5; i++) {
		const { paintOff, pearlOff, numColours } = headers[i];
		const paintColours: PlayerCarColor[] = [];
		const pearlColours: PlayerCarColor[] = [];

		if (numColours > 0 && paintOff > 0) {
			reader.position = paintOff;
			for (let j = 0; j < numColours; j++) {
				if (reader.position + 16 > data.byteLength) break;
				paintColours.push(readColor(reader));
			}
		}
		if (numColours > 0 && pearlOff > 0) {
			reader.position = pearlOff;
			for (let j = 0; j < numColours; j++) {
				if (reader.position + 16 > data.byteLength) break;
				pearlColours.push(readColor(reader));
			}
		}

		palettes.push({
			type: i as PaletteType,
			typeName: PALETTE_TYPE_NAMES[i as PaletteType],
			numColours,
			paintColours,
			pearlColours,
		});
		totalColors += paintColours.length;
	}

	return { palettes, totalColors };
}

// =============================================================================
// High-level wrapper (bundle-aware)
// =============================================================================

function reportProgress(
	callback: ProgressCallback | undefined,
	type: string,
	progress: number,
	message?: string,
) {
	callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}

function handleNestedBundle(
	data: Uint8Array,
	originalBuffer: ArrayBuffer,
	resource: ResourceEntry,
): Uint8Array {
	if (!isNestedBundle(data)) return data;

	const innerBuffer = (data.buffer as ArrayBuffer).slice(
		data.byteOffset,
		data.byteOffset + data.byteLength,
	);
	const bundle = parseBundle(innerBuffer);
	const innerResource = bundle.resources.find((r) => r.resourceTypeId === resource.resourceTypeId);
	if (!innerResource) {
		throw new ResourceNotFoundError(resource.resourceTypeId);
	}
	// Walk outer sections looking for the compressed payload.
	const dataOffsets = bundle.header.resourceDataOffsets;
	for (let si = 0; si < dataOffsets.length; si++) {
		const sectionOffset = dataOffsets[si];
		if (sectionOffset === 0) continue;
		const absoluteOffset = data.byteOffset + sectionOffset;
		if (absoluteOffset >= originalBuffer.byteLength) continue;
		const maxSize = originalBuffer.byteLength - absoluteOffset;
		const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 50000));
		if (sectionData.length >= 2 && sectionData[0] === 0x78) return sectionData;
	}
	throw new BundleError(
		'Could not find valid player car colours data in nested bundle',
		'PLAYER_CAR_COLOURS_NESTED_NOT_FOUND',
	);
}

/**
 * High-level wrapper used by parseBundleResources. The `options` argument is
 * accepted for interface symmetry with other parsers but is unused on PC.
 */
export function parsePlayerCarColours(
	buffer: ArrayBuffer,
	resource: ResourceEntry,
	_options: ParseOptions = {},
	progressCallback?: ProgressCallback,
): PlayerCarColours {
	try {
		reportProgress(progressCallback, 'parse', 0, 'Starting player car colours parsing');

		const context: ResourceContext = {
			bundle: parseBundle(buffer),
			resource,
			buffer,
		};
		let { data } = getResourceData(context);

		reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
		data = handleNestedBundle(data, buffer, resource);

		if (data.length >= 2 && data[0] === 0x78) {
			// handleNestedBundle may return still-compressed data from a
			// nested bundle section; decompress before parsing.
			data = decompressData(data);
		}

		reportProgress(progressCallback, 'parse', 0.5, 'Parsing color palettes');
		const result = parsePlayerCarColoursData(data);

		reportProgress(progressCallback, 'parse', 1.0, `Parsed ${result.palettes.length} palettes`);
		return result;
	} catch (error) {
		if (error instanceof BundleError) throw error;
		throw new BundleError(
			`Failed to parse player car colours: ${error instanceof Error ? error.message : String(error)}`,
			'PLAYER_CAR_COLOURS_PARSE_ERROR',
			{ error, resourceTypeId: resource.resourceTypeId },
		);
	}
}
