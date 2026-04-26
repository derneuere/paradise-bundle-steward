// Bundle header schema, types, and parsing functions for Burnout Paradise Bundle 2 format

import { BufferReader, object, arrayOf, u32, type Parsed, chars } from 'typed-binary';
import { ValidationError } from '../errors';

/**
 * Detect a Bundle's endianness by inspecting the version field at byte 4.
 *
 * - Bundle 2 ('bnd2'): version is always 2 — read as LE first, fall back to BE.
 * - Bundle 1 ('bndl'): versions 3-5 known. We read as BE first because every
 *   known BND1 fixture is X360/PS3 (BE); a hypothetical LE BND1 would still
 *   be detected via the LE fallback.
 *
 * Returns `true` for little-endian, defaulting to LE for truncated or
 * unrecognised buffers.
 */
export function detectBundleLittleEndian(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return true;
  const view = new DataView(buffer);
  // BND1 dispatch — magic 'bndl' (0x62 0x6E 0x64 0x6C). Versions 3-5.
  if (
    view.getUint8(0) === 0x62 && view.getUint8(1) === 0x6E &&
    view.getUint8(2) === 0x64 && view.getUint8(3) === 0x6C
  ) {
    const versionBE = view.getUint32(4, false);
    if (versionBE >= 3 && versionBE <= 5) return false;
    const versionLE = view.getUint32(4, true);
    if (versionLE >= 3 && versionLE <= 5) return true;
    return false; // BND1 default: BE (every known fixture is X360/PS3).
  }
  // BND2 dispatch — magic 'bnd2'. Version is always 2.
  if (view.getUint32(4, true) === 2) return true;
  if (view.getUint32(4, false) === 2) return false;
  return true;
}

// Bundle header schema including magic prefix for convenience
export const BundleHeaderSchema = object({
  magic: chars(4),         // 4 bytes, typically "bnd2"
  version: u32,
  platform: u32,
  debugDataOffset: u32,
  resourceEntriesCount: u32,
  resourceEntriesOffset: u32,
  resourceDataOffsets: arrayOf(u32, 3),
  flags: u32
});

export type BundleHeader = Parsed<typeof BundleHeaderSchema>;

/**
 * Parses the bundle header from a BufferReader
 */
export function parseHeader(
  reader: BufferReader,
  buffer: ArrayBuffer,
  options: { strict?: boolean; littleEndian?: boolean } = {}
): BundleHeader {
  // Read header including magic via schema
  reader.seekTo(0);
  const header = BundleHeaderSchema.read(reader);

  // Validate header
  if (options.strict !== false) {
    const errors = validateBundleHeader(header);
    if (errors.length > 0) {
      throw new ValidationError(
        `Invalid bundle header: ${errors.map(e => e.message).join(', ')}`,
        { header, errors }
      );
    }
  }

  return header;
}

// ============================================================================
// Bundle Header Validation
// ============================================================================

/**
 * Validates bundle header
 */
export function validateBundleHeader(header: BundleHeader): ValidationError[] {
  const errors: ValidationError[] = [];

  if (header.magic !== 'bnd2') {
    errors.push(new ValidationError(`Invalid bundle magic: ${header.magic}`));
  }

  if (header.version !== 2) {
    errors.push(new ValidationError(`Unsupported bundle version: ${header.version}`));
  }

  if (![1, 2, 3].includes(header.platform)) {
    errors.push(new ValidationError(`Invalid platform: ${header.platform}`));
  }

  if (header.resourceEntriesCount < 0 || header.resourceEntriesCount > 10000) {
    errors.push(new ValidationError(`Suspicious resource count: ${header.resourceEntriesCount}`));
  }

  return errors;
}
