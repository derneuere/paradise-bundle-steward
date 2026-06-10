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

// ----------------------------------------------------------------------------
// Native zlib fast-path (Node only).
//
// pako is a pure-JS port of zlib; profiling parseBundle on a 14.6 MB Burnout
// bundle showed ~70 % of CPU in pako's `inflate_fast`. Node's built-in
// `node:zlib.inflateSync` is the same algorithm in C++ and is materially
// faster — typically 2–3× on multi-MB inputs. We resolve it lazily so the
// browser bundle (Vite/Rollup) never tries to statically resolve `node:zlib`,
// and fall back to pako on any failure (browser, web worker, deno, etc.).
//
// Behaviour is identical: zlib + pako both implement RFC 1950, return the
// decompressed bytes, and throw on malformed input. The fallback path
// guarantees `decompressData` keeps working everywhere even if the lazy
// resolve fails.
let _nativeInflate: ((data: Uint8Array) => Uint8Array) | null = null;
let _nativeInflateChecked = false;
function getNativeInflate(): ((data: Uint8Array) => Uint8Array) | null {
  if (_nativeInflateChecked) return _nativeInflate;
  _nativeInflateChecked = true;
  try {
    // Node sets process.versions.node; browsers don't. We MUST avoid a static
    // import or require of "node:zlib" so Vite/Rollup don't try to resolve it
    // when bundling for the browser.
    const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
    if (!proc?.versions?.node) return null;
    // Two paths to grab a CJS require synchronously:
    //   1. Bun / CJS contexts expose a global `require` directly.
    //   2. Pure-ESM Node only gives you `module.createRequire(import.meta.url)`,
    //      which itself we have to load via... a require. Resolve it through
    //      eval(import.meta.url) → createRequire chain so static analysers
    //      can't see the `node:` specifier at parse time.
    let req:
      | ((m: string) => unknown)
      | null = (0, eval)('typeof require === "function" ? require : null') as
      | ((m: string) => unknown)
      | null;
    if (!req) {
      // Pure-ESM Node path. import.meta.url is set; createRequire is on the
      // built-in "module" we fetch via createRequire-of-self. To bootstrap,
      // we can use node:module via process.getBuiltinModule (Node 22+) or
      // fall back to a dynamic eval-import — but the dynamic-import path is
      // async, so prefer getBuiltinModule when available.
      type GBM = (n: string) => { createRequire?: (u: string) => (s: string) => unknown };
      const getBuiltinModule = (proc as unknown as { getBuiltinModule?: GBM }).getBuiltinModule;
      if (typeof getBuiltinModule === 'function') {
        const mod = getBuiltinModule('node:module');
        const url = (typeof import.meta !== 'undefined' ? import.meta.url : undefined) as
          | string
          | undefined;
        if (url && typeof mod?.createRequire === 'function') {
          req = mod.createRequire(url);
        }
      }
    }
    if (!req) return null;
    const zlib = req('node:zlib') as { inflateSync: (b: Uint8Array) => Uint8Array };
    if (typeof zlib?.inflateSync !== 'function') return null;
    _nativeInflate = (data: Uint8Array) => zlib.inflateSync(data);
  } catch {
    _nativeInflate = null;
  }
  return _nativeInflate;
}


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
  return extractResourceDataWithBlock(buffer, bundle, resource).data;
}

/**
 * Same as {@link extractResourceData} but also reports WHICH memory block the
 * bytes came from, so callers can run the per-block compression check
 * ({@link isResourceBlockCompressed}) against the matching entry fields.
 * blockIndex is -1 when no block had usable data.
 */
export function extractResourceDataWithBlock(
  buffer: ArrayBuffer,
  bundle: ParsedBundle,
  resource: ResourceEntry,
): { data: Uint8Array; blockIndex: number } {
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
    if (size <= 0) continue;
    const base = bundle.header.resourceDataOffsets[i] >>> 0;
    const rel = resource.diskOffsets[i] >>> 0;
    const start = (base + rel) >>> 0;
    if (start + size <= buffer.byteLength) {
      return { data: new Uint8Array(buffer, start, size), blockIndex: i };
    }
  }
  return { data: new Uint8Array(), blockIndex: -1 };
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
    let bytes: Uint8Array = new Uint8Array(buffer, start, size);
    if (isResourceBlockCompressed(resource, i, bytes)) bytes = decompressData(bytes) as Uint8Array;
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
 * Detects if data LOOKS like a zlib stream (magic-byte sniff).
 *
 * Sniffing alone is not authoritative: raw resource payloads can start with a
 * valid zlib magic by coincidence (0x78 0x01 is also the little-endian u32
 * 0x178 — a perfectly plausible struct offset; retail TRK_UNIT192 has exactly
 * such a PropGraphicsList). Whenever the ResourceEntry is available, use
 * {@link isResourceBlockCompressed} instead, which consults the envelope's
 * disk-vs-uncompressed size pair before trusting the sniff.
 */
export function isCompressed(data: Uint8Array): boolean {
  // zlib magic: CMF 0x78 followed by a standard-level FLG byte.
  if (data.length < 2 || data[0] !== 0x78) return false;
  return data[1] === 0x01 || data[1] === 0x9C || data[1] === 0xDA || data[1] === 0x5E;
}

/**
 * Authoritative per-block compression check for a resource's memory block.
 *
 * BND2 entries carry both the on-disk and the in-memory (uncompressed) size
 * per block. Equal sizes mean the block is stored raw — the bytes must NOT be
 * inflated even if they happen to start with a zlib magic. Different sizes
 * mean a compressed block, with the sniff kept as a sanity guard.
 */
export function isResourceBlockCompressed(
  resource: ResourceEntry,
  blockIndex: number,
  bytes: Uint8Array,
): boolean {
  const diskSize = extractResourceSize(resource.sizeAndAlignmentOnDisk[blockIndex]);
  const uncompressedSize = extractResourceSize(resource.uncompressedSizeAndAlignment[blockIndex]);
  if (diskSize === uncompressedSize) return false;
  return isCompressed(bytes);
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
    const native = getNativeInflate();
    const decompressed = (native
      ? native(compressedData)
      : pako.inflate(compressedData)) as Uint8Array<ArrayBuffer>;
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
  const { data: rawData, blockIndex } = extractResourceDataWithBlock(context.buffer, context.bundle, context.resource);
  const compressed = blockIndex >= 0 && isResourceBlockCompressed(context.resource, blockIndex, rawData);
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
    const { data, blockIndex } = extractResourceDataWithBlock(buffer, bundle, resource);
    if (blockIndex >= 0 && isResourceBlockCompressed(resource, blockIndex, data)) {
      stats.compressedResources++;
      stats.compressedSize += data.length;
    }
  }

  stats.compressionRatio = stats.compressedSize / stats.totalSize;
  return stats;
} 