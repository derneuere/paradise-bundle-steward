import { extractResourceSize, type ResourceEntry } from './bundleParser';

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
  0xBFA57004: 'SuperClassUnlock',
  0xEF6F3448: 'MuscleClassUnlock',
  0xD9917B81: 'F1ClassUnlock',
  0xC9D8E2A3: 'TunerClassUnlock',
  0x655484B3: 'HotRodClassUnlock',
  0xE99AE3EB: 'RivalGen'
};

export const AI_MUSIC_STREAMS: Record<number, string> = {
  0x9D3C81A9: 'AI_Muscle_music1',
  0xA7AE72CB: 'AI_Truck_music1',
  0x4B944D28: 'AI_Tuner_muisc1',
  0x09235CD9: 'AI_Sedan_music1',
  0xE9901A8A: 'AI_Exotic_music1',
  0xDD342AB1: 'AI_Super_muisc1'
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

export function parseVehicleList(buffer: ArrayBuffer, resource: ResourceEntry): VehicleListEntry[] {
  const data = getResourceData(buffer, resource);
  if (data.byteLength === 0) return [];

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let numVehicles = view.getUint32(0, true);

  // Detect 64-bit layout where the first field is a pointer
  if (numVehicles > 1000) {
    numVehicles = view.getUint32(8, true);
  }

  const entries: VehicleListEntry[] = [];
  const entrySize = 0x108; // 264 bytes per entry
  const offset = 0x10; // entries start after resource header

  for (let i = 0; i < numVehicles; i++) {
    const base = offset + i * entrySize;
    const entryBytes = new Uint8Array(data.buffer, data.byteOffset + base, entrySize);
    const entryView = new DataView(data.buffer, data.byteOffset + base, entrySize);

    const id = decodeCgsId(entryBytes.subarray(0, 8));
    const parentId = decodeCgsId(entryBytes.subarray(8, 16));
    const wheelName = decodeString(entryBytes.subarray(0x10, 0x10 + 32));
    const vehicleName = decodeString(entryBytes.subarray(0x30, 0x30 + 64));
    const manufacturer = decodeString(entryBytes.subarray(0x70, 0x70 + 32));

    // Gameplay data
    const gamePlayView = new DataView(entryBytes.buffer, entryBytes.byteOffset + 0x90, 0x0C);
    const gamePlayData: VehicleListEntryGamePlayData = {
      damageLimit: gamePlayView.getFloat32(0, true),
      flags: gamePlayView.getUint32(4, true),
      boostBarLength: gamePlayView.getUint8(8),
      unlockRank: gamePlayView.getUint8(9) as Rank,
      boostCapacity: gamePlayView.getUint8(10),
      strengthStat: gamePlayView.getUint8(11)
    };

    const attribCollectionKey = entryView.getBigUint64(0xA0, true);

    // Audio data
    const audioBase = 0xA8;
    const rivalUnlockHash = entryView.getUint32(audioBase + 0x20, true);
    const musicHash = entryView.getUint32(audioBase + 0x38, true);
    const audioData: VehicleListEntryAudioData = {
      exhaustName: decodeCgsId(entryBytes.subarray(audioBase, audioBase + 8)),
      exhaustEntityKey: entryView.getBigUint64(audioBase + 0x8, true),
      engineEntityKey: entryView.getBigUint64(audioBase + 0x10, true),
      engineName: decodeCgsId(entryBytes.subarray(audioBase + 0x18, audioBase + 0x20)),
      rivalUnlockName: CLASS_UNLOCK_STREAMS[rivalUnlockHash] ?? `0x${rivalUnlockHash.toString(16).toUpperCase()}`,
      wonCarVoiceOverKey: entryView.getBigUint64(audioBase + 0x28, true),
      rivalReleasedVoiceOverKey: entryView.getBigUint64(audioBase + 0x30, true),
      aiMusicLoopContentSpec: AI_MUSIC_STREAMS[musicHash] ?? `0x${musicHash.toString(16).toUpperCase()}`,
      aiExhaustIndex: entryView.getUint8(audioBase + 0x3C) as AIEngineStream,
      aiExhaustIndex2ndPick: entryView.getUint8(audioBase + 0x3D) as AIEngineStream,
      aiExhaustIndex3rdPick: entryView.getUint8(audioBase + 0x3E) as AIEngineStream
    };

    const category = entryView.getUint32(0xF8, true);
    const carTypeByte = entryView.getUint8(0xFC);
    const vehicleType = (carTypeByte >> 4) as VehicleType;
    const boostType = (carTypeByte & 0x0F) as CarType;
    const liveryType = entryView.getUint8(0xFD) as LiveryType;
    const topSpeedNormal = entryView.getUint8(0xFE);
    const topSpeedBoost = entryView.getUint8(0xFF);
    const topSpeedNormalGUIStat = entryView.getUint8(0x100);
    const topSpeedBoostGUIStat = entryView.getUint8(0x101);
    const colorIndex = entryView.getUint8(0x102);
    const paletteIndex = entryView.getUint8(0x103);

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
