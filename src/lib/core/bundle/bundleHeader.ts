// Bundle header schema, types, and parsing functions for Burnout Paradise Bundle 2 format

import { BufferReader, object, arrayOf, u32, type Parsed, chars } from 'typed-binary';
import { ValidationError } from '../errors';

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
