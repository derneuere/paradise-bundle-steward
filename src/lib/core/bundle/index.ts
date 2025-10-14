// Bundle parsing functions for Burnout Paradise Bundle 2 format

import { BufferReader } from 'typed-binary';
import {
  parseResourceEntries,
  parseImportEntries
} from './bundleEntry';
import { parseHeader } from './bundleHeader';
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
  calculateBundleStats
} from '../resourceManager';
import { parseVehicleList, type ParsedVehicleList } from '../vehicleList';
import { writeVehicleListData } from '../vehicleList';
import { parsePlayerCarColours, type PlayerCarColours } from '../playerCarColors';
import { RESOURCE_TYPES } from '../../resourceTypes';
import { parseIceTakeDictionary, type ParsedIceTakeDictionary } from '../iceTakeDictionary';
import { type ParsedTriggerData, parseTriggerData, writeTriggerDataData } from '../triggerData';
import { extractResourceSize, extractAlignment, packSizeAndAlignment, isCompressed, compressData } from '../resourceManager';
import { getSetting } from '../../settings';
import { parseChallengeList, ParsedChallengeList, writeChallengeListData } from '../challengeList';

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
  reportProgress(progressCallback, 'write', 0, 'Starting fresh bundle write');

  const isLittleEndian = bundle.header.platform !== PLATFORMS.PS3;

  // Normalize overrides into a single map keyed by resource type id
  type Encoder = (value: unknown) => Uint8Array;
  const little = isLittleEndian;
  const encoders: Record<number, Encoder> = {
    [RESOURCE_TYPE_IDS.VEHICLE_LIST]: (value: unknown) => {
      const v = value as { vehicles: ParsedVehicleList['vehicles']; header?: ParsedVehicleList['header'] };
      return writeVehicleListData({
        vehicles: v.vehicles,
        header: v.header ?? {
          numVehicles: v.vehicles.length,
          startOffset: 16,
          unknown1: 0,
          unknown2: 0
        }
      }, little);
    },
    [RESOURCE_TYPE_IDS.TRIGGER_DATA]: (value: unknown) => {
      const autoAssign = getSetting('autoAssignRegionIndexes');
      return writeTriggerDataData(value as ParsedTriggerData, little, autoAssign);
    },
    [RESOURCE_TYPE_IDS.CHALLENGE_LIST]: (value: unknown) => {
      return writeChallengeListData(value as ParsedChallengeList, little);
    }
  };

  const overrideMap: Record<number, Uint8Array | unknown> = { };
  if (options.overrides?.vehicleList) {
    overrideMap[RESOURCE_TYPE_IDS.VEHICLE_LIST] = options.overrides.vehicleList;
  }
  if (options.overrides?.triggerData) {
    overrideMap[RESOURCE_TYPE_IDS.TRIGGER_DATA] = options.overrides.triggerData;
  }
  if (options.overrides?.challengeList) {
    overrideMap[RESOURCE_TYPE_IDS.CHALLENGE_LIST] = options.overrides.challengeList;
  }
  if (options.overrides?.resources) {
    Object.assign(overrideMap, options.overrides.resources);
  }

  type Segment = {
    resourceIndex: number;
    blockIndex: number; // 0..2
    alignment: number;
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

      let finalBytes: Uint8Array;
      let uncompressedSize: number | undefined;

      // Apply override only to primary block for the resource (matches in-place writer behavior)
      if (bi === primaryBlock && Object.prototype.hasOwnProperty.call(overrideMap, resource.resourceTypeId)) {
        const overrideValue = overrideMap[resource.resourceTypeId];
        let newUncompressed: Uint8Array;
        if (overrideValue instanceof Uint8Array) {
          newUncompressed = overrideValue;
        } else if (encoders[resource.resourceTypeId]) {
          newUncompressed = encoders[resource.resourceTypeId](overrideValue);
        } else {
          // No encoder: fallback to original bytes
          newUncompressed = wasCompressed ? rawOriginal : rawOriginal.slice();
        }
        finalBytes = wasCompressed ? compressData(newUncompressed) : newUncompressed;
        uncompressedSize = newUncompressed.length;
      } else {
        // No override for this block: keep original bytes exactly
        finalBytes = rawOriginal;
      }

      segmentsByBlock[bi].push({ resourceIndex: ri, blockIndex: bi, alignment: align, bytes: finalBytes, uncompSize: uncompressedSize });
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
    if (blockSegments.length === 0) { resourceDataOffsets[bi] = 0; continue; }

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
        newUncompSizeAndAlign[seg.resourceIndex][bi] = packSizeAndAlignment(seg.uncompSize >>> 0, seg.alignment);
      }

      writePlans.push({ offset: absolute, bytes: seg.bytes });
      cursor += seg.bytes.length;
    }

    // Add minimal alignment between blocks
    cursor = ((cursor + 15) >>> 4) << 4;
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
  writeU32(headerOffset + 8, bundle.header.platform);
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
  try {
    reportProgress(progressCallback, 'parse', 0, 'Starting bundle parsing');

    const reader = new BufferReader(buffer, {
      endianness: options.littleEndian !== false ? 'little' : 'big'
    });

    reportProgress(progressCallback, 'parse', 0.1, 'Parsing bundle header');

    // Parse header
    const header = parseHeader(reader, buffer, options);

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

    // Parse imports
    const imports = parseImportEntries(reader, resources);

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
};

/**
 * Parses a specific resource type from bundle data
 */
function parseResourceType<T>(
  buffer: ArrayBuffer,
  bundle: ParsedBundle,
  resourceName: string,
  parseFn: (buffer: ArrayBuffer, resource: any, options: any) => T
): T | null {
  const resourceType = Object.values(RESOURCE_TYPES).find(rt => rt.name === resourceName);
  if (!resourceType) return null;

  const resource = bundle.resources.find(r => r.resourceTypeId === resourceType.id);
  if (!resource) return null;

  try {
    let options: any = {};

    // Set platform-specific options
    if (resourceName === 'Vehicle List') {
      options.littleEndian = bundle.header.platform !== PLATFORMS.PS3;
    } else if (resourceName === 'Player Car Colours') {
      options.is64Bit = bundle.header.platform === PLATFORMS.PC;
      options.strict = false;
    } else if (resourceName === 'ICE Dictionary') {
      options.littleEndian = bundle.header.platform !== PLATFORMS.PS3;
    }

    return parseFn(buffer, resource, options);
  } catch (error) {
    console.warn(`Failed to parse ${resourceName}:`, error);
    return null;
  }
}

/**
 * Parses all known resource types from a bundle
 */
export function parseBundleResources(
  buffer: ArrayBuffer,
  bundle: ParsedBundle
): ParsedResources {
  const resources: ParsedResources = {};

  // Parse vehicle list
  const vehicleList = parseResourceType(
    buffer,
    bundle,
    'Vehicle List',
    parseVehicleList
  );
  if (vehicleList) {
    resources.vehicleList = vehicleList;
  }

  // Parse player car colours
  const playerCarColours = parseResourceType(
    buffer,
    bundle,
    'Player Car Colours',
    parsePlayerCarColours
  );
  if (playerCarColours) {
    resources.playerCarColours = playerCarColours;
  }

  // Parse ICE Take Dictionary
  const iceDict = parseResourceType(
    buffer,
    bundle,
    'ICE Dictionary',
    parseIceTakeDictionary
  );
  if (iceDict) {
    resources.iceTakeDictionary = iceDict;
  }

  // Parse Trigger Data
  const triggerData = parseResourceType(
    buffer,
    bundle,
    'Trigger Data',
    parseTriggerData, 
  );
  if (triggerData) {
    resources.triggerData = triggerData;
  }
  // Parse Challenge List
  const challengeList = parseResourceType(
    buffer,
    bundle,
    'Challenge List',
    parseChallengeList,
  );
  if (challengeList) {
    resources.challengeList = challengeList;
  }

  return resources;
}
