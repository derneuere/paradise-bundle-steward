// Bundle parsing functions for Burnout Paradise Bundle 2 format

import { BufferReader } from 'typed-binary';
import {
  parseResourceEntries,
  parseImportEntries,
  getResourceImportSlice,
  type ImportEntry as BundleImportEntry,
  type ResourceEntry as BundleResourceEntry,
} from './bundleEntry';
export { getImportsByPtrOffset, getImportIds } from './bundleEntry';
import { parseHeader, detectBundleLittleEndian } from './bundleHeader';
import {
  isBundle1Magic,
  parseBundle1,
  writeBundle1Fresh,
  bnd1ToBnd2Shape,
  bnd2ToBnd1Shape,
  convertBnd1Platform,
  reencodeResourceChunksForTarget,
  type UnknownResourcePolicy,
} from './bundle1';
import { parseDebugDataFromBuffer } from './debugData';
import {
  ParsedBundle,
  ParseOptions,
  WriteOptions,
  ProgressCallback,
  BUNDLE_FLAGS,
  PLATFORMS,
  RESOURCE_TYPE_IDS
} from '../types';
import { BundleError } from '../errors';
import {
  validateResourceEntry,
  calculateBundleStats,
  decompressData
} from '../resourceManager';
import { parseVehicleList, type ParsedVehicleList } from '../vehicleList';
import { parsePlayerCarColours, type PlayerCarColours } from '../playerCarColors';
import { RESOURCE_TYPES } from '../../resourceTypes';
import { parseIceTakeDictionary, type ParsedIceTakeDictionary } from '../iceTakeDictionary';
import { type ParsedTriggerData, parseTriggerData } from '../triggerData';
import { extractResourceSize, extractAlignment, packSizeAndAlignment, isCompressed, compressData } from '../resourceManager';
import { parseChallengeList, type ParsedChallengeList } from '../challengeList';
import { parseStreetData, type ParsedStreetData } from '../streetData';
import { registry, getHandlerByTypeId, resourceCtxFromBundle } from '../registry';
import { parseBundleResourcesViaRegistry } from '../registry/bundleOps';
import { u64ToBigInt } from '../u64';

// ============================================================================
// Main Bundle Writer
// ============================================================================


// ==========================================================================
// Fresh Bundle Writer (repack layout)
// ==========================================================================

/**
 * Writes a new bundle buffer from scratch, repacking resources sequentially.
 * This does NOT preserve the original layout or reserved sizes. Offsets and
 * sizes are recalculated and all resource/import data are relocated.
 */
export function writeBundleFresh(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  options: WriteOptions = {},
  progressCallback?: ProgressCallback
): ArrayBuffer {
  // Bundle V1 dispatch — when `bundle1Extras` is present the source was
  // a 'bndl' prototype container; route to the BND1 writer and stop.
  if (bundle.bundle1Extras) {
    reportProgress(progressCallback, 'write', 0, 'Starting BND1 bundle write');
    const overridesRaw = (options.overrides as Record<string, unknown> | undefined) ?? undefined;
    const overrides: Record<number, Uint8Array | unknown> = {};
    let overridesByResourceId: Record<string, Uint8Array | unknown> | undefined;
    if (overridesRaw) {
      const r = overridesRaw['resources'];
      if (r && typeof r === 'object') Object.assign(overrides, r as Record<number, unknown>);
      const byId = overridesRaw['byResourceId'];
      if (byId && typeof byId === 'object') overridesByResourceId = byId as Record<string, Uint8Array | unknown>;
    }
    const out = writeBundle1Fresh(bundle, originalBuffer, { overrides, overridesByResourceId });
    reportProgress(progressCallback, 'write', 1.0, 'BND1 bundle write complete');
    return out;
  }

  reportProgress(progressCallback, 'write', 0, 'Starting fresh bundle write');

  // `options.platform` overrides the source bundle's platform — used by the
  // cross-platform export path so the wrapper *and* every per-resource writer
  // emit bytes in the target's endianness instead of the source's.
  const targetPlatform = options.platform ?? bundle.header.platform;
  const isLittleEndian = targetPlatform !== PLATFORMS.PS3;
  const ctx = resourceCtxFromBundle(bundle, targetPlatform);
  // Source ctx — used to parse the original bytes when the target differs.
  // Without this, the cross-platform path would only flip the wrapper's
  // endianness while leaving each resource's payload encoded in the source's
  // byte order, producing a broken output that fails to load on the target.
  const sourceCtx = resourceCtxFromBundle(bundle);
  const isCrossPlatformExport = targetPlatform !== bundle.header.platform;

  // Normalize overrides into two maps:
  //   1. `overrideMap` — keyed by resource type id. Applies the same override
  //      to EVERY resource of that type; fine for bundles that only ever hold
  //      one resource per type (the common case).
  //   2. `overrideByResourceId` — keyed by the formatted resource id hex
  //      string (`formatResourceId(u64ToBigInt(resource.resourceId))`).
  //      Needed for bundles like WORLDCOL.BIN that contain hundreds of
  //      resources of the same type — a single typeId-keyed override can't
  //      express "change only resource #3 and #271". byResourceId takes
  //      priority when both are present.
  //
  // Values are either raw encoded bytes or a model object that gets piped
  // through the matching ResourceHandler's writeRaw(). Legacy field-name
  // overrides (vehicleList, triggerData, challengeList, streetData) are
  // mapped to their typeId.
  const overrideMap: Record<number, Uint8Array | unknown> = {};
  const overrideByResourceId: Record<string, Uint8Array | unknown> = {};
  const legacyKey: Record<string, number> = {
    vehicleList: RESOURCE_TYPE_IDS.VEHICLE_LIST,
    triggerData: RESOURCE_TYPE_IDS.TRIGGER_DATA,
    challengeList: RESOURCE_TYPE_IDS.CHALLENGE_LIST,
    streetData: RESOURCE_TYPE_IDS.STREET_DATA,
  };
  const rawOverrides = options.overrides as Record<string, unknown> | undefined;
  if (rawOverrides) {
    for (const [k, v] of Object.entries(rawOverrides)) {
      if (k === 'resources' && v && typeof v === 'object') {
        Object.assign(overrideMap, v as Record<number, unknown>);
      } else if (k === 'byResourceId' && v && typeof v === 'object') {
        Object.assign(overrideByResourceId, v as Record<string, unknown>);
      } else if (k in legacyKey && v !== undefined) {
        overrideMap[legacyKey[k]] = v;
      }
    }
  }
  const hasByResourceIdOverrides = Object.keys(overrideByResourceId).length > 0;

  /**
   * Apply a single override to its resource bytes. Called per primary block
   * when an override is present. Returns the uncompressed bytes the new
   * resource should contain; compression is handled by the caller.
   */
  const applyOverride = (typeId: number, value: unknown, fallback: Uint8Array): Uint8Array => {
    if (value instanceof Uint8Array) return value;
    const handler = getHandlerByTypeId(typeId);
    if (handler && handler.caps.write && handler.writeRaw) {
      return handler.writeRaw(value as never, ctx);
    }
    // No writable handler for this type → fall back to original bytes.
    return fallback;
  };
  void registry; // keep import live for handler auto-registration side effects

  type Segment = {
    resourceIndex: number;
    blockIndex: number; // 0..2
    alignment: number;
    uncompAlignment: number; // alignment from uncompressedSizeAndAlignment (may differ from disk alignment)
    bytes: Uint8Array; // compressed or raw, exactly what will be written
    uncompSize?: number; // uncompressed size when we know it (for overrides)
  };

  const segmentsByBlock: Segment[][] = [[], [], []];

  // Prepare resource data segments (apply overrides and preserve compression state)
  for (let ri = 0; ri < bundle.resources.length; ri++) {
    const resource = bundle.resources[ri];

    // Determine the primary block (first with non-zero size)
    let primaryBlock = -1;
    for (let bi = 0; bi < 3; bi++) {
      if (extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]) > 0) { primaryBlock = bi; break; }
    }

    for (let bi = 0; bi < 3; bi++) {
      const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[bi]);
      if (size <= 0) continue;

      const base = bundle.header.resourceDataOffsets[bi] >>> 0;
      const rel = resource.diskOffsets[bi] >>> 0;
      const start = (base + rel) >>> 0;
      const rawOriginal = new Uint8Array(originalBuffer, start, size);
      const wasCompressed = isCompressed(rawOriginal);
      const align = extractAlignment(resource.sizeAndAlignmentOnDisk[bi]);
      const uncompAlign = extractAlignment(resource.uncompressedSizeAndAlignment[bi]);

      let finalBytes: Uint8Array;
      let uncompressedSize: number | undefined;

      // Apply override only to primary block for the resource (matches in-place writer behavior).
      // Look up byResourceId first so per-resource overrides take priority over
      // broad typeId overrides — a bundle with 428 PolygonSoupList resources
      // where the user edited 3 of them needs resource-specific routing.
      let overrideValue: unknown | undefined;
      if (bi === primaryBlock) {
        if (hasByResourceIdOverrides) {
          const idHex = `0x${u64ToBigInt(resource.resourceId).toString(16).toUpperCase().padStart(16, '0')}`;
          if (Object.prototype.hasOwnProperty.call(overrideByResourceId, idHex)) {
            overrideValue = overrideByResourceId[idHex];
          }
        }
        if (overrideValue === undefined && Object.prototype.hasOwnProperty.call(overrideMap, resource.resourceTypeId)) {
          overrideValue = overrideMap[resource.resourceTypeId];
        }
      }

      if (overrideValue !== undefined) {
        const newUncompressed = applyOverride(
          resource.resourceTypeId,
          overrideValue,
          wasCompressed ? rawOriginal : rawOriginal.slice(),
        );
        finalBytes = wasCompressed ? compressData(newUncompressed) : newUncompressed;
        uncompressedSize = newUncompressed.length;
      } else if (isCrossPlatformExport && bi === primaryBlock) {
        // Cross-platform re-encode: the user is converting the bundle to a
        // different platform's binary layout. Parse the original bytes in the
        // source endianness, then re-emit through the same handler in the
        // target endianness. Only the primary block goes through this path —
        // secondary blocks (graphics-memory pools etc.) are platform-specific
        // raw payloads our parsers don't model. Resources whose handler can't
        // write the target platform should already be filtered out by
        // getExportablePlatforms; if one slips through, fall back to the
        // pass-through bytes (the export will be broken, but the failure is
        // visible to the user instead of silently corrupting).
        const handler = getHandlerByTypeId(resource.resourceTypeId);
        const targetIsSupported = handler?.caps.writePlatforms?.includes(targetPlatform as never) ?? false;
        if (handler && handler.caps.write && handler.writeRaw && targetIsSupported) {
          const decoded = wasCompressed ? decompressData(rawOriginal) : rawOriginal;
          const model = handler.parseRaw(decoded, sourceCtx);
          const newUncompressed = handler.writeRaw(model as never, ctx);
          finalBytes = wasCompressed ? compressData(newUncompressed) : newUncompressed;
          uncompressedSize = newUncompressed.length;
        } else {
          finalBytes = rawOriginal;
        }
      } else {
        // No override for this block: keep original bytes exactly
        finalBytes = rawOriginal;
      }

      segmentsByBlock[bi].push({ resourceIndex: ri, blockIndex: bi, alignment: align, uncompAlignment: uncompAlign, bytes: finalBytes, uncompSize: uncompressedSize });
    }
  }

  reportProgress(progressCallback, 'write', 0.2, 'Prepared resource segments');

  // Layout calculation
  const HEADER_SIZE = 40; // as per BundleHeader schema
  const ENTRY_SIZE = 64;  // ResourceEntry write size

  const resourceCount = bundle.resources.length;
  const headerOffset = 0;
  const tableOffset = ((HEADER_SIZE + 15) >>> 4) << 4; // align 16
  let cursor = tableOffset + resourceCount * ENTRY_SIZE;
  cursor = ((cursor + 15) >>> 4) << 4; // align 16 before first data block

  const resourceDataOffsets: [number, number, number] = [0, 0, 0];
  const newDiskOffsets: number[][] = bundle.resources.map(() => [0, 0, 0]);
  const newSizeAndAlignOnDisk: number[][] = bundle.resources.map((r) => r.sizeAndAlignmentOnDisk.slice(0, 3) as [number, number, number]);
  const newUncompSizeAndAlign: number[][] = bundle.resources.map((r) => r.uncompressedSizeAndAlignment.slice(0, 3) as [number, number, number]);

  // We will assemble writes after we know total size
  type WritePlan = { offset: number; bytes: Uint8Array };
  const writePlans: WritePlan[] = [];

  // Pack each block sequentially
  for (let bi = 0; bi < 3; bi++) {
    const blockSegments = segmentsByBlock[bi];
    if (blockSegments.length === 0) {
      // Empty pools point to the current cursor (end of previous pool's data),
      // matching retail bundles where dataOffset[1]==dataOffset[2]==end-of-pool-0.
      // The game may use adjacent offsets to compute pool extents.
      resourceDataOffsets[bi] = cursor >>> 0;
      continue;
    }

    // Set base for this memory block
    resourceDataOffsets[bi] = cursor >>> 0;

    for (const seg of blockSegments) {
      // Align cursor for this segment
      const mask = seg.alignment - 1;
      cursor = (cursor + mask) & ~mask;

      const absolute = cursor >>> 0;
      const relative = (absolute - resourceDataOffsets[bi]) >>> 0;

      newDiskOffsets[seg.resourceIndex][bi] = relative;
      newSizeAndAlignOnDisk[seg.resourceIndex][bi] = packSizeAndAlignment(seg.bytes.length >>> 0, seg.alignment);
      if (seg.uncompSize != null) {
        // Use the original uncompressed alignment (e.g. 16 for AI Sections),
        // not the on-disk alignment (which is 1 for compressed data).
        newUncompSizeAndAlign[seg.resourceIndex][bi] = packSizeAndAlignment(seg.uncompSize >>> 0, seg.uncompAlignment);
      }

      writePlans.push({ offset: absolute, bytes: seg.bytes });
      cursor += seg.bytes.length;
    }

    // Align to 0x80 between memory pools (matches Bundle-Manager / YAP behaviour).
    // Pool boundaries are always 0x80-aligned in retail bundles.
    cursor = ((cursor + 0x7F) >>> 7) << 7;
  }

  reportProgress(progressCallback, 'write', 0.5, 'Packed resource data');

  // Pack import tables (copy as-is)
  const newImportOffsets: number[] = bundle.resources.map(() => 0);
  const importWritePlans: WritePlan[] = [];

  // Align before import region
  cursor = ((cursor + 15) >>> 4) << 4;
  for (let ri = 0; ri < bundle.resources.length; ri++) {
    const resource = bundle.resources[ri];
    if (resource.importCount > 0) {
      const bytesLen = resource.importCount * 16; // ImportEntrySchema size
      const src = new Uint8Array(originalBuffer, resource.importOffset >>> 0, bytesLen);
      // align 16 for each table
      cursor = ((cursor + 15) >>> 4) << 4;
      newImportOffsets[ri] = cursor >>> 0;
      importWritePlans.push({ offset: cursor >>> 0, bytes: src });
      cursor += bytesLen;
    }
  }

  reportProgress(progressCallback, 'write', 0.65, 'Copied import tables');

  // Optional debug data
  let debugDataOffset = 0;
  if (options.includeDebugData !== false && typeof bundle.debugData === 'string' && bundle.debugData.length > 0) {
    const enc = new TextEncoder();
    const bytes = enc.encode(bundle.debugData);
    // Align to 4 for text
    cursor = (cursor + 3) & ~3;
    debugDataOffset = cursor >>> 0;
    // Include NUL terminator
    writePlans.push({ offset: debugDataOffset, bytes });
    // NUL will be written manually later
    cursor += bytes.length + 1;
  }

  // Allocate final buffer
  const totalSize = cursor >>> 0;
  const outBytes = new Uint8Array(totalSize);
  const dv = new DataView(outBytes.buffer);

  // Write header
  const writeU32 = (off: number, val: number) => dv.setUint32(off, val >>> 0, isLittleEndian);
  outBytes.set(new TextEncoder().encode('bnd2'), headerOffset);
  writeU32(headerOffset + 4, 2); // version
  writeU32(headerOffset + 8, targetPlatform);
  writeU32(headerOffset + 12, debugDataOffset);
  writeU32(headerOffset + 16, resourceCount);
  writeU32(headerOffset + 20, tableOffset);
  writeU32(headerOffset + 24, resourceDataOffsets[0] || 0);
  writeU32(headerOffset + 28, resourceDataOffsets[1] || 0);
  writeU32(headerOffset + 32, resourceDataOffsets[2] || 0);
  // flags: preserve HAS_DEBUG_DATA if applicable, clear otherwise; keep other flags
  let flags = bundle.header.flags >>> 0;
  if (debugDataOffset > 0) {
    flags |= BUNDLE_FLAGS.HAS_DEBUG_DATA;
  } else {
    flags &= ~BUNDLE_FLAGS.HAS_DEBUG_DATA;
  }
  writeU32(headerOffset + 36, flags);

  // Write resource entry table with updated offsets/sizes/imports
  const writeU16 = (off: number, val: number) => dv.setUint16(off, val & 0xFFFF, isLittleEndian);
  const writeU8  = (off: number, val: number) => dv.setUint8(off, val & 0xFF);
  for (let i = 0; i < resourceCount; i++) {
    const re = bundle.resources[i];
    const off = tableOffset + i * ENTRY_SIZE;

    // resourceId (u64 -> two u32: low, high)
    writeU32(off + 0, re.resourceId.low);
    writeU32(off + 4, re.resourceId.high);
    // importHash (u64)
    writeU32(off + 8, re.importHash.low);
    writeU32(off + 12, re.importHash.high);

    // uncompressedSizeAndAlignment [3]
    writeU32(off + 16, newUncompSizeAndAlign[i][0]);
    writeU32(off + 20, newUncompSizeAndAlign[i][1]);
    writeU32(off + 24, newUncompSizeAndAlign[i][2]);

    // sizeAndAlignmentOnDisk [3]
    writeU32(off + 28, newSizeAndAlignOnDisk[i][0]);
    writeU32(off + 32, newSizeAndAlignOnDisk[i][1]);
    writeU32(off + 36, newSizeAndAlignOnDisk[i][2]);

    // diskOffsets [3]
    writeU32(off + 40, newDiskOffsets[i][0]);
    writeU32(off + 44, newDiskOffsets[i][1]);
    writeU32(off + 48, newDiskOffsets[i][2]);

    // importOffset
    writeU32(off + 52, newImportOffsets[i] || 0);

    // resourceTypeId
    writeU32(off + 56, re.resourceTypeId);

    // importCount (u16)
    writeU16(off + 60, re.importCount);
    // flags (u8)
    writeU8(off + 62, re.flags);
    // streamIndex (u8)
    writeU8(off + 63, re.streamIndex);
  }

  reportProgress(progressCallback, 'write', 0.85, 'Wrote header and resource table');

  // Write resource bytes
  for (const plan of writePlans) {
    outBytes.set(plan.bytes, plan.offset);
  }
  // NUL terminate debug data if present
  if (debugDataOffset > 0) {
    outBytes[debugDataOffset + (new TextEncoder().encode(bundle.debugData as string)).length] = 0;
  }
  // Write import tables
  for (const plan of importWritePlans) {
    outBytes.set(plan.bytes, plan.offset);
  }

  reportProgress(progressCallback, 'write', 1.0, 'Fresh bundle write complete');
  return outBytes.buffer;
}

// ============================================================================
// Main Bundle Parser
// ============================================================================


/**
 * Parses a Burnout Paradise Bundle 2 format file
 */
export function parseBundle(
  buffer: ArrayBuffer,
  options: ParseOptions = {},
  progressCallback?: ProgressCallback
): ParsedBundle {
  // Magic-based dispatch: BND1 ('bndl') prototype builds vs BND2 ('bnd2')
  // retail. The two formats wrap the same resource payloads (just BE vs LE
  // and a different container). BND1 path produces a ParsedBundle with
  // `bundle1Extras` populated; BND2 leaves it undefined.
  if (isBundle1Magic(buffer)) {
    reportProgress(progressCallback, 'parse', 0, 'Starting BND1 bundle parsing');
    const bundle = parseBundle1(buffer, { strict: options.strict });
    reportProgress(progressCallback, 'parse', 1.0, 'BND1 bundle parsing complete');
    return bundle;
  }

  try {
    reportProgress(progressCallback, 'parse', 0, 'Starting bundle parsing');

    // Auto-detect endianness when the caller didn't pin it. PS3/X360 bundles
    // are big-endian; PC/Remastered are little-endian. Detection peeks the
    // version field, which is invariant across all known bundles.
    const littleEndian = options.littleEndian !== undefined
      ? options.littleEndian
      : detectBundleLittleEndian(buffer);

    const reader = new BufferReader(buffer, {
      endianness: littleEndian ? 'little' : 'big'
    });

    reportProgress(progressCallback, 'parse', 0.1, 'Parsing bundle header');

    // Parse header
    const header = parseHeader(reader, buffer, { ...options, littleEndian });

    reportProgress(progressCallback, 'parse', 0.3, 'Parsing resource entries');

    // Parse resource entries
    const resources = parseResourceEntries(reader, header, buffer.byteLength, options);

    // Validate resource entries
    if (options.strict !== false) {
      for (let i = 0; i < resources.length; i++) {
        const errors = validateResourceEntry(resources[i], buffer.byteLength);
        if (errors.length > 0) {
          console.warn(`Resource entry ${i} validation warnings:`, errors.map(e => e.message));
        }
      }
    }

    reportProgress(progressCallback, 'parse', 0.6, 'Parsing import entries');

    // Parse imports. Reads each resource's inline import table from its
    // decompressed header block — see parseImportEntries() for details and
    // history of the prior file-absolute bug.
    const imports = parseImportEntries(buffer, resources, header);

    reportProgress(progressCallback, 'parse', 0.8, 'Parsing debug data');

    // Parse debug data
    const debugData = parseDebugDataFromBuffer(buffer, header);

    reportProgress(progressCallback, 'parse', 1.0, 'Bundle parsing complete');

    const bundle: ParsedBundle = {
      header,
      resources,
      imports,
      debugData
    };

    // Log bundle statistics
    const stats = calculateBundleStats(bundle, buffer);
    console.debug('Bundle statistics:', stats);

    return bundle;

  } catch (error) {
    if (error instanceof BundleError) {
      throw error;
    }
    throw new BundleError(
      `Failed to parse bundle: ${error instanceof Error ? error.message : String(error)}`,
      'PARSE_ERROR',
      { error, bufferSize: buffer.byteLength }
    );
  }
}

// ============================================================================
// Cross-container conversion
// ============================================================================

export type ConvertTarget = {
  /** Output bundle container. */
  container: 'bnd1' | 'bnd2';
  /** Output platform. PC=1 (LE), X360=2 (BE), PS3=3 (BE). */
  platform: 1 | 2 | 3;
  /**
   * Policy for handler-less resources when endianness flips.
   * Defaults to 'fail' (the safe choice). Pass 'passthrough' if you know
   * an unhandled type's payload is byte-oriented and won't suffer from
   * skipping the byte-swap (e.g. the type-0x0003 auxiliary in BND1 PVS).
   */
  unknownResourcePolicy?: UnknownResourcePolicy;
};

/**
 * Convert a bundle between containers and/or platforms. Handles all four
 * cardinal directions:
 *   - BND1 → BND1 (different platform): chunk-array reshape
 *   - BND1 → BND2: strip bundle1Extras, repack as Bundle 2
 *   - BND2 → BND1: synthesize bundle1Extras, repack as Bundle 1
 *   - BND2 → BND2 (different platform): existing cross-platform export path
 *
 * Endianness flips are handled per-resource by calling the registered
 * handler's parseRaw/writeRaw with the appropriate ctx. Resources whose
 * type has no writable handler can only round-trip when endianness stays
 * the same — otherwise the function throws a BundleError so the caller
 * sees the failure instead of getting silently corrupt output.
 */
export function convertBundle(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  target: ConvertTarget,
): ArrayBuffer {
  const sourceIsBnd1 = !!bundle.bundle1Extras;

  // 1) Re-encode every resource's primary chunk for the target endianness
  //    (no-op when source/target endianness match — bytes pass through).
  const overridesByResourceId = reencodeResourceChunksForTarget(
    bundle,
    originalBuffer,
    target.platform,
    target.unknownResourcePolicy ?? 'fail',
  );

  // 2) Build a target-shape ParsedBundle so writeBundleFresh dispatches to
  //    the right writer (BND1 vs BND2 driven by `bundle1Extras` presence).
  let shaped: ParsedBundle;
  if (target.container === 'bnd2') {
    shaped = sourceIsBnd1
      ? bnd1ToBnd2Shape(bundle, target.platform)
      : { ...bundle, header: { ...bundle.header, platform: target.platform } };
  } else {
    shaped = sourceIsBnd1
      ? convertBnd1Platform(bundle, target.platform)
      : bnd2ToBnd1Shape(bundle, originalBuffer, target.platform);
  }

  // 3) Write. Pass overrides via byResourceId so each resource gets its own
  //    re-encoded bytes (typeId-keyed overrides would collide on bundles
  //    with multiple resources of the same type).
  return writeBundleFresh(shaped, originalBuffer, {
    platform: target.platform,
    overrides: { byResourceId: overridesByResourceId },
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getPlatformName(platform: number): string {
  const platforms = {
    1: 'PC',
    2: 'Xbox 360',
    3: 'PlayStation 3'
  } as const;

  return platforms[platform as keyof typeof platforms] || `Unknown (${platform})`;
}

export function getFlagNames(flags: number): string[] {
  const flagNames: string[] = [];

  if (flags & BUNDLE_FLAGS.COMPRESSED) flagNames.push('Compressed');
  if (flags & BUNDLE_FLAGS.MAIN_MEM_OPTIMISED) flagNames.push('Main Memory Optimized');
  if (flags & BUNDLE_FLAGS.GRAPHICS_MEM_OPTIMISED) flagNames.push('Graphics Memory Optimized');
  if (flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) flagNames.push('Has Debug Data');

  return flagNames.length > 0 ? flagNames : ['None'];
}

export function formatResourceId(resourceId: bigint): string {
  return `0x${resourceId.toString(16).toUpperCase().padStart(16, '0')}`;
}

function reportProgress(
  callback: ProgressCallback | undefined,
  type: string,
  progress: number,
  message?: string
) {
  callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}

// ============================================================================
// Resource-Specific Parsing
// ============================================================================

/**
 * Result of parsing all known resource types from a bundle
 */
export type ParsedResources = {
  vehicleList?: ParsedVehicleList;
  playerCarColours?: PlayerCarColours;
  iceTakeDictionary?: ParsedIceTakeDictionary;
  triggerData?: ParsedTriggerData;
  challengeList?: ParsedChallengeList;
  streetData?: ParsedStreetData;
};

/**
 * Parses all known resource types from a bundle and returns the legacy
 * ParsedResources shape. Internally delegates to the registry-driven
 * parseBundleResourcesViaRegistry — this function exists only as a thin
 * compatibility shim for callers that still expect the named fields. Step 6
 * of the CLI refactor migrates BundleContext to the generic map form and
 * removes this shim.
 */
export function parseBundleResources(
  buffer: ArrayBuffer,
  bundle: ParsedBundle
): ParsedResources {
  const map = parseBundleResourcesViaRegistry(buffer, bundle);
  const out: ParsedResources = {};
  const vehicleList = map.get('vehicleList') as ParsedVehicleList | undefined;
  if (vehicleList) out.vehicleList = vehicleList;
  const playerCarColours = map.get('playerCarColours') as PlayerCarColours | undefined;
  if (playerCarColours) out.playerCarColours = playerCarColours;
  const iceTakeDictionary = map.get('iceTakeDictionary') as ParsedIceTakeDictionary | undefined;
  if (iceTakeDictionary) out.iceTakeDictionary = iceTakeDictionary;
  const triggerData = map.get('triggerData') as ParsedTriggerData | undefined;
  if (triggerData) out.triggerData = triggerData;
  const challengeList = map.get('challengeList') as ParsedChallengeList | undefined;
  if (challengeList) out.challengeList = challengeList;
  const streetData = map.get('streetData') as ParsedStreetData | undefined;
  if (streetData) out.streetData = streetData;
  return out;
}

// ============================================================================
// Import helpers are re-exported from bundleEntry.ts at the top of this file:
// getImportsByPtrOffset, getImportIds
