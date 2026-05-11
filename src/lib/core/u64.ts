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
export const u64 = object({
  low: u32,
  high: u32
});

// Helper function to convert u64 object to bigint
export function u64ToBigInt(input: Parsed<typeof u64>): bigint {
  return (BigInt(input.high) << 32n) | BigInt(input.low);
}

// Helper function to convert bigint to u64 object
export function bigIntToU64(value: bigint): Parsed<typeof u64> {
  return {
    low: Number(value & 0xFFFFFFFFn),
    high: Number((value >> 32n) & 0xFFFFFFFFn)
  };
}