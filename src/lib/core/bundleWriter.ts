// Bundle Writer - Constructs and writes Burnout Paradise bundle files
// Supports compression, resource optimization, and validation

import { BufferWriter } from 'typed-binary';
import * as pako from 'pako';
import type { 
  BundleHeader, 
  ResourceEntry, 
  ImportEntry, 
  ParsedBundle,
  WriteOptions,
  ProgressCallback,
  ValidationError
} from './types';
import { 
  BundleHeaderSchema, 
  ResourceEntrySchema, 
  ImportEntrySchema,
  bigIntToU64,
  createEmptyBundleHeader,
  SCHEMA_SIZES
} from './schemas';

// ============================================================================
// Bundle Layout Type
// ============================================================================

type BundleLayout = {
  resourceEntriesOffset: number;
  resourceDataOffset: number;
  debugDataOffset: number;
  importEntriesOffset: number;
  resourceDataSize: number;
}
import { 
  compressData, 
  packSizeAndAlignment, 
  validateBundleHeader,
  validateResourceEntry 
} from './resourceManager';
import { BUNDLE_FLAGS } from './types';

// ============================================================================
// Bundle Builder Class
// ============================================================================

export class BundleBuilder {
  private header: BundleHeader;
  private resources: ResourceEntry[] = [];
  private imports: ImportEntry[] = [];
  private resourceData: Map<bigint, Uint8Array> = new Map();
  private debugData?: string;

  constructor(options: WriteOptions = {}) {
    this.header = {
      magic: 'bnd2',
      ...createEmptyBundleHeader(),
      platform: options.platform || 1, // Default to PC
      flags: this.calculateFlags(options)
    };
  }

  private calculateFlags(options: WriteOptions): number {
    let flags = 0;
    
    if (options.compress) {
      flags |= BUNDLE_FLAGS.COMPRESSED;
    }
    
    if (options.optimizeForMemory) {
      flags |= BUNDLE_FLAGS.MAIN_MEM_OPTIMISED | BUNDLE_FLAGS.GRAPHICS_MEM_OPTIMISED;
    }
    
    if (options.includeDebugData) {
      flags |= BUNDLE_FLAGS.HAS_DEBUG_DATA;
    }
    
    return flags;
  }

  // ============================================================================
  // Resource Management
  // ============================================================================

  /**
   * Adds a resource to the bundle
   */
  addResource(
    resourceTypeId: number,
    data: Uint8Array,
    resourceId?: bigint,
    compress: boolean = false
  ): ResourceEntry {
    // Generate resource ID if not provided
    if (!resourceId) {
      resourceId = this.generateResourceId();
    }

    // Compress data if requested
    const finalData = compress ? compressData(data) : data;
    
    // Create resource entry
    const resource: ResourceEntry = {
      resourceId,
      importHash: 0n,
      uncompressedSizeAndAlignment: [0, 0, 0],
      sizeAndAlignmentOnDisk: [0, 0, 0],
      diskOffsets: [0, 0, 0],
      importOffset: 0,
      resourceTypeId,
      importCount: 0,
      flags: compress ? 1 : 0,
      streamIndex: 0
    };

    // Set size and alignment for main memory (index 0)
    const alignment = this.calculateAlignment(finalData.length);
    resource.sizeAndAlignmentOnDisk[0] = packSizeAndAlignment(finalData.length, alignment);
    resource.uncompressedSizeAndAlignment[0] = packSizeAndAlignment(data.length, alignment);

    this.resources.push(resource);
    this.resourceData.set(resourceId, finalData);

    return resource;
  }

  /**
   * Adds an import to a resource
   */
  addImport(resourceId: bigint, offset: number): void {
    const importEntry: ImportEntry = {
      resourceId,
      offset
    };
    
    this.imports.push(importEntry);
    
    // Update resource import count
    const resource = this.resources.find(r => r.resourceId === resourceId);
    if (resource) {
      resource.importCount++;
    }
  }

  /**
   * Sets debug data for the bundle
   */
  setDebugData(debugData: string): void {
    this.debugData = debugData;
    this.header.flags |= BUNDLE_FLAGS.HAS_DEBUG_DATA;
  }

  // ============================================================================
  // Bundle Writing
  // ============================================================================

  /**
   * Builds and returns the complete bundle as ArrayBuffer
   */
  async build(progressCallback?: ProgressCallback): Promise<ArrayBuffer> {
    this.reportProgress(progressCallback, 'write', 0, 'Preparing bundle structure');
    
    // Validate bundle before writing
    this.validate();
    
    // Calculate layout
    const layout = this.calculateLayout();
    
    this.reportProgress(progressCallback, 'write', 0.1, 'Writing bundle header');
    
    // Create buffer writer
    const writer = new BufferWriter(layout.totalSize, { endianness: 'little' });
    
    // Write header
    this.writeHeader(writer, layout);
    
    this.reportProgress(progressCallback, 'write', 0.3, 'Writing resource entries');
    
    // Write resource entries
    this.writeResourceEntries(writer, layout);
    
    this.reportProgress(progressCallback, 'write', 0.5, 'Writing import entries');
    
    // Write import entries
    this.writeImportEntries(writer);
    
    this.reportProgress(progressCallback, 'write', 0.7, 'Writing resource data');
    
    // Write resource data
    await this.writeResourceData(writer, layout, progressCallback);
    
    this.reportProgress(progressCallback, 'write', 0.9, 'Writing debug data');
    
    // Write debug data
    this.writeDebugData(writer, layout);
    
    this.reportProgress(progressCallback, 'write', 1.0, 'Bundle writing complete');
    
    return writer.getBuffer();
  }

  // ============================================================================
  // Layout Calculation
  // ============================================================================

  private calculateLayout() {
    const headerSize = 4 + SCHEMA_SIZES.BundleHeader; // magic + header
    const resourceEntriesSize = this.resources.length * SCHEMA_SIZES.ResourceEntry;
    const importEntriesSize = this.imports.length * SCHEMA_SIZES.ImportEntry;
    
    let resourceDataSize = 0;
    for (const data of this.resourceData.values()) {
      resourceDataSize += this.alignSize(data.length, 16); // 16-byte alignment
    }
    
    const debugDataSize = this.debugData ? this.debugData.length : 0;
    
    const resourceEntriesOffset = headerSize;
    const importEntriesOffset = resourceEntriesOffset + resourceEntriesSize;
    const resourceDataOffset = importEntriesOffset + importEntriesSize;
    const debugDataOffset = resourceDataOffset + resourceDataSize;
    
    return {
      headerSize,
      resourceEntriesSize,
      importEntriesSize,
      resourceDataSize,
      debugDataSize,
      resourceEntriesOffset,
      importEntriesOffset,
      resourceDataOffset,
      debugDataOffset,
      totalSize: debugDataOffset + debugDataSize
    };
  }

  // ============================================================================
  // Writing Methods
  // ============================================================================

  private writeHeader(writer: BufferWriter, layout: BundleLayout): void {
    // Write magic
    const magicBytes = new TextEncoder().encode(this.header.magic);
    writer.writeBytes(magicBytes);
    
    // Update header with calculated offsets
    const headerData = {
      ...this.header,
      resourceEntriesCount: this.resources.length,
      resourceEntriesOffset: layout.resourceEntriesOffset,
      resourceDataOffsets: [layout.resourceDataOffset, 0, 0],
      debugDataOffset: this.debugData ? layout.debugDataOffset : 0
    };
    
    // Write header schema
    BundleHeaderSchema.write(writer, headerData);
  }

  private writeResourceEntries(writer: BufferWriter, layout: BundleLayout): void {
    let currentDataOffset = layout.resourceDataOffset;
    let currentImportOffset = layout.importEntriesOffset;
    
    for (const resource of this.resources) {
      const data = this.resourceData.get(resource.resourceId);
      if (!data) continue;
      
      // Update resource with actual offsets
      const updatedResource = {
        ...resource,
        diskOffsets: [currentDataOffset, 0, 0],
        importOffset: resource.importCount > 0 ? currentImportOffset : 0
      };
      
      // Write resource entry
      const resourceForSchema = {
        ...updatedResource,
        resourceId: bigIntToU64(updatedResource.resourceId),
        importHash: bigIntToU64(updatedResource.importHash)
      };
      
      ResourceEntrySchema.write(writer, resourceForSchema);
      
      // Advance offsets
      currentDataOffset += this.alignSize(data.length, 16);
      currentImportOffset += resource.importCount * SCHEMA_SIZES.ImportEntry;
    }
  }

  private writeImportEntries(writer: BufferWriter): void {
    for (const importEntry of this.imports) {
      const importForSchema = {
        resourceId: bigIntToU64(importEntry.resourceId),
        offset: importEntry.offset,
        padding: 0
      };
      
      ImportEntrySchema.write(writer, importForSchema);
    }
  }

  private async writeResourceData(
    writer: BufferWriter, 
    layout: BundleLayout, 
    progressCallback?: ProgressCallback
  ): Promise<void> {
    let bytesWritten = 0;
    const totalBytes = layout.resourceDataSize;
    
    for (const [resourceId, data] of this.resourceData.entries()) {
      // Write data
      writer.writeBytes(data);
      
      // Add padding for alignment
      const paddedSize = this.alignSize(data.length, 16);
      const paddingNeeded = paddedSize - data.length;
      if (paddingNeeded > 0) {
        const padding = new Uint8Array(paddingNeeded);
        writer.writeBytes(padding);
      }
      
      bytesWritten += paddedSize;
      
      if (progressCallback) {
        const progress = 0.7 + (bytesWritten / totalBytes) * 0.2;
        this.reportProgress(progressCallback, 'write', progress, `Writing resource data: ${bytesWritten}/${totalBytes} bytes`);
      }
    }
  }

  private writeDebugData(writer: BufferWriter, layout: BundleLayout): void {
    if (this.debugData) {
      const debugBytes = new TextEncoder().encode(this.debugData);
      writer.writeBytes(debugBytes);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateResourceId(): bigint {
    // Generate a unique resource ID
    const timestamp = BigInt(Date.now());
    const random = BigInt(Math.floor(Math.random() * 0xFFFFFFFF));
    return (timestamp << 32n) | random;
  }

  private calculateAlignment(size: number): number {
    // Use 16-byte alignment for most resources
    return 16;
  }

  private alignSize(size: number, alignment: number): number {
    return Math.ceil(size / alignment) * alignment;
  }

  private validate(): void {
    const errors: ValidationError[] = [];
    
    // Validate header
    errors.push(...validateBundleHeader(this.header));
    
    // Validate resources
    for (const resource of this.resources) {
      const resourceErrors = validateResourceEntry(resource, Number.MAX_SAFE_INTEGER);
      errors.push(...resourceErrors);
    }
    
    if (errors.length > 0) {
      throw new Error(`Bundle validation failed: ${errors.map(e => e.message).join(', ')}`);
    }
  }

  private reportProgress(
    callback: ProgressCallback | undefined,
    type: 'parse' | 'write' | 'compress' | 'validate',
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
 * Writes a bundle to an ArrayBuffer
 */
export async function writeBundle(
  bundle: ParsedBundle,
  options: WriteOptions = {},
  progressCallback?: ProgressCallback
): Promise<ArrayBuffer> {
  const builder = new BundleBuilder(options);
  
  // Add existing resources
  // Note: This would need access to the original resource data
  // which isn't available in the ParsedBundle interface
  // This is a limitation that would need to be addressed in a real implementation
  
  if (bundle.debugData) {
    builder.setDebugData(bundle.debugData);
  }
  
  return builder.build(progressCallback);
} 