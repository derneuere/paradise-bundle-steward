// Bundle entry schemas, types, and parsing functions for Burnout Paradise Bundle 2 format

import {
  object,
  arrayOf,
  string,
  u8,
  u16,
  u32,
  type Parsed
} from 'typed-binary';
import { BufferReader } from 'typed-binary';
import { BundleError } from '../errors';
import { bigIntToU64, u64Schema } from './bundle';

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
// Bundle Entry Types
// ============================================================================

// ResourceEntry with bigint conversions for IDs
export type ResourceEntry = Parsed<typeof ResourceEntrySchema>;

// ImportEntry with bigint conversion for resourceId
export type ImportEntry = Parsed<typeof ImportEntrySchema>;

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
  id: object({ low: u32, high: u32 }),
  references: object({ low: u32, high: u32 }),
  // entryBlocks handled separately
  dependenciesListOffset: u32,
  type: u32,
  dependencyCount: u32
});

// Resource string table schema
export const ResourceStringTableSchema = object({
  content: string  // Null-terminated string
});

// ============================================================================
// Entry Creation and Conversion Functions
// ============================================================================

export function createEmptyResourceEntry(): ResourceEntry {
  return {
    resourceId: { low: 0, high: 0 },
    importHash: { low: 0, high: 0 },
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
    id: { low: entry.id.low, high: entry.id.high },
    references: { low: entry.references.low, high: entry.references.high },
    dependenciesListOffset: entry.dependenciesListOffset,
    type: entry.type,
    dependencyCount: entry.dependencyCount
  };
}

// Convert resource entry to schema format
export function resourceEntryToSchema(entry: ResourceEntry): Parsed<typeof ResourceEntrySchema> {
  return {
    resourceId: entry.resourceId,
    importHash: entry.importHash,
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

// ============================================================================
// Resource Entry Parsing
// ============================================================================

export function parseResourceEntries(
  reader: BufferReader,
  header: { resourceEntriesOffset: number; resourceEntriesCount: number },
  bufferSize: number,
  options: { strict?: boolean } = {}
): ResourceEntry[] {
  const resources: ResourceEntry[] = [];
  reader.seekTo(header.resourceEntriesOffset);

  for (let i = 0; i < header.resourceEntriesCount; i++) {
    try {
      const rawResource = ResourceEntrySchema.read(reader);

      const resource: ResourceEntry = {
        ...rawResource,
        resourceId: rawResource.resourceId,
        importHash: rawResource.importHash
      };

      // Validate resource entry if validation function is available
      // Note: validation is handled by the caller in bundleParser.ts

      resources.push(resource);

    } catch (error) {
      if (options.strict !== false) {
        throw new BundleError(
          `Failed to parse resource entry ${i}: ${error instanceof Error ? error.message : String(error)}`,
          'RESOURCE_PARSE_ERROR',
          { resourceIndex: i, error }
        );
      } else {
        console.warn(`Skipping invalid resource entry ${i}:`, error);
      }
    }
  }

  return resources;
}

// ============================================================================
// Import Entry Parsing
// ============================================================================

export function parseImportEntries(reader: BufferReader, resources: ResourceEntry[]): ImportEntry[] {
  const imports: ImportEntry[] = [];

  for (const resource of resources) {
    if (resource.importCount > 0) {
      reader.seekTo(resource.importOffset);

      for (let i = 0; i < resource.importCount; i++) {
        try {
          const rawImport = ImportEntrySchema.read(reader);
          const importEntry: ImportEntry = {
            resourceId: rawImport.resourceId,
            offset: rawImport.offset
          };
          imports.push(importEntry);
        } catch (error) {
          console.warn(`Error parsing import entry ${i} for resource ${resource.resourceId}:`, error);
        }
      }
    }
  }

  return imports;
}
