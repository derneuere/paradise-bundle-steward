// Feature Capabilities — UI metadata derived from the handler registry.
//
// Step 7 of the CLI-first refactor replaced the hand-written CAPABILITIES
// array with a registry-driven derivation. Handlers declare `caps: { read, write }`
// and whether they have an editor (determined by the presence of an entry
// in EDITOR_PAGES). Per-handler notes / wiki URLs live in a single lookup
// table in this file so they can be updated without touching each handler.

import { registry } from './core/registry';
import { EDITOR_PAGES } from './core/registry/editors';

export type FeatureCapability = {
  id: string;
  name: string;
  resourceTypeId?: number;
  read: boolean | 'partial';
  write: boolean | 'partial';
  editor: boolean | 'partial';
  notes?: string;
  wikiUrl?: string;
};

export type FeatureCapabilities = {
  resources: FeatureCapability[];
  tools: FeatureCapability[];
};

/**
 * Per-handler free-form metadata. Keyed by handler.key. Anything a handler
 * author wants surfaced in the UI feature matrix but that isn't machine-
 * derivable from the registry itself goes here.
 */
const HANDLER_META: Record<string, { id: string; notes?: string; wikiUrl?: string; readOverride?: 'partial' | boolean; writeOverride?: 'partial' | boolean; editorOverride?: 'partial' | boolean }> = {
  streetData: {
    id: 'street-data',
    notes: 'Full read/write support for streets, junctions, roads, and challenge par scores. Per-junction exits / per-road spans are not written (the retail game ignores them due to a FixUp bug).',
    wikiUrl: 'https://burnout.wiki/wiki/Street_Data',
  },
  triggerData: {
    id: 'trigger-data',
    notes: 'Full read/write support for landmarks, regions, blackspots, VFX, spawn locations',
    wikiUrl: 'https://burnout.wiki/wiki/Trigger_Data',
  },
  challengeList: {
    id: 'challenge-list',
    notes: 'Full read/write support with visual editor',
    wikiUrl: 'https://burnout.wiki/wiki/Challenge_List',
  },
  vehicleList: {
    id: 'vehicle-list',
    notes: 'Full read/write support with visual editor. Writer round-trips byte-exact against the reference fixture.',
    wikiUrl: 'https://burnout.wiki/wiki/Vehicle_List',
  },
  playerCarColours: {
    id: 'player-car-colours',
    notes: 'Read-only support. Can view all color palettes but writing not yet implemented.',
    wikiUrl: 'https://burnout.wiki/wiki/Player_Car_Colours',
  },
  iceTakeDictionary: {
    id: 'icetake-dictionary',
    notes: 'Partial support: can view some of the data, but not save changes. Blocked: specification missing from Burnout Wiki.',
    readOverride: 'partial',
    editorOverride: 'partial',
    wikiUrl: 'https://burnout.wiki/wiki/ICE_Take_Dictionary',
  },
};

function capabilityFromHandler(h: (typeof registry)[number]): FeatureCapability {
  const meta = HANDLER_META[h.key] ?? { id: h.key };
  return {
    id: meta.id,
    name: h.name,
    resourceTypeId: h.typeId,
    read: meta.readOverride ?? h.caps.read,
    write: meta.writeOverride ?? h.caps.write,
    editor: meta.editorOverride ?? (EDITOR_PAGES[h.key] !== undefined),
    notes: meta.notes,
    wikiUrl: meta.wikiUrl,
  };
}

export const CAPABILITIES: FeatureCapabilities = {
  resources: registry.map(capabilityFromHandler),
  tools: [
    {
      id: 'hex-viewer',
      name: 'Hex Viewer',
      read: true,
      write: false,
      editor: true,
      notes: 'Fully functional hex viewer with resource inspection and navigation',
    },
  ],
};

// ============================================================================
// Utilities
// ============================================================================

export function getCapability(id: string): FeatureCapability | undefined {
  return CAPABILITIES.resources.find((cap) => cap.id === id) ||
         CAPABILITIES.tools.find((cap) => cap.id === id);
}

export function getCapabilityByTypeId(typeId: number): FeatureCapability | undefined {
  return CAPABILITIES.resources.find((cap) => cap.resourceTypeId === typeId);
}

export function hasFullSupport(id: string): boolean {
  const cap = getCapability(id);
  return cap ? (cap.read === true && cap.write === true && cap.editor === true) : false;
}

export function hasAnySupport(id: string): boolean {
  const cap = getCapability(id);
  return cap ? (cap.read === true || cap.write === true || cap.editor === true) : false;
}

export function getFullySupportedFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter((cap) => cap.read === true && cap.write === true && cap.editor === true);
}

export function getReadOnlyFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter((cap) => cap.read && !cap.write);
}

export function getUnimplementedFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter((cap) => !cap.read && !cap.write && !cap.editor);
}

export function getCapabilitiesSummary() {
  const resources = CAPABILITIES.resources;
  return {
    total: resources.length,
    fullySupported: resources.filter((c) => c.read && c.write && c.editor).length,
    readOnly: resources.filter((c) => c.read && !c.write).length,
    unimplemented: resources.filter((c) => !c.read && !c.write && !c.editor).length,
  };
}
