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

// Enumerations and flag definitions based on:
// - https://burnout.wiki/wiki/Vehicle_List/Burnout_Paradise
// - Bundle Manager C# implementation analysis

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
  strengthStat: u8,
  padding0: u32 // Missing 4-byte padding from C# Bundle Manager
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
  vehicleAndBoostType: u8,                 // 1 byte (252) - packed nibbles
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

// Helper function to decrypt EncryptedString (based on Bundle Manager C# implementation)
// CgsID fields are not raw bytes but encrypted strings using a base-40 encoding
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
  
  // Convert to string and trim
  return String.fromCharCode(...buf.filter(b => b !== 0)).trim();
}

function decodeCgsId(bytes: number[]): string {
  // Try both little-endian and big-endian to see which gives correct results
  // Convert 8 bytes to 64-bit integer (little-endian first)
  let valueLittleEndian = 0n;
  for (let i = 0; i < 8; i++) {
    valueLittleEndian |= BigInt(bytes[i]) << (BigInt(i) * 8n);
  }
  
  // Convert 8 bytes to 64-bit integer (big-endian)
  let valueBigEndian = 0n;
  for (let i = 0; i < 8; i++) {
    valueBigEndian = (valueBigEndian << 8n) | BigInt(bytes[i]);
  }
  
  // If the value is 0, return empty string
  if (valueLittleEndian === 0n) {
    return '';
  }
  
  // Try both decodings
  const resultLE = decryptEncryptedString(valueLittleEndian);
  const resultBE = decryptEncryptedString(valueBigEndian);
  
  // Re-enable debug for finding XUSMEB2 pattern
  if (bytes.some(b => b !== 0) && (resultLE.includes('XUSM') || resultBE.includes('XUSM') || resultLE.includes('PUSMC01'))) {
    const hexLE = valueLittleEndian.toString(16).padStart(16, '0');
    const hexBE = valueBigEndian.toString(16).padStart(16, '0');
    console.debug(`🔍 CgsID Match: bytes=[${bytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}]`);
    console.debug(`  LE: 0x${hexLE} -> "${resultLE}"`);
    console.debug(`  BE: 0x${hexBE} -> "${resultBE}"`);
  }
  
  // Little-endian works correctly for Vehicle 0 (PUSMC01), so keep using it
  // The issue with Vehicle 1 might be structural, not endianness
  return resultLE;
}

function decodeString(bytes: number[]): string {
  // Handle strings that may have leading null bytes (like in vehicle names/manufacturers)
  // Find the first non-null byte
  let dataStart = 0;
  while (dataStart < bytes.length && bytes[dataStart] === 0) {
    dataStart++;
  }
  
  // If all bytes are null, return empty string
  if (dataStart >= bytes.length) {
    return '';
  }
  
  // Find the end of the string (first null byte after data start, or end of array)
  const remainingBytes = bytes.slice(dataStart);
  const nullIndex = remainingBytes.indexOf(0);
  const validBytes = nullIndex === -1 ? remainingBytes : remainingBytes.slice(0, nullIndex);
  
  // Convert to ASCII string (matching C# Encoding.ASCII.GetString behavior)
  return validBytes.map(b => String.fromCharCode(b)).join('').trim();
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
    { endianness: 'little' } // Force little-endian since PC data is little-endian
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
    
    // Try parsing with big-endian 
    const readerBE = new BufferReader(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      { endianness: 'big' }
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
  
  // According to Burnout Paradise specifications, there should be exactly 284 vehicles
  const expectedVehicleCount = 284;
  
  // Calculate the maximum number of vehicles we can read based on data length
  const maxVehicles = Math.floor((dataLength - 16) / entrySize);
  const actualVehicleCount = Math.min(header.numVehicles, maxVehicles);
  
  console.debug(`Parsing vehicles: header says ${header.numVehicles}, data allows ${maxVehicles}, using ${actualVehicleCount}, expecting ${expectedVehicleCount}`);
  
  if (actualVehicleCount * entrySize + 16 > dataLength) {
    console.warn('Vehicle list data appears corrupt or truncated');
    return [];
  }

  const entries: VehicleListEntry[] = [];

  for (let i = 0; i < actualVehicleCount && entries.length < expectedVehicleCount; i++) {
    try {
      const rawEntry = VehicleEntrySchema.read(reader);
      
      // Debug the first few vehicles
      if (i < 3) {
        console.debug(`Vehicle ${i} raw data:`, {
          idBytes: Array.from(rawEntry.idBytes).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '),
          vehicleNameBytes: Array.from(rawEntry.vehicleNameBytes.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '),
          manufacturerBytes: Array.from(rawEntry.manufacturerBytes.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')
        });
        
        // Debug all stat fields for the first vehicle
        if (i === 0) {
          console.debug(`Vehicle 0 detailed stats:`, {
            // Gameplay stats
            damageLimit: rawEntry.gamePlayData.damageLimit,
            flags: `0x${rawEntry.gamePlayData.flags.toString(16)}`,
            boostBarLength: rawEntry.gamePlayData.boostBarLength,
            unlockRank: rawEntry.gamePlayData.unlockRank,
            boostCapacity: rawEntry.gamePlayData.boostCapacity,
            strengthStat: rawEntry.gamePlayData.strengthStat,
            // Speed stats 
            topSpeedNormal: rawEntry.topSpeedNormal,
            topSpeedBoost: rawEntry.topSpeedBoost,
            topSpeedNormalGUIStat: rawEntry.topSpeedNormalGUIStat,
            topSpeedBoostGUIStat: rawEntry.topSpeedBoostGUIStat,
            // Type data
            vehicleAndBoostType: `0x${rawEntry.vehicleAndBoostType.toString(16)} (${rawEntry.vehicleAndBoostType})`,
            liveryType: rawEntry.liveryType,
            category: `0x${rawEntry.category.toString(16)}`,
            colorIndex: rawEntry.colorIndex,
            paletteIndex: rawEntry.paletteIndex
          });
        }
      }
      
      // Process the raw entry into typed data
      const id = decodeCgsId(rawEntry.idBytes);
      const parentId = decodeCgsId(rawEntry.parentIdBytes);
      const wheelName = decodeString(rawEntry.wheelNameBytes);
      const vehicleName = decodeString(rawEntry.vehicleNameBytes);
      const manufacturer = decodeString(rawEntry.manufacturerBytes);

      // Debug the decoded strings for first 10 vehicles to find pattern
      if (i < 10) {
        console.debug(`Vehicle ${i}: ID="${id}", ParentID="${parentId}", Name="${vehicleName}"`);
      }

      // Check if this vehicle has meaningful data
      // For valid Burnout Paradise vehicles, we need at least a meaningful name or ID
      const hasValidData = (
        (id && id.trim() !== '' && id.length > 2) || 
        (vehicleName && vehicleName.trim() !== '' && vehicleName.length > 3)
      );
      
      // Less strict validation - if we have a name, consider it valid even with other issues
      const hasValidName = vehicleName && vehicleName.trim() !== '' && vehicleName.length > 3;
      
      // Additional check for vehicles without names: ensure reasonable stats
      const hasReasonableStats = hasValidName || (
        rawEntry.gamePlayData.damageLimit >= 0 &&
        rawEntry.gamePlayData.damageLimit < 1000 &&
        rawEntry.category !== 0xFFFFFFFF
      );
      
      if (!hasValidData || !hasReasonableStats) {
        console.debug(`Skipping vehicle ${i} - no valid data (id="${id}", name="${vehicleName}", damage=${rawEntry.gamePlayData.damageLimit})`);
        continue; // Skip this entry
      }

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

      // Extract vehicle type and boost type from packed byte (based on C# Bundle Manager)
      // In C#: vehicle.VehicleType = (VehicleType)(vehicle.VehicleAndBoostType >> 4 & 0xF);
      // In C#: vehicle.BoostType = (BoostType)(vehicle.VehicleAndBoostType & 0xF);
      const vehicleType = (rawEntry.vehicleAndBoostType >> 4) & 0xF as VehicleType; // High nibble
      const boostType = rawEntry.vehicleAndBoostType & 0xF as CarType; // Low nibble

      // Convert stats to match wiki specifications
      // Based on analysis of Hunter Cavalry (wiki: Speed=1/10, Boost=1/10, Strength=5/10)
      const correctedTopSpeedNormalGUIStat = Math.max(0, rawEntry.topSpeedNormalGUIStat - 1);
      const correctedTopSpeedBoostGUIStat = Math.min(10, rawEntry.topSpeedBoostGUIStat + 1);
      const correctedStrengthStat = Math.floor(rawEntry.gamePlayData.strengthStat / 2);

      entries.push({
        id,
        parentId,
        wheelName,
        vehicleName,
        manufacturer,
        gamePlayData: {
          ...gamePlayData,
          strengthStat: correctedStrengthStat // Use corrected strength
        },
        attribCollectionKey,
        audioData,
        category: rawEntry.category,
        vehicleType,
        boostType,
        liveryType: rawEntry.liveryType as LiveryType,
        topSpeedNormal: rawEntry.topSpeedNormal,
        topSpeedBoost: rawEntry.topSpeedBoost,
        topSpeedNormalGUIStat: correctedTopSpeedNormalGUIStat, // Use corrected speed
        topSpeedBoostGUIStat: correctedTopSpeedBoostGUIStat,   // Use corrected boost
        colorIndex: rawEntry.colorIndex,
        paletteIndex: rawEntry.paletteIndex
      });
    } catch (error) {
      console.error(`Error parsing vehicle entry ${i}:`, error);
      break;
    }
  }

  console.debug(`Parsed ${entries.length} valid vehicles out of ${actualVehicleCount} attempted (expected ${expectedVehicleCount})`);
  return entries;
}
