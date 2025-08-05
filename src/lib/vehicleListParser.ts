import { extractResourceSize, parseBundle, type ResourceEntry } from './bundleParser';
import { 
  object, 
  arrayOf, 
  string, 
  u8, 
  u16, 
  u32, 
  f32, 
  BufferReader,
  type Parsed
} from 'typed-binary';
import * as pako from 'pako';

// Enumerations and flag definitions based on
// https://burnout.wiki/wiki/Vehicle_List/Burnout_Paradise

export enum VehicleCategory {
  PARADISE_CARS = 0x1,
  PARADISE_BIKES = 0x2,
  ONLINE_CARS = 0x4,
  TOY_VEHICLES = 0x8,
  LEGENDARY_CARS = 0x10,
  BOOST_SPECIAL_CARS = 0x20,
  COP_CARS = 0x40,
  BIG_SURF_ISLAND_CARS = 0x80
}

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

export const VehicleGamePlayFlags = {
  IS_RACE_VEHICLE: 0x1,
  CAN_CHECK_TRAFFIC: 0x2,
  CAN_BE_CHECKED: 0x4,
  IS_TRAILER: 0x8,
  CAN_TOW_TRAILER: 0x10,
  CAN_BE_PAINTED: 0x20,
  UNKNOWN_0x40: 0x40,
  UNKNOWN_0x80: 0x80,
  SWITCHABLE_BOOST: 0x100,
  UNKNOWN_0x200: 0x200,
  UNKNOWN_0x400: 0x400,
  IS_WIP_DEV: 0x800,
  FROM_1_0: 0x1000,
  FROM_1_3: 0x2000,
  FROM_1_4: 0x4000,
  FROM_1_5: 0x8000,
  FROM_1_6: 0x10000,
  FROM_1_7: 0x20000,
  FROM_1_8: 0x40000,
  FROM_1_9: 0x80000
} as const;

export const CLASS_UNLOCK_STREAMS: Record<number, string> = {
  0x0470A5BF: 'SuperClassUnlock',
  0x48346FEF: 'MuscleClassUnlock',
  0x817B91D9: 'F1ClassUnlock',
  0xA3E2D8C9: 'TunerClassUnlock',
  0xB3845465: 'HotRodClassUnlock',
  0xEBE39AE9: 'RivalGen'
};

export const AI_MUSIC_STREAMS: Record<number, string> = {
  0xA9813C9D: 'AI_Muscle_music1',
  0xCB72AEA7: 'AI_Truck_music1',
  0x284D944B: 'AI_Tuner_music1',
  0xD95C2309: 'AI_Sedan_music1',
  0x8A1A90E9: 'AI_Exotic_music1',
  0xB12A34DD: 'AI_Super_music1'
};

// Custom 64-bit integer schema (using two 32-bit values)
const u64Schema = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
function u64ToBigInt(u64: Parsed<typeof u64Schema>): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// 8-byte string schema (for CgsID)
const cgsIdSchema = arrayOf(u8, 8);

// 32-byte string schema  
const string32Schema = arrayOf(u8, 32);

// 64-byte string schema
const string64Schema = arrayOf(u8, 64);

// Vehicle List Header Schema (16 bytes)
const VehicleListHeaderSchema = object({
  numVehicles: u32,
  startOffset: u32,
  unknown1: u32,
  unknown2: u32
});

// Gameplay data schema
const GamePlayDataSchema = object({
  damageLimit: f32,
  flags: u32,
  boostBarLength: u8,
  unlockRank: u8, // Rank enum
  boostCapacity: u8,
  strengthStat: u8
});

// Audio data schema  
const AudioDataSchema = object({
  exhaustNameBytes: cgsIdSchema,
  exhaustEntityKey: u64Schema,
  engineEntityKey: u64Schema,
  engineNameBytes: cgsIdSchema,
  rivalUnlockHash: u32,
  padding1: u32, // 4 bytes padding
  wonCarVoiceOverKey: u64Schema,
  rivalReleasedVoiceOverKey: u64Schema,
  musicHash: u32,
  aiExhaustIndex: u8,
  aiExhaustIndex2ndPick: u8,
  aiExhaustIndex3rdPick: u8,
  padding2: u8 // 1 byte padding
});

// Vehicle entry schema (264 bytes / 0x108)
const VehicleEntrySchema = object({
  idBytes: cgsIdSchema,                    // 8 bytes
  parentIdBytes: cgsIdSchema,              // 8 bytes  
  wheelNameBytes: string32Schema,          // 32 bytes
  vehicleNameBytes: string64Schema,        // 64 bytes
  manufacturerBytes: string32Schema,       // 32 bytes
  gamePlayData: GamePlayDataSchema,        // 16 bytes (144-159)
  attribCollectionKey: u64Schema,          // 8 bytes (160-167)  
  audioData: AudioDataSchema,              // 64 bytes (168-231)
  unknown: arrayOf(u8, 16),                // 16 bytes padding (232-247)
  category: u32,                           // 4 bytes (248-251)
  carTypeByte: u8,                         // 1 byte (252)
  liveryType: u8,                          // 1 byte (253)
  topSpeedNormal: u8,                      // 1 byte (254)
  topSpeedBoost: u8,                       // 1 byte (255)
  topSpeedNormalGUIStat: u8,               // 1 byte (256)
  topSpeedBoostGUIStat: u8,                // 1 byte (257)
  colorIndex: u8,                          // 1 byte (258)
  paletteIndex: u8,                        // 1 byte (259)
  finalPadding: arrayOf(u8, 4)             // 4 bytes padding (260-263)
});

export interface VehicleListEntryGamePlayData {
  damageLimit: number;
  flags: number;
  boostBarLength: number;
  unlockRank: Rank;
  boostCapacity: number;
  strengthStat: number;
}

export interface VehicleListEntryAudioData {
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

export interface VehicleListEntry {
  id: string;
  parentId: string;
  vehicleName: string;
  manufacturer: string;
  wheelName: string;
  gamePlayData: VehicleListEntryGamePlayData;
  attribCollectionKey: bigint;
  audioData: VehicleListEntryAudioData;
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

function decodeCgsId(bytes: number[]): string {
  let result = '';
  for (let i = 0; i < 8; i++) {
    const b = bytes[i];
    if (b === 0) break;
    result += String.fromCharCode(b);
  }
  return result;
}

function decodeString(bytes: number[]): string {
  const end = bytes.indexOf(0);
  const validBytes = end === -1 ? bytes : bytes.slice(0, end);
  return new TextDecoder().decode(new Uint8Array(validBytes));
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
    throw new Error(`Failed to decompress vehicle list data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseVehicleList(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  littleEndian = true
): VehicleListEntry[] {
  let data = getResourceData(buffer, resource);
  if (data.byteLength === 0) return [];

  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic === 'bnd2') {
    console.debug('Vehicle list is in nested bundle, extracting...');
    const innerBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    const bundle = parseBundle(innerBuffer);
    
    // Find the VehicleList resource in the nested bundle
    const innerResource = bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId);
    if (!innerResource) {
      console.warn('No VehicleList resource found in nested bundle');
      return [];
    }
    
    console.debug('Found inner VehicleList resource:', {
      resourceId: innerResource.resourceId.toString(16),
      diskOffsets: innerResource.diskOffsets,
      sizes: innerResource.sizeAndAlignmentOnDisk.map(extractResourceSize)
    });
    
    // The actual vehicle list data is in the bundle's data sections, not at the resource's disk offset
    // Use the bundle header's resource data offsets to find the correct data
    const dataOffsets = bundle.header.resourceDataOffsets;
    console.debug('Bundle data section offsets:', dataOffsets.map(o => `0x${o.toString(16)}`));
    
    // Try each data section to find valid vehicle list data
    let foundData = false;
    for (let sectionIndex = 0; sectionIndex < dataOffsets.length; sectionIndex++) {
      const sectionOffset = dataOffsets[sectionIndex];
      if (sectionOffset === 0) continue;
      
      // The section offset is relative to the original buffer, not the nested buffer
      // We need to calculate the absolute offset in the original buffer
      const absoluteOffset = data.byteOffset + sectionOffset;
      
      if (absoluteOffset >= buffer.byteLength) {
        console.warn(`Section ${sectionIndex} offset 0x${absoluteOffset.toString(16)} is beyond buffer`);
        continue;
      }
      
      // Extract data from this section - we don't know the exact size, so we'll read a reasonable amount
      const maxSize = buffer.byteLength - absoluteOffset;
      const sectionData = new Uint8Array(buffer, absoluteOffset, Math.min(maxSize, 100000)); // Max 100KB
      
      console.debug(`Trying data section ${sectionIndex} at offset 0x${absoluteOffset.toString(16)}, size=${sectionData.length}`);
      
      // Check if this looks like compressed vehicle list data
      if (sectionData.length >= 2 && sectionData[0] === 0x78) {
        console.debug('Found compressed data in section', sectionIndex);
        data = sectionData;
        foundData = true;
        break;
      }
    }
    
    if (!foundData) {
      console.error('Could not find valid vehicle list data in any bundle section');
      return [];
    }
  }

  // Check if the data is compressed and decompress if needed
  data = decompressData(data);

  const reader = new BufferReader(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    { endianness: littleEndian ? 'little' : 'big' }
  );

  // Parse header
  const header = VehicleListHeaderSchema.read(reader);
  
  console.debug('Vehicle list header', {
    numVehicles: header.numVehicles,
    startOffset: header.startOffset,
    unknown1: header.unknown1,
    unknown2: header.unknown2,
    dataLength: data.byteLength,
    littleEndian
  });

  // Validate header values - they should be reasonable
  if (header.numVehicles > 1000 || header.numVehicles === 0) {
    console.warn(`Suspicious vehicle count: ${header.numVehicles}, trying big-endian`);
    
    // Try parsing with opposite endianness
    const readerBE = new BufferReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness: littleEndian ? 'big' : 'little' }
    );
    
    const headerBE = VehicleListHeaderSchema.read(readerBE);
    console.debug('Vehicle list header (opposite endianness)', {
      numVehicles: headerBE.numVehicles,
      startOffset: headerBE.startOffset,
      unknown1: headerBE.unknown1,
      unknown2: headerBE.unknown2,
      dataLength: data.byteLength,
      littleEndian: !littleEndian
    });
    
    if (headerBE.numVehicles > 0 && headerBE.numVehicles <= 1000) {
      console.info('Using opposite endianness for vehicle list');
      reader.seekTo(0);
      return parseVehicleListWithReader(readerBE, headerBE, data.byteLength, !littleEndian);
    } else {
      console.error('Both endianness attempts failed, vehicle list may be corrupt');
      
      // Additional debug info
      console.debug('First 32 bytes of data:', Array.from(data.subarray(0, 32)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
      
      return [];
    }
  }

  return parseVehicleListWithReader(reader, header, data.byteLength, littleEndian);
}

function parseVehicleListWithReader(
  reader: BufferReader,
  header: Parsed<typeof VehicleListHeaderSchema>,
  dataLength: number,
  littleEndian: boolean
): VehicleListEntry[] {
  // Each vehicle entry is 264 bytes (0x108)
  const entrySize = 0x108;
  
  if (header.numVehicles * entrySize + 16 > dataLength) {
    console.warn('Vehicle list data appears corrupt or truncated');
    return [];
  }

  const entries: VehicleListEntry[] = [];

  for (let i = 0; i < header.numVehicles; i++) {
    try {
      const rawEntry = VehicleEntrySchema.read(reader);
      
      // Process the raw entry into typed data
      const id = decodeCgsId(rawEntry.idBytes);
      const parentId = decodeCgsId(rawEntry.parentIdBytes);
      const wheelName = decodeString(rawEntry.wheelNameBytes);
      const vehicleName = decodeString(rawEntry.vehicleNameBytes);
      const manufacturer = decodeString(rawEntry.manufacturerBytes);

      const gamePlayData: VehicleListEntryGamePlayData = {
        damageLimit: rawEntry.gamePlayData.damageLimit,
        flags: rawEntry.gamePlayData.flags,
        boostBarLength: rawEntry.gamePlayData.boostBarLength,
        unlockRank: rawEntry.gamePlayData.unlockRank as Rank,
        boostCapacity: rawEntry.gamePlayData.boostCapacity,
        strengthStat: rawEntry.gamePlayData.strengthStat
      };

      const attribCollectionKey = u64ToBigInt(rawEntry.attribCollectionKey);

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

      const vehicleType = (rawEntry.carTypeByte >> 4) as VehicleType; // High nibble
      const boostType = (rawEntry.carTypeByte & 0x0f) as CarType; // Low nibble

      entries.push({
        id,
        parentId,
        wheelName,
        vehicleName,
        manufacturer,
        gamePlayData,
        attribCollectionKey,
        audioData,
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
      });
    } catch (error) {
      console.error(`Error parsing vehicle entry ${i}:`, error);
      break;
    }
  }

  return entries;
}
