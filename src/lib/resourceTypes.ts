// Resource Type Definitions and Utilities
// Refactored to use core architecture with improved type safety

import type { ResourceTypeId } from './core/types';
import { RESOURCE_TYPE_IDS } from './core/types';

// ============================================================================
// Resource Type Interface
// ============================================================================

export type ResourceType = {
  id: number;
  name: string;
  description: string;
  category: ResourceCategory;
}

export type ResourceCategory = 'Graphics' | 'Audio' | 'Data' | 'Script' | 'Camera' | 'Other';

// ============================================================================
// Extended Resource Type Definitions
// ============================================================================

export const RESOURCE_TYPES: Record<number, ResourceType> = {
  [RESOURCE_TYPE_IDS.ICE_TAKE_DICTIONARY]: {
    id: RESOURCE_TYPE_IDS.ICE_TAKE_DICTIONARY,
    name: 'ICE Dictionary',
    description: 'The ICE (In-game Camera Editor) take dictionary stores the camera cuts for things such as race starts, Picture Paradise and Super Jumps. It is only found in CAMERAS.BUNDLE.',
    category: 'Camera',
  },
  [RESOURCE_TYPE_IDS.VEHICLE_LIST]: { 
    id: RESOURCE_TYPE_IDS.VEHICLE_LIST, 
    name: 'Vehicle List', 
    description: 'Complete list of all available vehicles with stats and properties', 
    category: 'Data',
  },
  [RESOURCE_TYPE_IDS.TRIGGER_DATA]: {
    id: RESOURCE_TYPE_IDS.TRIGGER_DATA,
    name: 'Trigger Data',
    description: 'Landmarks, generic regions, blackspots, VFX regions, and related pointers',
    category: 'Data',
  },
  [RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS]: { 
    id: RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS, 
    name: 'Player Car Colours', 
    description: 'Available player car color palettes and paint options', 
    category: 'Graphics',
  },
  [RESOURCE_TYPE_IDS.CHALLENGE_LIST]: {
    id: RESOURCE_TYPE_IDS.CHALLENGE_LIST,
    name: 'Challenge List',
    description: 'Available challenges with their properties',
    category: 'Data',
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
  // Parser registration is handled elsewhere; treat all known types as parsable candidates
  return Object.values(RESOURCE_TYPES);
}

/**
 * Finds resource types that have writers available
 */
export function getWritableResourceTypes(): ResourceType[] {
  // Writers are optional; return all known for now
  return Object.values(RESOURCE_TYPES);
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