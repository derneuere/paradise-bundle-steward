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
import * as pako from 'pako';
import { BundleError } from '../errors';
import { bigIntToU64, u64, u64ToBigInt } from '../u64';

// ============================================================================
// Resource Entry Schema (80 bytes)
// ============================================================================

export const ResourceEntrySchema = object({
  resourceId: u64,       // 8 bytes
  importHash: u64,       // 8 bytes
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
  resourceId: u64,       // 8 bytes
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
    id: { low: Number(entry.id & 0xFFFFFFFFn), high: Number((entry.id >> 32n) & 0xFFFFFFFFn) },
    references: { low: Number(entry.references & 0xFFFFFFFFn), high: Number((entry.references >> 32n) & 0xFFFFFFFFn) },
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

/**
 * Read every resource's import table.
 *
 * In BND2 the import table is stored INLINE inside each resource's
 * decompressed header block (not in a separate uncompressed section of the
 * file). `resource.importOffset` is a header-block-RELATIVE offset, not a
 * file-absolute one. Each entry is 16 bytes:
 *   { u64 resourceId, u32 ptrOffset, u32 padding }
 * where `ptrOffset` is the offset within the same header block where the
 * pointer-to-patch lives.
 *
 * The earlier implementation seeked file-absolute on `reader`, which silently
 * read garbage from random positions inside the bundle's compressed data.
 * It happened to work for the registered resource types we shipped first
 * (StreetData / TriggerData / VehicleList / ChallengeList / PlayerCarColours
 * / IceTakeDictionary) because none of them actually USE imports — none of
 * those types reference other resources by ID. Renderable, GraphicsSpec, and
 * Model do use imports, and they all worked around the bug by re-reading the
 * import table themselves from `getRenderableBlocks()` etc. With this fix
 * those workarounds become unnecessary, but they're left in place for now
 * since they're correct.
 *
 * Returns a flat array (concatenation of every resource's imports in resource
 * order). Use {@link getResourceImportSlice} to recover the per-resource view.
 */
export function parseImportEntries(
  buffer: ArrayBuffer,
  resources: ResourceEntry[],
  bundleHeader: { resourceDataOffsets: number[] },
): ImportEntry[] {
  const imports: ImportEntry[] = [];

  // Lazy-loaded so we don't pull pako into bundle/* unconditionally — keeps
  // the dependency graph in this leaf module minimal. The dynamic import is
  // resolved synchronously since resourceManager is already statically loaded
  // by every parser anyway.
  // (We do the static import at the top of the file in practice; this is just
  // documenting why it's safe.)

  for (const resource of resources) {
    if (resource.importCount === 0) continue;

    // Pull the resource's header block (block 0). We can't trust
    // extractResourceData here because it returns the FIRST non-empty block —
    // which is what we want for header — but we still want to handle the
    // edge case where block 0 is empty.
    const size = extractResourceSizeLocal(resource.sizeAndAlignmentOnDisk[0]);
    if (size <= 0) {
      console.warn(`Resource has importCount=${resource.importCount} but block 0 is empty; skipping import read`);
      continue;
    }
    const base = bundleHeader.resourceDataOffsets[0] >>> 0;
    const rel = resource.diskOffsets[0] >>> 0;
    const start = (base + rel) >>> 0;
    if (start + size > buffer.byteLength) {
      console.warn('Resource block 0 runs past end of file; skipping import read');
      continue;
    }
    let bytes = new Uint8Array(buffer, start, size);
    if (isCompressedLocal(bytes)) bytes = decompressLocal(bytes);

    const importOff = resource.importOffset >>> 0;
    if (importOff + resource.importCount * 16 > bytes.byteLength) {
      console.warn(
        `Resource importOffset 0x${importOff.toString(16)} + ${resource.importCount}×16 ` +
        `runs past header block (${bytes.byteLength}); skipping`,
      );
      continue;
    }

    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < resource.importCount; i++) {
      const p = importOff + i * 16;
      const lo = dv.getUint32(p + 0, true);
      const hi = dv.getUint32(p + 4, true);
      const offset = dv.getUint32(p + 8, true);
      // 4 bytes of trailing padding per entry; preserved on the model so the
      // type matches ImportEntrySchema (which carries `padding: u32`).
      const padding = dv.getUint32(p + 12, true);
      imports.push({
        resourceId: { low: lo, high: hi },
        offset,
        padding,
      });
    }
  }

  return imports;
}

// Local copies of resourceManager helpers — bundle/bundleEntry.ts must not
// import from resourceManager.ts because resourceManager.ts already imports
// from this directory (would create a cycle). The two helpers are tiny.
function extractResourceSizeLocal(sizeAndAlignment: number): number {
  return sizeAndAlignment & 0x0FFFFFFF;
}

function isCompressedLocal(data: Uint8Array): boolean {
  // zlib magic: 0x78 followed by one of 0x01/0x9C/0xDA/0x5E.
  if (data.length < 2) return false;
  if (data[0] !== 0x78) return false;
  return data[1] === 0x01 || data[1] === 0x9C || data[1] === 0xDA || data[1] === 0x5E;
}

function decompressLocal(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return pako.inflate(data) as Uint8Array<ArrayBuffer>;
}

/**
 * Recover the per-resource import slice from the flat array returned by
 * {@link parseImportEntries}. The flat array is in resource order, so the
 * starting index for resource[i] is the running sum of `importCount` for
 * resources [0..i).
 *
 * Returns null if the resource has no imports.
 */
export function getResourceImportSlice(
  imports: ImportEntry[],
  resources: ResourceEntry[],
  resourceIndex: number,
): ImportEntry[] | null {
  let start = 0;
  for (let i = 0; i < resourceIndex; i++) start += resources[i].importCount;
  const count = resources[resourceIndex].importCount;
  if (count === 0) return null;
  return imports.slice(start, start + count);
}

/**
 * Build a Map<ptrOffset, resourceId (bigint)> for the imports belonging to
 * a specific resource.
 */
export function getImportsByPtrOffset(
  imports: ImportEntry[],
  resources: ResourceEntry[],
  resourceIndex: number,
): Map<number, bigint> {
  const slice = getResourceImportSlice(imports, resources, resourceIndex);
  const map = new Map<number, bigint>();
  if (!slice) return map;
  for (const entry of slice) {
    const id = (BigInt(entry.resourceId.high) << 32n) | BigInt(entry.resourceId.low);
    map.set(entry.offset, id);
  }
  return map;
}

/**
 * Returns all imported resource IDs (as bigint[]) for a specific resource.
 */
export function getImportIds(
  imports: ImportEntry[],
  resources: ResourceEntry[],
  resourceIndex: number,
): bigint[] {
  const slice = getResourceImportSlice(imports, resources, resourceIndex);
  if (!slice) return [];
  return slice.map((entry) => (BigInt(entry.resourceId.high) << 32n) | BigInt(entry.resourceId.low));
}
