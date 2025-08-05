// Burnout Paradise Bundle 2 format parser
// Refactored to use centralized core architecture with improved error handling

import { BufferReader } from 'typed-binary';
import type { 
  BundleHeader, 
  ResourceEntry, 
  ImportEntry, 
  ParsedBundle,
  ParseOptions,
  ProgressCallback
} from '../core/types';
import { 
  BundleHeaderSchema, 
  ResourceEntrySchema, 
  ImportEntrySchema,
  u64ToBigInt 
} from '../core/schemas';
import { 
  validateBundleHeader,
  validateResourceEntry,
  calculateBundleStats 
} from '../core/resourceManager';
import { 
  BundleError, 
  ValidationError,
  BUNDLE_FLAGS 
} from '../core/types';

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
    
    reportProgress(progressCallback, 'parse', 0.6, 'Parsing import entries');
    
    // Parse imports
    const imports = parseImportEntries(reader, resources);
    
    reportProgress(progressCallback, 'parse', 0.8, 'Parsing debug data');
    
    // Parse debug data
    const debugData = parseDebugData(buffer, header);
    
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
// Header Parsing
// ============================================================================

function parseHeader(
  reader: BufferReader, 
  buffer: ArrayBuffer, 
  options: ParseOptions
): BundleHeader {
  // Parse magic string first
  const magicBytes = new Uint8Array(buffer, 0, 4);
  const magic = new TextDecoder().decode(magicBytes);
  
  reader.seekTo(4); // Skip past magic string
  
  // Parse rest of header
  const headerRest = BundleHeaderSchema.read(reader);
  
  const header: BundleHeader = {
    magic,
    ...headerRest
  };

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
// Resource Entry Parsing
// ============================================================================

function parseResourceEntries(
  reader: BufferReader,
  header: BundleHeader,
  bufferSize: number,
  options: ParseOptions
): ResourceEntry[] {
  const resources: ResourceEntry[] = [];
  reader.seekTo(header.resourceEntriesOffset);

  for (let i = 0; i < header.resourceEntriesCount; i++) {
    try {
      const rawResource = ResourceEntrySchema.read(reader);
      
      const resource: ResourceEntry = {
        ...rawResource,
        resourceId: u64ToBigInt(rawResource.resourceId),
        importHash: u64ToBigInt(rawResource.importHash)
      };

      // Validate resource entry
      if (options.strict !== false) {
        const errors = validateResourceEntry(resource, bufferSize);
        if (errors.length > 0) {
          console.warn(`Resource entry ${i} validation warnings:`, errors.map(e => e.message));
        }
      }

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

function parseImportEntries(reader: BufferReader, resources: ResourceEntry[]): ImportEntry[] {
  const imports: ImportEntry[] = [];

  for (const resource of resources) {
    if (resource.importCount > 0) {
      reader.seekTo(resource.importOffset);
      
      for (let i = 0; i < resource.importCount; i++) {
        try {
          const rawImport = ImportEntrySchema.read(reader);
          
          const importEntry: ImportEntry = {
            resourceId: u64ToBigInt(rawImport.resourceId),
            offset: rawImport.offset
          };
          
          imports.push(importEntry);
          
        } catch (error) {
          console.warn(`Failed to parse import ${i} for resource ${resource.resourceId.toString(16)}:`, error);
        }
      }
    }
  }

  return imports;
}

// ============================================================================
// Debug Data Parsing
// ============================================================================

function parseDebugData(buffer: ArrayBuffer, header: BundleHeader): string | undefined {
  if (!(header.flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) || header.debugDataOffset === 0) {
    return undefined;
  }

  try {
    const remaining = buffer.byteLength - header.debugDataOffset;
    if (remaining <= 0) {
      console.warn('Debug data offset is beyond buffer end');
      return undefined;
    }

    const debugBytes = new Uint8Array(buffer, header.debugDataOffset, remaining);
    let debugData = new TextDecoder().decode(debugBytes);
    
    // Clean up the string - remove null bytes and trim
    debugData = debugData.replace(/\0/g, '').trim();
    
    return debugData.length > 0 ? debugData : undefined;
    
  } catch (error) {
    console.warn('Failed to parse debug data:', error);
    return undefined;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets platform name from platform ID
 */
export function getPlatformName(platform: number): string {
  switch (platform) {
    case 1: return 'PC';
    case 2: return 'Xbox 360';
    case 3: return 'PlayStation 3';
    default: return `Unknown (${platform})`;
  }
}

/**
 * Gets flag names from flags value
 */
export function getFlagNames(flags: number): string[] {
  const flagNames: string[] = [];
  if (flags & BUNDLE_FLAGS.COMPRESSED) flagNames.push('Compressed');
  if (flags & BUNDLE_FLAGS.MAIN_MEM_OPTIMISED) flagNames.push('Main Memory Optimised');
  if (flags & BUNDLE_FLAGS.GRAPHICS_MEM_OPTIMISED) flagNames.push('Graphics Memory Optimised');
  if (flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) flagNames.push('Has Debug Data');
  return flagNames;
}

/**
 * Formats a resource ID as a hex string
 */
export function formatResourceId(resourceId: bigint): string {
  return `0x${resourceId.toString(16).toUpperCase().padStart(16, '0')}`;
}

/**
 * Reports progress to callback if provided
 */
function reportProgress(
  callback: ProgressCallback | undefined,
  type: 'parse' | 'write' | 'compress' | 'validate',
  progress: number,
  message: string
): void {
  if (callback) {
    callback({
      type,
      stage: message,
      progress,
      message
    });
  }
}

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================

// Re-export core functionality that was previously in this file
export { 
  extractResourceSize, 
  extractAlignment,
  getMemoryTypeName,
  formatResourceId as formatResourceIdLegacy
} from '../core/resourceManager';

export type { BundleHeader, ResourceEntry, ImportEntry, ParsedBundle } from '../core/types'; 