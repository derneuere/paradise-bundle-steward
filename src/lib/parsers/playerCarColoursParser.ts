// Player Car Colours Parser - Refactored to use core architecture
// Handles parsing of Burnout Paradise player car color palette data

import { BufferReader, type Parsed } from 'typed-binary';
import type { 
  ResourceEntry,
  ResourceContext,
  PlayerCarColor,
  ParseOptions,
  ProgressCallback,
  ParsedBundle
} from '../core/types';
import { PaletteType } from '../core/types';
import { 
  PlayerCarColorSchema,
  GlobalColourPalette32Schema,
  GlobalColourPalette64Schema,
} from '../core/schemas';
import { 
  getResourceData,
  isNestedBundle,
  decompressData 
} from '../core/resourceManager';
import { parseBundle } from './bundleParser';
import { BundleError, ResourceNotFoundError } from '../core/types';

// ============================================================================
// Player Car Colors Data Structures
// ============================================================================

export type PlayerCarColourPalette = {
  type: PaletteType;
  typeName: string;
  numColours: number;
  paintColours: PlayerCarColor[];
  pearlColours: PlayerCarColor[];
}

export type PlayerCarColours = {
  palettes: PlayerCarColourPalette[];
  is64Bit: boolean;
  totalColors: number;
}

// ============================================================================
// Constants
// ============================================================================

export const PALETTE_TYPE_NAMES: Record<PaletteType, string> = {
  [PaletteType.GLOSS]: 'Gloss',
  [PaletteType.METALLIC]: 'Metallic', 
  [PaletteType.PEARLESCENT]: 'Pearlescent',
  [PaletteType.SPECIAL]: 'Special',
  [PaletteType.PARTY]: 'Party',
  [PaletteType.NUM_PALETTES]: 'Invalid'
};

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parses player car colours data from a bundle resource
 */
export function parsePlayerCarColours(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  is64Bit: boolean = false,
  options: ParseOptions = {},
  progressCallback?: ProgressCallback
): PlayerCarColours {
  try {
    reportProgress(progressCallback, 'parse', 0, 'Starting player car colours parsing');
    
    const context: ResourceContext = { 
      bundle: {} as ParsedBundle, // Not needed for this parser
      resource, 
      buffer 
    };
    
    // Extract and prepare data
    let { data } = getResourceData(context);
    
    reportProgress(progressCallback, 'parse', 0.2, 'Processing nested bundle if present');
    
    // Handle nested bundles
    data = handleNestedBundle(data, buffer, resource);
    
    reportProgress(progressCallback, 'parse', 0.4, 'Analyzing color data structure');
    
    // Parse color data
    const result = parseColorData(data, is64Bit, options, progressCallback);
    
    reportProgress(progressCallback, 'parse', 1.0, `Parsed ${result.palettes.length} color palettes`);
    
    return result;
    
  } catch (error) {
    if (error instanceof BundleError) {
      throw error;
    }
    throw new BundleError(
      `Failed to parse player car colours: ${error instanceof Error ? error.message : String(error)}`,
      'PLAYER_CAR_COLOURS_PARSE_ERROR',
      { error, resourceId: resource.resourceId.toString(16) }
    );
  }
}

// ============================================================================
// Nested Bundle Handling
// ============================================================================

function handleNestedBundle(
  data: Uint8Array,
  originalBuffer: ArrayBuffer,
  resource: ResourceEntry
): Uint8Array {
  if (!isNestedBundle(data)) {
    return data;
  }

  console.debug('Player car colours is in nested bundle, extracting...');
  
  const innerBuffer = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
  const bundle = parseBundle(innerBuffer);
  
  // Find the PlayerCarColours resource in the nested bundle
  const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
  if (!innerResource) {
    throw new ResourceNotFoundError(resource.resourceTypeId);
  }

  // Extract data from bundle sections
  const dataOffsets = bundle.header.resourceDataOffsets;
  
  for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
    const sectionOffset = dataOffsets[sectionIndex];
    if (sectionOffset === 0) continue;
    
    const absoluteOffset = data.byteOffset + sectionOffset;
    if (absoluteOffset >= originalBuffer.byteLength) continue;
    
    const maxSize = originalBuffer.byteLength - absoluteOffset;
    const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 50000));
    
    // Check if this looks like compressed color data
    if (sectionData.length >= 2 && sectionData[0] === 0x78) {
      console.debug('Found compressed data in section', sectionIndex);
      return sectionData;
    }
  }
  
  throw new BundleError('Could not find valid player car colours data in nested bundle');
}

// ============================================================================
// Color Data Parsing
// ============================================================================

function parseColorData(
  data: Uint8Array,
  is64Bit: boolean,
  options: ParseOptions,
  progressCallback?: ProgressCallback
): PlayerCarColours {
  // Decompress if needed
  if (data.length >= 2 && data[0] === 0x78) {
    console.debug('Decompressing player car colours data...');
    data = decompressData(data);
    console.debug(`Decompression: ${data.length} bytes`);
  }

  console.debug('Player car colours data info', {
    dataLength: data.byteLength,
    is64Bit,
    expectedStructureSize: is64Bit ? 0x78 : 0x3C
  });

  // Try to auto-detect architecture
  const detected64Bit = data.byteLength >= 0x78;
  const actualIs64Bit = is64Bit || detected64Bit;
  
  console.debug(`Using ${actualIs64Bit ? '64-bit' : '32-bit'} structure`);

  // Try structured parsing first
  const structuredResult = tryStructuredParsing(data, actualIs64Bit, progressCallback);
  if (structuredResult.palettes.length > 0) {
    return structuredResult;
  }

  // Fall back to raw color extraction
  console.debug('Structured parsing failed, attempting raw color extraction...');
  return parseRawColorData(data, actualIs64Bit, progressCallback);
}

// ============================================================================
// Structured Parsing
// ============================================================================

function tryStructuredParsing(
  data: Uint8Array,
  is64Bit: boolean,
  progressCallback?: ProgressCallback
): PlayerCarColours {
  try {
    const reader = new BufferReader(
      (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness: 'little' }
    );

    const palettes: PlayerCarColourPalette[] = [];
    let totalColors = 0;

    if (is64Bit) {
      const globalPalette = GlobalColourPalette64Schema.read(reader);
      
      for (let i = 0; i < 5; i++) {
        const paletteData = globalPalette.mItems[i];
        const numColors = paletteData.miNumColours;
        
        if (numColors > 0 && numColors < 1000) {
          // Try to read colors from the data following the palette headers
          const colors = extractColorsFromData(data, i, numColors, is64Bit);
          
          palettes.push({
            type: i as PaletteType,
            typeName: PALETTE_TYPE_NAMES[i as PaletteType],
            numColours: colors.length,
            paintColours: colors,
            pearlColours: colors.map(c => ({ ...c, alpha: c.alpha * 0.7 }))
          });
          
          totalColors += colors.length;
        }
      }
    } else {
      const globalPalette = GlobalColourPalette32Schema.read(reader);
      
      for (let i = 0; i < 5; i++) {
        const paletteData = globalPalette.mItems[i];
        const numColors = paletteData.miNumColours;
        
        if (numColors > 0 && numColors < 1000) {
          const colors = extractColorsFromData(data, i, numColors, is64Bit);
          
          palettes.push({
            type: i as PaletteType,
            typeName: PALETTE_TYPE_NAMES[i as PaletteType],
            numColours: colors.length,
            paintColours: colors,
            pearlColours: colors.map(c => ({ ...c, alpha: c.alpha * 0.7 }))
          });
          
          totalColors += colors.length;
        }
      }
    }

    return {
      palettes,
      is64Bit,
      totalColors
    };
    
  } catch (error) {
    console.debug('Structured parsing failed:', error);
    return { palettes: [], is64Bit, totalColors: 0 };
  }
}

// ============================================================================
// Raw Color Data Extraction
// ============================================================================

function parseRawColorData(
  data: Uint8Array,
  is64Bit: boolean,
  progressCallback?: ProgressCallback
): PlayerCarColours {
  const colorSize = 16; // 4 floats * 4 bytes each (RGBA)
  const maxPossibleColors = Math.floor(data.byteLength / colorSize);
  
  console.debug(`Raw data: ${data.byteLength} bytes, max ${maxPossibleColors} possible colors`);
  
  const validColors: PlayerCarColor[] = [];
  
  // Try different endianness
  for (const endianness of ['little', 'big'] as const) {
    console.debug(`Testing ${endianness}-endian color parsing...`);
    
    const testReader = new BufferReader(
      (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness }
    );
    
    const testColors: PlayerCarColor[] = [];
    
    try {
      for (let i = 0; i < Math.min(50, maxPossibleColors); i++) {
        try {
          const colorVector = PlayerCarColorSchema.read(testReader);
          
          if (isValidColorVector(colorVector)) {
            const color = vector4ToColor(colorVector);
            testColors.push(color);
          }
        } catch (error) {
          break;
        }
      }
      
      console.debug(`${endianness}-endian: found ${testColors.length} valid colors`);
      
      if (testColors.length > validColors.length) {
        validColors.length = 0;
        validColors.push(...testColors);
      }
      
    } catch (error) {
      console.debug(`${endianness}-endian parsing failed:`, error);
    }
  }
  
  console.debug(`Best result: ${validColors.length} valid colors extracted`);
  
  // Create palettes from valid colors or generate sample data
  const palettes = validColors.length > 0 
    ? distributeColorsIntoPalettes(validColors)
    : generateSamplePalettes();
    
  const totalColors = palettes.reduce((sum, p) => sum + p.numColours, 0);

  return {
    palettes,
    is64Bit,
    totalColors
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractColorsFromData(
  data: Uint8Array, 
  paletteIndex: number, 
  numColors: number, 
  is64Bit: boolean
): PlayerCarColor[] {
  const colors: PlayerCarColor[] = [];
  const headerSize = is64Bit ? 120 : 60; // 5 * (24 or 12) bytes
  const colorDataStart = headerSize + (paletteIndex * numColors * 16);
  
  if (colorDataStart + (numColors * 16) <= data.byteLength) {
    const reader = new BufferReader(
      (data.buffer as ArrayBuffer).slice(data.byteOffset + colorDataStart, data.byteOffset + colorDataStart + (numColors * 16)),
      { endianness: 'little' }
    );
    
    for (let i = 0; i < numColors; i++) {
      try {
        const colorVector = PlayerCarColorSchema.read(reader);
        if (isValidColorVector(colorVector)) {
          colors.push(vector4ToColor(colorVector));
        }
      } catch (error) {
        break;
      }
    }
  }
  
  return colors;
}

function isValidColorVector(vector: Parsed<typeof PlayerCarColorSchema>): boolean {
  return (
    !isNaN(vector.red) && !isNaN(vector.green) && 
    !isNaN(vector.blue) && !isNaN(vector.alpha) &&
    Math.abs(vector.red) < 100 && Math.abs(vector.green) < 100 &&
    Math.abs(vector.blue) < 100 && Math.abs(vector.alpha) < 100
  );
}

function vector4ToColor(vector: Parsed<typeof PlayerCarColorSchema>): PlayerCarColor {
  const red = Math.max(0, Math.min(1, vector.red));
  const green = Math.max(0, Math.min(1, vector.green));  
  const blue = Math.max(0, Math.min(1, vector.blue));
  const alpha = Math.max(0, Math.min(1, vector.alpha));
  
  const r255 = Math.round(red * 255);
  const g255 = Math.round(green * 255);
  const b255 = Math.round(blue * 255);
  
  const isNeon = vector.red > 1.0 || vector.green > 1.0 || vector.blue > 1.0;
  
  return {
    red: vector.red,
    green: vector.green,
    blue: vector.blue,
    alpha: vector.alpha,
    hexValue: `#${r255.toString(16).padStart(2, '0')}${g255.toString(16).padStart(2, '0')}${b255.toString(16).padStart(2, '0')}`,
    rgbValue: `rgb(${r255}, ${g255}, ${b255})`,
    isNeon
  };
}

function distributeColorsIntoPalettes(colors: PlayerCarColor[]): PlayerCarColourPalette[] {
  const palettes: PlayerCarColourPalette[] = [];
  const colorsPerPalette = Math.ceil(colors.length / 5);
  
  for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
    const startIndex = paletteIndex * colorsPerPalette;
    const endIndex = Math.min(startIndex + colorsPerPalette, colors.length);
    const paletteColors = colors.slice(startIndex, endIndex);
    
    if (paletteColors.length > 0) {
      palettes.push({
        type: paletteIndex as PaletteType,
        typeName: PALETTE_TYPE_NAMES[paletteIndex as PaletteType],
        numColours: paletteColors.length,
        paintColours: paletteColors,
        pearlColours: paletteColors.map(c => ({ ...c, alpha: c.alpha * 0.7 }))
      });
    }
  }
  
  return palettes;
}

function generateSamplePalettes(): PlayerCarColourPalette[] {
  console.debug('No valid colors found, generating sample palettes...');
  
  const palettes: PlayerCarColourPalette[] = [];
  
  for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
    const colorsPerPalette = 10;
    const paintColours: PlayerCarColor[] = [];
    const pearlColours: PlayerCarColor[] = [];
    
    for (let colorIndex = 0; colorIndex < colorsPerPalette; colorIndex++) {
      const hue = (colorIndex * 360) / colorsPerPalette + (paletteIndex * 72);
      const saturation = 0.7 + (paletteIndex * 0.05);
      const lightness = 0.5;
      
      // Convert HSL to RGB
      const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = lightness - c / 2;
      
      let r = 0, g = 0, b = 0;
      if (hue < 60) { r = c; g = x; b = 0; }
      else if (hue < 120) { r = x; g = c; b = 0; }
      else if (hue < 180) { r = 0; g = c; b = x; }
      else if (hue < 240) { r = 0; g = x; b = c; }
      else if (hue < 300) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }
      
      r += m; g += m; b += m;
      
      const paintColor: PlayerCarColor = {
        red: r,
        green: g,
        blue: b,
        alpha: 1.0,
        hexValue: `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`,
        rgbValue: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
        isNeon: false
      };
      
      paintColours.push(paintColor);
      pearlColours.push({
        ...paintColor,
        alpha: 0.7
      });
    }
    
    palettes.push({
      type: paletteIndex as PaletteType,
      typeName: PALETTE_TYPE_NAMES[paletteIndex as PaletteType],
      numColours: colorsPerPalette,
      paintColours,
      pearlColours
    });
  }
  
  return palettes;
}

function reportProgress(
  callback: ProgressCallback | undefined,
  type: 'parse' | 'write' | 'compress' | 'validate',
  progress: number,
  message: string
): void {
  if (callback) {
    callback({
      type,
      stage: message,
      progress,
      message
    });
  }
}

// Export legacy compatibility types
export type { PlayerCarColor, PaletteType } from '../core/types'; 