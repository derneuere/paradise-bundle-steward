// Resource Type metadata derived from the handler registry.
//
// Historically this file contained a hand-written RESOURCE_TYPES map that
// had to be kept in sync with six other locations. Step 7 of the CLI-first
// refactor replaced that with a one-line derivation from src/lib/core/registry:
// the registry is now the single source of truth for which resource types
// exist, what they're called, and which category they belong to.

import { registry } from './core/registry';
import type { ResourceCategory as HandlerResourceCategory } from './core/registry';

export type ResourceCategory = HandlerResourceCategory;

export type ResourceType = {
  id: number;
  name: string;
  description: string;
  category: ResourceCategory;
};

// Derived at module-load time from the registry. Adding a new resource in
// registry/handlers/<key>.ts + one line in registry/index.ts automatically
// flows into this map without touching any other file.
export const RESOURCE_TYPES: Record<number, ResourceType> = Object.fromEntries(
  registry.map((h) => [
    h.typeId,
    { id: h.typeId, name: h.name, description: h.description, category: h.category },
  ]),
);

// ============================================================================
// Resource Type Utilities
// ============================================================================

/**
 * Gets resource type information by ID. Falls back to a synthetic "Unknown"
 * record for resources the registry doesn't cover yet.
 */
export function getResourceType(typeId: number): ResourceType {
  return RESOURCE_TYPES[typeId] || {
    id: typeId,
    name: 'Unknown',
    description: `Unknown resource type (0x${typeId.toString(16).toUpperCase()})`,
    category: 'Other'
  };
}

/** Gets all resource types in a specific category. */
export function getResourceTypesByCategory(category: ResourceCategory): ResourceType[] {
  return Object.values(RESOURCE_TYPES).filter((type) => type.category === category);
}

/** Checks if a resource type is known/supported. */
export function isKnownResourceType(typeId: number): boolean {
  return typeId in RESOURCE_TYPES;
}

/** Gets category color for UI styling. */
export function getResourceTypeColor(category: ResourceCategory): string {
  switch (category) {
    case 'Graphics': return 'bg-blue-500/20 text-blue-700 border-blue-300';
    case 'Audio': return 'bg-green-500/20 text-green-700 border-green-300';
    case 'Data': return 'bg-purple-500/20 text-purple-700 border-purple-300';
    case 'Script': return 'bg-orange-500/20 text-orange-700 border-orange-300';
    default: return 'bg-gray-500/20 text-gray-700 border-gray-300';
  }
}

/** Gets icon name for resource category. */
export function getResourceCategoryIcon(category: ResourceCategory): string {
  switch (category) {
    case 'Graphics': return 'image';
    case 'Audio': return 'volume-2';
    case 'Data': return 'database';
    case 'Script': return 'code';
    default: return 'file';
  }
}

/** Finds resource types that have parsers available. */
export function getParsableResourceTypes(): ResourceType[] {
  return Object.values(RESOURCE_TYPES);
}

/** Finds resource types that have writers available. */
export function getWritableResourceTypes(): ResourceType[] {
  return Object.values(RESOURCE_TYPES);
}

/** Gets resource type statistics from a list of resource entries. */
export function analyzeResourceTypes(resources: { resourceTypeId: number }[]): {
  totalResources: number;
  byCategory: Record<ResourceCategory, number>;
  byType: Record<string, number>;
  unknownTypes: Set<number>;
} {
  const stats = {
    totalResources: resources.length,
    byCategory: {
      Graphics: 0,
      Audio: 0,
      Data: 0,
      Script: 0,
      Camera: 0,
      Other: 0,
    } as Record<ResourceCategory, number>,
    byType: {} as Record<string, number>,
    unknownTypes: new Set<number>(),
  };

  for (const resource of resources) {
    const type = getResourceType(resource.resourceTypeId);
    stats.byCategory[type.category]++;
    stats.byType[type.name] = (stats.byType[type.name] || 0) + 1;
    if (!isKnownResourceType(resource.resourceTypeId)) {
      stats.unknownTypes.add(resource.resourceTypeId);
    }
  }

  return stats;
}

/** Creates a resource type filter predicate. */
export function createResourceTypeFilter(
  categories?: ResourceCategory[],
  typeIds?: number[],
) {
  return (resource: { resourceTypeId: number }) => {
    if (typeIds && !typeIds.includes(resource.resourceTypeId)) return false;
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

// Re-export for backward compatibility — some callers still import the enum
// directly. Source of truth for this remains src/lib/core/types.ts.
export { RESOURCE_TYPE_IDS } from './core/types';
