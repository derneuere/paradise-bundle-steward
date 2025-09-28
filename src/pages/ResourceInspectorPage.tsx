import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBundle } from '@/context/BundleContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getResourceData, extractResourceSize, isCompressed, decompressData } from '@/lib/core/resourceManager';
import { getResourceType } from '@/lib/resourceTypes';
import { RESOURCE_TYPE_IDS } from '@/lib/core/types';
import { ResourceInspectorView } from '@/components/hexviewer/ResourceInspectorView';

const ResourceInspectorPage = () => {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { loadedBundle, originalArrayBuffer, resources } = useBundle();

  const inspected = useMemo(() => {
    if (!loadedBundle || !originalArrayBuffer) return null;
    const resourceIndex = sp.get('resourceIndex');
    const blockIndexParam = sp.get('blockIndex');
    const res = resourceIndex ? loadedBundle.resources[Number(resourceIndex)] : undefined;
    if (!res) return null;

    let bytes: Uint8Array | null = null;
    const bi = blockIndexParam != null ? Number(blockIndexParam) : undefined;
    if (typeof bi === 'number' && !Number.isNaN(bi)) {
      const base = loadedBundle.header.resourceDataOffsets[bi] >>> 0;
      const rel = res.diskOffsets[bi] >>> 0;
      const start = base + rel;
      const packed = res.sizeAndAlignmentOnDisk[bi];
      const size = extractResourceSize(packed);
      if (start < originalArrayBuffer.byteLength && size > 0) {
        const max = Math.min(size, originalArrayBuffer.byteLength - start);
        bytes = new Uint8Array(originalArrayBuffer, start, max);
      }
    }
    if (!bytes) {
      bytes = getResourceData({ bundle: loadedBundle, resource: res, buffer: originalArrayBuffer }).data;
    }
    const data = isCompressed(bytes) ? decompressData(bytes) : bytes;
    const typeLabel = getResourceType(res.resourceTypeId).name;
    const overlays: { name: string; start: number; end: number; color: string }[] = [];
    if (res.resourceTypeId === RESOURCE_TYPE_IDS.VEHICLE_LIST) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const headerSize = 16;
      const numVehicles = data.length >= 4 ? dv.getUint32(0, true) : 0;
      const entrySize = 0x108;
      overlays.push({ name: 'Header', start: 0, end: Math.min(headerSize, data.length), color: 'bg-amber-500' });
      for (let i = 0; i < Math.min(numVehicles, 2000); i++) {
        const s = headerSize + i * entrySize;
        const e = Math.min(s + entrySize, data.length);
        if (s >= data.length) break;
        overlays.push({ name: `Vehicle ${i}`, start: s, end: e, color: i % 2 === 0 ? 'bg-amber-600' : 'bg-amber-700' });
      }
    }
    return { resource: res, typeLabel, data, overlays } as any;
  }, [loadedBundle, originalArrayBuffer, sp]);

  if (!inspected) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">No resource selected for inspection.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resource Inspector — {inspected.typeLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResourceInspectorView inspected={inspected as any} bytesPerRow={16} />
      </CardContent>
    </Card>
  );
};

export default ResourceInspectorPage;


