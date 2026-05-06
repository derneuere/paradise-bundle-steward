// Feature Capabilities — UI-facing view derived from the handler registry.
//
// Each handler (`src/lib/core/registry/handlers/*.ts`) carries its own
// `notes`, `wikiUrl`, and optional `capabilityOverrides`. This file is a
// thin selector that lifts those into a stable shape the React badges /
// tooltips / export-warning modal consume. There is no side-table here —
// adding a handler is still one file plus one `index.ts` line.

import {
  getHandlerByKey,
  getHandlerByTypeId as registryGetHandlerByTypeId,
  type ResourceHandler,
} from './core/registry';
import { EDITOR_PAGES } from './core/registry/editors';

export type FeatureCapability = {
  /** Stable identifier — the handler's `key` (camelCase). */
  id: string;
  name: string;
  resourceTypeId?: number;
  read: boolean | 'partial';
  write: boolean | 'partial';
  editor: boolean | 'partial';
  notes?: string;
  wikiUrl?: string;
};

function capabilityFromHandler(h: ResourceHandler): FeatureCapability {
  const overrides = h.capabilityOverrides;
  return {
    id: h.key,
    name: h.name,
    resourceTypeId: h.typeId,
    // capabilityOverrides lets a handler declare a softer UI signal (e.g.
    // `'partial'`) without disabling the parser. Falls back to the machine
    // gate (`caps.read` / `caps.write`) and to EDITOR_PAGES presence for
    // the editor flag.
    read: overrides?.read ?? h.caps.read,
    write: overrides?.write ?? h.caps.write,
    editor: overrides?.editor ?? (EDITOR_PAGES[h.key] !== undefined),
    notes: h.notes,
    wikiUrl: h.wikiUrl,
  };
}

export function getCapability(id: string): FeatureCapability | undefined {
  const handler = getHandlerByKey(id);
  return handler ? capabilityFromHandler(handler) : undefined;
}

export function getCapabilityByTypeId(typeId: number): FeatureCapability | undefined {
  const handler = registryGetHandlerByTypeId(typeId);
  return handler ? capabilityFromHandler(handler) : undefined;
}
