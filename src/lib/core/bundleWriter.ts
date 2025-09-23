// Bundle Writer - Constructs and writes Burnout Paradise bundle files
// Refactored to use typed-binary schemas for type safety and consistency

import { BufferWriter, BufferReader } from 'typed-binary';
import * as pako from 'pako';
import {
  BundleHeaderSchema,
  ResourceEntrySchema,
  ImportEntrySchema,
  u64Schema,
  bigIntToU64,
  resourceEntryToSchema,
  createEmptyBundleHeader
} from './schemas';
import type { Parsed } from 'typed-binary';
import type { BundleHeader, ResourceEntry, ImportEntry } from './types';
import { extractResourceSize } from '@/lib/core/resourceManager';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface BundleEntryData {
  id: bigint;
  references: bigint;
  entryBlocks: EntryBlockData[];
  dependenciesListOffset: number;
  type: number;
  dependencyCount: number;
}

export interface EntryBlockData {
  compressed: boolean;
  compressedSize: number;
  uncompressedSize: number;
  uncompressedAlignment: number;
  data: Uint8Array | null;
}

// Schema-compatible types for writing
export type BundleForWriting = {
  header: BundleHeader;
  resources: ResourceEntry[];
  imports: ImportEntry[];
  resourceStringTable?: string;
}

export interface WriteOptions {
  platform?: number;
  compress?: boolean;
  includeDebugData?: boolean;
}

export interface ProgressCallback {
  (progress: { type: string; stage: string; progress: number; message: string }): void;
}

interface BundleLayout {
  headerSize: number;
  rstOffset: number;
  rstSize: number;
  idBlockOffset: number;
  idBlockSize: number;
  dataBlockOffsets: number[];
  dataBlockSizes: number[];
  totalSize: number;
  currentPos: number;
}

// ============================================================================
// Bundle Flags (matching C# implementation)
// ============================================================================

export enum BundleFlags {
  Compressed = 1,
  UnusedFlag1 = 2, // Always set
  UnusedFlag2 = 4, // Always set
  HasResourceStringTable = 8
}

export enum BundlePlatform {
  PC = 1,
  X360 = 2,
  PS3 = 3
}

// ============================================================================
// Schema-Based Bundle Builder Class
// ============================================================================

export class BundleBuilder {
  private bundle: BundleForWriting;
  private options: WriteOptions;
  private resourceData: Map<number, Uint8Array>;

  constructor(options: WriteOptions = {}) {
    this.options = options;
    this.resourceData = new Map();

    // Initialize bundle with basic structure first
    this.bundle = {
      header: {
        magic: 'bnd2',
        version: 2,
        platform: options.platform || BundlePlatform.PC,
        debugDataOffset: 0,
        resourceEntriesCount: 0,
        resourceEntriesOffset: 0,
        resourceDataOffsets: [0, 0, 0],
        flags: this.calculateInitialFlags(options)
      },
      resources: [],
      imports: [],
      resourceStringTable: undefined
    };
  }

  private calculateInitialFlags(options: WriteOptions): number {
    let flags = BundleFlags.UnusedFlag1 | BundleFlags.UnusedFlag2; // Always set
    
    if (options.compress) {
      flags |= BundleFlags.Compressed;
    }
    
    // Note: HasResourceStringTable flag will be set when RST is actually added
    
    return flags;
  }

  // ============================================================================
  // Utility Functions
  // ============================================================================

  private get isConsole(): boolean {
    return this.bundle.header.platform === BundlePlatform.X360 || this.bundle.header.platform === BundlePlatform.PS3;
  }

  private bitScanReverse(mask: number): number {
    // Exact port of C# BitScan.BitScanReverse
    let i: number;
    for (i = 31; (mask >> i) === 0 && i >= 0; i--);
    return i;
  }

  private alignPosition(position: number, alignment: number): number {
    if (position % alignment === 0) return position;
    return alignment * Math.floor((position + (alignment - 1)) / alignment);
  }

  private writeAlignment(writer: BufferWriter, alignment: number, currentPos: number): number {
    const alignedPos = this.alignPosition(currentPos, alignment);
    const paddingNeeded = alignedPos - currentPos;
    console.log(`Padding needed: ${paddingNeeded} bytes`);
    
    for (let i = 0; i < paddingNeeded; i++) {
      writer.writeUint8(0);
    }
    
    return alignedPos;
  }

  private writeCString(writer: BufferWriter, value: string): void {
    const bytes = new TextEncoder().encode(value);
    for (const byte of bytes) {
      writer.writeUint8(byte);
    }
    writer.writeUint8(0); // null terminator
  }

  // ============================================================================
  // Entry Management (Schema-Based)
  // ============================================================================

  /**
   * Adds a resource entry to the bundle using typed data
   */
  addResourceEntry(entry: ResourceEntry): void {
    this.bundle.resources.push(entry);
    this.bundle.header.resourceEntriesCount = this.bundle.resources.length;
  }

  /**
   * Adds multiple resource entries
   */
  addResourceEntries(entries: ResourceEntry[]): void {
    this.bundle.resources.push(...entries);
    this.bundle.header.resourceEntriesCount = this.bundle.resources.length;
  }

  /**
   * Adds an import entry to the bundle
   */
  addImportEntry(entry: ImportEntry): void {
    this.bundle.imports.push(entry);
  }

  /**
   * Sets the resource string table
   */
  setResourceStringTable(rst: string): void {
    this.bundle.resourceStringTable = rst;
    this.bundle.header.flags |= BundleFlags.HasResourceStringTable;
  }

  /**
   * Sets resource data for a specific resource index
   */
  setResourceData(resourceIndex: number, data: Uint8Array): void {
    this.resourceData.set(resourceIndex, data);
  }

  /**
   * Gets resource data for a specific resource index
   */
  private getResourceData(resourceIndex: number): Uint8Array | null {
    return this.resourceData.get(resourceIndex) || null;
  }

  /**
   * Creates a resource entry from legacy entry data (for compatibility)
   */
  createResourceEntryFromLegacyData(
    id: bigint,
    references: bigint,
    type: number,
    entryBlocks: EntryBlockData[],
    dependenciesListOffset: number = 0,
    dependencyCount: number = 0
  ): ResourceEntry {
    // Ensure we have exactly 3 entry blocks
    while (entryBlocks.length < 3) {
      entryBlocks.push({
        compressed: false,
        compressedSize: 0,
        uncompressedSize: 0,
        uncompressedAlignment: 16,
        data: null
      });
    }

    // Convert entry blocks to the format expected by ResourceEntry
    const uncompressedSizeAndAlignment: number[] = [];
    const sizeAndAlignmentOnDisk: number[] = [];
    const diskOffsets: number[] = [0, 0, 0]; // Will be calculated during layout

    for (let i = 0; i < 3; i++) {
      const block = entryBlocks[i];
      const alignmentBits = this.bitScanReverse(block.uncompressedAlignment);
      const packedValue = block.uncompressedSize | (alignmentBits << 28);
      uncompressedSizeAndAlignment.push(packedValue);
      
      const diskSize = block.data ? (this.options.compress ? 0 : block.data.length) : 0; // Will be calculated for compression
      sizeAndAlignmentOnDisk.push(diskSize);
    }

    return {
      resourceId: id,
      importHash: references,
      uncompressedSizeAndAlignment,
      sizeAndAlignmentOnDisk,
      diskOffsets,
      importOffset: dependenciesListOffset,
      resourceTypeId: type,
      importCount: dependencyCount,
      flags: 0,
      streamIndex: 0
    };
  }

  // ============================================================================
  // Schema-Based Bundle Writing
  // ============================================================================

  /**
   * Builds and returns the complete bundle as ArrayBuffer using typed schemas
   */
  async write(progressCallback?: ProgressCallback): Promise<ArrayBuffer> {
    this.reportProgress(progressCallback, 'write', 0, 'Starting schema-based bundle write');
    
    // Finalize header with calculated offsets
    this.finalizeHeader();
    
    // Calculate buffer size and create writer
    const estimatedSize = this.calculateEstimatedSize();
    const buffer = new ArrayBuffer(estimatedSize);
    const writer = new BufferWriter(buffer, { 
      endianness: this.isConsole ? 'big' : 'little' 
    });

    this.reportProgress(progressCallback, 'write', 0.1, 'Writing bundle with schemas');

    // Write using typed-binary schemas
    const actualSize = await this.writeWithSchemas(writer, buffer, progressCallback);

    // Trim buffer to actual size
    const finalBuffer = buffer.slice(0, actualSize);
    
    this.reportProgress(progressCallback, 'write', 1.0, 'Schema-based bundle writing complete');
    
    return finalBuffer;
  }

  /**
   * Finalizes the header with calculated offsets and sizes
   */
  private finalizeHeader(): void {
    let currentOffset = 48; // Header size (including magic)

    // RST offset
    if (this.bundle.resourceStringTable) {
      this.bundle.header.debugDataOffset = currentOffset;
      currentOffset += this.calculateRSTSize();
      currentOffset = this.alignPosition(currentOffset, 16);
    }

    // Resource entries offset
    this.bundle.header.resourceEntriesOffset = currentOffset;

    // Calculate resource data offsets based on actual resource count
    const resourceCount = this.bundle.resources.length;
    const resourceDataOffsets: number[] = [0, 0, 0];

    // Calculate data offset for each resource (after resource entries)
    let dataStartOffset = currentOffset + (resourceCount * 80); // 80 bytes per resource entry

    for (let i = 0; i < Math.min(resourceCount, 3); i++) {
      const resource = this.bundle.resources[i];
      // Get the uncompressed size of the resource data
      const uncompressedSize = extractResourceSize(resource.uncompressedSizeAndAlignment[0]);
      resourceDataOffsets[i] = dataStartOffset;
      dataStartOffset += uncompressedSize;
    }

    this.bundle.header.resourceDataOffsets = resourceDataOffsets;
  }

  /**
   * Schema-based writing method
   */
  private async writeWithSchemas(writer: BufferWriter, buffer: ArrayBuffer, progressCallback?: ProgressCallback): Promise<number> {
    let currentPos = 0;
    
    this.reportProgress(progressCallback, 'write', 0.2, 'Writing header with schema');
    
    try {
      // Step 1: Write magic string manually (not part of schema)
    const magic = new TextEncoder().encode('bnd2');
    for (const byte of magic) {
      writer.writeUint8(byte);
    }
      currentPos += 4;
      console.log(`After magic: ${currentPos} bytes`);
      
      // Step 2: Write header using schema
      const headerData: Parsed<typeof BundleHeaderSchema> = {
        version: this.bundle.header.version,
        platform: this.bundle.header.platform,
        debugDataOffset: this.bundle.header.debugDataOffset,
        resourceEntriesCount: this.bundle.header.resourceEntriesCount,
        resourceEntriesOffset: this.bundle.header.resourceEntriesOffset,
        resourceDataOffsets: this.bundle.header.resourceDataOffsets.slice(0, 3) as [number, number, number],
        flags: this.bundle.header.flags
      };
      BundleHeaderSchema.write(writer, headerData);
      currentPos += 36; // Header schema size
      console.log(`After header: ${currentPos} bytes`);
      
      // Align after header
      currentPos = this.writeAlignment(writer, 16, currentPos);
      console.log(`After header alignment: ${currentPos} bytes`);
      
      this.reportProgress(progressCallback, 'write', 0.3, 'Writing resource string table');
      
      // Step 3: Write RST if present
      if (this.bundle.resourceStringTable) {
        console.log(`Writing RST of length: ${this.bundle.resourceStringTable.length}`);
        this.writeCString(writer, this.bundle.resourceStringTable);
        currentPos += this.calculateRSTSize();
        console.log(`After RST: ${currentPos} bytes`);
        currentPos = this.writeAlignment(writer, 16, currentPos);
        console.log(`After RST alignment: ${currentPos} bytes`);
      }
      
      this.reportProgress(progressCallback, 'write', 0.5, 'Writing resource entries with schema');
      
      // Step 4: Write resource entries using schema
      console.log(`Writing ${this.bundle.resources.length} resource entries`);
      for (let i = 0; i < this.bundle.resources.length; i++) {
        const resource = this.bundle.resources[i];
        const resourceSchemaData = resourceEntryToSchema(resource);
        ResourceEntrySchema.write(writer, resourceSchemaData);
        
        if (progressCallback && i % 100 === 0) {
          const progress = 0.5 + (i / this.bundle.resources.length) * 0.2;
          this.reportProgress(progressCallback, 'write', progress, `Writing resource ${i + 1}/${this.bundle.resources.length}`);
        }
      }
      currentPos += this.bundle.resources.length * 80; // 80 bytes per resource entry
      console.log(`After resources: ${currentPos} bytes`);
      
      this.reportProgress(progressCallback, 'write', 0.8, 'Writing import entries with schema');
      
      // Step 5: Write import entries using schema
      console.log(`Writing ${this.bundle.imports.length} import entries`);
      for (const importEntry of this.bundle.imports) {
        const importSchemaData: Parsed<typeof ImportEntrySchema> = {
          resourceId: bigIntToU64(importEntry.resourceId),
          offset: importEntry.offset,
          padding: 0
        };
        ImportEntrySchema.write(writer, importSchemaData);
      }
      currentPos += this.bundle.imports.length * 16; // 16 bytes per import entry
      console.log(`After imports: ${currentPos} bytes`);
      
      // Step 6: Write resource data blocks
      this.reportProgress(progressCallback, 'write', 0.85, 'Writing resource data blocks');

      console.log(`About to write ${this.bundle.resources.length} resource data blocks`);
      console.log(`Current position: ${currentPos}, Buffer size: ${buffer.byteLength}, Resources: ${this.bundle.resources.length}`);

      // Write data for each resource
      for (let i = 0; i < this.bundle.resources.length; i++) {
        const resource = this.bundle.resources[i];
        const resourceData = this.getResourceData(i);

        console.log(`Resource ${i} - data size: ${resourceData ? resourceData.length : 0}, uncompressedSizeAndAlignment[0]: ${resource.uncompressedSizeAndAlignment[0]}`);

        if (resourceData && resourceData.length > 0) {
          // Check if we have enough space in the buffer
          if (currentPos + resourceData.length > buffer.byteLength) {
            console.error(`Buffer overflow! Current pos: ${currentPos}, Resource data size: ${resourceData.length}, Buffer size: ${buffer.byteLength}`);
            throw new Error(`Buffer overflow: trying to write ${resourceData.length} bytes at position ${currentPos} in ${buffer.byteLength} byte buffer`);
          }

          // Write the resource data
          for (const byte of resourceData) {
            writer.writeUint8(byte);
          }
          currentPos += resourceData.length;

          console.log(`Wrote resource ${i} data: ${resourceData.length} bytes`);

          if (progressCallback && i % 50 === 0) {
            const progress = 0.85 + (i / this.bundle.resources.length) * 0.15;
            this.reportProgress(progressCallback, 'write', progress, `Writing resource data ${i + 1}/${this.bundle.resources.length}`);
          }
        }
      }

      this.reportProgress(progressCallback, 'write', 1.0, 'Schema-based writing complete');
      console.log(`Final size: ${currentPos} bytes`);

      return currentPos;
      
    } catch (error) {
      console.error(`Write error at position ${currentPos}:`, error);
      console.error(`Error during buffer writing`);
      throw error;
    }
  }

  // ============================================================================
  // Size Calculation Helpers
  // ============================================================================

  private calculateRSTSize(): number {
    if (this.bundle.resourceStringTable) {
      return new TextEncoder().encode(this.bundle.resourceStringTable).length + 1; // +1 for null terminator
    }
    return 0;
  }

  private calculateEstimatedSize(): number {
    let size = 0;

    // Header: magic(4) + schema(36) = 40 bytes, aligned to 16 = 48 bytes
    size = this.alignPosition(40, 16);

    // Resource string table if present
    if (this.bundle.resourceStringTable) {
      const rstSize = this.calculateRSTSize();
      console.log(`RST Debug - Length: ${this.bundle.resourceStringTable.length}, Calculated size: ${rstSize}`);
      console.log(`RST Preview: "${this.bundle.resourceStringTable.substring(0, 100)}..."`);
      size += rstSize;
      size = this.alignPosition(size, 16); // RST gets aligned
    }

    // Resource entries (80 bytes each, no alignment between entries)
    console.log(`Resource entries debug: count=${this.bundle.resources.length}, size=${this.bundle.resources.length * 80}`);
    size += this.bundle.resources.length * 80;

    // Import entries (16 bytes each, no alignment between entries)
    console.log(`Import entries debug: count=${this.bundle.imports.length}, size=${this.bundle.imports.length * 16}`);
    size += this.bundle.imports.length * 16;

    // Resource data blocks - calculate actual sizes
    let totalResourceDataSize = 0;
    for (let i = 0; i < this.bundle.resources.length; i++) {
      const resource = this.bundle.resources[i];
      const resourceData = this.getResourceData(i);
      if (resourceData) {
        totalResourceDataSize += resourceData.length;
        console.log(`Resource ${i} data size: ${resourceData.length} bytes`);
      } else {
        // Fallback to uncompressed size if no data is set
        const uncompressedSize = extractResourceSize(resource.uncompressedSizeAndAlignment[0]);
        totalResourceDataSize += uncompressedSize;
        console.log(`Resource ${i} fallback size: ${uncompressedSize} bytes`);
      }
    }
    size += totalResourceDataSize;
    console.log(`Total resource data size: ${totalResourceDataSize} bytes`);

    // Larger safety margin to account for potential compression headers or other metadata
    const safetyMargin = Math.max(1024, totalResourceDataSize * 0.1); // At least 1KB or 10% of resource data
    size += safetyMargin;

    console.log(`Estimated bundle size: ${size} bytes`);
    console.log(`  Header: 40 -> ${this.alignPosition(40, 16)} bytes`);
    if (this.bundle.resourceStringTable) {
      console.log(`  RST: ${this.calculateRSTSize()} bytes (with alignment)`);
    }
    console.log(`  Resources: ${this.bundle.resources.length} × 80 = ${this.bundle.resources.length * 80} bytes`);
    console.log(`  Imports: ${this.bundle.imports.length} × 16 = ${this.bundle.imports.length * 16} bytes`);
    console.log(`  Resource data: ${totalResourceDataSize} bytes`);
    console.log(`  Safety margin: ${safetyMargin} bytes`);

    return size;
  }

  private reportProgress(
    callback: ProgressCallback | undefined,
    type: string,
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
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Creates a new bundle builder with default settings
 */
export function createBundleBuilder(options: WriteOptions = {}): BundleBuilder {
  return new BundleBuilder(options);
}

/**
 * Creates a bundle builder from existing resource entries
 */
export function createBundleFromResources(
  resources: ResourceEntry[],
  imports: ImportEntry[] = [],
  options: WriteOptions = {}
): BundleBuilder {
  const builder = new BundleBuilder(options);
  builder.addResourceEntries(resources);
  
  for (const importEntry of imports) {
    builder.addImportEntry(importEntry);
  }
  
  return builder;
}

/**
 * Creates a bundle builder from a parsed bundle
 */
export function createBundleFromParsed(
  parsedBundle: { 
    header: BundleHeader; 
    resources: ResourceEntry[]; 
    imports: ImportEntry[];
    debugData?: string;
  },
  options: WriteOptions = {}
): BundleBuilder {
  const builder = new BundleBuilder(options);
  builder.addResourceEntries(parsedBundle.resources);
  
  for (const importEntry of parsedBundle.imports) {
    builder.addImportEntry(importEntry);
  }
  
  if (parsedBundle.debugData) {
    builder.setResourceStringTable(parsedBundle.debugData);
  }
  
  return builder;
}

/**
 * Helper to create a resource entry
 */
export function createResourceEntry(
  resourceId: bigint,
  resourceTypeId: number,
  uncompressedSizes: number[] = [0, 0, 0],
  diskSizes: number[] = [0, 0, 0],
  diskOffsets: number[] = [0, 0, 0],
  importHash: bigint = 0n,
  importOffset: number = 0,
  importCount: number = 0
): ResourceEntry {
  return {
    resourceId,
    importHash,
    uncompressedSizeAndAlignment: uncompressedSizes.slice(0, 3),
    sizeAndAlignmentOnDisk: diskSizes.slice(0, 3),
    diskOffsets: diskOffsets.slice(0, 3),
    importOffset,
    resourceTypeId,
    importCount,
    flags: 0,
    streamIndex: 0
  };
} 