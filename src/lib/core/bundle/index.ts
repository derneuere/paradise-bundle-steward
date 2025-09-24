// Bundle parsing functions for Burnout Paradise Bundle 2 format

import { BufferReader } from 'typed-binary';
import {
  parseResourceEntries,
  parseImportEntries
} from './bundleEntry';
import { parseHeader } from './bundleHeader';
import { parseDebugDataFromBuffer } from './debugData';
import {
  ParsedBundle,
  ParseOptions,
  ProgressCallback,
  BUNDLE_FLAGS,
  PLATFORMS
} from '../types';
import { BundleError } from '../errors';
import {
  validateResourceEntry,
  calculateBundleStats
} from '../resourceManager';
import { parseVehicleList, type ParsedVehicleList } from '../vehicleList';
import { parsePlayerCarColours, type PlayerCarColours } from '../playerCarColors';
import { RESOURCE_TYPES } from '../../resourceTypes';

// ============================================================================
// Main Bundle Parser
// ============================================================================

/**
 * Parses a Burnout Paradise Bundle 2 format file
 */
export function parseBundle(
  buffer: ArrayBuffer,
  options: ParseOptions = {},
  progressCallback?: ProgressCallback
): ParsedBundle {
  try {
    reportProgress(progressCallback, 'parse', 0, 'Starting bundle parsing');

    const reader = new BufferReader(buffer, {
      endianness: options.littleEndian !== false ? 'little' : 'big'
    });

    reportProgress(progressCallback, 'parse', 0.1, 'Parsing bundle header');

    // Parse header
    const header = parseHeader(reader, buffer, options);

    reportProgress(progressCallback, 'parse', 0.3, 'Parsing resource entries');

    // Parse resource entries
    const resources = parseResourceEntries(reader, header, buffer.byteLength, options);

    // Validate resource entries
    if (options.strict !== false) {
      for (let i = 0; i < resources.length; i++) {
        const errors = validateResourceEntry(resources[i], buffer.byteLength);
        if (errors.length > 0) {
          console.warn(`Resource entry ${i} validation warnings:`, errors.map(e => e.message));
        }
      }
    }

    reportProgress(progressCallback, 'parse', 0.6, 'Parsing import entries');

    // Parse imports
    const imports = parseImportEntries(reader, resources);

    reportProgress(progressCallback, 'parse', 0.8, 'Parsing debug data');

    // Parse debug data
    const debugData = parseDebugDataFromBuffer(buffer, header);

    reportProgress(progressCallback, 'parse', 1.0, 'Bundle parsing complete');

    const bundle: ParsedBundle = {
      header,
      resources,
      imports,
      debugData
    };

    // Log bundle statistics
    const stats = calculateBundleStats(bundle, buffer);
    console.debug('Bundle statistics:', stats);

    return bundle;

  } catch (error) {
    if (error instanceof BundleError) {
      throw error;
    }
    throw new BundleError(
      `Failed to parse bundle: ${error instanceof Error ? error.message : String(error)}`,
      'PARSE_ERROR',
      { error, bufferSize: buffer.byteLength }
    );
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getPlatformName(platform: number): string {
  const platforms = {
    1: 'PC',
    2: 'Xbox 360',
    3: 'PlayStation 3'
  } as const;

  return platforms[platform as keyof typeof platforms] || `Unknown (${platform})`;
}

export function getFlagNames(flags: number): string[] {
  const flagNames: string[] = [];

  if (flags & BUNDLE_FLAGS.COMPRESSED) flagNames.push('Compressed');
  if (flags & BUNDLE_FLAGS.MAIN_MEM_OPTIMISED) flagNames.push('Main Memory Optimized');
  if (flags & BUNDLE_FLAGS.GRAPHICS_MEM_OPTIMISED) flagNames.push('Graphics Memory Optimized');
  if (flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) flagNames.push('Has Debug Data');

  return flagNames.length > 0 ? flagNames : ['None'];
}

export function formatResourceId(resourceId: bigint): string {
  return `0x${resourceId.toString(16).toUpperCase().padStart(16, '0')}`;
}

function reportProgress(
  callback: ProgressCallback | undefined,
  type: string,
  progress: number,
  message?: string
) {
  callback?.({ type: type as 'parse' | 'write' | 'compress' | 'validate', stage: type, progress, message });
}

// ============================================================================
// Resource-Specific Parsing
// ============================================================================

/**
 * Result of parsing all known resource types from a bundle
 */
export type ParsedResources = {
  vehicleList?: ParsedVehicleList;
  playerCarColours?: PlayerCarColours;
};

/**
 * Parses a specific resource type from bundle data
 */
function parseResourceType<T>(
  buffer: ArrayBuffer,
  bundle: ParsedBundle,
  resourceName: string,
  parseFn: (buffer: ArrayBuffer, resource: any, options: any) => T
): T | null {
  const resourceType = Object.values(RESOURCE_TYPES).find(rt => rt.name === resourceName);
  if (!resourceType) return null;

  const resource = bundle.resources.find(r => r.resourceTypeId === resourceType.id);
  if (!resource) return null;

  try {
    let options: any = {};

    // Set platform-specific options
    if (resourceName === 'Vehicle List') {
      options.littleEndian = bundle.header.platform !== PLATFORMS.PS3;
    } else if (resourceName === 'Player Car Colours') {
      options.is64Bit = bundle.header.platform === PLATFORMS.PC;
      options.strict = false;
    }

    return parseFn(buffer, resource, options);
  } catch (error) {
    console.warn(`Failed to parse ${resourceName}:`, error);
    return null;
  }
}

/**
 * Parses all known resource types from a bundle
 */
export function parseBundleResources(
  buffer: ArrayBuffer,
  bundle: ParsedBundle
): ParsedResources {
  const resources: ParsedResources = {};

  // Parse vehicle list
  const vehicleList = parseResourceType(
    buffer,
    bundle,
    'Vehicle List',
    parseVehicleList
  );
  if (vehicleList) {
    resources.vehicleList = vehicleList;
  }

  // Parse player car colours
  const playerCarColours = parseResourceType(
    buffer,
    bundle,
    'Player Car Colours',
    parsePlayerCarColours
  );
  if (playerCarColours) {
    resources.playerCarColours = playerCarColours;
  }

  return resources;
}
