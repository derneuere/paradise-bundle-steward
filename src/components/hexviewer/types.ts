export type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import type { ParsedBundle, ResourceEntry } from '@/lib/core/types';
import type React from 'react';

export type HexViewerProps = {
  originalData: ArrayBuffer | null;
  bundle: ParsedBundle | null;
  isModified: boolean;
  resources: Array<{
    id: string;
    name: string;
    type: string;
    typeName: string;
    category: string;
    platform: string;
    uncompressedSize: number;
    compressedSize: number;
    memoryType: string;
    imports: string[];
    flags: string[];
    raw: ResourceEntry;
  }>;
};

export type HexSection = {
  name: string;
  start: number;
  end: number;
  color: string;
  icon: React.ComponentType<any>;
  description: string;
  kind: 'header' | 'entries' | 'resource' | 'debug';
  resource?: ResourceEntry;
  blockIndex?: number;
};

export type CoverageSegment = {
  name: string;
  start: number;
  end: number;
  color: string;
  kind: HexSection['kind'] | 'unparsed';
  section?: HexSection;
};

export type HexRow = {
  offset: number;
  hexBytes: Array<{ byte: number; offset: number; section: string; color: string }>;
  ascii: string;
};

export type InspectedResource = {
  resource: ResourceEntry;
  typeLabel: string;
  data: Uint8Array;
  overlays: { name: string; start: number; end: number; color: string }[];
};
