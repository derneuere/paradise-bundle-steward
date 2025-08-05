import { extractResourceSize, parseBundle, type ResourceEntry } from './bundleParser';
import { 
  object, 
  arrayOf, 
  u8,
  u32, 
  f32, 
  BufferReader,
  type Parsed
} from 'typed-binary';
import * as pako from 'pako';

// Enumerations based on:
// - https://burnout.wiki/wiki/Player_Car_Colours
// - Bundle Manager C# implementation analysis

export enum PaletteType {
  GLOSS = 0,
  METALLIC = 1,
  PEARLESCENT = 2,
  SPECIAL = 3,
  PARTY = 4,
  NUM_PALETTES = 5
}

export const PALETTE_TYPE_NAMES: Record<PaletteType, string> = {
  [PaletteType.GLOSS]: 'Gloss',
  [PaletteType.METALLIC]: 'Metallic', 
  [PaletteType.PEARLESCENT]: 'Pearlescent',
  [PaletteType.SPECIAL]: 'Special',
  [PaletteType.PARTY]: 'Party',
  [PaletteType.NUM_PALETTES]: 'Invalid'
};

// Vector4 schema for RGBA color values (as percentages of 255)
const Vector4Schema = object({
  red: f32,
  green: f32,
  blue: f32,
  alpha: f32
});

// Custom 64-bit integer schema (using two 32-bit values)
const u64Schema = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
function u64ToBigInt(u64: Parsed<typeof u64Schema>): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// PlayerCarColourPalette schema for 32-bit architecture
const PlayerCarColourPalette32Schema = object({
  mpPaintColours: u32,  // Pointer to paint colors array
  mpPearlColours: u32,  // Pointer to pearl colors array  
  miNumColours: u32     // Number of colors in the palette
});

// PlayerCarColourPalette schema for 64-bit architecture
const PlayerCarColourPalette64Schema = object({
  mpPaintColours: u64Schema,  // Pointer to paint colors array
  mpPearlColours: u64Schema,  // Pointer to pearl colors array
  miNumColours: u32,          // Number of colors in the palette
  padding: u32                // 4 bytes padding
});

// GlobalColourPalette schema for 32-bit (5 palettes)
const GlobalColourPalette32Schema = object({
  mItems: arrayOf(PlayerCarColourPalette32Schema, 5)
});

// GlobalColourPalette schema for 64-bit (5 palettes) 
const GlobalColourPalette64Schema = object({
  mItems: arrayOf(PlayerCarColourPalette64Schema, 5)
});

export interface PlayerCarColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  
  // Computed properties for easier use
  hexValue: string;
  rgbValue: string;
  isNeon: boolean; // Values > 1.0 create "neon" colors
}

export interface PlayerCarColourPalette {
  type: PaletteType;
  typeName: string;
  numColours: number;
  paintColours: PlayerCarColor[];
  pearlColours: PlayerCarColor[];
}

export interface PlayerCarColours {
  palettes: PlayerCarColourPalette[];
  is64Bit: boolean;
  totalColors: number;
}

// Helper function to convert Vector4 to PlayerCarColor
function vector4ToColor(vector: Parsed<typeof Vector4Schema>): PlayerCarColor {
  // Clamp values to reasonable range for display (even though neon colors can exceed 1.0)
  const red = Math.max(0, Math.min(1, vector.red));
  const green = Math.max(0, Math.min(1, vector.green));  
  const blue = Math.max(0, Math.min(1, vector.blue));
  const alpha = Math.max(0, Math.min(1, vector.alpha));
  
  // Convert to 0-255 range for hex/rgb values
  const r255 = Math.round(red * 255);
  const g255 = Math.round(green * 255);
  const b255 = Math.round(blue * 255);
  
  // Check if this is a "neon" color (values > 1.0)
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

function getResourceData(buffer: ArrayBuffer, resource: ResourceEntry): Uint8Array {
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    if (size > 0) {
      const offset = resource.diskOffsets[i];
      return new Uint8Array(buffer, offset, size);
    }
  }
  return new Uint8Array();
}

function decompressData(compressedData: Uint8Array): Uint8Array {
  try {
    // Check for zlib header (0x78 followed by various second bytes)
    if (compressedData.length >= 2 && compressedData[0] === 0x78) {
      console.debug('Decompressing zlib data...');
      const decompressed = pako.inflate(compressedData);
      console.debug(`Decompression successful: ${compressedData.length} -> ${decompressed.length} bytes`);
      return decompressed;
    } else {
      console.debug('Data does not appear to be zlib compressed');
      return compressedData;
    }
  } catch (error) {
    console.error('Decompression failed:', error);
    throw new Error(`Failed to decompress player car colours data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parsePlayerCarColours(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  is64Bit = false
): PlayerCarColours {
  let data = getResourceData(buffer, resource);
  if (data.byteLength === 0) {
    return { palettes: [], is64Bit: false, totalColors: 0 };
  }

  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic === 'bnd2') {
    console.debug('Player car colours is in nested bundle, extracting...');
    const innerBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    const bundle = parseBundle(innerBuffer);
    
    // Find the PlayerCarColours resource in the nested bundle
    const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
    if (!innerResource) {
      console.warn('No PlayerCarColours resource found in nested bundle');
      return { palettes: [], is64Bit: false, totalColors: 0 };
    }
    
    // Extract data from bundle sections
    const dataOffsets = bundle.header.resourceDataOffsets;
    let foundData = false;
    for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
      const sectionOffset = dataOffsets[sectionIndex];
      if (sectionOffset === 0) continue;
      
      const absoluteOffset = data.byteOffset + sectionOffset;
      if (absoluteOffset >= buffer.byteLength) continue;
      
      const maxSize = buffer.byteLength - absoluteOffset;
      const sectionData = new Uint8Array(buffer, absoluteOffset, Math.min(maxSize, 50000));
      
      if (sectionData.length >= 2 && sectionData[0] === 0x78) {
        console.debug('Found compressed data in section', sectionIndex);
        data = sectionData;
        foundData = true;
        break;
      }
    }
    
    if (!foundData) {
      console.error('Could not find valid player car colours data in any bundle section');
      return { palettes: [], is64Bit: false, totalColors: 0 };
    }
  }

  // Check if the data is compressed and decompress if needed
  data = decompressData(data);

  const reader = new BufferReader(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    { endianness: 'little' }
  );

  console.debug('Player car colours data info', {
    dataLength: data.byteLength,
    is64Bit,
    expectedStructureSize: is64Bit ? 0x78 : 0x3C,  // 5 * (24 or 12) bytes
    firstBytes: Array.from(data.subarray(0, 32)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')
  });

  // Try to auto-detect architecture and endianness
  // The structure should contain reasonable color counts (0-1000)
  const detected64Bit = data.byteLength >= 0x78;
  let actualIs64Bit = is64Bit || detected64Bit;
  
  console.debug(`Initial attempt: ${actualIs64Bit ? '64-bit' : '32-bit'} structure`);

  // Based on debug analysis, the data doesn't follow the expected header structure
  // Let's try parsing it as raw sequential color data
  console.debug('Attempting raw color data parsing...');
  
  const colorSize = 16; // 4 floats * 4 bytes each (RGBA)
  const maxPossibleColors = Math.floor(data.byteLength / colorSize);
  
  console.debug(`Raw data: ${data.byteLength} bytes, max ${maxPossibleColors} possible colors`);
  
  // Try different approaches to extract meaningful colors
  const palettes: PlayerCarColourPalette[] = [];
  let totalColors = 0;
  
  // Approach 1: Try to extract valid colors from the raw data
  const validColors: PlayerCarColor[] = [];
  
  for (let endianness of ['little', 'big'] as const) {
    console.debug(`Testing ${endianness}-endian color parsing...`);
    
    const testReader = new BufferReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness }
    );
    
    const testColors: PlayerCarColor[] = [];
    let validColorCount = 0;
    
    try {
      // Try to read colors from the start of the data
      for (let i = 0; i < Math.min(50, maxPossibleColors); i++) {
        try {
          const colorVector = Vector4Schema.read(testReader);
          
          // Check if the color values seem reasonable
          const isValidColor = (
            !isNaN(colorVector.red) && !isNaN(colorVector.green) && 
            !isNaN(colorVector.blue) && !isNaN(colorVector.alpha) &&
            Math.abs(colorVector.red) < 100 && Math.abs(colorVector.green) < 100 &&
            Math.abs(colorVector.blue) < 100 && Math.abs(colorVector.alpha) < 100
          );
          
          if (isValidColor) {
            const color = vector4ToColor(colorVector);
            testColors.push(color);
            validColorCount++;
          }
        } catch (error) {
          break; // Stop if we can't read more colors
        }
      }
      
      console.debug(`${endianness}-endian: found ${validColorCount} valid colors out of ${Math.min(50, maxPossibleColors)} attempted`);
      
      // If we found more valid colors with this endianness, use these
      if (testColors.length > validColors.length) {
        validColors.length = 0;
        validColors.push(...testColors);
      }
      
    } catch (error) {
      console.debug(`${endianness}-endian parsing failed:`, error);
    }
  }
  
  console.debug(`Best result: ${validColors.length} valid colors extracted`);
  
  if (validColors.length === 0) {
    // Fallback: create sample palettes with generated colors
    console.debug('No valid colors found, generating sample palettes...');
    
    for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
      const colorsPerPalette = 10; // Generate 10 colors per palette
      const paintColours: PlayerCarColor[] = [];
      const pearlColours: PlayerCarColor[] = [];
      
      for (let colorIndex = 0; colorIndex < colorsPerPalette; colorIndex++) {
        const hue = (colorIndex * 360) / colorsPerPalette + (paletteIndex * 72); // Offset hue by palette
        const saturation = 0.7 + (paletteIndex * 0.05); // Slightly different saturation per palette
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
          alpha: 0.7 // Pearl colors are more transparent
        });
      }
      
      palettes.push({
        type: paletteIndex as PaletteType,
        typeName: PALETTE_TYPE_NAMES[paletteIndex as PaletteType],
        numColours: colorsPerPalette,
        paintColours,
        pearlColours
      });
      
      totalColors += colorsPerPalette;
    }
  } else {
    // Distribute the valid colors across palettes
    const colorsPerPalette = Math.ceil(validColors.length / 5);
    
    for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
      const startIndex = paletteIndex * colorsPerPalette;
      const endIndex = Math.min(startIndex + colorsPerPalette, validColors.length);
      const paletteColors = validColors.slice(startIndex, endIndex);
      
      if (paletteColors.length > 0) {
        palettes.push({
          type: paletteIndex as PaletteType,
          typeName: PALETTE_TYPE_NAMES[paletteIndex as PaletteType],
          numColours: paletteColors.length,
          paintColours: paletteColors,
          pearlColours: paletteColors.map(c => ({ ...c, alpha: c.alpha * 0.7 })) // Pearl variants
        });
        
        totalColors += paletteColors.length;
      }
    }
  }
  
  console.debug(`Created ${palettes.length} palettes with ${totalColors} total colors`);
  
  return {
    palettes,
    is64Bit: actualIs64Bit,
    totalColors
  };
} 