// Burnout Paradise Bundle 2 format parser using typed-binary
// Based on specifications from https://burnout.wiki/wiki/Bundle_2/Burnout_Paradise

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

// Platform constants
export const PLATFORMS = {
  PC: 1,
  XBOX360: 2,
  PS3: 3,
} as const;

// Flag constants
export const BUNDLE_FLAGS = {
  COMPRESSED: 0x1,
  MAIN_MEM_OPTIMISED: 0x2,
  GRAPHICS_MEM_OPTIMISED: 0x4,
  HAS_DEBUG_DATA: 0x8,
} as const;

// Memory type names by platform
export const MEMORY_TYPES = {
  [PLATFORMS.PC]: ['Main Memory', 'Disposable', 'Dummy'],
  [PLATFORMS.XBOX360]: ['Main Memory', 'Physical', 'Dummy'],
  [PLATFORMS.PS3]: ['Main Memory', 'Graphics System', 'Graphics Local'],
} as const;

// Custom 64-bit integer schema (using two 32-bit values)
const u64Schema = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
function u64ToBigInt(u64: Parsed<typeof u64Schema>): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// Bundle header schema (52 bytes)
export const BundleHeaderSchema = object({
  magic: string,               // 4 bytes - should be 'bnd2'
  version: u32,               // 4 bytes - should be 2
  platform: u32,              // 4 bytes - PC/Xbox360/PS3
  debugDataOffset: u32,        // 4 bytes
  resourceEntriesCount: u32,   // 4 bytes
  resourceEntriesOffset: u32,  // 4 bytes
  resourceDataOffsets: arrayOf(u32, 3), // 12 bytes - Main, Secondary, Tertiary memory types
  flags: u32                   // 4 bytes
});

// Resource entry schema (80 bytes)
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

// Import entry schema (16 bytes)
export const ImportEntrySchema = object({
  resourceId: u64Schema,       // 8 bytes
  offset: u32,                 // 4 bytes
  padding: u32                 // 4 bytes - padding
});

// TypeScript types
export type BundleHeader = Parsed<typeof BundleHeaderSchema>;
export type ResourceEntry = Omit<Parsed<typeof ResourceEntrySchema>, 'resourceId' | 'importHash'> & {
  resourceId: bigint;
  importHash: bigint;
};
export type ImportEntry = Omit<Parsed<typeof ImportEntrySchema>, 'resourceId' | 'padding'> & {
  resourceId: bigint;
};

export interface ParsedBundle {
  header: BundleHeader;
  resources: ResourceEntry[];
  imports: ImportEntry[];
  debugData?: string;
}

export function parseBundle(buffer: ArrayBuffer): ParsedBundle {
  const reader = new BufferReader(buffer, { endianness: 'little' });

  // Parse header - read 4 bytes for magic string first
  const magicBytes = new Uint8Array(buffer, 0, 4);
  const magic = new TextDecoder().decode(magicBytes);
  
  reader.seekTo(4); // Skip past magic string
  const headerRest = object({
    version: u32,
    platform: u32,
    debugDataOffset: u32,
    resourceEntriesCount: u32,
    resourceEntriesOffset: u32,
    resourceDataOffsets: arrayOf(u32, 3),
    flags: u32
  }).read(reader);

  const header: BundleHeader = {
    magic,
    ...headerRest
  };

  // Validate header
  if (header.magic !== 'bnd2') {
    throw new Error(`Invalid bundle magic: ${header.magic}`);
  }
  if (header.version !== 2) {
    throw new Error(`Unsupported bundle version: ${header.version}`);
  }

  // Parse resource entries
  const resources: ResourceEntry[] = [];
  reader.seekTo(header.resourceEntriesOffset);

  for (let i = 0; i < header.resourceEntriesCount; i++) {
    const rawResource = ResourceEntrySchema.read(reader);
    const resource: ResourceEntry = {
      ...rawResource,
      resourceId: u64ToBigInt(rawResource.resourceId),
      importHash: u64ToBigInt(rawResource.importHash)
    };
    resources.push(resource);
  }

  // Parse imports
  const imports: ImportEntry[] = [];
  for (const resource of resources) {
    if (resource.importCount > 0) {
      reader.seekTo(resource.importOffset);
      for (let i = 0; i < resource.importCount; i++) {
        const rawImport = ImportEntrySchema.read(reader);
        const importEntry: ImportEntry = {
          resourceId: u64ToBigInt(rawImport.resourceId),
          offset: rawImport.offset
        };
        imports.push(importEntry);
      }
    }
  }

  // Parse debug data if present
  let debugData: string | undefined;
  if (header.flags & BUNDLE_FLAGS.HAS_DEBUG_DATA && header.debugDataOffset > 0) {
    const remaining = buffer.byteLength - header.debugDataOffset;
    const debugBytes = new Uint8Array(buffer, header.debugDataOffset, remaining);
    debugData = new TextDecoder().decode(debugBytes);
    // Clean up the string - remove null bytes and trim
    debugData = debugData.replace(/\0/g, '').trim();
  }

  return {
    header,
    resources,
    imports,
    debugData
  };
}

// Helper functions
export function getPlatformName(platform: number): string {
  switch (platform) {
    case PLATFORMS.PC: return 'PC';
    case PLATFORMS.XBOX360: return 'Xbox 360';
    case PLATFORMS.PS3: return 'PlayStation 3';
    default: return `Unknown (${platform})`;
  }
}

export function getMemoryTypeName(platform: number, memoryIndex: number): string {
  const types = MEMORY_TYPES[platform as keyof typeof MEMORY_TYPES];
  return types?.[memoryIndex] || `Unknown Memory Type ${memoryIndex}`;
}

export function getFlagNames(flags: number): string[] {
  const flagNames: string[] = [];
  if (flags & BUNDLE_FLAGS.COMPRESSED) flagNames.push('Compressed');
  if (flags & BUNDLE_FLAGS.MAIN_MEM_OPTIMISED) flagNames.push('Main Memory Optimised');
  if (flags & BUNDLE_FLAGS.GRAPHICS_MEM_OPTIMISED) flagNames.push('Graphics Memory Optimised');
  if (flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) flagNames.push('Has Debug Data');
  return flagNames;
}

export function extractResourceSize(sizeAndAlignment: number): number {
  // Size is stored in the lower 28 bits, alignment in upper 4 bits
  return sizeAndAlignment & 0x0FFFFFFF;
}

export function extractAlignment(sizeAndAlignment: number): number {
  // Alignment is stored in upper 4 bits as a power of 2
  const alignmentPower = (sizeAndAlignment >>> 28) & 0xF;
  return 1 << alignmentPower;
}

export function formatResourceId(resourceId: bigint): string {
  return `0x${resourceId.toString(16).toUpperCase().padStart(16, '0')}`;
}