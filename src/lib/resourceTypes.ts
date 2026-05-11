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
