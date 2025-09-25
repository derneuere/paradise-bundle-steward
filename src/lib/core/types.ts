// Core type definitions for Burnout Paradise Bundle system
// This file centralizes all shared types and interfaces

import type { Parsed } from 'typed-binary';
import type { ParsedVehicleList, VehicleListEntry } from './vehicleList';

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
  ICE_TAKE_DICTIONARY: 0x41,
} as const;

// ============================================================================
// Base Bundle Types (moved to bundle.ts)
// ============================================================================

// Re-export for backward compatibility
export type { ResourceEntry, ImportEntry } from './bundle/bundleEntry';

// Import types for ParsedBundle definition
import type { BundleHeader } from './bundle/bundleHeader';
import type { ResourceEntry, ImportEntry } from './bundle/bundleEntry';

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
// Vehicle Types (moved to vehicleList.ts)
// ============================================================================

// Re-export for backward compatibility
export type {
  VehicleType,
  CarType,
  LiveryType,
  Rank,
  AIEngineStream,
  VehicleListEntryGamePlayData,
  VehicleListEntryAudioData,
  VehicleListEntry,
  ParsedVehicleList
} from './vehicleList';

// ============================================================================
// Player Car Colors Types (moved to playerCarColors.ts)
// ============================================================================

// Re-export for backward compatibility
export type { PaletteType, PlayerCarColor } from './playerCarColors';

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
  overrides?: {
    vehicleList?: {
      vehicles: VehicleListEntry[];
      header?: ParsedVehicleList['header'];
    };
  };
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