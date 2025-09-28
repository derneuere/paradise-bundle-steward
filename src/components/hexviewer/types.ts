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
  // Optional visual grouping metadata within this row (column indices are 0-based, end exclusive)
  groups?: Array<{
    kind: 'entry' | 'field' | 'header';
    colStart: number;
    colEnd: number;
    title?: string;
    classes: string;
  }>;
  // Optional decoded summary for this row (e.g., selected field value)
  decoded?: string;
  // Optional: multiple decoded items for this row, each with an optional label
  decodedItems?: Array<{ label?: string; value: string }>;
  // Optional info string (name • type • value) for middle column, and where to click
  info?: string;
  clickOffset?: number;
};

export type InspectedResource = {
  resource: ResourceEntry;
  typeLabel: string;
  data: Uint8Array;
  overlays: { name: string; start: number; end: number; color: string }[];
};
