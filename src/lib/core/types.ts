// Core type definitions for Burnout Paradise Bundle system
// This file centralizes all shared types and interfaces

import type { Parsed } from 'typed-binary';

// ============================================================================
// Platform and Bundle Constants
// ============================================================================

export const PLATFORMS = {
  PC: 1,
  XBOX360: 2,
  PS3: 3,
} as const;

export const BUNDLE_FLAGS = {
  COMPRESSED: 0x1,
  MAIN_MEM_OPTIMISED: 0x2,
  GRAPHICS_MEM_OPTIMISED: 0x4,
  HAS_DEBUG_DATA: 0x8,
} as const;

export const MEMORY_TYPES = {
  [PLATFORMS.PC]: ['Main Memory', 'Disposable', 'Dummy'],
  [PLATFORMS.XBOX360]: ['Main Memory', 'Physical', 'Dummy'],
  [PLATFORMS.PS3]: ['Main Memory', 'Graphics System', 'Graphics Local'],
} as const;

// ============================================================================
// Resource Type Constants
// ============================================================================

export const RESOURCE_TYPE_IDS = {
  VEHICLE_LIST: 0x10005,
  PLAYER_CAR_COLOURS: 0x1001E,
  TEXTURE: 0x00000002,
  MATERIAL: 0x00000003,
  MESH: 0x00000004,
  ANIMATION: 0x00000005,
  AUDIO: 0x00000006,
  SCRIPT: 0x00000007,
} as const;

// ============================================================================
// Base Bundle Types
// ============================================================================

export type BundleHeader = {
  magic: string;
  version: number;
  platform: number;
  debugDataOffset: number;
  resourceEntriesCount: number;
  resourceEntriesOffset: number;
  resourceDataOffsets: number[];
  flags: number;
}

export type ResourceEntry = {
  resourceId: bigint;
  importHash: bigint;
  uncompressedSizeAndAlignment: number[];
  sizeAndAlignmentOnDisk: number[];
  diskOffsets: number[];
  importOffset: number;
  resourceTypeId: number;
  importCount: number;
  flags: number;
  streamIndex: number;
}

export type ImportEntry = {
  resourceId: bigint;
  offset: number;
}

export type ParsedBundle = {
  header: BundleHeader;
  resources: ResourceEntry[];
  imports: ImportEntry[];
  debugData?: string;
}

// ============================================================================
// Resource Management Types
// ============================================================================

export type ResourceData = {
  data: Uint8Array;
  isCompressed: boolean;
  originalSize?: number;
}

export type ResourceContext = {
  bundle: ParsedBundle;
  resource: ResourceEntry;
  buffer: ArrayBuffer;
}

// ============================================================================
// Vehicle Types
// ============================================================================

export enum VehicleType {
  CAR = 0,
  BIKE = 1,
  PLANE = 2
}

export enum CarType {
  SPEED = 0,
  AGGRESSION = 1,
  STUNT = 2,
  NONE = 3,
  LOCKED = 4,
  INVALID = 5
}

export enum LiveryType {
  DEFAULT = 0,
  COLOUR = 1,
  PATTERN = 2,
  SILVER = 3,
  GOLD = 4,
  COMMUNITY = 5
}

export enum Rank {
  LEARNERS_PERMIT = 0,
  D_CLASS = 1,
  C_CLASS = 2,
  B_CLASS = 3,
  A_CLASS = 4,
  BURNOUT_LICENSE = 5
}

export enum AIEngineStream {
  NONE = 0,
  AIROD_EX = 1,
  AI_CIVIC_EX = 2,
  AI_GT_ENG = 3,
  AI_MUST_EX = 4,
  AI_F1_EX = 5,
  AI_BIKE_EX = 6
}

// ============================================================================
// Player Car Colors Types
// ============================================================================

export enum PaletteType {
  GLOSS = 0,
  METALLIC = 1,
  PEARLESCENT = 2,
  SPECIAL = 3,
  PARTY = 4,
  NUM_PALETTES = 5
}

export type PlayerCarColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  hexValue: string;
  rgbValue: string;
  isNeon: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

export class BundleError extends Error {
  constructor(message: string, public code?: string, public details?: unknown) {
    super(message);
    this.name = 'BundleError';
  }
}

export class ResourceNotFoundError extends BundleError {
  constructor(resourceTypeId: number) {
    super(`Resource type 0x${resourceTypeId.toString(16)} not found`, 'RESOURCE_NOT_FOUND', { resourceTypeId });
  }
}

export class CompressionError extends BundleError {
  constructor(message: string, details?: unknown) {
    super(`Compression error: ${message}`, 'COMPRESSION_ERROR', details);
  }
}

export class ValidationError extends BundleError {
  constructor(message: string, details?: unknown) {
    super(`Validation error: ${message}`, 'VALIDATION_ERROR', details);
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export type Platform = typeof PLATFORMS[keyof typeof PLATFORMS];
export type BundleFlag = typeof BUNDLE_FLAGS[keyof typeof BUNDLE_FLAGS];
export type ResourceTypeId = typeof RESOURCE_TYPE_IDS[keyof typeof RESOURCE_TYPE_IDS];

export type ParseOptions = {
  platform?: Platform;
  littleEndian?: boolean;
  strict?: boolean;
  validateChecksums?: boolean;
}

export type WriteOptions = {
  platform?: Platform;
  compress?: boolean;
  includeDebugData?: boolean;
  optimizeForMemory?: boolean;
}

// ============================================================================
// Event System Types (for progress tracking)
// ============================================================================

export type ProgressEvent = {
  type: 'parse' | 'write' | 'compress' | 'validate';
  stage: string;
  progress: number; // 0-1
  message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void; 