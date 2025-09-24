// Centralized utilities for Paradise Bundle Steward
// Re-exports from all utility modules for convenient access

// Core utilities
export * from '../core/types';
export * from '../core/bundle/bundle';
export * from '../core/bundleParser';
export * from '../core/vehicleList';
export * from '../core/playerCarColors';
export * from '../core/debugData';
export * from '../core/resourceManager';

// Theme utilities (keeping separate for UI concerns)
export * from '../burnoutTheme';

// Resource type utilities
export * from '../resourceTypes';

// Original utils (tailwind merge)
export { cn } from '../utils';

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Creates a complete bundle parsing context with all necessary components
 */
export async function createBundleContext(
  buffer: ArrayBuffer,
  options?: import('../core/types').ParseOptions
) {
  const { parseBundle } = await import('../core/bundleParser');
  const { parseVehicleList } = await import('../core/vehicleList');
  const { parsePlayerCarColours } = await import('../core/playerCarColors');
  const { findResourceByType } = await import('../core/resourceManager');
  const { RESOURCE_TYPE_IDS } = await import('../core/types');

  const bundle = parseBundle(buffer, options);

  return {
    bundle,
    async getVehicleList() {
      const resource = findResourceByType(bundle.resources, RESOURCE_TYPE_IDS.VEHICLE_LIST);
      return resource ? parseVehicleList(buffer, resource, options) : null;
    },
    async getPlayerCarColours(is64Bit = false) {
      const resource = findResourceByType(bundle.resources, RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS);
      return resource ? parsePlayerCarColours(buffer, resource, is64Bit, options) : null;
    }
  };
}

/**
 * Quick bundle analysis without full parsing
 */
export function analyzeBundleQuick(buffer: ArrayBuffer) {
  const { parseBundle, getPlatformName, getFlagNames } = require('../core/bundleParser');
  const { calculateBundleStats } = require('../core/resourceManager');

  try {
    const bundle = parseBundle(buffer, { strict: false });
    const stats = calculateBundleStats(bundle, buffer);

    return {
      isValid: true,
      platform: getPlatformName(bundle.header.platform),
      flags: getFlagNames(bundle.header.flags),
      resourceCount: bundle.resources.length,
      hasDebugData: !!bundle.debugData,
      stats,
      error: null
    };
  } catch (error) {
    return {
      isValid: false,
      platform: 'Unknown',
      flags: [],
      resourceCount: 0,
      hasDebugData: false,
      stats: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 