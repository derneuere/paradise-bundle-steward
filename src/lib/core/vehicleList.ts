// Vehicle List schemas, types, and reading functions for Burnout Paradise

import {
  object,
  arrayOf,
  u8,
  u16,
  u32,
  f32,
  type Parsed
} from 'typed-binary';
import { BufferReader } from 'typed-binary';
import * as pako from 'pako';
import { parseBundle } from './bundleParser';
import { getResourceData, isNestedBundle } from './resourceManager';
import type {
  ResourceEntry,
  ResourceContext,
  ParsedBundle,
  ProgressCallback,
  ResourceNotFoundError
} from './types';
import { BundleError } from './types';

// ============================================================================
// Vehicle List Schemas
// ============================================================================

// 8-byte string schema (for CgsID)
export const cgsIdSchema = arrayOf(u8, 8);

// 32-byte string schema
export const string32Schema = arrayOf(u8, 32);

// 64-byte string schema
export const string64Schema = arrayOf(u8, 64);

// Vehicle List Header Schema (16 bytes)
export const VehicleListHeaderSchema = object({
  numVehicles: u32,
  startOffset: u32,
  unknown1: u32,
  unknown2: u32
});

// Gameplay data schema
export const GamePlayDataSchema = object({
  damageLimit: f32,
  flags: u32,
  boostBarLength: u8,
  unlockRank: u8,
  boostCapacity: u8,
  strengthStat: u8,
  padding0: u32
});

// Audio data schema
export const AudioDataSchema = object({
  exhaustNameBytes: cgsIdSchema,
  exhaustEntityKey: object({ low: u32, high: u32 }),
  engineEntityKey: object({ low: u32, high: u32 }),
  engineNameBytes: cgsIdSchema,
  rivalUnlockHash: u32,
  padding1: u32,
  wonCarVoiceOverKey: object({ low: u32, high: u32 }),
  rivalReleasedVoiceOverKey: object({ low: u32, high: u32 }),
  musicHash: u32,
  aiExhaustIndex: u8,
  aiExhaustIndex2ndPick: u8,
  aiExhaustIndex3rdPick: u8,
  padding2: u8
});

// Vehicle entry schema (264 bytes / 0x108)
export const VehicleEntrySchema = object({
  idBytes: cgsIdSchema,
  parentIdBytes: cgsIdSchema,
  wheelNameBytes: string32Schema,
  vehicleNameBytes: string64Schema,
  manufacturerBytes: string32Schema,
  gamePlayData: GamePlayDataSchema,
  attribCollectionKey: object({ low: u32, high: u32 }),
  audioData: AudioDataSchema,
  unknown: arrayOf(u8, 16),
  category: u32,
  vehicleAndBoostType: u8,
  liveryType: u8,
  topSpeedNormal: u8,
  topSpeedBoost: u8,
  topSpeedNormalGUIStat: u8,
  topSpeedBoostGUIStat: u8,
  colorIndex: u8,
  paletteIndex: u8,
  finalPadding: arrayOf(u8, 4)
});

// ============================================================================
// Vehicle List Types
// ============================================================================

export enum VehicleType {
  CAR = 0,
  BIKE = 1,
  PLANE = 2
}

export enum CarType {
  SPEED = 0,
  AGGRESSION = 1,
  STUNT = 2,
  NONE = 3,
  LOCKED = 4,
  INVALID = 5
}

export enum LiveryType {
  DEFAULT = 0,
  COLOUR = 1,
  PATTERN = 2,
  SILVER = 3,
  GOLD = 4,
  COMMUNITY = 5
}

export enum Rank {
  LEARNERS_PERMIT = 0,
  D_CLASS = 1,
  C_CLASS = 2,
  B_CLASS = 3,
  A_CLASS = 4,
  BURNOUT_LICENSE = 5
}

export enum AIEngineStream {
  NONE = 0,
  AIROD_EX = 1,
  AI_CIVIC_EX = 2,
  AI_GT_ENG = 3,
  AI_MUST_EX = 4,
  AI_F1_EX = 5,
  AI_BIKE_EX = 6
}

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
// Schema Factory for Fixed-Length Collections
// ============================================================================

// Vehicle list with known count
export function makeVehicleListSchema(count: number) {
  return object({
    header: VehicleListHeaderSchema,
    entries: arrayOf(VehicleEntrySchema, count)
  });
}

// ============================================================================
// String Decoding Functions
// ============================================================================

function decodeString(bytes: number[]): string {
  // Find null terminator
  const nullIndex = bytes.indexOf(0);
  const effectiveBytes = nullIndex >= 0 ? bytes.slice(0, nullIndex) : bytes;

  // Convert to string and trim whitespace
  return new TextDecoder('utf-8').decode(new Uint8Array(effectiveBytes)).trim();
}

// Helper function to get decrypted ID for display
export function getDecryptedId(encrypted: bigint): string {
  if (encrypted === 0n) return '';
  return decryptEncryptedString(encrypted);
}

function decryptEncryptedString(encrypted: bigint): string {
  const buf: number[] = new Array(12).fill(0);
  let current = encrypted;
  let index = 11;

  do {
    const mod = current % 0x28n;
    current = current / 0x28n;

    let c: number;
    if (mod === 39n) {
      c = '_'.charCodeAt(0);
    } else if (mod < 13n) {
      if (mod < 3n) {
        if (mod === 2n) {
          c = '/'.charCodeAt(0);
        } else if (mod === 1n) {
          c = '-'.charCodeAt(0);
        } else {
          c = mod !== 0n ? 0 : ' '.charCodeAt(0);
        }
      } else {
        c = Number(mod) + '-'.charCodeAt(0);
      }
    } else {
      c = Number(mod) + '4'.charCodeAt(0);
    }

    buf[index] = c;
    index--;
  } while (current > 0 && index >= 0);

  // Convert to string and remove leading zeros
  return new TextDecoder('utf-8').decode(new Uint8Array(buf)).replace(/^\x00+/, '');
}

// ============================================================================
// Vehicle Entry Processing
// ============================================================================

function processVehicleEntry(rawEntry: Parsed<typeof VehicleEntrySchema>): VehicleListEntry | null {
  try {
    // Preserve encrypted CGS IDs as bigints (don't decrypt)
    const id = bytesToBigInt(rawEntry.idBytes);
    const parentId = bytesToBigInt(rawEntry.parentIdBytes);
    const wheelName = decodeString(rawEntry.wheelNameBytes);
    const vehicleName = decodeString(rawEntry.vehicleNameBytes);
    const manufacturer = decodeString(rawEntry.manufacturerBytes);

    // Process gameplay data
    const gamePlayData: VehicleListEntryGamePlayData = {
      damageLimit: rawEntry.gamePlayData.damageLimit,
      flags: rawEntry.gamePlayData.flags,
      boostBarLength: rawEntry.gamePlayData.boostBarLength,
      unlockRank: rawEntry.gamePlayData.unlockRank as Rank,
      boostCapacity: rawEntry.gamePlayData.boostCapacity,
      strengthStat: rawEntry.gamePlayData.strengthStat // Use raw value for perfect round-trip
    };

    // Process audio data - preserve encrypted names as bigints
    const audioData: VehicleListEntryAudioData = {
      exhaustName: bytesToBigInt(rawEntry.audioData.exhaustNameBytes),
      exhaustEntityKey: u64ToBigInt(rawEntry.audioData.exhaustEntityKey),
      engineEntityKey: u64ToBigInt(rawEntry.audioData.engineEntityKey),
      engineName: bytesToBigInt(rawEntry.audioData.engineNameBytes),
      rivalUnlockName: CLASS_UNLOCK_STREAMS[rawEntry.audioData.rivalUnlockHash] ??
        `0x${rawEntry.audioData.rivalUnlockHash.toString(16).toUpperCase()}`,
      wonCarVoiceOverKey: u64ToBigInt(rawEntry.audioData.wonCarVoiceOverKey),
      rivalReleasedVoiceOverKey: u64ToBigInt(rawEntry.audioData.rivalReleasedVoiceOverKey),
      aiMusicLoopContentSpec: AI_MUSIC_STREAMS[rawEntry.audioData.musicHash] ??
        `0x${rawEntry.audioData.musicHash.toString(16).toUpperCase()}`,
      aiExhaustIndex: rawEntry.audioData.aiExhaustIndex as AIEngineStream,
      aiExhaustIndex2ndPick: rawEntry.audioData.aiExhaustIndex2ndPick as AIEngineStream,
      aiExhaustIndex3rdPick: rawEntry.audioData.aiExhaustIndex3rdPick as AIEngineStream
    };

    // Extract vehicle and boost types
    const vehicleType = (rawEntry.vehicleAndBoostType >> 4) & 0xF as VehicleType;
    const boostType = rawEntry.vehicleAndBoostType & 0xF as CarType;

    return {
      id,
      parentId,
      wheelName,
      vehicleName,
      manufacturer,
      gamePlayData,
      attribCollectionKey: u64ToBigInt(rawEntry.attribCollectionKey),
      audioData,
      unknownData: new Uint8Array(rawEntry.unknown),
      category: rawEntry.category,
      vehicleType,
      boostType,
      liveryType: rawEntry.liveryType as LiveryType,
      topSpeedNormal: rawEntry.topSpeedNormal,
      topSpeedBoost: rawEntry.topSpeedBoost,
      topSpeedNormalGUIStat: rawEntry.topSpeedNormalGUIStat,
      topSpeedBoostGUIStat: rawEntry.topSpeedBoostGUIStat,
      colorIndex: rawEntry.colorIndex,
      paletteIndex: rawEntry.paletteIndex
    };

  } catch (error) {
    console.warn(`Failed to process vehicle entry:`, error);
    return null;
  }
}

function isValidVehicleEntry(entry: VehicleListEntry): boolean {
  // Basic validation - check if essential fields are present
  return entry.vehicleName.length > 0 && entry.id !== 0n;
}

// ============================================================================
// Constants and Mappings
// ============================================================================

const CLASS_UNLOCK_STREAMS: Record<number, string> = {
  0x0470A5BF: 'SuperClassUnlock',
  0x48346FEF: 'MuscleClassUnlock',
  0x817B91D9: 'F1ClassUnlock',
  0xA3E2D8C9: 'TunerClassUnlock',
  0xB3845465: 'HotRodClassUnlock',
  0xEBE39AE9: 'RivalGen'
};

const AI_MUSIC_STREAMS: Record<number, string> = {
  0xA9813C9D: 'AI_Muscle_music1',
  0xCB72AEA7: 'AI_Truck_music1',
  0x284D944B: 'AI_Tuner_music1',
  0xD95C2309: 'AI_Sedan_music1',
  0x8A1A90E9: 'AI_Exotic_music1',
  0xB12A34DD: 'AI_Super_music1'
};

const VEHICLE_ENTRY_SIZE = 0x108; // 264 bytes

// ============================================================================
// Helper Functions
// ============================================================================

// Helper function to convert u64 object to bigint
function u64ToBigInt(u64: { low: number; high: number }): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// Helper function to convert array of 8 bytes to bigint (little-endian)
function bytesToBigInt(bytes: number[]): bigint {
  if (bytes.length !== 8) {
    throw new Error(`Expected 8 bytes, got ${bytes.length}`);
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * 8n);
  }
  return value;
}

// ============================================================================
// High-Level Parsing Functions
// ============================================================================

/**
 * Parses vehicle list data from a bundle resource, handling nested bundles
 */
export function parseVehicleList(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  options: { littleEndian?: boolean } = {},
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
// Main Parsing Function
// ============================================================================

/**
 * Parses vehicle list data from raw bytes
 */
export function parseVehicleListData(
  data: Uint8Array,
  options: { littleEndian?: boolean } = {},
  progressCallback?: ProgressCallback
): ParsedVehicleList {
  const littleEndian = options.littleEndian !== false;

  // Decompress if needed
  if (data.length >= 2 && data[0] === 0x78) {
    console.debug('Decompressing vehicle list data...');
    data = pako.inflate(data);
    console.debug(`Decompression complete: ${data.length} bytes`);
  }

  const reader = new BufferReader(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    { endianness: littleEndian ? 'little' : 'big' }
  );

  // Parse header
  const header = VehicleListHeaderSchema.read(reader);

  console.debug('Vehicle list header:', {
    numVehicles: header.numVehicles,
    startOffset: header.startOffset,
    dataLength: data.byteLength
  });

  // Validate header
  if (header.numVehicles > 5000 || header.numVehicles === 0) {
    throw new Error(`Invalid vehicle count: ${header.numVehicles}`);
  }

  const maxVehicles = Math.floor((data.byteLength - 16) / VEHICLE_ENTRY_SIZE);
  const actualVehicleCount = Math.min(header.numVehicles, maxVehicles);

  console.debug(`Parsing vehicles: header=${header.numVehicles}, max=${maxVehicles}, using=${actualVehicleCount}`);

  if (actualVehicleCount * VEHICLE_ENTRY_SIZE + 16 > data.byteLength) {
    throw new Error('Vehicle list data appears corrupt or truncated');
  }

  const entries: VehicleListEntry[] = [];

  for (let i = 0; i < actualVehicleCount; i++) {
    try {
      const rawEntry = VehicleEntrySchema.read(reader);
      const entry = processVehicleEntry(rawEntry);

      if (entry && isValidVehicleEntry(entry)) {
        entries.push(entry);
      }

    } catch (error) {
      console.warn(`Error parsing vehicle entry ${i}:`, error);
      // Continue with next entry unless in strict mode
      if (i < 10) { // Only fail early for first few entries
        throw error;
      }
    }
  }

  console.debug(`Parsed ${entries.length} valid vehicles out of ${actualVehicleCount} attempted`);
  return {
    vehicles: entries,
    header: {
      numVehicles: header.numVehicles,
      startOffset: header.startOffset,
      unknown1: header.unknown1,
      unknown2: header.unknown2
    }
  };
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
