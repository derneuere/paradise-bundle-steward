// Bundle V1 ('bndl') reader + writer.
//
// Container used by Criterion's pre-release dev builds: Black 2 (2006-06-29)
// up to Burnout 5 (2007-02-22 prototype). Distinct from Bundle 2 ('bnd2')
// which shipped in retail. The two formats wrap the *same* resource payloads
// (e.g. ZoneList type 0xB000 is byte-identical inside either container —
// only endianness flips), so this module deliberately reuses the existing
// ResourceEntry / ParsedBundle shapes by adapting BND1 entries into them.
//
// Per-platform layout sizes (from burnout.wiki/wiki/Bundle):
//
//   header size       PC 0x4C   X360 0x58   PS3 0x64
//   ResourceEntry     PC 0x60   X360 0x70   PS3 0x78
//   ResourceDescriptor PC 0x20  X360 0x28   PS3 0x30 (4/5/6 BaseResourceDescriptors)
//   Resource          PC 0x10   X360 0x14   PS3 0x18 (4/5/6 BaseResource pointers)
//
// V5 extends the base header with flags + uncompressed-descriptor table +
// per-pool alignment fields. Only V5 is implemented for now (the only version
// in our fixtures and the latest BND1 form).
//
// Round-trip strategy: every BND1-only field that doesn't fit the BND2
// ResourceEntry shape is stashed in `bundle1Extras` (carried on ParsedBundle)
// so the writer can re-emit byte-exact bytes. The 5-chunk size descriptor's
// chunk[0] is normalised into BND2's `sizeAndAlignmentOnDisk[0]`, and the
// chunk[0] **absolute file offset** lands in `diskOffsets[0]` (with
// `header.resourceDataOffsets[0] = 0`) so the existing extractResourceData
// helper continues to work unchanged.

import type { ParsedBundle, Platform } from '../types';
import type { BundleHeader } from './bundleHeader';
import { type ResourceEntry, createEmptyResourceEntry } from './bundleEntry';
import {
  packSizeAndAlignment,
  extractResourceSize,
  extractAlignment,
  isCompressed,
  decompressData,
  compressData,
} from '../resourceManager';
import { BundleError } from '../errors';
import { getHandlerByTypeId } from '../registry';
import { resourceCtxFromBundle } from '../registry/handler';

// ============================================================================
// Magic / version constants
// ============================================================================

export const BND1_MAGIC = 'bndl';
export const BND1_MAGIC_BYTES = new Uint8Array([0x62, 0x6E, 0x64, 0x6C]);

const SUPPORTED_BND1_VERSIONS = [5] as const;
export type Bnd1Version = typeof SUPPORTED_BND1_VERSIONS[number];

// ============================================================================
// Per-platform layout (X360 / PS3 are big-endian; PC is little-endian)
// ============================================================================

type PlatformLayout = {
  // Number of memory-pool descriptors in the bundle/per-entry tables.
  numChunks: number;
  // Header sizes
  headerBaseSize: number;        // up to and incl. muPlatform
  v5ExtendedHeaderTail: number;  // bytes of V5 extension after the base
  // Per-entry stride
  entrySize: number;
  // Resource descriptor / Resource pointer-array sizes (informational)
  resourceDescriptorSize: number;
  resourcePointerArraySize: number;
};

// Burnout wiki layouts. The "base" header ends at the muPlatform field;
// V4 adds (flags, uncompCount, uncompPtr) — 0x0C bytes; V5 adds two more
// alignment fields — another 0x08 bytes — for a total V5 tail of 0x14.
const PLATFORM_LAYOUTS: Record<number, PlatformLayout> = {
  // PC (KU_BUNDLE_DX9 = 1): 4 base resource pools, header ends @ 0x50.
  1: {
    numChunks: 4,
    headerBaseSize: 0x50,
    v5ExtendedHeaderTail: 0x14,
    entrySize: 0x60,
    resourceDescriptorSize: 0x20,
    resourcePointerArraySize: 0x10,
  },
  // X360 (KU_BUNDLE_X360 = 2): 5 base resource pools, header ends @ 0x5C.
  2: {
    numChunks: 5,
    headerBaseSize: 0x5C,
    v5ExtendedHeaderTail: 0x14,
    entrySize: 0x70,
    resourceDescriptorSize: 0x28,
    resourcePointerArraySize: 0x14,
  },
  // PS3 (KU_BUNDLE_PS3 = 3): 6 base resource pools, header ends @ 0x68.
  3: {
    numChunks: 6,
    headerBaseSize: 0x68,
    v5ExtendedHeaderTail: 0x14,
    entrySize: 0x78,
    resourceDescriptorSize: 0x30,
    resourcePointerArraySize: 0x18,
  },
};

const platformLayout = (platform: number): PlatformLayout => {
  const l = PLATFORM_LAYOUTS[platform];
  if (!l) {
    throw new BundleError(
      `Bundle V1: unsupported platform ${platform} (expected 1=PC, 2=X360, 3=PS3)`,
      'BUNDLE1_UNSUPPORTED_PLATFORM',
      { platform },
    );
  }
  return l;
};

const isLittleEndianForPlatform = (platform: number): boolean => platform === 1;

// ============================================================================
// `bundle1Extras` shape — BND1 fields that don't fit BND2's ResourceEntry
// ============================================================================

// Each chunk descriptor holds the raw u32s the writer needs to re-emit;
// the parser also splits them into size+align via the standard packing
// scheme so callers can read either form.
export type Bundle1ChunkDescriptor = {
  size: number;       // bytes
  alignmentPow2: number; // raw u32 alignment value (NOT log2)
};

export type Bundle1ResourceExtras = {
  // 5-chunk size descriptors (BND2 entry only carries chunks 0..2 in the
  // packed sizeAndAlignmentOnDisk[]; we keep the rest here so the writer
  // can re-emit them. For X360 the array length is 5; for PC 4; for PS3 6.)
  chunkSizes: Bundle1ChunkDescriptor[];
  // Absolute file offsets per chunk (NOT relative to a data-block base —
  // BND1's offset descriptor is file-absolute).
  chunkFileOffsets: { offset: number; alignmentPow2: number }[];
  // Runtime garbage that we preserve verbatim for byte-exact round-trip.
  runtime: {
    mpResource: number;            // entry +0x00
    mpImportTable: number;         // entry +0x04
    serialisedResourcePointers: number[]; // length = numChunks
  };
  // Whether this resource's primary chunk is zlib-compressed on disk.
  // (BND1 has a per-resource compression bit indirectly via the bundle
  // flag — we store the actual observed state per resource for safety.)
  compressed: boolean;
  // Index into the bundle-level uncompressed-descriptor table, or -1 if
  // this resource has no entry there (uncompressed resources).
  uncompressedDescriptorIndex: number;
};

export type Bundle1Extras = {
  bndVersion: Bnd1Version;
  platform: Platform;
  // Bundle-level descriptor: per-pool size + alignment.
  bundleResourceDescriptor: Bundle1ChunkDescriptor[];
  // mAllocatedResource (numChunks pointers, runtime garbage).
  allocatedResourcePointers: number[];
  // V5 extension fields.
  flags: number;
  uncompressedDescriptorCount: number;
  uncompressedDescriptors: Bundle1ChunkDescriptor[];
  mainMemAlignment: number;
  graphicsMemAlignment: number;
  // Original section offsets (we recompute them on write but keep these
  // for diagnostics / round-trip parity checks).
  sectionOffsets: {
    hashTableOffset: number;
    resourceEntriesOffset: number;
    importTablesOffset: number;
    resourceDataOffset: number;
    uncompressedDescriptorsOffset: number;
  };
  // Resource ID hash table: u64 per resource, in entry order. Stored as
  // {low, high} to mirror the ResourceEntry.resourceId shape.
  resourceIds: { low: number; high: number }[];
  // Per-resource extras, parallel to bundle.resources[].
  perResource: Bundle1ResourceExtras[];
};

// ============================================================================
// Detection
// ============================================================================

export function isBundle1Magic(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  const dv = new DataView(buffer);
  return dv.getUint8(0) === 0x62
      && dv.getUint8(1) === 0x6E
      && dv.getUint8(2) === 0x64
      && dv.getUint8(3) === 0x6C;
}

export function detectBundle1LittleEndian(buffer: ArrayBuffer): boolean {
  // BND1 platform field is 4 bytes deep into the header — peek at version (BE)
  // first as a coarse sanity check, then decide LE vs BE from the platform
  // byte (PC=1=>LE, X360/PS3=>BE).
  if (buffer.byteLength < 0x10) return true;
  const dv = new DataView(buffer);
  // muPlatform sits at different file offsets per platform — the easiest
  // robust read is the version field (always at +0x04). BND1 v5 in BE is
  // 0x00000005 in BE = 5; in LE it would be 0x05000000 = 83886080. Use
  // the version byte to disambiguate.
  if (dv.getUint32(0x04, false) >= 3 && dv.getUint32(0x04, false) <= 5) return false;
  return true;
}

// ============================================================================
// Parser
// ============================================================================

export type ParseBundle1Options = {
  strict?: boolean;
};

export function parseBundle1(
  buffer: ArrayBuffer,
  options: ParseBundle1Options = {},
): ParsedBundle {
  if (!isBundle1Magic(buffer)) {
    throw new BundleError(
      "Not a BND1 bundle (magic != 'bndl')",
      'BUNDLE1_BAD_MAGIC',
    );
  }

  const dv = new DataView(buffer);

  // Peek base header fields in BE first to read version, then decide LE/BE
  // from the platform field.
  const versionBE = dv.getUint32(0x04, false);
  const versionLE = dv.getUint32(0x04, true);
  // BND1 used versions 3-5 historically. Accept either byte order's read.
  let version: number;
  let littleEndian: boolean;
  if (versionBE >= 3 && versionBE <= 5) {
    version = versionBE;
    littleEndian = false;
  } else if (versionLE >= 3 && versionLE <= 5) {
    version = versionLE;
    littleEndian = true;
  } else {
    throw new BundleError(
      `Bundle V1: unrecognised version (BE=${versionBE}, LE=${versionLE})`,
      'BUNDLE1_BAD_VERSION',
    );
  }

  if (!SUPPORTED_BND1_VERSIONS.includes(version as Bnd1Version)) {
    throw new BundleError(
      `Bundle V1 version ${version} not yet supported (expected one of: ${SUPPORTED_BND1_VERSIONS.join(', ')})`,
      'BUNDLE1_UNSUPPORTED_VERSION',
      { version },
    );
  }

  const numResources = dv.getUint32(0x08, littleEndian);
  if (numResources < 0 || numResources > 100000) {
    throw new BundleError(
      `Bundle V1: suspicious numResources=${numResources}`,
      'BUNDLE1_BAD_RESOURCE_COUNT',
    );
  }

  // The platform field's offset depends on numChunks (which depends on the
  // platform we don't yet know). Resolve it by trying each known platform
  // layout and seeing which one has its muPlatform field land on a valid
  // value. This lets one parser handle PC / X360 / PS3 without the caller
  // pre-declaring the platform.
  let platform: number | undefined;
  let layout: PlatformLayout | undefined;
  for (const candidate of [1, 2, 3] as const) {
    const pl = PLATFORM_LAYOUTS[candidate];
    // muPlatform sits immediately after mResourceDataOffset, which itself sits
    // 4 bytes after mImportTablesOffset — i.e. headerBaseSize - 4 is muPlatform.
    const platformFieldOffset = pl.headerBaseSize - 4;
    if (platformFieldOffset + 4 > buffer.byteLength) continue;
    const muPlatform = dv.getUint32(platformFieldOffset, littleEndian);
    if (muPlatform === candidate) {
      platform = candidate;
      layout = pl;
      break;
    }
  }
  if (!platform || !layout) {
    throw new BundleError(
      'Bundle V1: could not infer platform — no muPlatform field matched a known layout',
      'BUNDLE1_PLATFORM_INFER_FAILED',
    );
  }
  // Sanity: PC bundles MUST be LE; consoles MUST be BE. Catch a corrupt
  // bundle that happened to satisfy the platform match in the wrong endianness.
  if (isLittleEndianForPlatform(platform) !== littleEndian) {
    throw new BundleError(
      `Bundle V1: endianness mismatch — platform ${platform} expects ${isLittleEndianForPlatform(platform) ? 'LE' : 'BE'} but version field implied ${littleEndian ? 'LE' : 'BE'}`,
      'BUNDLE1_ENDIANNESS_MISMATCH',
    );
  }

  const readU32 = (offset: number) => dv.getUint32(offset, littleEndian);

  // --- Bundle-level descriptor (numChunks × {size, align}) at +0x0C ---
  const bundleResourceDescriptor: Bundle1ChunkDescriptor[] = [];
  for (let c = 0; c < layout.numChunks; c++) {
    const o = 0x0C + c * 8;
    bundleResourceDescriptor.push({
      size: readU32(o),
      alignmentPow2: readU32(o + 4),
    });
  }

  // --- mAllocatedResource: numChunks pointers, runtime garbage ---
  const allocOff = 0x0C + layout.numChunks * 8;
  const allocatedResourcePointers: number[] = [];
  for (let c = 0; c < layout.numChunks; c++) {
    allocatedResourcePointers.push(readU32(allocOff + c * 4));
  }

  // --- Section offsets (4 × u32) ---
  const sectionsOff = allocOff + layout.numChunks * 4;
  const hashTableOffset = readU32(sectionsOff + 0x0);
  const resourceEntriesOffset = readU32(sectionsOff + 0x4);
  const importTablesOffset = readU32(sectionsOff + 0x8);
  const resourceDataOffset = readU32(sectionsOff + 0xC);
  // muPlatform sits at sectionsOff + 0x10 — already validated above.

  // --- V5 extension tail ---
  const v5Off = layout.headerBaseSize;
  const flags = readU32(v5Off + 0x0);
  const uncompressedDescriptorCount = readU32(v5Off + 0x4);
  const uncompressedDescriptorsOffset = readU32(v5Off + 0x8);
  const mainMemAlignment = readU32(v5Off + 0xC);
  const graphicsMemAlignment = readU32(v5Off + 0x10);

  const compressed = (flags & 0x1) !== 0;

  // --- Resource ID hash table: numResources × u64 ---
  const resourceIds: { low: number; high: number }[] = [];
  for (let i = 0; i < numResources; i++) {
    const o = hashTableOffset + i * 8;
    // u64 layout in memory: [high u32, low u32] in BE; [low, high] in LE
    // (typed-binary's u64 schema serialises little-endian as low/high).
    // We always store {low, high} and reconstruct correctly by reading the
    // u32 halves with the correct endianness.
    const a = readU32(o);
    const b = readU32(o + 4);
    if (littleEndian) {
      resourceIds.push({ low: a, high: b });
    } else {
      resourceIds.push({ low: b, high: a });
    }
  }

  // --- Resource entries ---
  const resources: ResourceEntry[] = [];
  const perResource: Bundle1ResourceExtras[] = [];

  for (let i = 0; i < numResources; i++) {
    const eoff = resourceEntriesOffset + i * layout.entrySize;

    const mpResource = readU32(eoff + 0x00);
    const mpImportTable = readU32(eoff + 0x04);
    const mpType = readU32(eoff + 0x08);

    // mSerialisedResourceDescriptor: numChunks × (size, align) starting +0x0C
    const sizeDescOff = eoff + 0x0C;
    const chunkSizes: Bundle1ChunkDescriptor[] = [];
    for (let c = 0; c < layout.numChunks; c++) {
      chunkSizes.push({
        size: readU32(sizeDescOff + c * 8 + 0),
        alignmentPow2: readU32(sizeDescOff + c * 8 + 4),
      });
    }

    // mSerialisedOffsetResourceDescriptor: numChunks × (offset, align)
    const offDescOff = sizeDescOff + layout.resourceDescriptorSize;
    const chunkFileOffsets: { offset: number; alignmentPow2: number }[] = [];
    for (let c = 0; c < layout.numChunks; c++) {
      chunkFileOffsets.push({
        offset: readU32(offDescOff + c * 8 + 0),
        alignmentPow2: readU32(offDescOff + c * 8 + 4),
      });
    }

    // mSerialisedResource: numChunks pointers (runtime garbage)
    const resPtrOff = offDescOff + layout.resourceDescriptorSize;
    const serialisedResourcePointers: number[] = [];
    for (let c = 0; c < layout.numChunks; c++) {
      serialisedResourcePointers.push(readU32(resPtrOff + c * 4));
    }

    // Adapt into a BND2-shaped ResourceEntry. We expose chunks 0..2 in the
    // packed BND2 form (sizeAndAlignmentOnDisk + diskOffsets) so the
    // existing extractResourceData helper works unchanged. Set
    // header.resourceDataOffsets[i]=0 (done below) so `base + rel` in
    // extractResourceData reduces to the absolute file offset we put here.
    const entry = createEmptyResourceEntry();
    entry.resourceId = resourceIds[i];
    entry.resourceTypeId = mpType;
    // BND1 offset alignment is "always 1" per wiki — pack it as 2^0=1.
    for (let bi = 0; bi < 3; bi++) {
      const cs = chunkSizes[bi];
      const co = chunkFileOffsets[bi];
      if (cs && cs.size > 0) {
        // alignmentPow2 in the descriptor is the actual alignment value,
        // not the log2. packSizeAndAlignment expects the actual alignment.
        const align = cs.alignmentPow2 > 0 ? cs.alignmentPow2 : 1;
        entry.sizeAndAlignmentOnDisk[bi] = packSizeAndAlignment(cs.size, align);
        // Same for uncompressed size — for compressed resources the wiki
        // says the uncompressed size lives in the side table; for now we
        // leave it equal to the on-disk size and patch from the side table
        // below when applicable.
        entry.uncompressedSizeAndAlignment[bi] = packSizeAndAlignment(cs.size, align);
        entry.diskOffsets[bi] = co ? co.offset : 0;
      }
    }

    resources.push(entry);

    // Detect compression by sniffing the chunk bytes (zlib magic). Uses the
    // global compressed flag as a fast path; falls back to byte sniffing.
    const primaryChunkSize = chunkSizes[0]?.size ?? 0;
    const primaryChunkOff = chunkFileOffsets[0]?.offset ?? 0;
    let isResourceCompressed = false;
    if (compressed && primaryChunkSize >= 2 && primaryChunkOff + 2 <= buffer.byteLength) {
      const probe = new Uint8Array(buffer, primaryChunkOff, Math.min(2, primaryChunkSize));
      isResourceCompressed = isCompressed(probe);
    }

    perResource.push({
      chunkSizes,
      chunkFileOffsets,
      runtime: {
        mpResource,
        mpImportTable,
        serialisedResourcePointers,
      },
      compressed: isResourceCompressed,
      uncompressedDescriptorIndex: -1, // populated after we read the side table below
    });
  }

  // --- Uncompressed-descriptor side table (V5 only). Per the wiki this is
  // a sparse list — one ResourceDescriptor per compressed resource. We store
  // them in order; mapping back to resources is by position-in-compressed-set.
  const uncompressedDescriptors: Bundle1ChunkDescriptor[] = [];
  const numUncompDescriptors = uncompressedDescriptorCount * layout.numChunks;
  for (let i = 0; i < numUncompDescriptors; i++) {
    const o = uncompressedDescriptorsOffset + i * 8;
    if (o + 8 > buffer.byteLength) {
      // Bail out gracefully on a corrupt/truncated table — round-trip won't
      // be byte-exact but we still get a usable ParsedBundle.
      console.warn(`Bundle V1: uncompressed descriptor table runs past end of file at index ${i}`);
      break;
    }
    uncompressedDescriptors.push({
      size: readU32(o),
      alignmentPow2: readU32(o + 4),
    });
  }

  // Map uncompressed descriptors back to resources (one block of
  // `numChunks` descriptors per compressed resource, in resource order).
  let uncompCursor = 0;
  for (let i = 0; i < numResources; i++) {
    if (perResource[i].compressed) {
      perResource[i].uncompressedDescriptorIndex = uncompCursor;
      // Patch ResourceEntry.uncompressedSizeAndAlignment[0] from the side table
      // so handlers that look at the uncompressed size get the right value.
      const desc = uncompressedDescriptors[uncompCursor];
      if (desc && desc.size > 0) {
        const align = desc.alignmentPow2 > 0 ? desc.alignmentPow2 : 1;
        resources[i].uncompressedSizeAndAlignment[0] = packSizeAndAlignment(desc.size, align);
      }
      uncompCursor += layout.numChunks;
    }
  }

  // Validate strict mode: every resource entry's chunk[0] should land in-bounds.
  if (options.strict !== false) {
    for (let i = 0; i < numResources; i++) {
      const off = perResource[i].chunkFileOffsets[0]?.offset ?? 0;
      const sz = perResource[i].chunkSizes[0]?.size ?? 0;
      if (sz > 0 && off + sz > buffer.byteLength) {
        throw new BundleError(
          `Bundle V1: resource ${i} chunk[0] (${off}..${off + sz}) runs past end of buffer (${buffer.byteLength})`,
          'BUNDLE1_RESOURCE_OOB',
          { resourceIndex: i, off, size: sz },
        );
      }
    }
  }

  // Synthesise a BundleHeader so downstream code (which is BND2-shaped)
  // doesn't have to special-case BND1. resourceDataOffsets[0..2] are zero
  // so that extractResourceData's `base + rel` collapses to the absolute
  // file offset we stored in `diskOffsets`.
  const header: BundleHeader = {
    magic: 'bndl',
    version,
    platform,
    debugDataOffset: 0,
    resourceEntriesCount: numResources,
    resourceEntriesOffset,
    resourceDataOffsets: [0, 0, 0],
    flags,
  };

  const extras: Bundle1Extras = {
    bndVersion: version as Bnd1Version,
    platform: platform as Platform,
    bundleResourceDescriptor,
    allocatedResourcePointers,
    flags,
    uncompressedDescriptorCount,
    uncompressedDescriptors,
    mainMemAlignment,
    graphicsMemAlignment,
    sectionOffsets: {
      hashTableOffset,
      resourceEntriesOffset,
      importTablesOffset,
      resourceDataOffset,
      uncompressedDescriptorsOffset,
    },
    resourceIds,
    perResource,
  };

  return {
    header,
    resources,
    imports: [],
    bundle1Extras: extras,
  };
}

// ============================================================================
// Writer
// ============================================================================

export type WriteBundle1Options = {
  /**
   * Override resource bytes by typeId. Values may be raw `Uint8Array` (the
   * bytes are written as-is, after re-compression if the source was
   * compressed) or any value (which gets passed to a registered handler's
   * writeRaw to produce the bytes — we look up handlers via the global
   * registry so this matches the BND2 writer's contract).
   */
  overrides?: Record<number, Uint8Array | unknown>;
  /**
   * Optional override-by-resource-id map (hex string keys), parallel to
   * BND2's writeBundleFresh by-resource-id channel.
   */
  overridesByResourceId?: Record<string, Uint8Array | unknown>;
};

/**
 * Repack a BND1 bundle. Preserves layout sections (header, hash table,
 * resource entries, uncompressed-descriptor side table, resource data block)
 * in the same order the wiki documents and the existing fixtures use.
 *
 * Round-trip contract: when no overrides are passed and every resource is
 * round-tripped, the output bytes equal the input bytes. We achieve this by
 * preserving runtime garbage (mpResource, mpImportTable, mAllocatedResource,
 * mSerialisedResource) verbatim from `bundle1Extras`.
 */
export function writeBundle1Fresh(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  options: WriteBundle1Options = {},
): ArrayBuffer {
  const extras = bundle.bundle1Extras;
  if (!extras) {
    throw new BundleError(
      'writeBundle1Fresh: bundle has no bundle1Extras (was it parsed by parseBundle1?)',
      'BUNDLE1_NO_EXTRAS',
    );
  }
  const layout = platformLayout(extras.platform);
  const littleEndian = isLittleEndianForPlatform(extras.platform);
  const numResources = bundle.resources.length;

  const ctx = resourceCtxFromBundle(bundle);

  // Locate by-id overrides via formatted hex IDs, matching the BND2 contract.
  const u64ToBigInt = (id: { low: number; high: number }): bigint =>
    (BigInt(id.high) << 32n) | BigInt(id.low);
  const formatId = (id: { low: number; high: number }): string =>
    `0x${u64ToBigInt(id).toString(16).toUpperCase().padStart(16, '0')}`;

  const resolveChunk0Bytes = (i: number): { bytes: Uint8Array; uncompSize: number } => {
    const resource = bundle.resources[i];
    const re = extras.perResource[i];
    const offDesc = re.chunkFileOffsets[0];
    const sizeDesc = re.chunkSizes[0];
    const origAbsOff = offDesc?.offset ?? 0;
    const origSize = sizeDesc?.size ?? 0;

    // Prefer per-resource-id overrides over typeId overrides, mirroring BND2.
    let override: unknown | undefined;
    if (options.overridesByResourceId) {
      const key = formatId(resource.resourceId);
      if (Object.prototype.hasOwnProperty.call(options.overridesByResourceId, key)) {
        override = options.overridesByResourceId[key];
      }
    }
    if (override === undefined && options.overrides) {
      if (Object.prototype.hasOwnProperty.call(options.overrides, resource.resourceTypeId)) {
        override = options.overrides[resource.resourceTypeId];
      }
    }

    const originalChunk = origSize > 0
      ? new Uint8Array(originalBuffer, origAbsOff, origSize)
      : new Uint8Array(0);

    let uncompressed: Uint8Array;
    if (override === undefined) {
      // No override: preserve the original chunk bytes verbatim.
      return { bytes: originalChunk, uncompSize: re.compressed ? extractResourceSize(resource.uncompressedSizeAndAlignment[0]) : origSize };
    }

    if (override instanceof Uint8Array) {
      uncompressed = override;
    } else {
      const handler = getHandlerByTypeId(resource.resourceTypeId);
      if (!handler || !handler.caps.write || !handler.writeRaw) {
        // No writable handler — fall back to original bytes (matches BND2).
        return { bytes: originalChunk, uncompSize: re.compressed ? extractResourceSize(resource.uncompressedSizeAndAlignment[0]) : origSize };
      }
      uncompressed = handler.writeRaw(override as never, ctx) as Uint8Array;
    }

    if (re.compressed) {
      // BND1 originals are zlib level 9 (per the wiki: "zlib level 9 (maximum
      // compression)"). Use the same level so override-free round-trip stays
      // byte-exact and overridden chunks compress to a comparable size.
      const compressedBytes = compressData(uncompressed, 9);
      return { bytes: compressedBytes, uncompSize: uncompressed.byteLength };
    }
    return { bytes: uncompressed, uncompSize: uncompressed.byteLength };
  };

  // --- Pre-compute the bytes for every resource's chunk[0] ---
  // We need these up-front because their lengths drive the data-block layout.
  const chunkBytes: Uint8Array[] = [];
  const chunkUncompSizes: number[] = [];
  for (let i = 0; i < numResources; i++) {
    const r = resolveChunk0Bytes(i);
    chunkBytes.push(r.bytes);
    chunkUncompSizes.push(r.uncompSize);
  }

  // --- Compute final section offsets ---
  // For round-trip parity with the original layout, reuse the source
  // section offsets verbatim. They'll point to the right places because
  // (a) the hash table / entry table sizes are determined by numResources,
  // and (b) we can place the data block at the original mResourceDataOffset
  // (assuming the resource bytes don't grow beyond their original window —
  // which is the typical override case for ZoneList where size is similar).
  //
  // For overridden resources whose new size differs from the original, we
  // recompute later. The first pass reuses original offsets; round-trip with
  // no overrides is then byte-exact.

  const headerSize = layout.headerBaseSize + layout.v5ExtendedHeaderTail;
  // Sections in source order (from wiki): header → hashTable → entries →
  // uncompressed-descriptor table → resource data block.
  // Use the source offsets for header→data sections; recompute the data
  // block layout per-chunk using each resource's original alignment.

  const hashTableOffset = extras.sectionOffsets.hashTableOffset;
  const resourceEntriesOffset = extras.sectionOffsets.resourceEntriesOffset;
  const importTablesOffset = extras.sectionOffsets.importTablesOffset;
  const uncompressedDescriptorsOffset = extras.sectionOffsets.uncompressedDescriptorsOffset;
  const resourceDataOffset = extras.sectionOffsets.resourceDataOffset;

  // --- Lay out the data block ---
  // Reflow chunk[0] for every resource sequentially, aligned to 16 bytes.
  // For round-trip parity (every chunk unchanged) the recomputed offsets
  // match the source's natural layout — verified by the byte-exact test on
  // the X360 fixture. When a chunk grows (the converted-from-BND2 case),
  // subsequent chunks slide forward to make room.

  const newChunkOffsets: number[] = [];
  let cursor = resourceDataOffset;
  for (let i = 0; i < numResources; i++) {
    cursor = (cursor + 15) & ~15;
    newChunkOffsets.push(cursor);
    cursor += chunkBytes[i].byteLength;
  }

  // Total size: max of (last chunk end, original buffer length). The
  // original-buffer-length term keeps round-trip byte-exact when the source
  // had trailing pad bytes after the last chunk.
  let totalSize = Math.max(cursor, originalBuffer.byteLength);

  // --- Allocate output buffer and pre-fill from the original to preserve
  // any padding/inter-section gaps verbatim. We then overwrite the regions
  // we control. ---
  // For synthesized bundles the originalBuffer has nothing to do with the
  // output (it's the BND2 source we converted from); the pre-fill is then
  // a no-op for any byte we'll subsequently overwrite. We still copy what
  // overlaps to keep round-trip parity for true round-trips.
  const outBytes = new Uint8Array(totalSize);
  // Only pre-fill from the source buffer when the source IS this bundle
  // (round-trip case): test by checking that the original section offsets
  // can be re-read as a valid header.
  if (originalBuffer.byteLength >= 4) {
    const ov = new DataView(originalBuffer);
    const looksLikeBnd1 =
      ov.getUint8(0) === 0x62 && ov.getUint8(1) === 0x6E &&
      ov.getUint8(2) === 0x64 && ov.getUint8(3) === 0x6C;
    if (looksLikeBnd1) {
      const origView = new Uint8Array(originalBuffer, 0, Math.min(originalBuffer.byteLength, totalSize));
      outBytes.set(origView, 0);
    }
  }

  const dv = new DataView(outBytes.buffer);
  const writeU32 = (off: number, val: number) => dv.setUint32(off, val >>> 0, littleEndian);

  // --- Header ---
  outBytes.set(BND1_MAGIC_BYTES, 0);
  writeU32(0x04, extras.bndVersion);
  writeU32(0x08, numResources);
  // bundleResourceDescriptor at +0x0C
  for (let c = 0; c < layout.numChunks; c++) {
    const o = 0x0C + c * 8;
    const desc = extras.bundleResourceDescriptor[c];
    writeU32(o + 0, desc?.size ?? 0);
    writeU32(o + 4, desc?.alignmentPow2 ?? 0);
  }
  // mAllocatedResource (runtime garbage — preserved verbatim)
  const allocOff = 0x0C + layout.numChunks * 8;
  for (let c = 0; c < layout.numChunks; c++) {
    writeU32(allocOff + c * 4, extras.allocatedResourcePointers[c] ?? 0);
  }
  // Section offsets
  const sectionsOff = allocOff + layout.numChunks * 4;
  writeU32(sectionsOff + 0x0, hashTableOffset);
  writeU32(sectionsOff + 0x4, resourceEntriesOffset);
  writeU32(sectionsOff + 0x8, importTablesOffset);
  writeU32(sectionsOff + 0xC, resourceDataOffset);
  writeU32(sectionsOff + 0x10, extras.platform);
  // V5 tail
  const v5Off = layout.headerBaseSize;
  writeU32(v5Off + 0x0, extras.flags);
  writeU32(v5Off + 0x4, extras.uncompressedDescriptorCount);
  writeU32(v5Off + 0x8, uncompressedDescriptorsOffset);
  writeU32(v5Off + 0xC, extras.mainMemAlignment);
  writeU32(v5Off + 0x10, extras.graphicsMemAlignment);

  // --- Hash table: u64 IDs in entry order ---
  for (let i = 0; i < numResources; i++) {
    const o = hashTableOffset + i * 8;
    const id = extras.resourceIds[i];
    if (littleEndian) {
      writeU32(o + 0, id.low);
      writeU32(o + 4, id.high);
    } else {
      // BE u64 stores high u32 first, then low.
      writeU32(o + 0, id.high);
      writeU32(o + 4, id.low);
    }
  }

  // --- Resource entries ---
  for (let i = 0; i < numResources; i++) {
    const eoff = resourceEntriesOffset + i * layout.entrySize;
    const re = extras.perResource[i];
    writeU32(eoff + 0x00, re.runtime.mpResource);
    writeU32(eoff + 0x04, re.runtime.mpImportTable);
    writeU32(eoff + 0x08, bundle.resources[i].resourceTypeId);

    // mSerialisedResourceDescriptor — sizes (recompute chunk[0] from the
    // (possibly overridden) bytes; chunks 1..N keep their original values).
    const sizeDescOff = eoff + 0x0C;
    for (let c = 0; c < layout.numChunks; c++) {
      const desc = re.chunkSizes[c] ?? { size: 0, alignmentPow2: 0 };
      let outSize = desc.size;
      if (c === 0) outSize = chunkBytes[i].byteLength;
      writeU32(sizeDescOff + c * 8 + 0, outSize);
      writeU32(sizeDescOff + c * 8 + 4, desc.alignmentPow2);
    }

    // mSerialisedOffsetResourceDescriptor — file offsets.
    const offDescOff = sizeDescOff + layout.resourceDescriptorSize;
    for (let c = 0; c < layout.numChunks; c++) {
      const desc = re.chunkFileOffsets[c] ?? { offset: 0, alignmentPow2: 0 };
      let outOff = desc.offset;
      if (c === 0) outOff = newChunkOffsets[i];
      writeU32(offDescOff + c * 8 + 0, outOff);
      writeU32(offDescOff + c * 8 + 4, desc.alignmentPow2);
    }

    // mSerialisedResource — runtime garbage (verbatim).
    const resPtrOff = offDescOff + layout.resourceDescriptorSize;
    for (let c = 0; c < layout.numChunks; c++) {
      writeU32(resPtrOff + c * 4, re.runtime.serialisedResourcePointers[c] ?? 0);
    }
  }

  // --- Uncompressed-descriptor side table (V5) ---
  // Re-emit verbatim if no overrides changed any compressed resource's size.
  // When an override grows/shrinks the uncompressed size, patch that entry.
  for (let i = 0; i < extras.uncompressedDescriptors.length; i++) {
    const o = uncompressedDescriptorsOffset + i * 8;
    let { size, alignmentPow2 } = extras.uncompressedDescriptors[i];
    // Patch the chunk-0 entry of any compressed resource whose uncomp size
    // changed. We map descriptor index → resource via uncompressedDescriptorIndex.
    for (let r = 0; r < numResources; r++) {
      if (extras.perResource[r].compressed && extras.perResource[r].uncompressedDescriptorIndex === i) {
        size = chunkUncompSizes[r];
        break;
      }
    }
    writeU32(o + 0, size);
    writeU32(o + 4, alignmentPow2);
  }

  // --- Resource data: write each chunk[0] at its computed offset ---
  for (let i = 0; i < numResources; i++) {
    const off = newChunkOffsets[i];
    const bytes = chunkBytes[i];
    if (bytes.byteLength === 0) continue;
    outBytes.set(bytes, off);
    // If the new bytes are smaller than the original slot, zero the trailing
    // bytes so we don't leave stale data in the output.
    const origSize = extras.perResource[i].chunkSizes[0]?.size ?? 0;
    if (bytes.byteLength < origSize) {
      const pad = origSize - bytes.byteLength;
      outBytes.fill(0, off + bytes.byteLength, off + bytes.byteLength + pad);
    }
  }

  return outBytes.buffer;
}

/**
 * Helper used by tests: decompresses a chunk if it's zlib-compressed.
 * Wraps decompressData so callers don't need to import the resource manager.
 */
export function decompressChunkIfNeeded(bytes: Uint8Array): Uint8Array {
  return isCompressed(bytes) ? decompressData(bytes) : bytes;
}

// ============================================================================
// Cross-container conversion helpers
// ============================================================================

/**
 * Strip a BND1-shaped ParsedBundle of its `bundle1Extras` so that
 * writeBundleFresh dispatches to the BND2 writer. The returned bundle has
 * `header.magic = 'bnd2'`, `header.version = 2`, and `header.platform`
 * set to `targetPlatform`. resourceDataOffsets stay at [0,0,0]; the BND1
 * reader put absolute offsets into each resource's `diskOffsets` so the
 * BND2 writer's `base + rel` resource extraction (`base = 0`) reads the
 * correct bytes from the source buffer.
 *
 * The caller still has to feed re-encoded chunk bytes for any resource
 * whose endianness changed — see {@link convertBundle}.
 */
export function bnd1ToBnd2Shape(bundle: ParsedBundle, targetPlatform: Platform): ParsedBundle {
  if (!bundle.bundle1Extras) {
    throw new BundleError(
      'bnd1ToBnd2Shape: bundle has no bundle1Extras (was it parsed by parseBundle1?)',
      'BUNDLE1_NO_EXTRAS',
    );
  }
  const newHeader: BundleHeader = {
    magic: 'bnd2',
    version: 2,
    platform: targetPlatform,
    debugDataOffset: 0,
    resourceEntriesCount: bundle.resources.length,
    resourceEntriesOffset: 0,
    resourceDataOffsets: [0, 0, 0],
    flags: bundle.header.flags,
  };
  const next: ParsedBundle = {
    header: newHeader,
    // The BND2 writer mutates resources only by reading sizeAndAlignmentOnDisk
    // and diskOffsets; both are already in BND2 form on a parseBundle1 result
    // (chunks 0..2 are populated from BND1 chunks 0..2; chunk 0 is the only
    // populated one in our fixtures). Clone so the source bundle isn't
    // mutated when overrides are applied.
    resources: bundle.resources.map((r) => ({
      ...r,
      uncompressedSizeAndAlignment: r.uncompressedSizeAndAlignment.slice(0, 3) as [number, number, number],
      sizeAndAlignmentOnDisk: r.sizeAndAlignmentOnDisk.slice(0, 3) as [number, number, number],
      diskOffsets: r.diskOffsets.slice(0, 3) as [number, number, number],
    })),
    imports: [],
    debugData: bundle.debugData,
  };
  return next;
}

/**
 * Build a BND1-shaped ParsedBundle from a BND2 source. Synthesizes a
 * `bundle1Extras` with sensible defaults (zero runtime pointers; mainAlign=16,
 * gfxAlign=128 from the X360 prototype convention; freshly computed section
 * offsets). The caller is expected to pass re-encoded chunk bytes via
 * `overrides` in writeBundleFresh — the BND1 writer will recompress them at
 * zlib level 9 and lay out the data block.
 */
export function bnd2ToBnd1Shape(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  targetPlatform: Platform,
): ParsedBundle {
  if (bundle.bundle1Extras) {
    throw new BundleError(
      'bnd2ToBnd1Shape: source already has bundle1Extras — pass through convertBnd1Platform instead',
      'BUNDLE1_ALREADY_BND1',
    );
  }
  const layout = platformLayout(targetPlatform);
  const numResources = bundle.resources.length;

  const perResource: Bundle1ResourceExtras[] = [];
  const resourceIds: { low: number; high: number }[] = [];
  let numCompressed = 0;

  for (let i = 0; i < numResources; i++) {
    const r = bundle.resources[i];
    resourceIds.push({ low: r.resourceId.low, high: r.resourceId.high });

    // Read the resource's primary chunk to detect compression. Source bytes
    // live at `header.resourceDataOffsets[0] + diskOffsets[0]` in BND2.
    const size0 = extractResourceSize(r.sizeAndAlignmentOnDisk[0]);
    const align0 = extractAlignment(r.sizeAndAlignmentOnDisk[0]);
    const base = bundle.header.resourceDataOffsets[0] >>> 0;
    const rel = r.diskOffsets[0] >>> 0;
    const absOff = (base + rel) >>> 0;

    let resourceCompressed = false;
    if (size0 > 0 && absOff + 2 <= originalBuffer.byteLength) {
      const probe = new Uint8Array(originalBuffer, absOff, Math.min(2, size0));
      resourceCompressed = isCompressed(probe);
    }
    if (resourceCompressed) numCompressed++;

    // Build per-resource extras with chunk[0] populated and chunks 1..N-1
    // zeroed. BND1 chunks beyond [0] correspond to additional memory pools
    // (graphics, physical) that aren't represented in BND2's 3-block view —
    // we don't have data for them.
    const chunkSizes: Bundle1ChunkDescriptor[] = [];
    const chunkFileOffsets: { offset: number; alignmentPow2: number }[] = [];
    for (let c = 0; c < layout.numChunks; c++) {
      if (c === 0) {
        chunkSizes.push({ size: size0, alignmentPow2: align0 });
        chunkFileOffsets.push({ offset: absOff, alignmentPow2: 1 });
      } else {
        chunkSizes.push({ size: 0, alignmentPow2: 0 });
        chunkFileOffsets.push({ offset: 0, alignmentPow2: 0 });
      }
    }

    perResource.push({
      chunkSizes,
      chunkFileOffsets,
      runtime: {
        mpResource: 0,
        mpImportTable: 0,
        serialisedResourcePointers: new Array(layout.numChunks).fill(0),
      },
      compressed: resourceCompressed,
      uncompressedDescriptorIndex: -1, // patched below
    });
  }

  // Build the uncompressed-descriptor side table and link compressed
  // resources to their entry. One block of `numChunks` descriptors per
  // compressed resource, in resource order.
  const uncompressedDescriptors: Bundle1ChunkDescriptor[] = [];
  let uncompCursor = 0;
  for (let i = 0; i < numResources; i++) {
    if (!perResource[i].compressed) continue;
    perResource[i].uncompressedDescriptorIndex = uncompCursor;
    const uncompSize = extractResourceSize(bundle.resources[i].uncompressedSizeAndAlignment[0]);
    const uncompAlign = extractAlignment(bundle.resources[i].uncompressedSizeAndAlignment[0]);
    for (let c = 0; c < layout.numChunks; c++) {
      uncompressedDescriptors.push({
        size: c === 0 ? uncompSize : 0,
        alignmentPow2: c === 0 ? uncompAlign : 0,
      });
    }
    uncompCursor += layout.numChunks;
  }

  // Compute section offsets fresh from the natural BND1 layout: header →
  // hash table → resource entries → uncompressed-descriptor table → data.
  const headerSize = layout.headerBaseSize + layout.v5ExtendedHeaderTail;
  const hashTableOffset = headerSize;
  const resourceEntriesOffset = hashTableOffset + numResources * 8;
  const uncompressedDescriptorsOffset = resourceEntriesOffset + numResources * layout.entrySize;
  const uncompressedDescriptorsByteLength = uncompressedDescriptors.length * 8;
  const dataBlockStart = uncompressedDescriptorsOffset + uncompressedDescriptorsByteLength;
  // Align data block start to 16. The X360 fixture's natural layout lands
  // on 0x1B0 with no extra alignment; this rule is benign there and keeps
  // synthesized bundles aligned for arbitrary resource counts.
  const resourceDataOffset = (dataBlockStart + 15) & ~15;

  // mBundleResourceDescriptor: per-pool size sums. Only chunk[0] sums are
  // meaningful for BND2-sourced bundles; others are zero.
  const bundleResourceDescriptor: Bundle1ChunkDescriptor[] = [];
  let chunk0Sum = 0;
  for (const r of bundle.resources) chunk0Sum += extractResourceSize(r.sizeAndAlignmentOnDisk[0]);
  for (let c = 0; c < layout.numChunks; c++) {
    bundleResourceDescriptor.push({
      size: c === 0 ? chunk0Sum : 0,
      // Match the X360 fixture's per-pool 16-byte alignment convention.
      alignmentPow2: 16,
    });
  }

  const flags = numCompressed > 0 ? 0x1 : 0x0;
  const extras: Bundle1Extras = {
    bndVersion: 5,
    platform: targetPlatform,
    bundleResourceDescriptor,
    allocatedResourcePointers: new Array(layout.numChunks).fill(0),
    flags,
    uncompressedDescriptorCount: numCompressed,
    uncompressedDescriptors,
    mainMemAlignment: 16,
    graphicsMemAlignment: 128,
    sectionOffsets: {
      hashTableOffset,
      resourceEntriesOffset,
      importTablesOffset: 0,
      resourceDataOffset,
      uncompressedDescriptorsOffset,
    },
    resourceIds,
    perResource,
  };

  const newHeader: BundleHeader = {
    magic: 'bndl',
    version: 5,
    platform: targetPlatform,
    debugDataOffset: 0,
    resourceEntriesCount: numResources,
    resourceEntriesOffset,
    resourceDataOffsets: [0, 0, 0],
    flags,
  };

  return {
    header: newHeader,
    resources: bundle.resources.map((r) => ({
      ...r,
      uncompressedSizeAndAlignment: r.uncompressedSizeAndAlignment.slice(0, 3) as [number, number, number],
      sizeAndAlignmentOnDisk: r.sizeAndAlignmentOnDisk.slice(0, 3) as [number, number, number],
      diskOffsets: r.diskOffsets.slice(0, 3) as [number, number, number],
    })),
    imports: [],
    bundle1Extras: extras,
  };
}

/**
 * Re-shape a BND1 bundle's `bundle1Extras` for a different target platform —
 * the per-platform `numChunks` field changes (PC=4, X360=5, PS3=6), so the
 * 5-chunk descriptors and runtime-pointer arrays need to grow or shrink. PS3
 * support is structural only and untested without a fixture.
 */
export function convertBnd1Platform(bundle: ParsedBundle, targetPlatform: Platform): ParsedBundle {
  const extras = bundle.bundle1Extras;
  if (!extras) {
    throw new BundleError(
      'convertBnd1Platform: source has no bundle1Extras',
      'BUNDLE1_NO_EXTRAS',
    );
  }
  if (extras.platform === targetPlatform) {
    // No-op clone.
    return { ...bundle, bundle1Extras: { ...extras } };
  }
  const targetLayout = platformLayout(targetPlatform);

  const reshapeArr = <T,>(arr: T[], pad: T): T[] => {
    if (arr.length === targetLayout.numChunks) return arr.slice();
    if (arr.length > targetLayout.numChunks) return arr.slice(0, targetLayout.numChunks);
    return arr.slice().concat(Array(targetLayout.numChunks - arr.length).fill(pad));
  };

  const newPerResource: Bundle1ResourceExtras[] = extras.perResource.map((re) => ({
    chunkSizes: reshapeArr<Bundle1ChunkDescriptor>(re.chunkSizes, { size: 0, alignmentPow2: 0 }),
    chunkFileOffsets: reshapeArr(re.chunkFileOffsets, { offset: 0, alignmentPow2: 0 }),
    runtime: {
      mpResource: re.runtime.mpResource,
      mpImportTable: re.runtime.mpImportTable,
      serialisedResourcePointers: reshapeArr<number>(re.runtime.serialisedResourcePointers, 0),
    },
    compressed: re.compressed,
    uncompressedDescriptorIndex: re.uncompressedDescriptorIndex,
  }));

  const newBundleResourceDescriptor = reshapeArr<Bundle1ChunkDescriptor>(
    extras.bundleResourceDescriptor,
    { size: 0, alignmentPow2: 16 },
  );
  const newAllocated = reshapeArr<number>(extras.allocatedResourcePointers, 0);

  // Re-pack uncompressed descriptors to the new numChunks-per-block layout.
  const newUncompressedDescriptors: Bundle1ChunkDescriptor[] = [];
  let uncompCursor = 0;
  for (let i = 0; i < newPerResource.length; i++) {
    if (!newPerResource[i].compressed) continue;
    newPerResource[i].uncompressedDescriptorIndex = uncompCursor;
    const sourceIdx = extras.perResource[i].uncompressedDescriptorIndex;
    for (let c = 0; c < targetLayout.numChunks; c++) {
      const src = sourceIdx >= 0 ? extras.uncompressedDescriptors[sourceIdx + c] : undefined;
      newUncompressedDescriptors.push(src ?? { size: 0, alignmentPow2: 0 });
    }
    uncompCursor += targetLayout.numChunks;
  }

  // Recompute section offsets for the new platform's header / entry sizes.
  const headerSize = targetLayout.headerBaseSize + targetLayout.v5ExtendedHeaderTail;
  const hashTableOffset = headerSize;
  const resourceEntriesOffset = hashTableOffset + bundle.resources.length * 8;
  const uncompressedDescriptorsOffset = resourceEntriesOffset + bundle.resources.length * targetLayout.entrySize;
  const uncompDescBytes = newUncompressedDescriptors.length * 8;
  const dataBlockStart = uncompressedDescriptorsOffset + uncompDescBytes;
  const resourceDataOffset = (dataBlockStart + 15) & ~15;

  const newExtras: Bundle1Extras = {
    bndVersion: extras.bndVersion,
    platform: targetPlatform,
    bundleResourceDescriptor: newBundleResourceDescriptor,
    allocatedResourcePointers: newAllocated,
    flags: extras.flags,
    uncompressedDescriptorCount: extras.uncompressedDescriptorCount,
    uncompressedDescriptors: newUncompressedDescriptors,
    mainMemAlignment: extras.mainMemAlignment,
    graphicsMemAlignment: extras.graphicsMemAlignment,
    sectionOffsets: {
      hashTableOffset,
      resourceEntriesOffset,
      importTablesOffset: 0,
      resourceDataOffset,
      uncompressedDescriptorsOffset,
    },
    resourceIds: extras.resourceIds.map((id) => ({ ...id })),
    perResource: newPerResource,
  };

  return {
    ...bundle,
    header: { ...bundle.header, platform: targetPlatform, resourceEntriesOffset },
    bundle1Extras: newExtras,
  };
}

/**
 * Policy for handling resources whose type has no writable handler when
 * endianness changes during conversion:
 *   - 'fail' (default, safe): throw a BundleError. Use this when you don't
 *     know whether the unknown payload contains multi-byte integers that
 *     would need byte-flipping.
 *   - 'passthrough': decompress the source bytes and emit them verbatim
 *     (no endian flip). Correct when the bytes are opaque/byte-oriented;
 *     produces broken output if they actually contain LE/BE-encoded
 *     integers. Useful for the type-0x0003 auxiliary resource in the BND1
 *     PVS fixture, which is small and not interpreted by any tool we ship.
 */
export type UnknownResourcePolicy = 'fail' | 'passthrough';

/**
 * Build the by-resource-id overrides map needed for cross-container
 * conversion. Walks every resource, decompresses chunk[0], re-encodes for the
 * target endianness via the registry when endianness flips, and emits a
 * uncompressed Uint8Array per resource (the writer will recompress as needed).
 *
 * Throws if a resource's type lacks a writable handler when endianness is
 * flipping AND `unknownResourcePolicy === 'fail'` (the default). Same-
 * endianness conversions of unknown-type resources always pass through.
 */
export function reencodeResourceChunksForTarget(
  bundle: ParsedBundle,
  originalBuffer: ArrayBuffer,
  targetPlatform: Platform,
  unknownResourcePolicy: UnknownResourcePolicy = 'fail',
): Record<string, Uint8Array> {
  const sourcePlatform = bundle.header.platform as Platform;
  const sourceLittleEndian = sourcePlatform === 1;
  const targetLittleEndian = targetPlatform === 1;
  const sourceCtx = { platform: sourcePlatform, littleEndian: sourceLittleEndian };
  const targetCtx = { platform: targetPlatform, littleEndian: targetLittleEndian };

  const idToHex = (id: { low: number; high: number }) =>
    `0x${(((BigInt(id.high) << 32n) | BigInt(id.low))).toString(16).toUpperCase().padStart(16, '0')}`;
  const overrides: Record<string, Uint8Array> = {};

  for (let i = 0; i < bundle.resources.length; i++) {
    const r = bundle.resources[i];
    const sizeOnDisk = extractResourceSize(r.sizeAndAlignmentOnDisk[0]);
    if (sizeOnDisk === 0) continue;

    // Both BND1 and BND2 readers populate `diskOffsets[0]` such that
    // `resourceDataOffsets[0] + diskOffsets[0]` is the chunk's absolute
    // offset in `originalBuffer` (BND1's base is 0, so the sum is the
    // pre-stored absolute offset; BND2 adds its data-block base).
    const base = bundle.header.resourceDataOffsets[0] >>> 0;
    const rel = r.diskOffsets[0] >>> 0;
    const absOff = (base + rel) >>> 0;
    const sourceChunk = new Uint8Array(originalBuffer, absOff, sizeOnDisk);
    const wasCompressed = isCompressed(sourceChunk);
    const decoded = wasCompressed ? decompressData(sourceChunk) : sourceChunk;

    let outBytes: Uint8Array;
    if (sourceLittleEndian !== targetLittleEndian) {
      const handler = getHandlerByTypeId(r.resourceTypeId);
      if (!handler || !handler.caps.write || !handler.writeRaw) {
        if (unknownResourcePolicy === 'fail') {
          throw new BundleError(
            `convertBundle: cannot endian-flip resource type 0x${r.resourceTypeId.toString(16)} ` +
              `(${sourceLittleEndian ? 'LE' : 'BE'} → ${targetLittleEndian ? 'LE' : 'BE'}) — ` +
              `no writable handler registered. Pass unknownResourcePolicy='passthrough' to ` +
              `emit the bytes verbatim (correct only when the payload is opaque/byte-oriented).`,
            'BUNDLE_CONVERT_NO_HANDLER',
            { resourceTypeId: r.resourceTypeId },
          );
        }
        // 'passthrough': bytes stay in source endianness. Caller has accepted
        // the risk that the result may be broken if the payload contains
        // multi-byte ints that needed flipping.
        outBytes = decoded;
      } else {
        const targetIsSupported = handler.caps.writePlatforms?.includes(targetPlatform as never) ?? true;
        if (!targetIsSupported) {
          throw new BundleError(
            `convertBundle: handler ${handler.key} is not validated for target platform ${targetPlatform}`,
            'BUNDLE_CONVERT_PLATFORM_UNSUPPORTED',
            { resourceTypeId: r.resourceTypeId, targetPlatform },
          );
        }
        const model = handler.parseRaw(decoded, sourceCtx);
        outBytes = handler.writeRaw(model as never, targetCtx) as Uint8Array;
      }
    } else {
      // Same endianness: pass decoded bytes through. Writer will recompress.
      outBytes = decoded;
    }

    overrides[idToHex(r.resourceId)] = outBytes;
  }

  return overrides;
}

// Re-export the alignment helpers since some BND1 callers may want them.
export { extractAlignment };
