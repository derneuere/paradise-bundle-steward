// Vehicle List Writer - Serializes vehicle list data back to binary format
// Complements the vehicleListParser for round-trip editing

import { BufferWriter } from 'typed-binary';
import type { 
  VehicleListEntry, 
  VehicleListEntryGamePlayData, 
  VehicleListEntryAudioData
} from './vehicleListParser';
import { 
  Rank,
  VehicleType,
  CarType,
  LiveryType
} from '../core/types';

// ============================================================================
// Constants
// ============================================================================

const VEHICLE_ENTRY_SIZE = 0x108; // 264 bytes
const VEHICLE_LIST_HEADER_SIZE = 16; // bytes

// Reverse mappings for encoding
const RANK_TO_NUMBER: Record<Rank, number> = {
  [Rank.LEARNERS_PERMIT]: 0,
  [Rank.D_CLASS]: 1,
  [Rank.C_CLASS]: 2,
  [Rank.B_CLASS]: 3,
  [Rank.A_CLASS]: 4,
  [Rank.BURNOUT_LICENSE]: 5
};

const VEHICLE_TYPE_TO_NUMBER: Record<VehicleType, number> = {
  [VehicleType.CAR]: 0,
  [VehicleType.BIKE]: 1,
  [VehicleType.PLANE]: 2
};

const BOOST_TYPE_TO_NUMBER: Record<CarType, number> = {
  [CarType.SPEED]: 0,
  [CarType.AGGRESSION]: 1,
  [CarType.STUNT]: 2,
  [CarType.NONE]: 3,
  [CarType.LOCKED]: 4,
  [CarType.INVALID]: 5
};

const LIVERY_TYPE_TO_NUMBER: Record<LiveryType, number> = {
  [LiveryType.DEFAULT]: 0,
  [LiveryType.COLOUR]: 1,
  [LiveryType.PATTERN]: 2,
  [LiveryType.SILVER]: 3,
  [LiveryType.GOLD]: 4,
  [LiveryType.COMMUNITY]: 5
};

const CLASS_UNLOCK_STREAMS_REVERSE: Record<string, number> = {
  'SuperClassUnlock': 0x0470A5BF,
  'MuscleClassUnlock': 0x48346FEF,
  'F1ClassUnlock': 0x817B91D9,
  'TunerClassUnlock': 0xA3E2D8C9,
  'HotRodClassUnlock': 0xB3845465,
  'RivalGen': 0xEBE39AE9
};

const AI_MUSIC_STREAMS_REVERSE: Record<string, number> = {
  'AI_Muscle_music1': 0xA9813C9D,
  'AI_Truck_music1': 0xCB72AEA7,
  'AI_Tuner_music1': 0x284D944B,
  'AI_Sedan_music1': 0xD95C2309,
  'AI_Exotic_music1': 0x8A1A90E9,
  'AI_Super_music1': 0xB12A34DD
};

// ============================================================================
// Main Writer Functions
// ============================================================================

/**
 * Writes vehicle list data to binary format
 */
export function writeVehicleList(
  vehicles: VehicleListEntry[], 
  littleEndian: boolean = true
): Uint8Array {
  const totalSize = VEHICLE_LIST_HEADER_SIZE + (vehicles.length * VEHICLE_ENTRY_SIZE);
  const buffer = new ArrayBuffer(totalSize);
  const writer = new BufferWriter(buffer, { 
    endianness: littleEndian ? 'little' : 'big' 
  });

  // Write header
  writeVehicleListHeader(writer, vehicles.length);

  // Write vehicle entries
  for (const vehicle of vehicles) {
    writeVehicleEntry(writer, vehicle);
  }

  return new Uint8Array(buffer);
}

/**
 * Writes the vehicle list header
 */
function writeVehicleListHeader(writer: BufferWriter, numVehicles: number): void {
  // Vehicle list header format (matches VehicleListHeaderSchema):
  // uint32 numVehicles
  // uint32 startOffset (16 for header size)
  // uint32 unknown1 (padding)
  // uint32 unknown2 (padding)
  
  writer.writeUint32(numVehicles);
  writer.writeUint32(16); // startOffset - header is 16 bytes
  writer.writeUint32(0);  // unknown1/padding
  writer.writeUint32(0);  // unknown2/padding
}

/**
 * Writes a single vehicle entry
 */
function writeVehicleEntry(writer: BufferWriter, vehicle: VehicleListEntry): void {
  // Write vehicle ID (8 bytes)
  writeCgsId(writer, vehicle.id);
  
  // Write parent ID (8 bytes)
  writeCgsId(writer, vehicle.parentId);
  
  // Write wheel name (32 bytes)
  writeString32(writer, vehicle.wheelName);
  
  // Write vehicle name (64 bytes)
  writeString64(writer, vehicle.vehicleName);
  
  // Write manufacturer (32 bytes)
  writeString32(writer, vehicle.manufacturer);
  
  // Write gameplay data (16 bytes)
  writeGamePlayData(writer, vehicle.gamePlayData);
  
  // Write attribute collection key (8 bytes)
  writeU64(writer, vehicle.attribCollectionKey);
  
  // Write audio data (40 bytes)
  writeAudioData(writer, vehicle.audioData);
  
  // Write unknown data (16 bytes)
  for (let i = 0; i < 16; i++) {
    writer.writeUint8(0);
  }
  
  // Write category (4 bytes)
  writer.writeUint32(vehicle.category);
  
  // Write vehicle and boost type (1 byte combined)
  const vehicleTypeNum = VEHICLE_TYPE_TO_NUMBER[vehicle.vehicleType] || 0;
  const boostTypeNum = BOOST_TYPE_TO_NUMBER[vehicle.boostType] || 0;
  const combinedType = (vehicleTypeNum << 4) | (boostTypeNum & 0xF);
  writer.writeUint8(combinedType);
  
  // Write livery type (1 byte)
  writer.writeUint8(LIVERY_TYPE_TO_NUMBER[vehicle.liveryType] || 0);
  
  // Write speeds and stats (6 bytes)
  writer.writeUint8(vehicle.topSpeedNormal);
  writer.writeUint8(vehicle.topSpeedBoost);
  writer.writeUint8(vehicle.topSpeedNormalGUIStat); // Raw value for perfect round-trip
  writer.writeUint8(vehicle.topSpeedBoostGUIStat); // Raw value for perfect round-trip
  writer.writeUint8(vehicle.colorIndex);
  writer.writeUint8(vehicle.paletteIndex);
  
  // Write final padding (4 bytes)
  for (let i = 0; i < 4; i++) {
    writer.writeUint8(0);
  }
}

/**
 * Writes gameplay data structure
 */
function writeGamePlayData(writer: BufferWriter, data: VehicleListEntryGamePlayData): void {
  writer.writeFloat32(data.damageLimit);  // 4 bytes
  writer.writeUint32(data.flags);         // 4 bytes
  writer.writeUint8(data.boostBarLength); // 1 byte
  writer.writeUint8(RANK_TO_NUMBER[data.unlockRank] || 0); // 1 byte
  writer.writeUint8(data.boostCapacity);  // 1 byte
  writer.writeUint8(data.strengthStat);   // 1 byte
  writer.writeUint32(0);                  // 4 bytes padding (padding0 field)
}

/**
 * Writes audio data structure
 */
function writeAudioData(writer: BufferWriter, data: VehicleListEntryAudioData): void {
  // Exhaust name (8 bytes)
  writeCgsId(writer, data.exhaustName);
  
  // Exhaust entity key (8 bytes)
  writeU64(writer, data.exhaustEntityKey);
  
  // Engine entity key (8 bytes)
  writeU64(writer, data.engineEntityKey);
  
  // Engine name (8 bytes)
  writeCgsId(writer, data.engineName);
  
  // Rival unlock hash (4 bytes)
  const rivalUnlockHash = CLASS_UNLOCK_STREAMS_REVERSE[data.rivalUnlockName] || 
    (data.rivalUnlockName.startsWith('0x') ? parseInt(data.rivalUnlockName, 16) : 0);
  writer.writeUint32(rivalUnlockHash);
  
  // Padding1 (4 bytes)
  writer.writeUint32(0);
  
  // Won car voice over key (8 bytes)
  writeU64(writer, data.wonCarVoiceOverKey);
  
  // Rival released voice over key (8 bytes)
  writeU64(writer, data.rivalReleasedVoiceOverKey);
  
  // AI music hash (4 bytes)
  const musicHash = AI_MUSIC_STREAMS_REVERSE[data.aiMusicLoopContentSpec] ||
    (data.aiMusicLoopContentSpec.startsWith('0x') ? parseInt(data.aiMusicLoopContentSpec, 16) : 0);
  writer.writeUint32(musicHash);
  
  // AI exhaust indices (3 bytes)
  writer.writeUint8(data.aiExhaustIndex);
  writer.writeUint8(data.aiExhaustIndex2ndPick);
  writer.writeUint8(data.aiExhaustIndex3rdPick);
  
  // Padding (1 byte)
  writer.writeUint8(0);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Encrypts a string into the CGS ID format using the exact algorithm from EncryptedString.cs
 */
function encryptStringToCgsId(str: string): bigint {
  if (!str || str.trim() === '') {
    return 0n;
  }
  
  // Limit to 12 characters max (as per C# implementation)
  if (str.length > 12) {
    str = str.substring(0, 12);
  }
  
  // Convert to ASCII bytes
  const bytes = new TextEncoder().encode(str);
  
  let current = 0n;
  
  // Process each byte position (0 to 11)
  for (let index = 0; index < 12; index++) {
    let c = 0;
    if (index < bytes.length) {
      c = bytes[index];
    }
    
    let mod = 0;
    
    // Map character to mod value (exact algorithm from C#)
    if (c === 0x20) { // ' '
      mod = 0;
    } else if (c === 0x2D) { // '-'
      mod = 1;
    } else if (c === 0x2F) { // '/'
      mod = 2;
    } else if (c === 0x5F) { // '_'
      mod = 39;
    } else if (c >= 0x2D && c < 0x34) { // '-' to '3'
      mod = c - 0x2D;
    } else if (c >= 0x34 && c <= 0x39) { // '4' to '9'
      mod = c - 0x34 + 7;
    } else if (c >= 0x41 && c <= 0x5A) { // 'A' to 'Z'
      mod = c - 0x34;
    } else if (c >= 0x61 && c <= 0x7A) { // 'a' to 'z' - convert to uppercase
      mod = (c - 0x20) - 0x34; // Convert to uppercase then map
    } else {
      // Default to 0 for other characters
      mod = 0;
    }
    
    current = current * 0x28n + BigInt(mod);
  }
  
  return current;
}

/**
 * Writes a CGS ID (8 bytes)
 */
function writeCgsId(writer: BufferWriter, id: string): void {
  const encrypted = encryptStringToCgsId(id);
  
  // Write as little-endian 64-bit integer
  const low = Number(encrypted & 0xFFFFFFFFn);
  const high = Number(encrypted >> 32n);
  
  writer.writeUint32(low);
  writer.writeUint32(high);
}

/**
 * Writes a 32-byte null-terminated string
 */
function writeString32(writer: BufferWriter, str: string): void {
  const bytes = new TextEncoder().encode(str.padEnd(32, '\0').substring(0, 32));
  for (let i = 0; i < 32; i++) {
    writer.writeUint8(bytes[i] || 0);
  }
}

/**
 * Writes a 64-byte null-terminated string
 */
function writeString64(writer: BufferWriter, str: string): void {
  const bytes = new TextEncoder().encode(str.padEnd(64, '\0').substring(0, 64));
  for (let i = 0; i < 64; i++) {
    writer.writeUint8(bytes[i] || 0);
  }
}

/**
 * Writes a 64-bit integer (8 bytes)
 */
function writeU64(writer: BufferWriter, value: bigint): void {
  // Write as little-endian 64-bit integer
  const low = Number(value & 0xFFFFFFFFn);
  const high = Number(value >> 32n);
  
  writer.writeUint32(low);
  writer.writeUint32(high);
}

/**
 * Calculates the total size needed for a vehicle list
 */
export function calculateVehicleListSize(vehicleCount: number): number {
  return VEHICLE_LIST_HEADER_SIZE + (vehicleCount * VEHICLE_ENTRY_SIZE);
}

/**
 * Validates a vehicle entry before writing
 */
export function validateVehicleEntry(vehicle: VehicleListEntry): string[] {
  const errors: string[] = [];

  if (!vehicle.id || vehicle.id.trim() === '') {
    errors.push('Vehicle ID cannot be empty');
  }

  if (!vehicle.vehicleName || vehicle.vehicleName.trim() === '') {
    errors.push('Vehicle name cannot be empty');
  }

  if (!vehicle.manufacturer || vehicle.manufacturer.trim() === '') {
    errors.push('Manufacturer cannot be empty');
  }

  if (!vehicle.wheelName || vehicle.wheelName.trim() === '') {
    errors.push('Wheel name cannot be empty');
  }

  if (vehicle.gamePlayData.damageLimit <= 0) {
    errors.push('Damage limit must be greater than 0');
  }

  if (vehicle.topSpeedNormalGUIStat < 1 || vehicle.topSpeedNormalGUIStat > 10) {
    errors.push('Speed GUI stat must be between 1 and 10');
  }

  if (vehicle.topSpeedBoostGUIStat < 1 || vehicle.topSpeedBoostGUIStat > 10) {
    errors.push('Boost GUI stat must be between 1 and 10');
  }

  return errors;
} 