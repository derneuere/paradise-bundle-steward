// Player Car Colours Writer - Serializes player car colour data back to binary format
// Complements the playerCarColoursParser for round-trip editing

import { BufferWriter } from 'typed-binary';
import * as pako from 'pako';
import type { 
  PlayerCarColours, 
  PlayerCarColourPalette 
} from './playerCarColoursParser';
import type { PlayerCarColor, PaletteType } from '../core/types';

// ============================================================================
// Constants
// ============================================================================

const GLOBAL_PALETTE_HEADER_SIZE_32 = 0x3C; // 60 bytes for 32-bit
const GLOBAL_PALETTE_HEADER_SIZE_64 = 0x78; // 120 bytes for 64-bit
const PALETTE_ENTRY_SIZE_32 = 12; // 12 bytes per palette entry in 32-bit
const PALETTE_ENTRY_SIZE_64 = 24; // 24 bytes per palette entry in 64-bit
const COLOR_SIZE = 16; // 16 bytes per color (4 floats)

// ============================================================================
// Main Writer Functions
// ============================================================================

/**
 * Writes player car colours data to binary format
 */
export function writePlayerCarColours(
  colours: PlayerCarColours,
  littleEndian: boolean = true,
  compress: boolean = false
): Uint8Array {
  const headerSize = colours.is64Bit ? GLOBAL_PALETTE_HEADER_SIZE_64 : GLOBAL_PALETTE_HEADER_SIZE_32;
  const paletteEntrySize = colours.is64Bit ? PALETTE_ENTRY_SIZE_64 : PALETTE_ENTRY_SIZE_32;
  
  // Calculate total size needed
  const totalColors = colours.palettes.reduce((sum, palette) => sum + palette.paintColours.length, 0);
  const colorsDataSize = totalColors * COLOR_SIZE;
  const totalSize = headerSize + colorsDataSize;
  
  const buffer = new ArrayBuffer(totalSize);
  const writer = new BufferWriter(buffer, { 
    endianness: littleEndian ? 'little' : 'big' 
  });

  // Write global palette header
  writeGlobalPaletteHeader(writer, colours, colours.is64Bit);
  
  // Write color data for all palettes
  for (const palette of colours.palettes) {
    writeColourPalette(writer, palette);
  }

  const uncompressedData = new Uint8Array(buffer);
  
  // Apply compression if requested
  if (compress) {
    return compressPlayerCarColoursData(uncompressedData);
  }
  
  return uncompressedData;
}

/**
 * Writes the global palette header structure
 */
function writeGlobalPaletteHeader(
  writer: BufferWriter, 
  colours: PlayerCarColours, 
  is64Bit: boolean
): void {
  const paletteEntrySize = is64Bit ? PALETTE_ENTRY_SIZE_64 : PALETTE_ENTRY_SIZE_32;
  
  // Write 5 palette entries (even if some are empty)
  for (let i = 0; i < 5; i++) {
    const palette = colours.palettes.find(p => p.type === i);
    const numColors = palette ? palette.paintColours.length : 0;
    
    if (is64Bit) {
      // 64-bit structure
      writeU64(writer, BigInt(numColors)); // miNumColours (8 bytes)
      writeU64(writer, 0n); // mpColourArray pointer (8 bytes) - will be null in serialized data
      writeU64(writer, 0n); // padding (8 bytes)
    } else {
      // 32-bit structure  
      writer.writeUint32(numColors); // miNumColours (4 bytes)
      writer.writeUint32(0); // mpColourArray pointer (4 bytes) - will be null in serialized data
      writer.writeUint32(0); // padding (4 bytes)
    }
  }
}

/**
 * Writes a color palette's data
 */
function writeColourPalette(writer: BufferWriter, palette: PlayerCarColourPalette): void {
  // Write each paint color
  for (const color of palette.paintColours) {
    writePlayerCarColor(writer, color);
  }
}

/**
 * Writes a single player car color
 */
function writePlayerCarColor(writer: BufferWriter, color: PlayerCarColor): void {
  // Write as 4 32-bit floats (16 bytes total)
  writer.writeFloat32(color.red);   // 4 bytes
  writer.writeFloat32(color.green); // 4 bytes  
  writer.writeFloat32(color.blue);  // 4 bytes
  writer.writeFloat32(color.alpha); // 4 bytes
}

/**
 * Writes a 64-bit integer (8 bytes)
 */
function writeU64(writer: BufferWriter, value: bigint): void {
  // Write as little-endian 64-bit integer
  const low = Number(value & 0xFFFFFFFFn);
  const high = Number(value >> 32n);
  
  writer.writeUint32(low);
  writer.writeUint32(high);
}

/**
 * Compresses player car colours data using zlib
 */
function compressPlayerCarColoursData(data: Uint8Array): Uint8Array {
  try {
    return pako.deflate(data);
  } catch (error) {
    console.warn('Failed to compress player car colours data:', error);
    return data; // Return uncompressed data as fallback
  }
}

/**
 * Calculates the total size needed for player car colours data
 */
export function calculatePlayerCarColoursSize(colours: PlayerCarColours): number {
  const headerSize = colours.is64Bit ? GLOBAL_PALETTE_HEADER_SIZE_64 : GLOBAL_PALETTE_HEADER_SIZE_32;
  const totalColors = colours.palettes.reduce((sum, palette) => sum + palette.paintColours.length, 0);
  const colorsDataSize = totalColors * COLOR_SIZE;
  return headerSize + colorsDataSize;
}

/**
 * Validates player car colours data before writing
 */
export function validatePlayerCarColours(colours: PlayerCarColours): string[] {
  const errors: string[] = [];

  if (!colours.palettes || colours.palettes.length === 0) {
    errors.push('Must have at least one color palette');
  }

  if (colours.palettes.length > 5) {
    errors.push('Cannot have more than 5 color palettes');
  }

  for (const palette of colours.palettes) {
    if (palette.type < 0 || palette.type >= 5) {
      errors.push(`Invalid palette type: ${palette.type}`);
    }

    if (palette.paintColours.length > 1000) {
      errors.push(`Too many colors in ${palette.typeName} palette: ${palette.paintColours.length}`);
    }

    for (const color of palette.paintColours) {
      if (color.red < 0 || color.red > 1) {
        errors.push(`Invalid red value: ${color.red} (must be 0-1)`);
      }
      if (color.green < 0 || color.green > 1) {
        errors.push(`Invalid green value: ${color.green} (must be 0-1)`);
      }
      if (color.blue < 0 || color.blue > 1) {
        errors.push(`Invalid blue value: ${color.blue} (must be 0-1)`);
      }
      if (color.alpha < 0 || color.alpha > 1) {
        errors.push(`Invalid alpha value: ${color.alpha} (must be 0-1)`);
      }
    }
  }

  return errors;
}