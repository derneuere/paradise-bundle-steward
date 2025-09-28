import React, { useCallback, useMemo, useState } from 'react';
import { FileText, Database, Settings, Hexagon } from 'lucide-react';
import { getResourceType, type ResourceCategory } from '@/lib/resourceTypes';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import { extractResourceSize, getResourceData, isCompressed, decompressData } from '@/lib/core/resourceManager';
import type { HexViewerProps, HexSection, CoverageSegment, InspectedResource } from './types';
import { shadesForCategory, formatAscii } from './utils';
import { CoverageBar } from './CoverageBar';
import { Controls } from './Controls';
import { SectionList } from './SectionList';
import { HexTable } from './HexTable';
import { Card, CardContent } from '@/components/ui/card';
import { ResourceInspectorDialog } from './ResourceInspectorDialog';

const BYTES_PER_ROW = 16;

export const HexViewer: React.FC<HexViewerProps> = ({ originalData, bundle, isModified, resources }) => {
  const [currentOffset, setCurrentOffset] = useState(0);
  const [bytesPerRow, setBytesPerRow] = useState(BYTES_PER_ROW);
  const [searchOffset, setSearchOffset] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [inspected, setInspected] = useState<InspectedResource | null>(null);

  const sections = useMemo<HexSection[]>(() => {
    if (!bundle || !originalData) return [];

    const sections: HexSection[] = [
      { name: 'Header', start: 0, end: 40, color: 'bg-blue-500', icon: Settings, description: 'Bundle header with magic, version, platform info', kind: 'header' },
    ];

    const entriesBase = bundle.header.resourceEntriesOffset >>> 0;
    bundle.resources.forEach((resource, index) => {
      const uiResource = resources.find(r => r.raw === resource);
      const category: ResourceCategory = (uiResource?.category as ResourceCategory) || getResourceType(resource.resourceTypeId).category;
      const [entryColor] = shadesForCategory(category);
      const start = entriesBase + index * 80;
      const end = start + 80;
      if (start < originalData.byteLength) {
        const typeLabel = uiResource?.type || getResourceType(resource.resourceTypeId).name;
        sections.push({ name: `${typeLabel} (entry)`, start, end: Math.min(end, originalData.byteLength), color: entryColor, icon: Database, description: `${uiResource?.typeName || typeLabel} • entry (80 bytes)`, kind: 'entries', resource });
      }
    });

    bundle.resources.forEach((resource) => {
      const uiResource = resources.find(r => r.raw === resource);
      const category: ResourceCategory = (uiResource?.category as ResourceCategory) || getResourceType(resource.resourceTypeId).category;
      const typeLabel = uiResource?.type || getResourceType(resource.resourceTypeId).name;
      const shades = shadesForCategory(category);
      for (let i = 0; i < 3; i++) {
        const base = bundle.header.resourceDataOffsets[i] >>> 0;
        const rel = resource.diskOffsets[i] >>> 0;
        const dataStart = base + rel;
        const dataSizePacked = resource.sizeAndAlignmentOnDisk[i];
        const dataSize = extractResourceSize(dataSizePacked);
        if (dataStart > 0 && dataSize > 0 && dataStart < originalData.byteLength) {
          const end = Math.min(dataStart + dataSize, originalData.byteLength);
          sections.push({ name: `${typeLabel} (block ${i + 1})`, start: dataStart, end, color: shades[Math.min(i, shades.length - 1)], icon: FileText, description: `${uiResource?.typeName || typeLabel} • block ${i + 1} • ${(dataSize / 1024).toFixed(1)} KB`, kind: 'resource', resource, blockIndex: i });
        }
      }
    });

    if (bundle.header.debugDataOffset > 0 && bundle.header.debugDataOffset < originalData.byteLength) {
      const start = bundle.header.debugDataOffset >>> 0;
      const view = new Uint8Array(originalData, start);
      const nulIndex = view.indexOf(0);
      const payloadLen = nulIndex >= 0 ? nulIndex : view.length;
      const end = Math.min(start + payloadLen + 1, originalData.byteLength);
      sections.push({ name: 'Debug Data', start, end, color: 'bg-orange-500', icon: FileText, description: `Debug information (${payloadLen.toLocaleString()} bytes)`, kind: 'debug' });
    }

    return sections.sort((a, b) => a.start - b.start);
  }, [bundle, originalData, resources]);

  const coverageSegments = useMemo<CoverageSegment[]>(() => {
    if (!originalData) return [];
    const sorted = [...sections].sort((a, b) => a.start - b.start);
    const segments: CoverageSegment[] = [];
    let cursor = 0;
    const total = originalData.byteLength;
    for (const section of sorted) {
      if (section.start > cursor) segments.push({ name: 'Unparsed', start: cursor, end: section.start, color: 'bg-gray-300', kind: 'unparsed' });
      segments.push({ name: section.name, start: section.start, end: Math.min(section.end, total), color: section.color, kind: section.kind, section });
      cursor = Math.max(cursor, Math.min(section.end, total));
      if (cursor >= total) break;
    }
    if (cursor < total) segments.push({ name: 'Unparsed', start: cursor, end: total, color: 'bg-gray-300', kind: 'unparsed' });
    return segments.filter(s => s.end > s.start);
  }, [sections, originalData]);

  const totalBytes = useMemo(() => originalData?.byteLength ?? 0, [originalData]);
  const parsedBytes = useMemo(() => coverageSegments.filter(s => s.kind !== 'unparsed').reduce((sum, s) => sum + (s.end - s.start), 0), [coverageSegments]);
  const coveragePercent = useMemo(() => totalBytes ? Math.round((parsedBytes / totalBytes) * 1000) / 10 : 0, [parsedBytes, totalBytes]);
  const breakdown = useMemo(() => {
    const map: Record<string, number> = { Header: 0, 'Resource Entries': 0, 'Resource Data': 0, 'Debug Data': 0, Unparsed: 0 };
    for (const s of coverageSegments) {
      const size = s.end - s.start;
      switch (s.kind) {
        case 'header': map['Header'] += size; break;
        case 'entries': map['Resource Entries'] += size; break;
        case 'resource': map['Resource Data'] += size; break;
        case 'debug': map['Debug Data'] += size; break;
        case 'unparsed': map['Unparsed'] += size; break;
      }
    }
    return map;
  }, [coverageSegments]);

  const data = useMemo(() => originalData ? new Uint8Array(originalData) : null, [originalData]);

  const getSectionForOffset = useCallback((offset: number): HexSection | null => {
    return sections.find(section => offset >= section.start && offset < section.end) || null;
  }, [sections]);

  const hexRows = useMemo(() => {
    if (!data) return [];
    const rows = [] as { offset: number; hexBytes: { byte: number; offset: number; section: string; color: string }[]; ascii: string }[];
    const totalRows = Math.ceil(data.length / bytesPerRow);
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
      const rowStart = rowIndex * bytesPerRow;
      const rowData = data.slice(rowStart, rowStart + bytesPerRow);
      const hexBytes = Array.from(rowData).map((byte, i) => {
        const offset = rowStart + i;
        const section = getSectionForOffset(offset);
        return { byte, offset, section: section?.name || 'Unknown', color: section?.color || 'bg-gray-100' };
      });
      const asciiChars = Array.from(rowData).map(byte => formatAscii(byte));
      rows.push({ offset: rowStart, hexBytes, ascii: asciiChars.join('') });
    }
    return rows;
  }, [data, bytesPerRow, getSectionForOffset]);

  const visibleRows = useMemo(() => {
    if (selectedSection === 'all') return hexRows;
    const section = sections.find(s => s.name === selectedSection);
    if (!section) return hexRows;
    return hexRows.filter(row => {
      const rowEnd = row.offset + bytesPerRow;
      return row.offset < section.end && rowEnd > section.start;
    });
  }, [hexRows, selectedSection, sections, bytesPerRow]);

  const navigateToOffset = useCallback((rowIndex: number) => {
    const targetOffset = Math.max(0, rowIndex) * bytesPerRow;
    const el = typeof document !== 'undefined' ? document.getElementById(`row-${targetOffset}`) : null;
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setCurrentOffset(Math.max(0, rowIndex));
  }, [bytesPerRow]);

  const handleSearchOffset = useCallback(() => {
    const offset = parseInt(searchOffset, 16);
    if (!isNaN(offset)) {
      const rowIndex = Math.floor(offset / bytesPerRow);
      navigateToOffset(rowIndex);
    }
  }, [searchOffset, bytesPerRow, navigateToOffset]);

  const scrollToSection = useCallback((sectionName: string) => {
    const section = sections.find(s => s.name === sectionName);
    if (section) {
      const rowIndex = Math.floor(section.start / bytesPerRow);
      navigateToOffset(rowIndex);
    }
  }, [sections, bytesPerRow, navigateToOffset]);

  const openInspector = useCallback((section: HexSection) => {
    if (!bundle || !originalData || section.kind !== 'resource' || !section.resource) return;
    try {
      let bytes: Uint8Array | null = null;
      if (typeof section.blockIndex === 'number') {
        const b = section.blockIndex;
        const base = bundle.header.resourceDataOffsets[b] >>> 0;
        const rel = section.resource.diskOffsets[b] >>> 0;
        const start = base + rel;
        const packed = section.resource.sizeAndAlignmentOnDisk[b];
        const size = extractResourceSize(packed);
        if (start < originalData.byteLength && size > 0) {
          const max = Math.min(size, originalData.byteLength - start);
          bytes = new Uint8Array(originalData, start, max);
        }
      }
      if (!bytes) {
        const ctx = { bundle, resource: section.resource, buffer: originalData } as const;
        bytes = getResourceData(ctx).data;
      }
      const data = isCompressed(bytes) ? decompressData(bytes) : bytes;
      const typeLabel = getResourceType(section.resource.resourceTypeId).name;
      const overlays: { name: string; start: number; end: number; color: string }[] = [];
      if (section.resource.resourceTypeId === RESOURCE_TYPE_IDS.VEHICLE_LIST) {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const headerSize = 16;
        const numVehicles = data.length >= 4 ? dv.getUint32(0, true) : 0;
        const entrySize = 0x108;
        overlays.push({ name: 'Header', start: 0, end: Math.min(headerSize, data.length), color: 'bg-amber-500' });
        let offset = headerSize;
        for (let i = 0; i < Math.min(numVehicles, 2000); i++) {
          const s = offset + i * entrySize;
          const e = Math.min(s + entrySize, data.length);
          if (s >= data.length) break;
          overlays.push({ name: `Vehicle ${i}`, start: s, end: e, color: i % 2 === 0 ? 'bg-amber-600' : 'bg-amber-700' });
        }
      } else if (section.resource.resourceTypeId === RESOURCE_TYPE_IDS.PLAYER_CAR_COLOURS) {
        const is64 = data.length >= 0x78;
        const headerSize = is64 ? 120 : 60;
        overlays.push({ name: 'Global Palette Header', start: 0, end: Math.min(headerSize, data.length), color: 'bg-teal-500' });
        if (headerSize < data.length) overlays.push({ name: 'Color Data', start: headerSize, end: data.length, color: 'bg-teal-700' });
      }
      setInspected({ resource: section.resource, typeLabel, data, overlays });
    } catch (e) {
      console.warn('Failed to open inspector:', e);
    }
  }, [bundle, originalData]);

  if (!data || !bundle) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Hexagon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No bundle data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CoverageBar
        coveragePercent={coveragePercent}
        segments={coverageSegments}
        breakdown={breakdown}
        totalBytes={totalBytes}
        bytesPerRow={bytesPerRow}
        onClickSegment={(seg) => {
          if (seg.section && seg.section.kind === 'resource') {
            openInspector(seg.section);
          } else {
            const rowIndex = Math.floor(seg.start / bytesPerRow);
            navigateToOffset(rowIndex);
          }
        }}
      />

      <Controls
        isModified={isModified}
        sections={sections}
        selectedSection={selectedSection}
        setSelectedSection={setSelectedSection}
        bytesPerRow={bytesPerRow}
        setBytesPerRow={setBytesPerRow}
        searchOffset={searchOffset}
        setSearchOffset={setSearchOffset}
        onSearch={handleSearchOffset}
      />

      <SectionList sections={sections} onScrollToSection={scrollToSection} onOpenInspector={openInspector} />

      <HexTable rows={visibleRows} />

      <ResourceInspectorDialog inspected={inspected} onOpenChange={(open) => !open && setInspected(null)} bytesPerRow={bytesPerRow} />
    </div>
  );
};
