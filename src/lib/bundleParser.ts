// Burnout Paradise Bundle 2 format parser
// Based on specifications from https://burnout.wiki/wiki/Bundle_2/Burnout_Paradise

export interface BundleHeader {
  magic: string;
  version: number;
  platform: number;
  debugDataOffset: number;
  resourceEntriesCount: number;
  resourceEntriesOffset: number;
  resourceDataOffsets: [number, number, number]; // Main, Secondary, Tertiary memory types
  flags: number;
}

export interface ResourceEntry {
  resourceId: bigint;
  importHash: bigint;
  uncompressedSizeAndAlignment: [number, number, number];
  sizeAndAlignmentOnDisk: [number, number, number];
  diskOffsets: [number, number, number];
  importOffset: number;
  resourceTypeId: number;
  importCount: number;
  flags: number;
  streamIndex: number;
}

export interface ImportEntry {
  resourceId: bigint;
  offset: number;
}

export interface ParsedBundle {
  header: BundleHeader;
  resources: ResourceEntry[];
  imports: ImportEntry[];
  debugData?: string;
}

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

class BinaryReader {
  private view: DataView;
  private offset: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    const value = this.view.getUint16(this.offset, true); // little endian
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = this.view.getUint32(this.offset, true); // little endian
    this.offset += 4;
    return value;
  }

  readUint64(): bigint {
    const low = this.view.getUint32(this.offset, true);
    const high = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    return (BigInt(high) << 32n) | BigInt(low);
  }

  readString(length: number): string {
    const bytes = new Uint8Array(this.view.buffer, this.offset, length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readNullTerminatedString(): string {
    const start = this.offset;
    while (this.offset < this.view.byteLength && this.view.getUint8(this.offset) !== 0) {
      this.offset++;
    }
    const bytes = new Uint8Array(this.view.buffer, start, this.offset - start);
    this.offset++; // skip null terminator
    return new TextDecoder().decode(bytes);
  }

  seek(position: number): void {
    this.offset = position;
  }

  tell(): number {
    return this.offset;
  }

  get eof(): boolean {
    return this.offset >= this.view.byteLength;
  }
}

export function parseBundle(buffer: ArrayBuffer): ParsedBundle {
  const reader = new BinaryReader(buffer);

  // Parse header
  const header: BundleHeader = {
    magic: reader.readString(4),
    version: reader.readUint32(),
    platform: reader.readUint32(),
    debugDataOffset: reader.readUint32(),
    resourceEntriesCount: reader.readUint32(),
    resourceEntriesOffset: reader.readUint32(),
    resourceDataOffsets: [
      reader.readUint32(),
      reader.readUint32(),
      reader.readUint32()
    ],
    flags: reader.readUint32()
  };

  // Validate header
  if (header.magic !== 'bnd2') {
    throw new Error(`Invalid bundle magic: ${header.magic}`);
  }
  if (header.version !== 2) {
    throw new Error(`Unsupported bundle version: ${header.version}`);
  }

  // Parse resource entries
  reader.seek(header.resourceEntriesOffset);
  const resources: ResourceEntry[] = [];

  for (let i = 0; i < header.resourceEntriesCount; i++) {
    const resource: ResourceEntry = {
      resourceId: reader.readUint64(),
      importHash: reader.readUint64(),
      uncompressedSizeAndAlignment: [
        reader.readUint32(),
        reader.readUint32(),
        reader.readUint32()
      ],
      sizeAndAlignmentOnDisk: [
        reader.readUint32(),
        reader.readUint32(),
        reader.readUint32()
      ],
      diskOffsets: [
        reader.readUint32(),
        reader.readUint32(),
        reader.readUint32()
      ],
      importOffset: reader.readUint32(),
      resourceTypeId: reader.readUint32(),
      importCount: reader.readUint16(),
      flags: reader.readUint8(),
      streamIndex: reader.readUint8()
    };
    resources.push(resource);
  }

  // Parse imports
  const imports: ImportEntry[] = [];
  for (const resource of resources) {
    if (resource.importCount > 0) {
      reader.seek(resource.importOffset);
      for (let i = 0; i < resource.importCount; i++) {
        const importEntry: ImportEntry = {
          resourceId: reader.readUint64(),
          offset: reader.readUint32(),
        };
        reader.readUint32(); // skip padding
        imports.push(importEntry);
      }
    }
  }

  // Parse debug data if present
  let debugData: string | undefined;
  if (header.flags & BUNDLE_FLAGS.HAS_DEBUG_DATA && header.debugDataOffset > 0) {
    reader.seek(header.debugDataOffset);
    // Debug data is XML, read until end of buffer or until we find a reasonable end
    const remaining = buffer.byteLength - header.debugDataOffset;
    debugData = reader.readString(remaining);
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