// Resource type definitions for Burnout Paradise
// Based on common resource types found in the game

export interface ResourceType {
  id: number;
  name: string;
  description: string;
  category: 'Graphics' | 'Audio' | 'Data' | 'Script' | 'Other';
}

// Common resource types found in Burnout Paradise bundles
export const RESOURCE_TYPES: Record<number, ResourceType> = {
  0x00000001: { id: 0x00000001, name: 'Registry', description: 'Configuration data', category: 'Data' },
  0x00000002: { id: 0x00000002, name: 'Texture', description: 'Image texture data', category: 'Graphics' },
  0x00000003: { id: 0x00000003, name: 'Material', description: 'Material properties', category: 'Graphics' },
  0x00000004: { id: 0x00000004, name: 'Mesh', description: '3D geometry data', category: 'Graphics' },
  0x00000005: { id: 0x00000005, name: 'Animation', description: 'Animation sequences', category: 'Graphics' },
  0x00000006: { id: 0x00000006, name: 'Audio', description: 'Sound effects and music', category: 'Audio' },
  0x00000007: { id: 0x00000007, name: 'Script', description: 'Game logic scripts', category: 'Script' },
  0x00000008: { id: 0x00000008, name: 'Font', description: 'Font data', category: 'Graphics' },
  0x00000009: { id: 0x00000009, name: 'Shader', description: 'GPU shader programs', category: 'Graphics' },
  0x0000000A: { id: 0x0000000A, name: 'Model', description: 'Vehicle/object models', category: 'Graphics' },
  0x0000000B: { id: 0x0000000B, name: 'Physics', description: 'Physics properties', category: 'Data' },
  0x0000000C: { id: 0x0000000C, name: 'Collision', description: 'Collision mesh data', category: 'Data' },
  0x0000000D: { id: 0x0000000D, name: 'Localization', description: 'Localized text', category: 'Data' },
  0x0000000E: { id: 0x0000000E, name: 'Track', description: 'Race track data', category: 'Data' },
  0x0000000F: { id: 0x0000000F, name: 'Vehicle', description: 'Vehicle configuration', category: 'Data' },
  0x00000010: { id: 0x00000010, name: 'Particle', description: 'Particle effects', category: 'Graphics' },
  0x00000011: { id: 0x00000011, name: 'Lighting', description: 'Lighting data', category: 'Graphics' },
  0x00000012: { id: 0x00000012, name: 'Navigation', description: 'AI navigation data', category: 'Data' },
  0x00000013: { id: 0x00000013, name: 'UI', description: 'User interface elements', category: 'Graphics' },
  0x00000014: { id: 0x00000014, name: 'Skybox', description: 'Sky/environment textures', category: 'Graphics' },
  0x00010005: { id: 0x00010005, name: 'Vehicle List', description: 'List of available vehicles', category: 'Data' },
  0x0001001E: { id: 0x0001001E, name: 'Player Car Colours', description: 'Available player car color palettes', category: 'Graphics' },
};

export function getResourceType(typeId: number): ResourceType {
  return RESOURCE_TYPES[typeId] || {
    id: typeId,
    name: 'Unknown',
    description: `Unknown resource type (0x${typeId.toString(16).toUpperCase()})`,
    category: 'Other'
  };
}

export function getResourceTypeColor(category: string): string {
  switch (category) {
    case 'Graphics': return 'bg-accent/20 text-accent border-accent/30';
    case 'Audio': return 'bg-warning/20 text-warning border-warning/30';
    case 'Data': return 'bg-info/20 text-info border-info/30';
    case 'Script': return 'bg-success/20 text-success border-success/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}