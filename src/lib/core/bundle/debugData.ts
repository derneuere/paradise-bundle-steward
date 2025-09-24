// Debug data parsing for Burnout Paradise bundles
// Handles ResourceStringTable XML parsing

import { BundleHeader } from "./bundleHeader";
import { BUNDLE_FLAGS } from "../types";

// ============================================================================
// Debug Data Types
// ============================================================================

export type DebugResource = {
  id: string;
  name: string;
  typeName: string;
}

// ============================================================================
// Debug Data Parsing Functions
// ============================================================================

/**
 * Parses debug data XML from ResourceStringTable
 */
export function parseDebugDataFromXml(xmlData: string): DebugResource[] {
  const resources: DebugResource[] = [];

  try {
    // Simple XML parsing for ResourceStringTable
    // Look for <Resource> elements with Id, Name, and TypeName attributes
    const resourceRegex = /<Resource\s+([^>]+)>/g;
    let match;

    while ((match = resourceRegex.exec(xmlData)) !== null) {
      const attributes = match[1];

      // Extract attributes
      const idMatch = attributes.match(/Id\s*=\s*["']([^"']+)["']/);
      const nameMatch = attributes.match(/Name\s*=\s*["']([^"']+)["']/);
      const typeNameMatch = attributes.match(/TypeName\s*=\s*["']([^"']+)["']/);

      if (idMatch && nameMatch && typeNameMatch) {
        resources.push({
          id: idMatch[1],
          name: nameMatch[1],
          typeName: typeNameMatch[1]
        });
      }
    }
  } catch (error) {
    console.error('Error parsing debug data:', error);
  }

  return resources;
}


// ============================================================================
// Debug Data Parsing
// ============================================================================

export function parseDebugDataFromBuffer(buffer: ArrayBuffer, header: BundleHeader): string | undefined {
  if (!(header.flags & BUNDLE_FLAGS.HAS_DEBUG_DATA) || header.debugDataOffset === 0) {
    return undefined;
  }

  try {
    // Read debug data as UTF-8 string
    const debugView = new Uint8Array(buffer, header.debugDataOffset);
    const nullIndex = debugView.indexOf(0);
    const debugBytes = nullIndex >= 0 ? debugView.subarray(0, nullIndex) : debugView;
    const debugString = new TextDecoder('utf-8').decode(debugBytes);

    console.debug(`Debug data: found ${debugBytes.length} bytes of XML, total buffer had ${buffer.byteLength} bytes`);
    return debugString;
  } catch (error) {
    console.warn('Failed to parse debug data:', error);
    return undefined;
  }
}

// ============================================================================
// Debug Data Utility Functions
// ============================================================================

/**
 * Finds a debug resource by name
 */
export function findDebugResourceByName(debugResources: DebugResource[], name: string): DebugResource | undefined {
  return debugResources.find(r => r.name === name);
}

/**
 * Finds a debug resource by ID
 */
export function findDebugResourceById(debugResources: DebugResource[], id: string): DebugResource | undefined {
  return debugResources.find(r => r.id === id);
}
