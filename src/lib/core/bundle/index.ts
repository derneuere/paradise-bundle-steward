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

// ============================================================================
// Main Bundle Writer
// ============================================================================

/**
 * Writes a Burnout Paradise Bundle 2 format buffer from a ParsedBundle.
 * Note: This writer preserves the original data layout. It updates the header,
 * resource entry table and optional debug data in-place relative to the
 * original buffer. Resource/import data bytes are copied from the original
 * buffer without relocation.
 */
export function writeBundle(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  options: WriteOptions = {},
  progressCallback?: ProgressCallback
): ArrayBuffer {
  try {
    reportProgress(progressCallback, 'write', 0, 'Starting bundle write');
    const outBytes = new Uint8Array(originalBuffer.byteLength);
    outBytes.set(new Uint8Array(originalBuffer));
    const outBuffer = outBytes.buffer;
    const isLittleEndian = bundle.header.platform !== PLATFORMS.PS3;
    const dv = new DataView(outBuffer);

    // ----------------------------------------------------------------------
    // Write header at offset 0
    // ----------------------------------------------------------------------
    const headerOffset = 0;
    const writeU32 = (offset: number, value: number) => dv.setUint32(offset, value >>> 0, isLittleEndian);

    // magic 'bnd2'
    const magicBytes = new TextEncoder().encode('bnd2');
    outBytes.set(magicBytes, headerOffset);

    // version
    writeU32(headerOffset + 4, 2);

    // platform
    writeU32(headerOffset + 8, bundle.header.platform);

    // Determine debug flag and offset
    const includeDebug = options.includeDebugData !== false && !!bundle.debugData && bundle.header.debugDataOffset > 0;
    let flags = bundle.header.flags >>> 0;
    if (includeDebug) {
      flags |= BUNDLE_FLAGS.HAS_DEBUG_DATA;
    } else {
      flags &= ~BUNDLE_FLAGS.HAS_DEBUG_DATA;
    }

    // debugDataOffset from header (preserve existing position)
    writeU32(headerOffset + 12, includeDebug ? bundle.header.debugDataOffset : 0);

    // resourceEntriesCount
    writeU32(headerOffset + 16, bundle.resources.length);

    // resourceEntriesOffset
    writeU32(headerOffset + 20, bundle.header.resourceEntriesOffset);

    // resourceDataOffsets (3 x u32)
    const rdo = bundle.header.resourceDataOffsets || [0, 0, 0];
    writeU32(headerOffset + 24, rdo[0] || 0);
    writeU32(headerOffset + 28, rdo[1] || 0);
    writeU32(headerOffset + 32, rdo[2] || 0);

    // flags
    writeU32(headerOffset + 36, flags);

    reportProgress(progressCallback, 'write', 0.25, 'Header written');

    // ----------------------------------------------------------------------
    // Write resource entry table
    // ----------------------------------------------------------------------

    const entrySize = 64; // bytes per ResourceEntry
    let tableOffset = bundle.header.resourceEntriesOffset;

    const writeU16 = (offset: number, value: number) => dv.setUint16(offset, value & 0xFFFF, isLittleEndian);
    const writeU8 = (offset: number, value: number) => dv.setUint8(offset, value & 0xFF);

    for (let i = 0; i < bundle.resources.length; i++) {
      const re = bundle.resources[i];
      let off = tableOffset + i * entrySize;

      // resourceId (u64 -> two u32: low, high)
      writeU32(off + 0, re.resourceId.low);
      writeU32(off + 4, re.resourceId.high);

      // importHash (u64)
      writeU32(off + 8, re.importHash.low);
      writeU32(off + 12, re.importHash.high);

      // uncompressedSizeAndAlignment [3]
      writeU32(off + 16, re.uncompressedSizeAndAlignment[0]);
      writeU32(off + 20, re.uncompressedSizeAndAlignment[1]);
      writeU32(off + 24, re.uncompressedSizeAndAlignment[2]);

      // sizeAndAlignmentOnDisk [3]
      writeU32(off + 28, re.sizeAndAlignmentOnDisk[0]);
      writeU32(off + 32, re.sizeAndAlignmentOnDisk[1]);
      writeU32(off + 36, re.sizeAndAlignmentOnDisk[2]);

      // diskOffsets [3]
      writeU32(off + 40, re.diskOffsets[0]);
      writeU32(off + 44, re.diskOffsets[1]);
      writeU32(off + 48, re.diskOffsets[2]);

      // importOffset
      writeU32(off + 52, re.importOffset);

      // resourceTypeId
      writeU32(off + 56, re.resourceTypeId);

      // importCount (u16)
      writeU16(off + 60, re.importCount);

      // flags (u8)
      writeU8(off + 62, re.flags);

      // streamIndex (u8)
      writeU8(off + 63, re.streamIndex);

    }

    reportProgress(progressCallback, 'write', 0.7, 'Resource table written');
    console.log(outBytes.length);



    // ----------------------------------------------------------------------
    // Write debug data if requested and space exists at header.debugDataOffset
    // ----------------------------------------------------------------------
    if (includeDebug && typeof bundle.debugData === 'string') {
      const enc = new TextEncoder();
      const bytes = enc.encode(bundle.debugData);
      const start = bundle.header.debugDataOffset >>> 0;

      // Safeguard: only write within buffer bounds
      const maxWritable = outBytes.length - start;
      const toWrite = Math.min(bytes.length, Math.max(0, maxWritable - 1)); // keep room for NUL
      if (toWrite > 0 && start < outBytes.length) {
        outBytes.set(bytes.subarray(0, toWrite), start);
        outBytes[start + toWrite] = 0; // NUL terminate
      }
    }

    reportProgress(progressCallback, 'write', 0.9, 'Debug data written');

    // TO-DO: This is based on the assumption that vehicle list is the first resource data offset
    const vehicleListDataOffset = bundle.header.resourceDataOffsets[0];

    // ----------------------------------------------------------------------
    // If vehicle list overrides provided, write them in-place to resource data
    // ----------------------------------------------------------------------
    if (options.overrides?.vehicleList) {
      const vehicleResource = bundle.resources.find(r => r.resourceTypeId === RESOURCE_TYPE_IDS.VEHICLE_LIST);
      if (vehicleResource) {
        console.log('Writing vehicle list overrides');
        const little = bundle.header.platform !== PLATFORMS.PS3;
        const vehicleBytes = writeVehicleListData({
          vehicles: options.overrides.vehicleList.vehicles,
          header: options.overrides.vehicleList.header ?? {
            numVehicles: options.overrides.vehicleList.vehicles.length,
            startOffset: 16,
            unknown1: 0,
            unknown2: 0
          }
        }, little);

        console.log("original compressed size", 15860, "new compressed size", vehicleBytes.length);
        console.log(`Writing vehicle list to offset ${vehicleListDataOffset} with size ${vehicleBytes.length}`);
        console.log(outBytes.length);
        // To-Do: Assumption that the list did not change size, so we can just write to the offset
        outBytes.set(vehicleBytes, vehicleListDataOffset);
      
      }
    }

    reportProgress(progressCallback, 'write', 1.0, 'Bundle write complete');
    return outBuffer;

  } catch (error) {
    throw new BundleError(
      `Failed to write bundle: ${error instanceof Error ? error.message : String(error)}`,
      'WRITE_ERROR',
      { error }
    );
  }
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

  return resources;
}
