// Bundle Writer - Constructs and writes Burnout Paradise bundle files
// Rewritten to exactly match BundleArchive.cs behavior

import { BufferWriter } from 'typed-binary';
import * as pako from 'pako';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface BundleEntry {
  id: bigint;
  references: bigint;
  entryBlocks: EntryBlock[];
  dependenciesListOffset: number;
  type: number;
  dependencyCount: number;
}

export interface EntryBlock {
  compressed: boolean;
  compressedSize: number;
  uncompressedSize: number;
  uncompressedAlignment: number;
  data: Uint8Array | null;
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
// Bundle Builder Class
// ============================================================================

export class BundleBuilder {
  private version: number = 2;
  private platform: BundlePlatform;
  private flags: number;
  private entries: BundleEntry[] = [];
  private resourceStringTable?: string;

  constructor(options: WriteOptions = {}) {
    this.platform = options.platform || BundlePlatform.PC;
    this.flags = this.calculateFlags(options);
  }

  private calculateFlags(options: WriteOptions): number {
    let flags = BundleFlags.UnusedFlag1 | BundleFlags.UnusedFlag2; // Always set
    
    if (options.compress) {
      flags |= BundleFlags.Compressed;
    }
    
    if (options.includeDebugData && this.resourceStringTable) {
      flags |= BundleFlags.HasResourceStringTable;
    }
    
    return flags;
  }

  // ============================================================================
  // Utility Functions (matching C# implementation)
  // ============================================================================

  private get isConsole(): boolean {
    return this.platform === BundlePlatform.X360 || this.platform === BundlePlatform.PS3;
  }

  private bitScanReverse(mask: number): number {
    // Exact port of C# BitScan.BitScanReverse
    let i: number;
    for (i = 31; (mask >> i) === 0 && i >= 0; i--);
    return i;
  }

  private compressData(data: Uint8Array): Uint8Array {
    // Use zlib compression to match C# LibDeflate ZlibCompressor
    return pako.deflate(data);
  }

  private alignPosition(position: number, alignment: number): number {
    if (position % alignment === 0) return position;
    return alignment * Math.floor((position + (alignment - 1)) / alignment);
  }

  private writeAlignment(writer: BufferWriter, alignment: number, currentPos: number): number {
    const alignedPos = this.alignPosition(currentPos, alignment);
    const paddingNeeded = alignedPos - currentPos;
    
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
  // Entry Management
  // ============================================================================

  /**
   * Adds an entry to the bundle (exact C# API match)
   */
  addEntry(
    id: bigint,
    references: bigint,
    type: number,
    entryBlocks: EntryBlock[],
    dependenciesListOffset: number = 0,
    dependencyCount: number = 0
  ): void {
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

    this.entries.push({
      id,
      references,
      entryBlocks: entryBlocks.slice(0, 3), // Only take first 3
      dependenciesListOffset,
      type,
      dependencyCount
    });
  }

  /**
   * Sets the resource string table
   */
  setResourceStringTable(rst: string): void {
    this.resourceStringTable = rst;
    this.flags |= BundleFlags.HasResourceStringTable;
  }

  // ============================================================================
  // Bundle Writing (exact match to C# BundleArchive.Write)
  // ============================================================================

  /**
   * Builds and returns the complete bundle as ArrayBuffer
   */
  async write(progressCallback?: ProgressCallback): Promise<ArrayBuffer> {
    this.reportProgress(progressCallback, 'write', 0, 'Starting bundle write');
    
    // Calculate buffer size and create writer
    const estimatedSize = this.calculateEstimatedSize();
    const buffer = new ArrayBuffer(estimatedSize);
    const writer = new BufferWriter(buffer, { 
      endianness: this.isConsole ? 'big' : 'little' 
    });

    this.reportProgress(progressCallback, 'write', 0.1, 'Writing bundle header');

    // Write exactly like C# BundleArchive.Write()
    const actualSize = await this.writeBundle(writer, progressCallback);

    // Trim buffer to actual size
    const finalBuffer = buffer.slice(0, actualSize);
    
    this.reportProgress(progressCallback, 'write', 1.0, 'Bundle writing complete');
    
    return finalBuffer;
  }

  private async writeBundle(writer: BufferWriter, progressCallback?: ProgressCallback): Promise<number> {
    // Since typed-binary BufferWriter doesn't have offset/seek, we need to 
    // pre-calculate all offsets and write the complete structure in order
    
    this.reportProgress(progressCallback, 'write', 0.1, 'Pre-calculating layout');
    
    // Step 1: Pre-calculate the complete bundle layout
    const layout = this.calculateBundleLayout();
    
    this.reportProgress(progressCallback, 'write', 0.2, 'Writing bundle header');
    
    // Step 2: Write header with pre-calculated offsets
    this.writeHeader(writer, layout);
    
    this.reportProgress(progressCallback, 'write', 0.3, 'Writing resource string table');
    
    // Step 3: Write RST if present
    if (this.flags & BundleFlags.HasResourceStringTable && this.resourceStringTable) {
      this.writeCString(writer, this.resourceStringTable);
      layout.currentPos = this.writeAlignment(writer, 16, layout.currentPos + this.calculateRSTSize());
    }
    
    this.reportProgress(progressCallback, 'write', 0.5, 'Writing ID block');
    
    // Step 4: Write ID block
    const compressedBlocks = await this.writeIdBlock(writer, layout, progressCallback);
    
    this.reportProgress(progressCallback, 'write', 0.7, 'Writing data blocks');
    
    // Step 5: Write data blocks
    await this.writeDataBlocks(writer, layout, compressedBlocks, progressCallback);
    
    return layout.totalSize;
  }

  // ============================================================================
  // Bundle Layout Calculation
  // ============================================================================

  private calculateBundleLayout(): BundleLayout {
    let currentPos = 0;
    
    // Header: magic(4) + version(4) + platform(4) + rstOffset(4) + entryCount(4) + idBlockOffset(4) + fileBlockOffsets(12) + flags(4) + padding
    const headerSize = 44; // 4+4+4+4+4+4+12+4 = 40, then aligned to 16 = 48, but let's calculate exactly
    currentPos = this.alignPosition(headerSize, 16);
    
    // RST data
    const rstSize = this.calculateRSTSize();
    const rstOffset = currentPos;
    currentPos += rstSize;
    if (rstSize > 0) {
      currentPos = this.alignPosition(currentPos, 16);
    }
    
    // ID block
    const idBlockOffset = currentPos;
    const idBlockSize = this.entries.length * 64; // Each entry is 64 bytes in ID block
    currentPos += idBlockSize;
    
    // Calculate data block sizes and offsets
    const dataBlockOffsets = [0, 0, 0];
    const dataBlockSizes = [0, 0, 0];
    
    for (let blockIndex = 0; blockIndex < 3; blockIndex++) {
      dataBlockOffsets[blockIndex] = currentPos;
      let blockSize = 0;
      
      for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex++) {
        const entry = this.entries[entryIndex];
        const entryBlock = entry.entryBlocks[blockIndex];
        
        if (entryBlock.data) {
          let dataSize = entryBlock.data.length;
          if (this.flags & BundleFlags.Compressed) {
            // Estimate compressed size (rough approximation)
            dataSize = Math.ceil(dataSize * 0.7); // Conservative estimate
          }
          
          blockSize += dataSize;
          // Add alignment padding
          const alignmentBytes = (blockIndex !== 0 && entryIndex !== this.entries.length - 1) ? 0x80 : 16;
          blockSize = this.alignPosition(blockSize, alignmentBytes);
        }
      }
      
      dataBlockSizes[blockIndex] = blockSize;
      currentPos += blockSize;
      
      // Align between blocks (not for last block)
      if (blockIndex !== 2) {
        currentPos = this.alignPosition(currentPos, 0x80);
      }
    }
    
    return {
      headerSize,
      rstOffset,
      rstSize,
      idBlockOffset,
      idBlockSize,
      dataBlockOffsets,
      dataBlockSizes,
      totalSize: currentPos,
      currentPos: 0
    };
  }

  private calculateRSTSize(): number {
    if (this.resourceStringTable) {
      return new TextEncoder().encode(this.resourceStringTable).length + 1; // +1 for null terminator
    }
    return 0;
  }

  // ============================================================================
  // Writing Methods (rewritten for sequential writing)
  // ============================================================================

  private writeHeader(writer: BufferWriter, layout: BundleLayout): void {
    // Write BND2 magic
    const magic = new TextEncoder().encode('bnd2');
    for (const byte of magic) {
      writer.writeUint8(byte);
    }

    // Write version and platform
    writer.writeInt32(this.version);
    writer.writeInt32(this.platform);

    // Write RST offset
    writer.writeUint32(layout.rstOffset);

    // Write entry count
    writer.writeInt32(this.entries.length);

    // Write ID block offset
    writer.writeInt32(layout.idBlockOffset);

    // Write file block offsets (3 blocks)
    for (let i = 0; i < 3; i++) {
      writer.writeUint32(layout.dataBlockOffsets[i]);
    }

    // Write flags
    writer.writeInt32(this.flags);

    // Align to 16 bytes
    const currentHeaderSize = 44; // 4+4+4+4+4+4+12+4
    layout.currentPos = this.writeAlignment(writer, 16, currentHeaderSize);
  }

  private async writeIdBlock(
    writer: BufferWriter,
    layout: BundleLayout,
    progressCallback?: ProgressCallback
  ): Promise<(Uint8Array | null)[][]> {
    const compressedBlocks: (Uint8Array | null)[][] = [];
    
    // Pre-compress all blocks if needed
    for (let i = 0; i < this.entries.length; i++) {
      compressedBlocks[i] = [null, null, null];
      const entry = this.entries[i];
      
      for (let j = 0; j < 3; j++) {
        const entryBlock = entry.entryBlocks[j];
        if (entryBlock.data && (this.flags & BundleFlags.Compressed)) {
          compressedBlocks[i][j] = this.compressData(entryBlock.data);
        }
      }
    }
    
    // Write ID block entries
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      
      // Write entry ID and references
      this.writeBigInt64(writer, entry.id);
      this.writeBigInt64(writer, entry.references);
      
      // Write uncompressed sizes with alignment (3 blocks)
      for (let j = 0; j < 3; j++) {
        const entryBlock = entry.entryBlocks[j];
        let uncompressedSize = 0;
        if (entryBlock.data !== null) {
          uncompressedSize = entryBlock.data.length;
        }
        // Pack size with alignment in upper 4 bits (exact C# formula)
        const alignmentBits = this.bitScanReverse(entryBlock.uncompressedAlignment);
        const packedValue = uncompressedSize | (alignmentBits << 28);
        writer.writeUint32(packedValue);
      }
      
      // Write compressed sizes (3 blocks)
      for (let j = 0; j < 3; j++) {
        const entryBlock = entry.entryBlocks[j];
        if (entryBlock.data === null) {
          writer.writeUint32(0);
        } else {
          if (this.flags & BundleFlags.Compressed) {
            writer.writeUint32(compressedBlocks[i][j]!.length);
          } else {
            writer.writeUint32(entryBlock.data.length);
          }
        }
      }
      
      // Write data offsets (calculated dynamically)
      const dataOffsets = this.calculateDataOffsets(i, layout, compressedBlocks);
      for (let j = 0; j < 3; j++) {
        writer.writeUint32(dataOffsets[j]);
      }
      
      // Write dependencies offset, type, and count
      writer.writeInt32(entry.dependenciesListOffset);
      writer.writeInt32(entry.type);
      writer.writeInt16(entry.dependencyCount);
      
      // 2 bytes padding
      writer.writeInt16(0);
      
      if (progressCallback && i % 100 === 0) {
        const progress = 0.5 + (i / this.entries.length) * 0.2;
        this.reportProgress(progressCallback, 'write', progress, `Writing entry ${i + 1}/${this.entries.length}`);
      }
    }
    
    return compressedBlocks;
  }

  private calculateDataOffsets(entryIndex: number, layout: BundleLayout, compressedBlocks: (Uint8Array | null)[][]): number[] {
    const offsets = [0, 0, 0];
    
    for (let blockIndex = 0; blockIndex < 3; blockIndex++) {
      let currentOffset = 0;
      
      // Calculate offset by summing sizes of all previous entries in this block
      for (let i = 0; i < entryIndex; i++) {
        const entry = this.entries[i];
        const entryBlock = entry.entryBlocks[blockIndex];
        
        if (entryBlock.data) {
          let dataSize: number;
          if (this.flags & BundleFlags.Compressed && compressedBlocks[i][blockIndex]) {
            dataSize = compressedBlocks[i][blockIndex]!.length;
          } else {
            dataSize = entryBlock.data.length;
          }
          
          currentOffset += dataSize;
          
          // Add alignment padding
          const alignmentBytes = (blockIndex !== 0 && i !== this.entries.length - 1) ? 0x80 : 16;
          currentOffset = this.alignPosition(currentOffset, alignmentBytes);
        }
      }
      
      offsets[blockIndex] = currentOffset;
    }
    
    return offsets;
  }

  private async writeDataBlocks(
    writer: BufferWriter,
    layout: BundleLayout,
    compressedBlocks: (Uint8Array | null)[][],
    progressCallback?: ProgressCallback
  ): Promise<void> {
    // Write 3 data blocks sequentially
    for (let blockIndex = 0; blockIndex < 3; blockIndex++) {
      
      // Write data for each entry in this block
      for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex++) {
        const entry = this.entries[entryIndex];
        const entryBlock = entry.entryBlocks[blockIndex];
        const compressed = !!(this.flags & BundleFlags.Compressed);
        
        let dataToWrite: Uint8Array | null = null;
        
        if (compressed && compressedBlocks[entryIndex][blockIndex]) {
          dataToWrite = compressedBlocks[entryIndex][blockIndex];
        } else if (entryBlock.data) {
          dataToWrite = entryBlock.data;
        }
        
        if (dataToWrite) {
          // Write actual data
          for (const byte of dataToWrite) {
            writer.writeUint8(byte);
          }
          
          // Apply alignment (exact C# logic)
          const alignmentBytes = (blockIndex !== 0 && entryIndex !== this.entries.length - 1) ? 0x80 : 16;
          layout.currentPos = this.writeAlignment(writer, alignmentBytes, layout.currentPos + dataToWrite.length);
        }
        
        if (progressCallback && entryIndex % 50 === 0) {
          const blockProgress = blockIndex / 3;
          const entryProgress = (entryIndex / this.entries.length) / 3;
          const totalProgress = 0.7 + blockProgress + entryProgress;
          this.reportProgress(progressCallback, 'write', totalProgress, 
            `Writing block ${blockIndex + 1}/3, entry ${entryIndex + 1}/${this.entries.length}`);
        }
      }
      
      // Align block end (not for last block)
      if (blockIndex !== 2) {
        layout.currentPos = this.writeAlignment(writer, 0x80, layout.currentPos);
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private writeBigInt64(writer: BufferWriter, value: bigint): void {
    // Write as two 32-bit values (little/big endian aware)
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    
    if (this.isConsole) {
      writer.writeUint32(high);
      writer.writeUint32(low);
    } else {
      writer.writeUint32(low);
      writer.writeUint32(high);
    }
  }

  private calculateEstimatedSize(): number {
    // Rough size calculation for buffer allocation
    let size = 64; // Header
    
    if (this.resourceStringTable) {
      size += this.resourceStringTable.length + 32;
    }
    
    // ID block
    size += this.entries.length * 64; // Each entry is ~64 bytes
    
    // Data blocks
    for (const entry of this.entries) {
      for (const block of entry.entryBlocks) {
        if (block.data) {
          size += block.data.length + 128; // Extra space for compression and alignment
        }
      }
    }
    
    return size * 2; // Double for safety
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
 * Creates a bundle builder from existing entries (matching C# API)
 */
export function createBundleFromEntries(
  entries: BundleEntry[],
  options: WriteOptions = {}
): BundleBuilder {
  const builder = new BundleBuilder(options);
  
  for (const entry of entries) {
    builder.addEntry(
      entry.id,
      entry.references,
      entry.type,
      entry.entryBlocks,
      entry.dependenciesListOffset,
      entry.dependencyCount
    );
  }
  
  return builder;
}

/**
 * Helper to create an entry block
 */
export function createEntryBlock(
  data: Uint8Array | null,
  alignment: number = 16,
  compressed: boolean = false
): EntryBlock {
  return {
    compressed,
    compressedSize: data ? data.length : 0,
    uncompressedSize: data ? data.length : 0,
    uncompressedAlignment: alignment,
    data
  };
} 