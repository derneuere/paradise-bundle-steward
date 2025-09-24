// Bundle schemas, types, and reading/writing functions for Burnout Paradise Bundle 2 format

import {
  object,
  u32,
  type Parsed
} from 'typed-binary';

// ============================================================================
// Core Bundle Schemas
// ============================================================================

// Custom 64-bit integer schema (using two 32-bit values)
export const u64Schema = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
export function u64ToBigInt(u64: Parsed<typeof u64Schema>): bigint {
  return (BigInt(u64.high) << 32n) | BigInt(u64.low);
}

// Helper function to convert array of 8 bytes to bigint (little-endian)
export function bytesToBigInt(bytes: number[]): bigint {
  if (bytes.length !== 8) {
    throw new Error(`Expected 8 bytes, got ${bytes.length}`);
  }
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(bytes[i]) << (BigInt(i) * 8n);
  }
  return value;
}

// Helper function to convert bigint to u64 object
export function bigIntToU64(value: bigint): Parsed<typeof u64Schema> {
  return {
    low: Number(value & 0xFFFFFFFFn),
    high: Number((value >> 32n) & 0xFFFFFFFFn)
  };
}