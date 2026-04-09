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
 * Parses debug data XML from ResourceStringTable.
 *
 * Stock BP PC bundles use lowercase attribute names: `<Resource id="..."
 * type="..." name="..."/>`. Some other tools or platforms emit capitalized
 * names (`Id`, `Name`, `TypeName`). We accept both, and normalize the type
 * field to `typeName` regardless of which attribute name was used.
 *
 * The id field is normalized to lowercase so per-resource lookups can use
 * a canonical key (BP IDs in the RST are 8-char hex without `0x`).
 */
export function parseDebugDataFromXml(xmlData: string): DebugResource[] {
  const resources: DebugResource[] = [];

  try {
    const resourceRegex = /<Resource\s+([^>]+?)\/?>/g;
    let match;

    while ((match = resourceRegex.exec(xmlData)) !== null) {
      const attributes = match[1];

      // Case-insensitive attribute extraction. Accept either spelling.
      const idMatch = attributes.match(/\b[Ii]d\s*=\s*["']([^"']+)["']/);
      const nameMatch = attributes.match(/\b[Nn]ame\s*=\s*["']([^"']+)["']/);
      const typeNameMatch =
        attributes.match(/\b[Tt]ype[Nn]ame\s*=\s*["']([^"']+)["']/) ??
        attributes.match(/\b[Tt]ype\s*=\s*["']([^"']+)["']/);

      if (idMatch && nameMatch && typeNameMatch) {
        resources.push({
          id: idMatch[1].toLowerCase(),
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
 * Normalize a resource id to the form RST entries store: lowercase hex
 * without `0x` prefix and without leading zeros. Accepts inputs in any of:
 *   - "0x0000000000334801" (formatResourceId output, uppercase, 16 chars)
 *   - "00334801"           (RST format, lowercase, 8 chars)
 *   - "334801"              (no leading zeros)
 *   - "0x334801"            (with 0x prefix, no padding)
 */
function normalizeResourceIdKey(id: string): string {
  let s = id.toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  // strip leading zeros but keep at least one digit
  s = s.replace(/^0+(?=.)/, '');
  return s;
}

/**
 * Finds a debug resource by ID. Tolerates the multiple id-string formats
 * floating around the codebase by normalizing both sides to a canonical
 * lowercase-no-prefix-no-leading-zeros form.
 */
export function findDebugResourceById(debugResources: DebugResource[], id: string): DebugResource | undefined {
  const target = normalizeResourceIdKey(id);
  return debugResources.find(r => normalizeResourceIdKey(r.id) === target);
}
