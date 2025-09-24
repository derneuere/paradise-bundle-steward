// Vehicle List Parser - Refactored to use core architecture
// Handles parsing of Burnout Paradise vehicle list data with improved error handling

import {
  VehicleType,
  CarType,
  LiveryType,
  Rank,
  AIEngineStream,
  parseVehicleListData,
  getDecryptedId
} from '../core/vehicleList';
import type {
  ResourceEntry,
  ResourceContext,
  ParseOptions,
  ProgressCallback,
  ParsedBundle
} from '../core/types';
import {
  getResourceData,
  isNestedBundle,
  decompressData
} from '../core/resourceManager';
import { parseBundle } from './bundleParser';
import { BundleError, ResourceNotFoundError } from '../core/types';

// ============================================================================
// Vehicle List Data Structures
// ============================================================================

export type VehicleListEntryGamePlayData = {
  damageLimit: number;
  flags: number;
  boostBarLength: number;
  unlockRank: Rank;
  boostCapacity: number;
  strengthStat: number;
}

export type VehicleListEntryAudioData = {
  exhaustName: bigint; // Encrypted exhaust name
  exhaustEntityKey: bigint;
  engineEntityKey: bigint;
  engineName: bigint; // Encrypted engine name
  rivalUnlockName: string;
  wonCarVoiceOverKey: bigint;
  rivalReleasedVoiceOverKey: bigint;
  aiMusicLoopContentSpec: string;
  aiExhaustIndex: AIEngineStream;
  aiExhaustIndex2ndPick: AIEngineStream;
  aiExhaustIndex3rdPick: AIEngineStream;
}

export type VehicleListEntry = {
  id: bigint; // Encrypted CGS ID
  parentId: bigint; // Encrypted parent CGS ID
  vehicleName: string;
  manufacturer: string;
  wheelName: string;
  gamePlayData: VehicleListEntryGamePlayData;
  attribCollectionKey: bigint;
  audioData: VehicleListEntryAudioData;
  unknownData: Uint8Array; // 16 bytes of unknown data
  category: number;
  vehicleType: VehicleType;
  boostType: CarType;
  liveryType: LiveryType;
  topSpeedNormal: number;
  topSpeedBoost: number;
  topSpeedNormalGUIStat: number;
  topSpeedBoostGUIStat: number;
  colorIndex: number;
  paletteIndex: number;
}

// Helper function re-exported from core for backward compatibility
export { getDecryptedId } from '../core/vehicleList';

export type ParsedVehicleList = {
  vehicles: VehicleListEntry[];
  header: {
    numVehicles: number;
    startOffset: number;
    unknown1: number;
    unknown2: number;
  };
};

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parses vehicle list data from a bundle resource
 */
export function parseVehicleList(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  options: ParseOptions = {},
  progressCallback?: ProgressCallback
): ParsedVehicleList {
  try {
    reportProgress(progressCallback, 'parse', 0, 'Starting vehicle list parsing');

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

    reportProgress(progressCallback, 'parse', 0.4, 'Parsing vehicle list data');

    // Parse with core function
    const result = parseVehicleListData(data, options, progressCallback);

    reportProgress(progressCallback, 'parse', 1.0, `Parsed ${result.vehicles.length} vehicles`);

    return result;

  } catch (error) {
    if (error instanceof BundleError) {
      throw error;
    }
    throw new BundleError(
      `Failed to parse vehicle list: ${error instanceof Error ? error.message : String(error)}`,
      'VEHICLE_LIST_PARSE_ERROR',
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
  console.debug(`handleNestedBundle: Checking data of size ${data.length} bytes, first 4 bytes: ${new TextDecoder().decode(data.subarray(0, 4))}`);

  if (!isNestedBundle(data)) {
    console.debug('handleNestedBundle: Data is not a nested bundle, returning as-is');
    return data;
  }

  console.debug('Vehicle list is in nested bundle, extracting...');

  try {
    const innerBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const bundle = parseBundle(innerBuffer);

    // Find the VehicleList resource in the nested bundle
    const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
    if (!innerResource) {
      throw new ResourceNotFoundError(resource.resourceTypeId);
    }

    console.debug('Found inner VehicleList resource:', {
      resourceId: innerResource.resourceId.toString(16),
      diskOffsets: innerResource.diskOffsets,
      sizes: innerResource.sizeAndAlignmentOnDisk.map(s => s & 0x0FFFFFFF)
    });

    // Extract data from bundle sections
    const dataOffsets = bundle.header.resourceDataOffsets;
    console.debug('Nested bundle dataOffsets:', dataOffsets);
    console.debug('Inner resource diskOffsets:', innerResource.diskOffsets);

    for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
      const sectionOffset = dataOffsets[sectionIndex];
      if (sectionOffset === 0) continue;

      const absoluteOffset = data.byteOffset + sectionOffset;
      if (absoluteOffset >= originalBuffer.byteLength) continue;

      const maxSize = originalBuffer.byteLength - absoluteOffset;
      const sectionData = new Uint8Array(originalBuffer, absoluteOffset, Math.min(maxSize, 100000));

      console.debug(`Checking section ${sectionIndex}: offset=${sectionOffset}, absolute=${absoluteOffset}, size=${sectionData.length}, first byte=${sectionData[0]?.toString(16)}`);

      // Check if this looks like compressed vehicle list data
      if (sectionData.length >= 2 && sectionData[0] === 0x78) {
        console.debug('Found compressed data in section', sectionIndex);
        return sectionData;
      }

      // Check if this looks like uncompressed vehicle list data
      // Vehicle list data starts with a 16-byte header: numVehicles(4), startOffset(4), unknown1(4), unknown2(4)
      if (sectionData.length >= 16) {
        const headerStart = sectionData.subarray(0, 4);
        const numVehicles = new DataView(headerStart.buffer, headerStart.byteOffset).getUint32(0, true);
        const startOffset = new DataView(sectionData.buffer, sectionData.byteOffset + 4).getUint32(0, true);

        if (startOffset === 16) { // Header is always 16 bytes
          console.debug(`Found uncompressed vehicle list data in section ${sectionIndex}: numVehicles=${numVehicles}`);
          return sectionData;
        }
      }
    }

    // Also check if the resource data is at offset 0 (since inner resource has diskOffset 0)
    console.debug('Checking if resource data is at offset 0...');
    const resourceOffset = innerResource.diskOffsets[0];
    if (resourceOffset === 0) {
      const resourceData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      console.debug(`Resource data at offset 0: size=${resourceData.length}, first byte=${resourceData[0]?.toString(16)}`);

      // Check for compressed data
      if (resourceData.length >= 2 && resourceData[0] === 0x78) {
        console.debug('Found compressed data at resource offset 0');
        return resourceData;
      }

      // Check for uncompressed vehicle list data
      if (resourceData.length >= 16) {
        const numVehicles = new DataView(resourceData.buffer, resourceData.byteOffset).getUint32(0, true);
        const startOffset = new DataView(resourceData.buffer, resourceData.byteOffset + 4).getUint32(0, true);

        if (startOffset === 16) {
          console.debug(`Found uncompressed vehicle list data at resource offset 0: numVehicles=${numVehicles}`);
          return resourceData;
        }
      }
    }

    throw new BundleError('Could not find valid vehicle list data in nested bundle');
  } catch (error) {
    console.warn('Failed to parse as nested bundle, treating as raw vehicle list data:', error);
    return data; // Return original data if nested bundle parsing fails
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function reportProgress(
  callback: ProgressCallback | undefined,
  type: string,
  progress: number,
  message?: string
) {
  callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}