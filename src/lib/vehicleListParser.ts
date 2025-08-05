import { extractResourceSize, parseBundle, type ResourceEntry } from './bundleParser';

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

function decodeCgsId(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < 8; i++) {
    const b = bytes[i];
    if (b === 0) break;
    result += String.fromCharCode(b);
  }
  return result;
}

function decodeString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  return new TextDecoder().decode(bytes.slice(0, end));
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

export function parseVehicleList(
  buffer: ArrayBuffer,
  resource: ResourceEntry,
  littleEndian = true
): VehicleListEntry[] {
  let data = getResourceData(buffer, resource);
  if (data.byteLength === 0) return [];

  const magic = new TextDecoder().decode(data.subarray(0, 4));
  if (magic === 'bnd2') {
    const innerBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    const bundle = parseBundle(innerBuffer);
    const innerResource =
      bundle.resources.find(r => r.resourceTypeId === resource.resourceTypeId) ??
      bundle.resources[0];
    if (!innerResource) return [];
    data = getResourceData(innerBuffer, innerResource);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Header: [vehicle count][start offset][unknown1][unknown2] 
  const numVehicles = view.getUint32(0, !littleEndian); // Console is big endian
  const startOffset = view.getUint32(4, !littleEndian);
  const unknown1 = view.getUint32(8, !littleEndian);
  const unknown2 = view.getUint32(12, !littleEndian);

  console.debug('Vehicle list header', {
    numVehicles,
    startOffset,
    unknown1,
    unknown2,
    dataLength: data.byteLength,
    littleEndian
  });

  // Each vehicle entry is 264 bytes (0x108)
  const entrySize = 0x108;
  
  if (numVehicles * entrySize + 16 > data.byteLength) {
    console.warn('Vehicle list data appears corrupt or truncated');
    return [];
  }

  const entries: VehicleListEntry[] = [];

  for (let i = 0; i < numVehicles; i++) {
    const base = 16 + i * entrySize; // Start after 16-byte header
    if (base + entrySize > data.byteLength) {
      console.warn('Vehicle entry outside buffer bounds', {
        index: i,
        base,
        entrySize,
        dataLength: data.byteLength
      });
      break;
    }
    const entryBytes = new Uint8Array(data.buffer, data.byteOffset + base, entrySize);
    const entryView = new DataView(data.buffer, data.byteOffset + base, entrySize);

    // Based on the C# implementation: each entry starts with ID (8 bytes) + ParentID (8 bytes)
    const id = decodeCgsId(entryBytes.subarray(0, 8));
    const parentId = decodeCgsId(entryBytes.subarray(8, 16));
    const wheelName = decodeString(entryBytes.subarray(16, 48)); // 32 bytes
    const vehicleName = decodeString(entryBytes.subarray(48, 112)); // 64 bytes  
    const manufacturer = decodeString(entryBytes.subarray(112, 144)); // 32 bytes

    // Gameplay data starts at offset 144 (0x90)
    const gamePlayData: VehicleListEntryGamePlayData = {
      damageLimit: entryView.getFloat32(144, !littleEndian),
      flags: entryView.getUint32(148, !littleEndian),
      boostBarLength: entryView.getUint8(152),
      unlockRank: entryView.getUint8(153) as Rank,
      boostCapacity: entryView.getUint8(154),
      strengthStat: entryView.getUint8(155)
    };

    // Padding at 156 (4 bytes)
    const attribCollectionKey = entryView.getBigInt64(160, !littleEndian); // offset 160 (0xA0)

    // Audio data starts at offset 168 (0xA8)
    const audioBase = 168;
    const exhaustNameBytes = entryBytes.subarray(audioBase, audioBase + 8);
    const exhaustEntityKey = entryView.getBigInt64(audioBase + 8, !littleEndian);
    const engineEntityKey = entryView.getBigInt64(audioBase + 16, !littleEndian);
    const engineNameBytes = entryBytes.subarray(audioBase + 24, audioBase + 32);
    const rivalUnlockHash = entryView.getUint32(audioBase + 32, !littleEndian);
    const wonCarVoiceOverKey = entryView.getBigInt64(audioBase + 40, !littleEndian);
    const rivalReleasedVoiceOverKey = entryView.getBigInt64(audioBase + 48, !littleEndian);
    const musicHash = entryView.getUint32(audioBase + 56, !littleEndian);
    const aiExhaustIndex = entryView.getUint8(audioBase + 60) as AIEngineStream;
    const aiExhaustIndex2ndPick = entryView.getUint8(audioBase + 61) as AIEngineStream;
    const aiExhaustIndex3rdPick = entryView.getUint8(audioBase + 62) as AIEngineStream;
    
    const audioData: VehicleListEntryAudioData = {
      exhaustName: decodeCgsId(exhaustNameBytes),
      exhaustEntityKey,
      engineEntityKey,
      engineName: decodeCgsId(engineNameBytes),
      rivalUnlockName: CLASS_UNLOCK_STREAMS[rivalUnlockHash] ?? `0x${rivalUnlockHash.toString(16).toUpperCase()}`,
      wonCarVoiceOverKey,
      rivalReleasedVoiceOverKey,
      aiMusicLoopContentSpec: AI_MUSIC_STREAMS[musicHash] ?? `0x${musicHash.toString(16).toUpperCase()}`,
      aiExhaustIndex,
      aiExhaustIndex2ndPick,
      aiExhaustIndex3rdPick
    };

    // Skip Unknown fields at offsets 232-247 (16 bytes)
    const category = entryView.getUint32(248, !littleEndian); // offset 248 (0xF8)
    const carTypeByte = entryView.getUint8(252); // offset 252 (0xFC)
    const vehicleType = (carTypeByte >> 4) as VehicleType; // High nibble
    const boostType = (carTypeByte & 0x0f) as CarType; // Low nibble
    const liveryType = entryView.getUint8(253) as LiveryType; // offset 253 (0xFD)
    const topSpeedNormal = entryView.getUint8(254); // offset 254 (0xFE)
    const topSpeedBoost = entryView.getUint8(255); // offset 255 (0xFF)
    const topSpeedNormalGUIStat = entryView.getUint8(256); // offset 256 (0x100)
    const topSpeedBoostGUIStat = entryView.getUint8(257); // offset 257 (0x101)
    const colorIndex = entryView.getUint8(258); // offset 258 (0x102)
    const paletteIndex = entryView.getUint8(259); // offset 259 (0x103)

    entries.push({
      id,
      parentId,
      wheelName,
      vehicleName,
      manufacturer,
      gamePlayData,
      attribCollectionKey,
      audioData,
      category,
      vehicleType,
      boostType,
      liveryType,
      topSpeedNormal,
      topSpeedBoost,
      topSpeedNormalGUIStat,
      topSpeedBoostGUIStat,
      colorIndex,
      paletteIndex
    });
  }

  return entries;
}
