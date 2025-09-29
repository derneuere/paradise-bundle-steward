import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import type { InspectedResource } from './types';
import { HexTable } from './HexTable';
import { getSchemaFields } from './utils.ts';
import { VehicleEntrySchema } from '@/lib/core/vehicleList';
import { ICETakeHeader32Schema, ICETakeHeader64Schema, parseIceTakeDictionaryData } from '@/lib/core/iceTakeDictionary';
import type { HexRow } from './types';

export type ResourceInspectorViewProps = {
  inspected: InspectedResource | null;
  bytesPerRow: number;
};

type SchemaField = { key: string; name: string; offset: number; size: number };

type SchemaProvider = {
  label: string;
  headerSizeFromData: (data: Uint8Array) => number;
  entrySizeFromData: (data: Uint8Array, headerSize: number) => number;
  countFromData: (data: Uint8Array, headerSize: number, entrySize: number) => number;
  fieldsFromData: (data: Uint8Array) => SchemaField[];
  entryOffsetsFromData?: (data: Uint8Array, headerSize: number, entrySize: number) => number[];
};

const schemaRegistry: Record<number, SchemaProvider> = {
  [RESOURCE_TYPE_IDS.VEHICLE_LIST]: {
    label: 'VehicleListEntry',
    headerSizeFromData: (data) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true) >>> 0,
    entrySizeFromData: () => 0x108,
    countFromData: (data, headerSize, entrySize) => {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const numVehicles = dv.getUint32(0, true) >>> 0;
      const maxVehicles = Math.floor((data.length - headerSize) / entrySize);
      return Math.min(numVehicles, maxVehicles);
    },
    fieldsFromData: () => getSchemaFields(VehicleEntrySchema)
  },
  [RESOURCE_TYPE_IDS.ICE_TAKE_DICTIONARY]: {
    label: 'ICETakeHeader',
    headerSizeFromData: () => 0,
    entrySizeFromData: (data) => {
      const parsed = parseIceTakeDictionaryData(data);
      return parsed.is64Bit ? 0x6C : 0x64;
    },
    countFromData: (data) => {
      const parsed = parseIceTakeDictionaryData(data);
      return parsed.totalTakes;
    },
    entryOffsetsFromData: (data) => {
      const parsed = parseIceTakeDictionaryData(data);
      return parsed.takes.map(t => t.offset >>> 0).sort((a, b) => a - b);
    },
    fieldsFromData: (data) => {
      const parsed = parseIceTakeDictionaryData(data);
      return getSchemaFields(parsed.is64Bit ? ICETakeHeader64Schema : ICETakeHeader32Schema);
    }
  }
};

export const ResourceInspectorView: React.FC<ResourceInspectorViewProps> = ({ inspected, bytesPerRow }) => {
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(-1);

  const schema = useMemo(() => inspected ? schemaRegistry[inspected.resource.resourceTypeId] : undefined, [inspected]);

  const headerInfo = useMemo(() => {
    if (!inspected || !schema) return null;
    const headerSize = schema.headerSizeFromData(inspected.data);
    const entrySize = schema.entrySizeFromData(inspected.data, headerSize);
    const count = schema.countFromData(inspected.data, headerSize, entrySize);
    const entryOffsets = schema.entryOffsetsFromData
      ? schema.entryOffsetsFromData(inspected.data, headerSize, entrySize)
      : Array.from({ length: count }, (_, i) => headerSize + i * entrySize);
    return { headerSize, count, entrySize, entryOffsets };
  }, [inspected, schema]);

  const fieldsForSchema = useMemo(() => {
    if (!inspected || !schema) return [] as SchemaField[];
    return schema.fieldsFromData(inspected.data);
  }, [inspected, schema]);

  const selectedFieldMask = useMemo(() => {
    if (!inspected || !schema || !headerInfo || !selectedFieldKey) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const field = fieldsForSchema.find(f => f.key === selectedFieldKey);
    if (!field) return mask;
    const { entryOffsets, entrySize } = headerInfo as NonNullable<typeof headerInfo> & { entryOffsets: number[] };
    for (let i = 0; i < entryOffsets.length; i++) {
      const s = entryOffsets[i] + field.offset;
      const e = Math.min(s + field.size, mask.length);
      if (e > s) mask.fill(1, s, e);
    }
    return mask;
  }, [inspected, schema, headerInfo, selectedFieldKey, fieldsForSchema]);

  const totalRows = useMemo(() => inspected ? Math.ceil(inspected.data.length / bytesPerRow) : 0, [inspected, bytesPerRow]);

  const entryMask = useMemo(() => {
    if (!inspected || !schema || !headerInfo) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const { entryOffsets, entrySize } = headerInfo as NonNullable<typeof headerInfo> & { entryOffsets: number[] };
    for (let i = 0; i < entryOffsets.length; i++) {
      const s = entryOffsets[i];
      const e = Math.min(s + entrySize, mask.length);
      if (e > s) mask.fill(1, s, e);
    }
    return mask;
  }, [inspected, schema, headerInfo]);

  const headerMask = useMemo(() => {
    if (!inspected || !schema || !headerInfo) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const { headerSize } = headerInfo;
    const e = Math.min(headerSize, mask.length);
    if (e > 0) mask.fill(1, 0, e);
    return mask;
  }, [inspected, schema, headerInfo]);

  // ================================
  // Search (hex bytes)
  // ================================
  const parsedSearchBytes = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null as Uint8Array | null;
    // Accept forms like "DE AD BE EF" or "deadbeef" or with commas/0x prefixes
    const cleaned = q.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length < 2) return null;
    const evenLen = cleaned.length - (cleaned.length % 2);
    if (evenLen < 2) return null;
    const out = new Uint8Array(evenLen / 2);
    for (let i = 0; i < evenLen; i += 2) {
      const byteStr = cleaned.slice(i, i + 2);
      const v = Number.parseInt(byteStr, 16);
      if (Number.isNaN(v)) return null;
      out[i >> 1] = v & 0xFF;
    }
    return out;
  }, [searchQuery]);

  const searchMatchStarts = useMemo(() => {
    if (!inspected || !parsedSearchBytes || parsedSearchBytes.length === 0) return [] as number[];
    const hay = inspected.data;
    const needle = parsedSearchBytes;
    const starts: number[] = [];
    // Simple forward scan
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      starts.push(i);
    }
    return starts;
  }, [inspected, parsedSearchBytes]);

  const searchMask = useMemo(() => {
    if (!inspected || !parsedSearchBytes || parsedSearchBytes.length === 0 || searchMatchStarts.length === 0) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const sz = parsedSearchBytes.length;
    for (const s of searchMatchStarts) {
      const e = Math.min(s + sz, mask.length);
      if (e > s) mask.fill(1, s, e);
    }
    return mask;
  }, [inspected, parsedSearchBytes, searchMatchStarts]);

  const activeMatchMask = useMemo(() => {
    if (!inspected || !parsedSearchBytes || parsedSearchBytes.length === 0) return null as Uint8Array | null;
    if (activeMatchIndex < 0 || activeMatchIndex >= searchMatchStarts.length) return null as Uint8Array | null;
    const mask = new Uint8Array(inspected.data.length);
    const s = searchMatchStarts[activeMatchIndex];
    const e = Math.min(s + parsedSearchBytes.length, mask.length);
    if (e > s) mask.fill(1, s, e);
    return mask;
  }, [inspected, parsedSearchBytes, activeMatchIndex, searchMatchStarts]);

  const scrollTargetRow = useMemo(() => {
    if (!parsedSearchBytes || activeMatchIndex < 0 || activeMatchIndex >= searchMatchStarts.length) return null as number | null;
    const s = searchMatchStarts[activeMatchIndex];
    return Math.floor(s / Math.max(1, bytesPerRow));
  }, [parsedSearchBytes, activeMatchIndex, searchMatchStarts, bytesPerRow]);

  // Keep active match index valid when query or matches change
  React.useEffect(() => {
    if (!parsedSearchBytes || searchMatchStarts.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    setActiveMatchIndex((prev) => (prev >= 0 && prev < searchMatchStarts.length ? prev : 0));
  }, [parsedSearchBytes, searchMatchStarts.length]);

  const goPrev = React.useCallback(() => {
    if (!parsedSearchBytes || searchMatchStarts.length === 0) return;
    setActiveMatchIndex((prev) => {
      const n = searchMatchStarts.length;
      if (prev < 0) return 0;
      return (prev - 1 + n) % n;
    });
  }, [parsedSearchBytes, searchMatchStarts.length]);

  const goNext = React.useCallback(() => {
    if (!parsedSearchBytes || searchMatchStarts.length === 0) return;
    setActiveMatchIndex((prev) => {
      const n = searchMatchStarts.length;
      if (prev < 0) return 0;
      return (prev + 1) % n;
    });
  }, [parsedSearchBytes, searchMatchStarts.length]);

  const decodePreview = useMemo(() => {
    function toHex(bytes: Uint8Array): string { return Array.from(bytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '); }
    function toAscii(bytes: Uint8Array): string { const str = Array.from(bytes).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join(''); return str.replace(/\.+$/, ''); }
    function readU16LE(bytes: Uint8Array): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true); }
    function readU32LE(bytes: Uint8Array): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) >>> 0; }
    function readF32LE(bytes: Uint8Array): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true); }
    function readU64LE(bytes: Uint8Array): string { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const lo = dv.getUint32(0, true); const hi = dv.getUint32(4, true); const big = (BigInt(hi) << 32n) | BigInt(lo); return '0x' + big.toString(16).toUpperCase(); }
    function decodeCString(bytes: Uint8Array): string { const nul = bytes.indexOf(0); const effective = nul >= 0 ? bytes.subarray(0, nul) : bytes; return new TextDecoder('utf-8').decode(effective).trim(); }
    return (bytes: Uint8Array): string => {
      const len = bytes.length;
      if (len === 0) return '';
      if (len === 32 || len === 64) { const s = decodeCString(bytes); if (s) return `"${s}"`; }
      if (len === 1) return `u8=${bytes[0]} (0x${bytes[0].toString(16).toUpperCase().padStart(2, '0')})`;
      if (len === 2) return `u16=${readU16LE(bytes)} hex=${toHex(bytes)}`;
      if (len === 4) return `u32=${readU32LE(bytes)} f32=${readF32LE(bytes).toFixed(4)} hex=${toHex(bytes)}`;
      if (len === 8) return `u64=${readU64LE(bytes)} hex=${toHex(bytes)}`;
      const ascii = toAscii(bytes);
      if (ascii.length >= 2) return `ascii="${ascii}" (len=${len})`;
      return `hex=${toHex(bytes)} (len=${len})`;
    };
  }, []);

  const tooltipForOffset = useMemo(() => {
    if (!inspected || !schema || !headerInfo || !selectedFieldKey) return null as (string | null)[] | null;
    const tips = new Array<string | null>(inspected.data.length).fill(null);
    const field = fieldsForSchema.find(f => f.key === selectedFieldKey);
    if (!field) return tips;
    const { entryOffsets, entrySize } = headerInfo as NonNullable<typeof headerInfo> & { entryOffsets: number[] };
    for (let i = 0; i < entryOffsets.length; i++) {
      const s = entryOffsets[i] + field.offset;
      const e = Math.min(s + field.size, inspected.data.length);
      if (e <= s) continue;
      const view = inspected.data.subarray(s, e);
      const decoded = decodePreview(view);
      const label = `${field.name} • entry ${i}${decoded ? ` = ${decoded}` : ''}`;
      tips.fill(label, s, e);
    }
    return tips;
  }, [inspected, schema, headerInfo, selectedFieldKey, decodePreview, fieldsForSchema]);

  const getRow = (rowIndex: number): HexRow => {
    if (!inspected) return { offset: 0, hexBytes: [], ascii: '' };
    const rowStart = rowIndex * bytesPerRow;
    const rowData = inspected.data.subarray(rowStart, Math.min(rowStart + bytesPerRow, inspected.data.length));
    const hexBytes = Array.from(rowData).map((b, i) => {
      const off = rowStart + i;
      const inField = !!selectedFieldMask && selectedFieldMask[off] === 1;
      const inEntry = !!entryMask && entryMask[off] === 1;
      const inHeader = !!headerMask && headerMask[off] === 1;
      const inSearch = !!searchMask && searchMask[off] === 1;
      const inActive = !!activeMatchMask && activeMatchMask[off] === 1;
      const prevOff = off - 1;
      const nextOff = off + 1;
      const fieldStart = inField && (!selectedFieldMask || prevOff < 0 || selectedFieldMask[prevOff] !== 1);
      const fieldEnd = inField && (!selectedFieldMask || nextOff >= inspected.data.length || selectedFieldMask[nextOff] !== 1);
      const entryStart = inEntry && (!entryMask || prevOff < 0 || entryMask[prevOff] !== 1);
      const entryEnd = inEntry && (!entryMask || nextOff >= inspected.data.length || entryMask[nextOff] !== 1);

      let color = inHeader ? 'bg-secondary text-secondary-foreground border border-border' : 'bg-muted text-foreground border border-border';
      if (inField) color += ' bg-fuchsia-500/10';
      if (entryStart) color += ' border-l-2 border-amber-500 rounded-l-sm';
      if (entryEnd) color += ' border-r-2 border-amber-500 rounded-r-sm';
      if (fieldStart) color += ' ring-2 ring-fuchsia-500 ring-offset-0';
      if (fieldEnd && !fieldStart) color += ' ring-2 ring-fuchsia-500 ring-offset-0';
      if (inSearch) color += ' bg-emerald-500/20';
      if (inActive) color += ' ring-2 ring-emerald-500 ring-offset-0';

      const section = tooltipForOffset?.[off] ?? '';
      return { byte: b, offset: off, section, color };
    });
    const ascii = Array.from(rowData).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');

    const groups: NonNullable<HexRow['groups']> = [];
    if (schema && headerInfo) {
      const rowEnd = rowStart + rowData.length;
      const { headerSize, entrySize } = headerInfo;
      const entryOffsets = (headerInfo as any).entryOffsets as number[] | undefined;

      if (rowStart < headerSize) {
        const s = 0;
        const e = Math.min(headerSize - rowStart, rowData.length);
        if (e > s) {
          const topOpen = 0 < rowStart;
          const bottomOpen = headerSize > rowEnd;
          const cls: string[] = [ 'border-2', 'border-sky-500/60', 'hover:border-sky-400/80', 'p-0.5', '-m-0.5' ];
          cls.push(topOpen ? 'border-t-0' : 'border-t-2');
          cls.push(bottomOpen ? 'border-b-0' : 'border-b-2');
          if (topOpen) cls.push('-mt-px');
          if (bottomOpen) cls.push('-mb-px');
          if (!topOpen) { cls.push('rounded-tl-md', 'rounded-tr-md'); }
          if (!bottomOpen) { cls.push('rounded-bl-md', 'rounded-br-md'); }
          groups.push({ kind: 'header', colStart: s, colEnd: e, title: `Header bytes [0x${rowStart.toString(16).toUpperCase()}..)`, classes: cls.join(' ') });
        }
      }

      const iter = entryOffsets ?? Array.from({ length: (headerInfo?.count ?? 0) }, (_, i) => headerSize + i * entrySize);
      for (let i = 0; i < iter.length; i++) {
        const es = iter[i];
        const ee = es + entrySize;
        if (rowStart < ee && rowEnd > es) {
          const sAbs = Math.max(rowStart, es);
          const eAbs = Math.min(rowEnd, ee);
          const colStart = sAbs - rowStart;
          const colEnd = eAbs - rowStart;
          const topOpen = es < rowStart;
          const bottomOpen = ee > rowEnd;
          const cls: string[] = [ 'border-2', 'border-amber-500/60', 'hover:border-amber-400/80', 'p-0.5', '-m-0.5' ];
          cls.push(topOpen ? 'border-t-0' : 'border-t-2');
          cls.push(bottomOpen ? 'border-b-0' : 'border-b-2');
          if (topOpen) cls.push('-mt-px');
          if (bottomOpen) cls.push('-mb-px');
          if (!topOpen) { cls.push('rounded-tl-md', 'rounded-tr-md'); }
          if (!bottomOpen) { cls.push('rounded-bl-md', 'rounded-br-md'); }
            groups.push({ kind: 'entry', colStart, colEnd, title: `Entry ${i} [0x${es.toString(16).toUpperCase()}..0x${(ee-1).toString(16).toUpperCase()}]`, classes: cls.join(' ') });
        }
      }
    }

    return { offset: rowStart, hexBytes, ascii, groups };
  };

  if (!inspected) return null;

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Size: {inspected.data.length.toLocaleString()} bytes</div>

      {/* Search Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Hex bytes (e.g. DE AD BE EF or deadbeef)"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    goNext();
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={goPrev} disabled={!parsedSearchBytes || searchMatchStarts.length === 0}>
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={goNext} disabled={!parsedSearchBytes || searchMatchStarts.length === 0}>
                Next
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} disabled={searchQuery.length === 0}>Clear</Button>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {parsedSearchBytes && searchMatchStarts.length > 0
                ? `Match ${activeMatchIndex + 1} of ${searchMatchStarts.length}`
                : searchQuery
                  ? 'No matches'
                  : 'Enter bytes to search'}
            </div>
          </div>
        </CardContent>
      </Card>

      {schema && headerInfo && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="text-xs text-muted-foreground">Header {headerInfo.headerSize} bytes • Entry size {headerInfo.entrySize} bytes • {headerInfo.count} entries</div>
              <div className="text-xs text-muted-foreground">Selected field highlights across all entries</div>
            </div>

            <div className="space-y-2">
              <Label>Fields</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-auto pr-1">
                {fieldsForSchema.map(f => (
                  <Button
                    key={f.key}
                    size="sm"
                    variant={selectedFieldKey === f.key ? 'secondary' : 'outline'}
                    className="justify-start"
                    onClick={() => setSelectedFieldKey(prev => prev === f.key ? null : f.key)}
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">+0x{f.offset.toString(16).toUpperCase()} • {f.size}B</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <HexTable
        rowCount={totalRows}
        getRow={(i) => {
          const row = getRow(i);
          if (inspected && schema && headerInfo) {
            const items: NonNullable<HexRow['decodedItems']> = [];
            const { entrySize } = headerInfo;
            const entryOffsets = (headerInfo as any).entryOffsets as number[] | undefined;
            const rowStart = row.offset;
            const rowEnd = rowStart + Math.min(row.hexBytes.length, bytesPerRow);

            // Only render one card per entry group, and only for the selected field (if any)
            if (selectedFieldKey) {
              const selectedField = fieldsForSchema.find(f => f.key === selectedFieldKey);
              if (selectedField) {
                const iter = entryOffsets ?? [];
                for (let idx = 0; idx < iter.length; idx++) {
                  const fs = iter[idx] + selectedField.offset;
                  const fe = fs + selectedField.size;
                  if (rowStart < fe && rowEnd > fs) {
                    const view = inspected.data.subarray(fs, Math.min(fe, inspected.data.length));
                    const decoded = decodePreview(view);
                    items.push({ label: `${selectedField.name} #${idx}`, value: decoded });
                    if (row.clickOffset == null) row.clickOffset = fs;
                  }
                }
              }
            }

            if (items.length > 0) {
              row.decodedItems = items;
              row.decoded = items.map(it => `${it.label ? it.label + ': ' : ''}${it.value}`).join(' • ');
              row.info = items[0] ? `${items[0].label ?? 'Value'} • ${items[0].value}` : row.info;
            }
          }
          return row;
        }}
        heightClass="h-[70vh]"
        scrollToRowIndex={scrollTargetRow}
        onClickByte={(offset) => {
          if (!schema || !headerInfo) return;
          const { entrySize } = headerInfo;
          const entryOffsets = (headerInfo as any).entryOffsets as number[] | undefined;
          if (!entryOffsets || entryOffsets.length === 0) return;
          for (let idx = 0; idx < entryOffsets.length; idx++) {
            const es = entryOffsets[idx];
            const ee = es + entrySize;
            if (offset >= es && offset < ee) {
              const within = offset - es;
              const f = fieldsForSchema.find(f => within >= f.offset && within < f.offset + f.size);
              if (f) setSelectedFieldKey(f.key);
              return;
            }
          }
          setSelectedFieldKey(null);
        }}
      />
    </div>
  );
};

export default ResourceInspectorView;


