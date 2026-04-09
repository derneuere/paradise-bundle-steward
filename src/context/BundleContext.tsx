import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { parseBundle, writeBundleFresh, getPlatformName, getFlagNames, formatResourceId } from '@/lib/core/bundle';
import { parseBundleResourcesViaRegistry } from '@/lib/core/registry/bundleOps';
import { u64ToBigInt } from '@/lib/core/u64';
import { getResourceType } from '@/lib/resourceTypes';
import { extractResourceSize, getMemoryTypeName } from '@/lib/core/resourceManager';
import { findDebugResourceById } from '@/lib/core/bundle/debugData';
import type { ParsedBundle } from '@/lib/core/types';
import type { DebugResource } from '@/lib/core/bundle/debugData';

export type UIResource = {
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
  raw: any;
};

type BundleContextValue = {
  isLoading: boolean;
  isModified: boolean;
  setIsModified: (v: boolean) => void;
  originalArrayBuffer: ArrayBuffer | null;
  loadedBundle: ParsedBundle | null;
  resources: UIResource[];
  debugResources: DebugResource[];
  /**
   * Generic handler-key → parsed model map. Editor pages consume this via
   * getResource<T>('streetData') and push edits back via setResource('streetData', model).
   */
  parsedResources: Map<string, unknown>;
  getResource: <T>(key: string) => T | null;
  setResource: (key: string, next: unknown | null) => void;
  loadBundleFromFile: (file: File) => Promise<void>;
  exportBundle: () => Promise<void>;
};

const BundleContext = createContext<BundleContextValue | undefined>(undefined);

export const BundleProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isModified, setIsModified] = useState(false);
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<ParsedBundle | null>(null);
  const [resources, setResources] = useState<UIResource[]>([]);
  const [debugResources, setDebugResources] = useState<DebugResource[]>([]);
  const [parsedResources, setParsedResources] = useState<Map<string, unknown>>(() => new Map());

  const convertResourceToUI = useMemo(() => {
    return (resource: any, bundle: ParsedBundle, debugData: DebugResource[]): UIResource => {
      const resourceType = getResourceType(resource.resourceTypeId);
      const debugResource = findDebugResourceById(debugData, formatResourceId(u64ToBigInt(resource.resourceId)));

      let memoryTypeIndex = 0;
      let uncompressed = extractResourceSize(resource.uncompressedSizeAndAlignment[0]);
      let compressed = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
      for (let i = 0; i < 3; i++) {
        const size = extractResourceSize(resource.uncompressedSizeAndAlignment[i]);
        if (size > 0) {
          memoryTypeIndex = i;
          uncompressed = size;
          compressed = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
          break;
        }
      }

      return {
        id: formatResourceId(u64ToBigInt(resource.resourceId)),
        name: debugResource?.name || `Resource_${resource.resourceId.low.toString(16)}`,
        type: resourceType.name,
        typeName: debugResource?.typeName || resourceType.description,
        category: resourceType.category,
        platform: getPlatformName(bundle.header.platform),
        uncompressedSize: uncompressed,
        compressedSize: compressed,
        memoryType: getMemoryTypeName(bundle.header.platform, memoryTypeIndex),
        imports: [],
        flags: getFlagNames(resource.flags),
        raw: resource
      };
    };
  }, []);

  const loadBundleFromFile = async (file: File) => {
    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      setOriginalArrayBuffer(arrayBuffer);
      const bundle = parseBundle(arrayBuffer);

      let debugData: DebugResource[] = [];
      if (bundle.debugData) {
        const { parseDebugDataFromXml } = await import('@/lib/core/bundle/debugData');
        debugData = parseDebugDataFromXml(bundle.debugData);
      }

      const uiResources = bundle.resources.map((resource) => convertResourceToUI(resource, bundle, debugData));
      const modelMap = parseBundleResourcesViaRegistry(arrayBuffer, bundle);

      setParsedResources(modelMap);
      setLoadedBundle(bundle);
      setResources(uiResources);
      setDebugResources(debugData);
      setIsModified(false);

      toast.success(`Loaded bundle: ${file.name}`, {
        description: `${bundle.resources.length} resources found, Platform: ${getPlatformName(bundle.header.platform)}`
      });
    } catch (error) {
      console.error('Error parsing bundle:', error);
      toast.error('Failed to parse bundle file', { description: error instanceof Error ? error.message : 'Unknown error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  const getResource = useCallback(
    <T,>(key: string): T | null => {
      const v = parsedResources.get(key);
      return (v as T | undefined) ?? null;
    },
    [parsedResources],
  );

  const setResource = useCallback((key: string, next: unknown | null) => {
    setParsedResources((prev) => {
      const copy = new Map(prev);
      if (next == null) copy.delete(key);
      else copy.set(key, next);
      return copy;
    });
    setIsModified(true);
  }, []);

  const exportBundle = async () => {
    if (!loadedBundle || !originalArrayBuffer) {
      toast.error('No bundle loaded to export');
      return;
    }
    try {
      // Build a generic resources override map keyed by handler.key, which
      // writeBundleFresh translates to typeId via the registry.
      const overrides: Record<string, unknown> = {};
      for (const [key, model] of parsedResources) {
        overrides[key] = model;
      }

      const outBuffer = writeBundleFresh(
        loadedBundle,
        originalArrayBuffer,
        {
          includeDebugData: true,
          overrides: { resources: keyedOverridesToTypeIdMap(parsedResources, loadedBundle) },
        },
      );

      const blob = new Blob([outBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bundle-modified.BUNDLE';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success('Exported bundle', { description: `Size: ${(outBuffer.byteLength / 1024).toFixed(1)} KB` });
    } catch (error) {
      console.error('Error exporting bundle:', error);
      toast.error('Failed to export bundle', { description: error instanceof Error ? error.message : 'Unknown error' });
    }
  };

  const value: BundleContextValue = {
    isLoading,
    isModified,
    setIsModified,
    originalArrayBuffer,
    loadedBundle,
    resources,
    debugResources,
    parsedResources,
    getResource,
    setResource,
    loadBundleFromFile,
    exportBundle
  };

  return <BundleContext.Provider value={value}>{children}</BundleContext.Provider>;
};

export const useBundle = () => {
  const ctx = useContext(BundleContext);
  if (!ctx) throw new Error('useBundle must be used within BundleProvider');
  return ctx;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Translate handler-key → model map to typeId → model map for writeBundleFresh.
// Uses the registry to look up handler metadata; imported here (not above) so
// the registry side-effect module lands once per app boot.
import { getHandlerByKey } from '@/lib/core/registry';
function keyedOverridesToTypeIdMap(
  map: Map<string, unknown>,
  _bundle: ParsedBundle,
): Record<number, unknown> {
  const out: Record<number, unknown> = {};
  for (const [key, model] of map) {
    const handler = getHandlerByKey(key);
    if (!handler || !handler.caps.write) continue;
    out[handler.typeId] = model;
  }
  return out;
}
