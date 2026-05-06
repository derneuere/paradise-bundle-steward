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
  registry,
  type ResourceHandler,
} from './core/registry';
import { EDITOR_PAGES } from './core/registry/editors';

export type FeatureCapability = {
  /**
   * Stable identifier — handler's `featureId` if declared (kebab-case slug),
   * otherwise its `key` (camelCase). Consumed by `CapabilityWarning` lookup.
   */
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
    // featureId opt-in keeps the public id stable for handlers that ship a
    // kebab-case slug; new handlers can omit it and inherit `key`.
    id: h.featureId ?? h.key,
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
  // Accept either form — featureId (kebab) for stable public ids, key
  // (camelCase) for the registry-internal name. featureId wins when both
  // resolve, since it's the explicit override.
  const handler =
    registry.find((h) => (h.featureId ?? h.key) === id) ?? getHandlerByKey(id);
  return handler ? capabilityFromHandler(handler) : undefined;
}

export function getCapabilityByTypeId(typeId: number): FeatureCapability | undefined {
  const handler = registryGetHandlerByTypeId(typeId);
  return handler ? capabilityFromHandler(handler) : undefined;
}
