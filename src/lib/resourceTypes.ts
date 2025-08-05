// Resource Type Definitions and Utilities
// Refactored to use core architecture with improved type safety

import type { ResourceTypeId } from './core/types';
import { RESOURCE_TYPE_IDS } from './core/types';

// ============================================================================
// Resource Type Interface
// ============================================================================

export interface ResourceType {
  id: number;
  name: string;
  description: string;
  category: ResourceCategory;
  parser?: string; // Optional parser module name
  writer?: string; // Optional writer module name
}

export type ResourceCategory = 'Graphics' | 'Audio' | 'Data' | 'Script' | 'Other';

// ============================================================================
// Extended Resource Type Definitions
// ============================================================================

export const RESOURCE_TYPES: Record<number, ResourceType> = {
  // Core Bundle Types
  0x00000001: { 
    id: 0x00000001, 
    name: 'Registry', 
    description: 'Configuration and registry data', 
    category: 'Data' 
  },
  
  // Graphics Resources
  0x00000002: { 
    id: 0x00000002, 
    name: 'Texture', 
    description: 'Image texture data (DDS, etc.)', 
    category: 'Graphics',
    parser: 'textureParser',
    writer: 'textureWriter'
  },
  0x00000003: { 
    id: 0x00000003, 
    name: 'Material', 
    description: 'Material properties and shaders', 
    category: 'Graphics' 
  },
  0x00000004: { 
    id: 0x00000004, 
    name: 'Mesh', 
    description: '3D geometry and vertex data', 
    category: 'Graphics' 
  },
  0x00000005: { 
    id: 0x00000005, 
    name: 'Animation', 
    description: 'Animation sequences and keyframes', 
    category: 'Graphics' 
  },
  0x00000008: { 
    id: 0x00000008, 
    name: 'Font', 
    description: 'Font data and glyph information', 
    category: 'Graphics' 
  },
  0x00000009: { 
    id: 0x00000009, 
    name: 'Shader', 
    description: 'GPU shader programs (vertex/pixel)', 
    category: 'Graphics' 
  },
  0x0000000A: { 
    id: 0x0000000A, 
    name: 'Model', 
    description: 'Complete 3D models (vehicles/objects)', 
    category: 'Graphics' 
  },
  0x00000010: { 
    id: 0x00000010, 
    name: 'Particle', 
    description: 'Particle effects and systems', 
    category: 'Graphics' 
  },
  0x00000011: { 
    id: 0x00000011, 
    name: 'Lighting', 
    description: 'Lighting data and environment maps', 
    category: 'Graphics' 
  },
  0x00000013: { 
    id: 0x00000013, 
    name: 'UI', 
    description: 'User interface elements and layouts', 
    category: 'Graphics' 
  },
  0x00000014: { 
    id: 0x00000014, 
    name: 'Skybox', 
    description: 'Sky and environment textures', 
    category: 'Graphics' 
  },

  // Audio Resources
  0x00000006: { 
    id: 0x00000006, 
    name: 'Audio', 
    description: 'Sound effects, music, and voice audio', 
    category: 'Audio',
    parser: 'audioParser',
    writer: 'audioWriter'
  },

  // Script Resources
  0x00000007: { 
    id: 0x00000007, 
    name: 'Script', 
    description: 'Game logic scripts and bytecode', 
    category: 'Script' 
  },

  // Data Resources
  0x0000000B: { 
    id: 0x0000000B, 
    name: 'Physics', 
    description: 'Physics properties and constraints', 
    category: 'Data' 
  },
  0x0000000C: { 
    id: 0x0000000C, 
    name: 'Collision', 
    description: 'Collision mesh and bounds data', 
    category: 'Data' 
  },
  0x0000000D: { 
    id: 0x0000000D, 
    name: 'Localization', 
    description: 'Localized text and language data', 
    category: 'Data' 
  },
  0x0000000E: { 
    id: 0x0000000E, 
    name: 'Track', 
    description: 'Race track and road network data', 
    category: 'Data' 
  },
  0x0000000F: { 
    id: 0x0000000F, 
    name: 'Vehicle', 
    description: 'Individual vehicle configuration', 
    category: 'Data' 
  },
  0x00000012: { 
    id: 0x00000012, 
    name: 'Navigation', 
    description: 'AI navigation and pathfinding data', 
    category: 'Data' 
  },

  // Burnout Paradise Specific Resources
  [RESOURCE_TYPE_IDS.VEHICLE_LIST]: { 
    id: RESOURCE_TYPE_IDS.VEHICLE_LIST, 
    name: 'Vehicle List', 
    description: 'Complete list of all available vehicles with stats and properties', 
    category: 'Data',
    parser: 'vehicleListParser',
    writer: 'vehicleListWriter'
  },
  [RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS]: { 
    id: RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS, 
    name: 'Player Car Colours', 
    description: 'Available player car color palettes and paint options', 
    category: 'Graphics',
    parser: 'playerCarColoursParser',
    writer: 'playerCarColoursWriter'
  },
};

// ============================================================================
// Resource Type Utilities
// ============================================================================

/**
 * Gets resource type information by ID
 */
export function getResourceType(typeId: number): ResourceType {
  return RESOURCE_TYPES[typeId] || {
    id: typeId,
    name: 'Unknown',
    description: `Unknown resource type (0x${typeId.toString(16).toUpperCase()})`,
    category: 'Other'
  };
}

/**
 * Gets all resource types in a specific category
 */
export function getResourceTypesByCategory(category: ResourceCategory): ResourceType[] {
  return Object.values(RESOURCE_TYPES).filter(type => type.category === category);
}

/**
 * Checks if a resource type is known/supported
 */
export function isKnownResourceType(typeId: number): boolean {
  return typeId in RESOURCE_TYPES;
}

/**
 * Gets category color for UI styling
 */
export function getResourceTypeColor(category: ResourceCategory): string {
  switch (category) {
    case 'Graphics': return 'bg-blue-500/20 text-blue-700 border-blue-300';
    case 'Audio': return 'bg-green-500/20 text-green-700 border-green-300';
    case 'Data': return 'bg-purple-500/20 text-purple-700 border-purple-300';
    case 'Script': return 'bg-orange-500/20 text-orange-700 border-orange-300';
    default: return 'bg-gray-500/20 text-gray-700 border-gray-300';
  }
}

/**
 * Gets icon name for resource category
 */
export function getResourceCategoryIcon(category: ResourceCategory): string {
  switch (category) {
    case 'Graphics': return 'image';
    case 'Audio': return 'volume-2';
    case 'Data': return 'database';
    case 'Script': return 'code';
    default: return 'file';
  }
}

/**
 * Finds resource types that have parsers available
 */
export function getParsableResourceTypes(): ResourceType[] {
  return Object.values(RESOURCE_TYPES).filter(type => type.parser);
}

/**
 * Finds resource types that have writers available
 */
export function getWritableResourceTypes(): ResourceType[] {
  return Object.values(RESOURCE_TYPES).filter(type => type.writer);
}

/**
 * Gets resource type statistics from a list of resource entries
 */
export function analyzeResourceTypes(resources: { resourceTypeId: number }[]): {
  totalResources: number;
  byCategory: Record<ResourceCategory, number>;
  byType: Record<string, number>;
  unknownTypes: Set<number>;
} {
  const stats = {
    totalResources: resources.length,
    byCategory: {
      'Graphics': 0,
      'Audio': 0,
      'Data': 0,
      'Script': 0,
      'Other': 0
    } as Record<ResourceCategory, number>,
    byType: {} as Record<string, number>,
    unknownTypes: new Set<number>()
  };

  for (const resource of resources) {
    const type = getResourceType(resource.resourceTypeId);
    
    // Count by category
    stats.byCategory[type.category]++;
    
    // Count by type name
    stats.byType[type.name] = (stats.byType[type.name] || 0) + 1;
    
    // Track unknown types
    if (!isKnownResourceType(resource.resourceTypeId)) {
      stats.unknownTypes.add(resource.resourceTypeId);
    }
  }

  return stats;
}

/**
 * Creates a resource type filter predicate
 */
export function createResourceTypeFilter(
  categories?: ResourceCategory[],
  typeIds?: number[]
) {
  return (resource: { resourceTypeId: number }) => {
    if (typeIds && !typeIds.includes(resource.resourceTypeId)) {
      return false;
    }
    
    if (categories) {
      const type = getResourceType(resource.resourceTypeId);
      return categories.includes(type.category);
    }
    
    return true;
  };
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

// Re-export for backward compatibility
export { RESOURCE_TYPE_IDS } from './core/types';