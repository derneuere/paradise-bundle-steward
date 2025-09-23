// Vehicle List Parser - Refactored to use core architecture
// Handles parsing of Burnout Paradise vehicle list data with improved error handling

import { BufferReader, type Parsed } from 'typed-binary';
import type { 
  ResourceEntry,
  ResourceContext,
  VehicleType,
  CarType,
  LiveryType,
  Rank,
  AIEngineStream,
  ParseOptions,
  ProgressCallback,
  ParsedBundle
} from '../core/types';
import { 
  VehicleListHeaderSchema,
  VehicleEntrySchema,
  u64ToBigInt,
} from '../core/schemas';
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
  exhaustName: string;
  exhaustEntityKey: bigint;
  engineEntityKey: bigint;
  engineName: string;
  rivalUnlockName: string;
  wonCarVoiceOverKey: bigint;
  rivalReleasedVoiceOverKey: bigint;
  aiMusicLoopContentSpec: string;
  aiExhaustIndex: AIEngineStream;
  aiExhaustIndex2ndPick: AIEngineStream;
  aiExhaustIndex3rdPick: AIEngineStream;
}

export type VehicleListEntry = {
  id: string;
  parentId: string;
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
    unknown1: number;
    unknown2: number;
  };
};

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
    
    reportProgress(progressCallback, 'parse', 0.4, 'Parsing vehicle list header');
    
    // Parse with appropriate endianness
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
// Vehicle List Data Parsing
// ============================================================================

function parseVehicleListData(
  data: Uint8Array,
  options: ParseOptions,
  progressCallback?: ProgressCallback
): ParsedVehicleList {
  // Decompress if needed
  if (data.length >= 2 && data[0] === 0x78) {
    console.debug('Decompressing vehicle list data...');
    data = decompressData(data);
    console.debug(`Decompression: ${data.length} bytes`);
  }

  const reader = new BufferReader(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    { endianness: options.littleEndian !== false ? 'little' : 'big' }
  );

  // Parse header
  const header = VehicleListHeaderSchema.read(reader);
  
  console.debug('Vehicle list header:', {
    numVehicles: header.numVehicles,
    startOffset: header.startOffset,
    dataLength: data.byteLength,
    endianness: options.littleEndian !== false ? 'little' : 'big'
  });

  // Validate header
  if (header.numVehicles > 5000 || header.numVehicles === 0) {
    console.warn(`Suspicious vehicle count: ${header.numVehicles}, trying opposite endianness`);
    
    const readerBE = new BufferReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness: options.littleEndian !== false ? 'big' : 'little' }
    );
    
    const headerBE = VehicleListHeaderSchema.read(readerBE);
    
    if (headerBE.numVehicles > 0 && headerBE.numVehicles <= 5000) {
      console.info('Using opposite endianness for vehicle list');
      return parseVehicleEntries(readerBE, headerBE, data.byteLength, !options.littleEndian, progressCallback);
    } else {
      throw new BundleError('Invalid vehicle list header with both endianness attempts');
    }
  }

  return parseVehicleEntries(reader, header, data.byteLength, options.littleEndian !== false, progressCallback);
}

// ============================================================================
// Vehicle Entry Parsing
// ============================================================================

function parseVehicleEntries(
  reader: BufferReader,
  header: Parsed<typeof VehicleListHeaderSchema>,
  dataLength: number,
  littleEndian: boolean,
  progressCallback?: ProgressCallback
): ParsedVehicleList {
  const maxVehicles = Math.floor((dataLength - 16) / VEHICLE_ENTRY_SIZE);
  const actualVehicleCount = Math.min(header.numVehicles, maxVehicles);
  
  console.debug(`Parsing vehicles: header=${header.numVehicles}, max=${maxVehicles}, using=${actualVehicleCount}`);
  
  if (actualVehicleCount * VEHICLE_ENTRY_SIZE + 16 > dataLength) {
    throw new BundleError('Vehicle list data appears corrupt or truncated');
  }

  const entries: VehicleListEntry[] = [];

  for (let i = 0; i < actualVehicleCount; i++) {
    try {
      reportProgress(progressCallback, 'parse', 0.4 + (i / actualVehicleCount) * 0.6, 
        `Parsing vehicle ${i + 1}/${actualVehicleCount}`);
      
      const rawEntry = VehicleEntrySchema.read(reader);
      const entry = processVehicleEntry(rawEntry, i);
      
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
      unknown1: header.unknown1,
      unknown2: header.unknown2
    }
  };
}

// ============================================================================
// Vehicle Entry Processing
// ============================================================================

function processVehicleEntry(rawEntry: Parsed<typeof VehicleEntrySchema>, index: number): VehicleListEntry | null {
  try {
    // Decode strings
    const id = decodeCgsId(rawEntry.idBytes);
    const parentId = decodeCgsId(rawEntry.parentIdBytes);
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

    // Process audio data
    const audioData: VehicleListEntryAudioData = {
      exhaustName: decodeCgsId(rawEntry.audioData.exhaustNameBytes),
      exhaustEntityKey: u64ToBigInt(rawEntry.audioData.exhaustEntityKey),
      engineEntityKey: u64ToBigInt(rawEntry.audioData.engineEntityKey),
      engineName: decodeCgsId(rawEntry.audioData.engineNameBytes),
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
    console.warn(`Failed to process vehicle entry ${index}:`, error);
    return null;
  }
}

// ============================================================================
// String Decoding
// ============================================================================

function decodeCgsId(bytes: number[]): string {
  // Convert 8 bytes to 64-bit integer (little-endian)
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * 8n);
  }
  
  if (value === 0n) return '';
  
  return decryptEncryptedString(value);
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
  } while (index >= 0);
  
  return String.fromCharCode(...buf.filter(b => b !== 0)).trim();
}

function decodeString(bytes: number[]): string {
  let dataStart = 0;
  while (dataStart < bytes.length && bytes[dataStart] === 0) {
    dataStart++;
  }
  
  if (dataStart >= bytes.length) return '';
  
  const remainingBytes = bytes.slice(dataStart);
  const nullIndex = remainingBytes.indexOf(0);
  const validBytes = nullIndex === -1 ? remainingBytes : remainingBytes.slice(0, nullIndex);
  
  return validBytes.map(b => String.fromCharCode(b)).join('').trim();
}

// ============================================================================
// Validation
// ============================================================================

function isValidVehicleEntry(entry: VehicleListEntry): boolean {
  return (
    (entry.id && entry.id.trim() !== '' && entry.id.length > 2) || 
    (entry.vehicleName && entry.vehicleName.trim() !== '' && entry.vehicleName.length > 3)
  ) && (
    entry.gamePlayData.damageLimit >= 0 &&
    entry.gamePlayData.damageLimit < 1000 &&
    entry.category !== 0xFFFFFFFF
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

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
export type { VehicleType, CarType, LiveryType, Rank, AIEngineStream } from '../core/types'; 