// Feature Capabilities Tracking
// This file tracks the read/write/editor support status for each resource type

export type FeatureCapability = {
  id: string;
  name: string;
  resourceTypeId?: number;
  read: boolean | "partial";
  write: boolean | "partial";
  editor: boolean | "partial";
  notes?: string;
  wikiUrl?: string;
}

export type FeatureCapabilities = {
  resources: FeatureCapability[];
  tools: FeatureCapability[];
}

/**
 * Current feature support status
 * Updated: 2025-10-23
 */
export const CAPABILITIES: FeatureCapabilities = {
  resources: [
    {
      id: 'challenge-list',
      name: 'Challenge List',
      resourceTypeId: 0x30201,
      read: true,
      write: true,
      editor: true,
      notes: 'Full read/write support with visual editor',
      wikiUrl: 'https://burnout.wiki/wiki/Challenge_List'
    },
    {
      id: 'trigger-data',
      name: 'Trigger Data',
      resourceTypeId: 0x30203,
      read: true,
      write: true,
      editor: true,
      notes: 'Full read/write support for landmarks, regions, blackspots, VFX, spawn locations',
      wikiUrl: 'https://burnout.wiki/wiki/Trigger_Data'
    },
    {
      id: 'vehicle-list',
      name: 'Vehicle List',
      resourceTypeId: 0x10005,
      read: true,
      write: false,
      editor: true,
      notes: 'Read-only support. Editor available, but the exported bundle is not yet working correctly.',
      wikiUrl: 'https://burnout.wiki/wiki/Vehicle_List'
    },
    {
      id: 'player-car-colours',
      name: 'Player Car Colours',
      resourceTypeId: 0x1001E,
      read: true,
      write: false,
      editor: true,
      notes: 'Read-only support. Can view all color palettes but writing not yet implemented.',
      wikiUrl: 'https://burnout.wiki/wiki/Player_Car_Colours'
    },
    {
      id: 'icetake-dictionary',
      name: 'ICE Take Dictionary',
      resourceTypeId: 0x41,
      read: "partial", 
      write: false,
      editor: "partial",
      notes: 'Partial support: can view some of the data, but not save changes. Blocked: specification missing from Burnout Wiki.',
      wikiUrl: 'https://burnout.wiki/wiki/ICE_Take_Dictionary'
    }
  ],
  tools: [
    {
      id: 'hex-viewer',
      name: 'Hex Viewer',
      read: true,
      write: false,
      editor: true,
      notes: 'Fully functional hex viewer with resource inspection and navigation'
    }
  ]
}

/**
 * Get capability status for a specific resource by ID
 */
export function getCapability(id: string): FeatureCapability | undefined {
  return CAPABILITIES.resources.find(cap => cap.id === id) || 
         CAPABILITIES.tools.find(cap => cap.id === id);
}

/**
 * Get capability status by resource type ID
 */
export function getCapabilityByTypeId(typeId: number): FeatureCapability | undefined {
  return CAPABILITIES.resources.find(cap => cap.resourceTypeId === typeId);
}

/**
 * Check if a resource type has full support (read + write + editor)
 */
export function hasFullSupport(id: string): boolean {
  const cap = getCapability(id);
  return cap ? (cap.read === true && cap.write === true && cap.editor === true) : false;
}

/**
 * Check if a resource type has any support
 */
export function hasAnySupport(id: string): boolean {
  const cap = getCapability(id);
  return cap ? (cap.read === true || cap.write === true || cap.editor === true) : false;
}

/**
 * Get all fully supported features
 */
export function getFullySupportedFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter(cap => cap.read === true && cap.write === true && cap.editor === true);
}

/**
 * Get all read-only features
 */
export function getReadOnlyFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter(cap => cap.read && !cap.write);
}

/**
 * Get all features that need implementation
 */
export function getUnimplementedFeatures(): FeatureCapability[] {
  return CAPABILITIES.resources.filter(cap => !cap.read && !cap.write && !cap.editor);
}

/**
 * Get a summary of current capabilities
 */
export function getCapabilitiesSummary() {
  const resources = CAPABILITIES.resources;
  return {
    total: resources.length,
    fullySupported: resources.filter(c => c.read && c.write && c.editor).length,
    readOnly: resources.filter(c => c.read && !c.write).length,
    unimplemented: resources.filter(c => !c.read && !c.write && !c.editor).length,
  };
}

