// Centralized typed-binary schemas for bundle format
// These schemas are used for both reading and writing bundle files

import { 
  object, 
  arrayOf, 
  string, 
  u8, 
  u16, 
  u32, 
  f32, 
  type Parsed
} from 'typed-binary';

// ============================================================================
// Core Schemas
// ============================================================================

// 4-byte fixed magic (e.g., "bnd2")
export const Magic4Schema = arrayOf(u8, 4);

export function magicBytesToString(bytes: Parsed<typeof Magic4Schema>): string {
  const arr = Uint8Array.from(bytes);
  return new TextDecoder().decode(arr);
}

export function stringToMagicBytes(magic: string): Parsed<typeof Magic4Schema> {
  const out: number[] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    out[i] = i < magic.length ? magic.charCodeAt(i) & 0xFF : 0;
  }
  return out as Parsed<typeof Magic4Schema>;
}

// Custom 64-bit integer schema (using two 32-bit values)
export const u64Schema = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
export function u64ToBigInt(u64: Parsed<typeof u64Schema>): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// Helper function to convert array of 8 bytes to bigint (little-endian)
export function bytesToBigInt(bytes: number[]): bigint {
  if (bytes.length !== 8) {
    throw new Error(`Expected 8 bytes, got ${bytes.length}`);
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * 8n);
  }
  return value;
}

// Helper function to convert bigint to u64 object
export function bigIntToU64(value: bigint): Parsed<typeof u64Schema> {
  return {
    low: Number(value & 0xFFFFFFFFn),
    high: Number((value >> 32n) & 0xFFFFFFFFn)
  };
}

// ============================================================================
// Bundle Header Schema (52 bytes)
// ============================================================================

export const BundleHeaderSchema = object({
  // magic field is handled separately as it's a fixed string
  version: u32,               // 4 bytes - should be 2
  platform: u32,              // 4 bytes - PC/Xbox360/PS3
  debugDataOffset: u32,        // 4 bytes
  resourceEntriesCount: u32,   // 4 bytes
  resourceEntriesOffset: u32,  // 4 bytes
  resourceDataOffsets: arrayOf(u32, 3), // 12 bytes - Main, Secondary, Tertiary memory types
  flags: u32                   // 4 bytes
});

// Header schema including magic prefix for convenience
export const BundleHeaderWithMagicSchema = object({
  magic: Magic4Schema,         // 4 bytes, typically "bnd2"
  version: u32,
  platform: u32,
  debugDataOffset: u32,
  resourceEntriesCount: u32,
  resourceEntriesOffset: u32,
  resourceDataOffsets: arrayOf(u32, 3),
  flags: u32
});

// ============================================================================
// Resource Entry Schema (80 bytes)
// ============================================================================

export const ResourceEntrySchema = object({
  resourceId: u64Schema,       // 8 bytes
  importHash: u64Schema,       // 8 bytes
  uncompressedSizeAndAlignment: arrayOf(u32, 3), // 12 bytes
  sizeAndAlignmentOnDisk: arrayOf(u32, 3),       // 12 bytes
  diskOffsets: arrayOf(u32, 3),                  // 12 bytes
  importOffset: u32,           // 4 bytes
  resourceTypeId: u32,         // 4 bytes
  importCount: u16,            // 2 bytes
  flags: u8,                   // 1 byte
  streamIndex: u8              // 1 byte
});

// ============================================================================
// Import Entry Schema (16 bytes)
// ============================================================================

export const ImportEntrySchema = object({
  resourceId: u64Schema,       // 8 bytes
  offset: u32,                 // 4 bytes
  padding: u32                 // 4 bytes - padding
});

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
  exhaustEntityKey: u64Schema,
  engineEntityKey: u64Schema,
  engineNameBytes: cgsIdSchema,
  rivalUnlockHash: u32,
  padding1: u32,
  wonCarVoiceOverKey: u64Schema,
  rivalReleasedVoiceOverKey: u64Schema,
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
  attribCollectionKey: u64Schema,
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
// Player Car Colors Schemas
// ============================================================================

// Vector4 schema for RGBA color values
export const Vector4Schema = object({
  red: f32,
  green: f32,
  blue: f32,
  alpha: f32
});

// Alias: raw player color (RGBA float) as a schema
export const PlayerCarColorSchema = Vector4Schema;

// PlayerCarColourPalette schema for 32-bit architecture
export const PlayerCarColourPalette32Schema = object({
  mpPaintColours: u32,
  mpPearlColours: u32,
  miNumColours: u32
});

// PlayerCarColourPalette schema for 64-bit architecture
export const PlayerCarColourPalette64Schema = object({
  mpPaintColours: u64Schema,
  mpPearlColours: u64Schema,
  miNumColours: u32,
  padding: u32
});

// GlobalColourPalette schema for 32-bit (5 palettes)
export const GlobalColourPalette32Schema = object({
  mItems: arrayOf(PlayerCarColourPalette32Schema, 5)
});

// GlobalColourPalette schema for 64-bit (5 palettes) 
export const GlobalColourPalette64Schema = object({
  mItems: arrayOf(PlayerCarColourPalette64Schema, 5)
});

// ============================================================================
// Schema Validation Helpers
// ============================================================================

export function validateSchemaSize(schema: object, expectedSize: number): boolean {
  // This would need to be implemented based on typed-binary's capabilities
  // For now, we'll use known sizes from the Bundle Manager reference
  return true;
}

// Known schema sizes for validation
export const SCHEMA_SIZES = {
  BundleHeader: 48, // Total header size including 4-byte magic
  ResourceEntry: 80,
  ImportEntry: 16,
  VehicleListHeader: 16,
  VehicleEntry: 264,
  GamePlayData: 16,
  AudioData: 64,
  Vector4: 16,
  PlayerCarColourPalette32: 12,
  PlayerCarColourPalette64: 24,
  GlobalColourPalette32: 60,
  GlobalColourPalette64: 120
} as const;

// ============================================================================
// Bundle Writing Schemas
// ============================================================================

// Entry block schema for writing (matches the bundleWriter EntryBlock interface)
export const EntryBlockWriteSchema = object({
  compressed: u8,  // Convert boolean to byte
  compressedSize: u32,
  uncompressedSize: u32,
  uncompressedAlignment: u32
  // Note: data is handled separately as it can be large and variable
});

// Bundle entry schema for writing (matches bundleWriter BundleEntry interface)
export const BundleEntryWriteSchema = object({
  id: u64Schema,
  references: u64Schema,
  // entryBlocks handled separately
  dependenciesListOffset: u32,
  type: u32,
  dependencyCount: u32
});

// Resource string table schema
export const ResourceStringTableSchema = object({
  content: string  // Null-terminated string
});

// Complete bundle structure schema for organized writing
export const BundleWriteSchema = object({
  header: BundleHeaderSchema,
  // RST, entries, and data handled as separate write operations due to size
});

// ============================================================================
// Writing Helper Functions
// ============================================================================

export function createEmptyBundleHeader(): Parsed<typeof BundleHeaderSchema> {
  return {
    version: 2,
    platform: 1, // PC
    debugDataOffset: 0,
    resourceEntriesCount: 0,
    resourceEntriesOffset: 0,
    resourceDataOffsets: [0, 0, 0],
    flags: 0
  };
}

export function createEmptyResourceEntry(): Omit<Parsed<typeof ResourceEntrySchema>, 'resourceId' | 'importHash'> & {
  resourceId: bigint;
  importHash: bigint;
} {
  return {
    resourceId: 0n,
    importHash: 0n,
    uncompressedSizeAndAlignment: [0, 0, 0],
    sizeAndAlignmentOnDisk: [0, 0, 0],
    diskOffsets: [0, 0, 0],
    importOffset: 0,
    resourceTypeId: 0,
    importCount: 0,
    flags: 0,
    streamIndex: 0
  };
}

// Convert bigint to schema format for writing
export function bundleEntryToSchema(entry: {
  id: bigint;
  references: bigint;
  dependenciesListOffset: number;
  type: number;
  dependencyCount: number;
}): Parsed<typeof BundleEntryWriteSchema> {
  return {
    id: bigIntToU64(entry.id),
    references: bigIntToU64(entry.references),
    dependenciesListOffset: entry.dependenciesListOffset,
    type: entry.type,
    dependencyCount: entry.dependencyCount
  };
}

// Convert resource entry to schema format
export function resourceEntryToSchema(entry: {
  resourceId: bigint;
  importHash: bigint;
  uncompressedSizeAndAlignment: number[];
  sizeAndAlignmentOnDisk: number[];
  diskOffsets: number[];
  importOffset: number;
  resourceTypeId: number;
  importCount: number;
  flags: number;
  streamIndex: number;
}): Parsed<typeof ResourceEntrySchema> {
  return {
    resourceId: bigIntToU64(entry.resourceId),
    importHash: bigIntToU64(entry.importHash),
    uncompressedSizeAndAlignment: entry.uncompressedSizeAndAlignment.slice(0, 3) as [number, number, number],
    sizeAndAlignmentOnDisk: entry.sizeAndAlignmentOnDisk.slice(0, 3) as [number, number, number],
    diskOffsets: entry.diskOffsets.slice(0, 3) as [number, number, number],
    importOffset: entry.importOffset,
    resourceTypeId: entry.resourceTypeId,
    importCount: entry.importCount,
    flags: entry.flags,
    streamIndex: entry.streamIndex
  };
} 

// ============================================================================
// Schema Factories for Fixed-Length Collections
// ============================================================================

// Fixed-length resource entries array
export function makeResourceEntriesSchema(count: number) {
  return arrayOf(ResourceEntrySchema, count);
}

// Fixed-length import entries array
export function makeImportEntriesSchema(count: number) {
  return arrayOf(ImportEntrySchema, count);
}

// Vehicle list with known count
export function makeVehicleListSchema(count: number) {
  return object({
    header: VehicleListHeaderSchema,
    entries: arrayOf(VehicleEntrySchema, count)
  });
}