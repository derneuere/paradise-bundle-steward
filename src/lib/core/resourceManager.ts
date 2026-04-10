// Resource Manager - Centralized resource handling for all bundle operations
// Handles compression, decompression, validation, and data extraction

import * as pako from 'pako';
import type {
  ResourceEntry,
  ResourceData,
  ResourceContext,
  ParsedBundle
} from './types';
import { 
  CompressionError,
  ValidationError,
} from './errors';


// ============================================================================
// Resource Data Extraction
// ============================================================================

/**
 * Extracts raw resource data from a bundle buffer.
 *
 * `resource.diskOffsets[i]` is the offset RELATIVE to the start of the
 * corresponding memory block (`bundle.header.resourceDataOffsets[i]`), so the
 * absolute offset into the buffer is `base + rel`. Earlier versions of this
 * function treated diskOffsets as absolute, which silently returned bytes
 * starting at 0 (the bundle header). Every parser had to paper over it with a
 * nested-bundle fallback. The signature now requires the parsed bundle so the
 * base offset is always available.
 */
export function extractResourceData(
  buffer: ArrayBuffer,
  bundle: ParsedBundle,
  resource: ResourceEntry,
): Uint8Array {
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    if (size <= 0) continue;
    const base = bundle.header.resourceDataOffsets[i] >>> 0;
    const rel = resource.diskOffsets[i] >>> 0;
    const start = (base + rel) >>> 0;
    if (start + size <= buffer.byteLength) {
      return new Uint8Array(buffer, start, size);
    }
  }
  return new Uint8Array();
}

/**
 * Extract all three memory blocks of a resource, decompressing each
 * independently. Returns an array of [block0, block1, block2] where each
 * entry is either a Uint8Array or null if the block has zero size or
 * extends beyond the buffer.
 *
 * This is a generalised version of getRenderableBlocks() from renderable.ts.
 * Any resource type that stores data across multiple blocks (Renderable,
 * Texture, etc.) can use it.
 */
export function getResourceBlocks(
  buffer: ArrayBuffer,
  bundle: ParsedBundle,
  resource: ResourceEntry,
): (Uint8Array | null)[] {
  const blocks: (Uint8Array | null)[] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    if (size <= 0) continue;
    const base = bundle.header.resourceDataOffsets[i] >>> 0;
    const rel = resource.diskOffsets[i] >>> 0;
    const start = (base + rel) >>> 0;
    if (start + size > buffer.byteLength) continue;
    let bytes = new Uint8Array(buffer, start, size);
    if (isCompressed(bytes)) bytes = decompressData(bytes);
    blocks[i] = bytes;
  }
  return blocks;
}

/**
 * Extracts size from size and alignment packed value
 */
export function extractResourceSize(sizeAndAlignment: number): number {
  // Size is stored in the lower 28 bits, alignment in upper 4 bits
  return sizeAndAlignment & 0x0FFFFFFF;
}

/**
 * Extracts alignment from size and alignment packed value
 */
export function extractAlignment(sizeAndAlignment: number): number {
  // Alignment is stored in upper 4 bits as a power of 2
  const alignmentPower = (sizeAndAlignment >>> 28) & 0xF;
  return 1 << alignmentPower;
}

/**
 * Packs size and alignment into a single value
 */
export function packSizeAndAlignment(size: number, alignment: number): number {
  const alignmentPower = Math.log2(alignment);
  return size | ((alignmentPower & 0xF) << 28);
}

// ============================================================================
// Compression Handling
// ============================================================================

/**
 * Detects if data is compressed (zlib format)
 */
export function isCompressed(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x78;
}

/**
 * Decompresses zlib-compressed data
 */
export function decompressData(compressedData: Uint8Array): Uint8Array {
  try {
    if (!isCompressed(compressedData)) {
      console.debug(`📂 Data is not compressed: ${compressedData.length} bytes`);
      return compressedData;
    }

    console.debug(`📖 Decompressing data: ${compressedData.length} bytes`);
    const decompressed = pako.inflate(compressedData);
    console.debug(`✅ Decompression complete: ${compressedData.length} -> ${decompressed.length} bytes (ratio: ${(decompressed.length / compressedData.length).toFixed(1)}x)`);
    return decompressed;
  } catch (error) {
    throw new CompressionError(
      `Failed to decompress data: ${error instanceof Error ? error.message : String(error)}`,
      { originalSize: compressedData.length, error }
    );
  }
}

/**
 * Compresses data using zlib
 */
export function compressData(data: Uint8Array, level: number = 6): Uint8Array {
  try {
    // Clamp level to valid pako range (0-9)
    const validLevel = Math.max(0, Math.min(9, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    console.debug(`🗜️ Compressing data: ${data.length} bytes at level ${validLevel}`);
    const compressed = pako.deflate(data, { level: validLevel });
    console.debug(`✅ Compression complete: ${data.length} -> ${compressed.length} bytes (ratio: ${(compressed.length / data.length * 100).toFixed(1)}%)`);
    return compressed;
  } catch (error) {
    throw new CompressionError(
      `Failed to compress data: ${error instanceof Error ? error.message : String(error)}`,
      { originalSize: data.length, error }
    );
  }
}

/**
 * Gets resource data with automatic decompression
 */
export function getResourceData(context: ResourceContext): ResourceData {
  const rawData = extractResourceData(context.buffer, context.bundle, context.resource);
  const compressed = isCompressed(rawData);
  const data = compressed ? decompressData(rawData) : rawData;

  return {
    data,
    isCompressed: compressed,
    originalSize: compressed ? rawData.length : undefined
  };
}

// ============================================================================
// Nested Bundle Handling
// ============================================================================

/**
 * Detects if resource data contains a nested bundle
 */
export function isNestedBundle(data: Uint8Array): boolean {
  if (data.length < 8) {
    return false; // Too small to be a bundle
  }

  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic !== 'bnd2') {
    return false;
  }

  // Check version (should be 2 for Burnout Paradise bundles)
  const version = new DataView(data.buffer, data.byteOffset + 4).getUint32(0, true);
  if (version !== 2) {
    return false;
  }

  // Check platform (should be 1 for PC, 2 for X360, 3 for PS3)
  const platform = new DataView(data.buffer, data.byteOffset + 8).getUint32(0, true);
  if (platform < 1 || platform > 3) {
    return false;
  }

  console.debug(`isNestedBundle: Found valid bundle - magic: ${magic}, version: ${version}, platform: ${platform}, size: ${data.length}`);
  return true;
}

/**
 * Extracts data from nested bundle sections
 */
export function extractFromNestedBundle(
  buffer: ArrayBuffer,
  nestedData: Uint8Array,
  targetResourceTypeId: number
): Uint8Array | null {
  if (!isNestedBundle(nestedData)) {
    return null;
  }

  try {
    // This would need to import parseBundle, but to avoid circular deps,
    // we'll handle this in the specific parsers
    return null;
  } catch (error) {
    console.warn('Failed to parse nested bundle:', error);
    return null;
  }
}

// ============================================================================
// Resource Validation
// ============================================================================

/**
 * Validates resource entry data integrity
 */
export function validateResourceEntry(resource: ResourceEntry, bufferSize: number): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check resource ID
  if (resource.resourceId.low === 0 && resource.resourceId.high === 0) {
    errors.push(new ValidationError('Resource ID cannot be zero'));
  }

  // Check offsets and sizes
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    const offset = resource.diskOffsets[i];

    if (size > 0) {
      if (offset < 0) {
        errors.push(new ValidationError(`Invalid negative offset for memory type ${i}: ${offset}`));
      }

      if (offset + size > bufferSize) {
        errors.push(new ValidationError(
          `Resource data extends beyond buffer for memory type ${i}: offset=${offset}, size=${size}, bufferSize=${bufferSize}`
        ));
      }

      const alignment = extractAlignment(resource.sizeAndAlignmentOnDisk[i]);
      if (offset % alignment !== 0) {
        errors.push(new ValidationError(
          `Resource offset not aligned for memory type ${i}: offset=${offset}, alignment=${alignment}`
        ));
      }
    }
  }

  // Check import data
  if (resource.importCount > 0 && resource.importOffset === 0) {
    errors.push(new ValidationError('Resource has imports but no import offset'));
  }

  return errors;
}


// ============================================================================
// Resource Utilities
// ============================================================================

/**
 * Finds a resource by type ID
 */
export function findResourceByType(resources: ResourceEntry[], typeId: number): ResourceEntry | undefined {
  return resources.find(r => r.resourceTypeId === typeId);
}

/**
 * Finds all resources of a specific type
 */
export function findResourcesByType(resources: ResourceEntry[], typeId: number): ResourceEntry[] {
  return resources.filter(r => r.resourceTypeId === typeId);
}

/**
 * Gets the memory type name for a platform
 */
export function getMemoryTypeName(platform: number, memoryIndex: number): string {
  const types = {
    1: ['Main Memory', 'Disposable', 'Dummy'],      // PC
    2: ['Main Memory', 'Physical', 'Dummy'],        // Xbox360  
    3: ['Main Memory', 'Graphics System', 'Graphics Local'] // PS3
  }[platform];
  
  return types?.[memoryIndex] || `Unknown Memory Type ${memoryIndex}`;
}

/**
 * Formats a resource ID as a hex string
 */
export function formatResourceId(resourceId: bigint): string {
  return `0x${resourceId.toString(16).toUpperCase().padStart(16, '0')}`;
}

/**
 * Calculates bundle statistics
 */
export type BundleStats = {
  totalResources: number;
  compressedResources: number;
  totalSize: number;
  compressedSize: number;
  compressionRatio: number;
  resourceTypes: Record<number, number>;
}

export function calculateBundleStats(bundle: ParsedBundle, buffer: ArrayBuffer): BundleStats {
  const stats: BundleStats = {
    totalResources: bundle.resources.length,
    compressedResources: 0,
    totalSize: buffer.byteLength,
    compressedSize: 0,
    compressionRatio: 1,
    resourceTypes: {}
  };

  for (const resource of bundle.resources) {
    // Count resource types
    stats.resourceTypes[resource.resourceTypeId] = (stats.resourceTypes[resource.resourceTypeId] || 0) + 1;

    // Check if compressed
    const data = extractResourceData(buffer, bundle, resource);
    if (isCompressed(data)) {
      stats.compressedResources++;
      stats.compressedSize += data.length;
    }
  }

  stats.compressionRatio = stats.compressedSize / stats.totalSize;
  return stats;
} 