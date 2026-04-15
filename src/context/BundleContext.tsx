import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { parseBundle, writeBundleFresh, getPlatformName, getFlagNames, formatResourceId } from '@/lib/core/bundle';
import { parseBundleResourcesViaRegistry, parseAllBundleResourcesViaRegistry } from '@/lib/core/registry/bundleOps';
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
   *
   * For keys whose bundle has multiple resources of the same type (e.g.
   * polygonSoupList inside WORLDCOL.BIN), this holds the FIRST one. See
   * `parsedResourcesAll` / `getResources` for the full list.
   */
  parsedResources: Map<string, unknown>;
  /**
   * All parsed models per key, preserving `bundle.resources` order. Entries
   * that failed to parse are `null` so indexes stay aligned with the bundle.
   */
  parsedResourcesAll: Map<string, (unknown | null)[]>;
  getResource: <T>(key: string) => T | null;
  /** All parsed models of a type; empty array when the bundle has none. */
  getResources: <T>(key: string) => (T | null)[];
  setResource: (key: string, next: unknown | null) => void;
  /**
   * Replace the Nth parsed model of a type. `setResource(key, v)` is the
   * same as `setResourceAt(key, 0, v)` — it keeps the first-resource
   * shortcut in sync so legacy editors that use getResource still see
   * edits made through the multi-resource UI.
   */
  setResourceAt: (key: string, index: number, next: unknown | null) => void;
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
  const [parsedResourcesAll, setParsedResourcesAll] = useState<Map<string, (unknown | null)[]>>(() => new Map());
  // Tracks which (handlerKey, index) pairs have been explicitly edited since
  // the bundle loaded. Drives the multi-resource export path: only dirty
  // entries become `byResourceId` overrides, so untouched resources write
  // back byte-exact through the pass-through path.
  const [dirtyMulti, setDirtyMulti] = useState<Set<string>>(() => new Set());

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
      const modelMapAll = parseAllBundleResourcesViaRegistry(arrayBuffer, bundle);

      setParsedResources(modelMap);
      setParsedResourcesAll(modelMapAll);
      setDirtyMulti(new Set());
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

  const getResources = useCallback(
    <T,>(key: string): (T | null)[] => {
      const list = parsedResourcesAll.get(key);
      return (list as (T | null)[] | undefined) ?? [];
    },
    [parsedResourcesAll],
  );

  const setResourceAt = useCallback((key: string, index: number, next: unknown | null) => {
    setParsedResourcesAll((prev) => {
      const copy = new Map(prev);
      const list = copy.get(key)?.slice() ?? [];
      // Pad with nulls if caller pokes past the end — shouldn't happen for
      // normal edits, but safer than throwing mid-render.
      while (list.length <= index) list.push(null);
      list[index] = next;
      copy.set(key, list);
      return copy;
    });
    // Keep the first-resource shortcut in sync so legacy editors that use
    // getResource still observe edits made through setResourceAt.
    if (index === 0) {
      setParsedResources((prev) => {
        const copy = new Map(prev);
        if (next == null) copy.delete(key);
        else copy.set(key, next);
        return copy;
      });
    }
    // Mark this (key, index) as dirty so the export path emits a per-
    // resource-id override for it instead of overriding every resource of
    // the same type.
    setDirtyMulti((prev) => {
      const copy = new Set(prev);
      copy.add(`${key}:${index}`);
      return copy;
    });
    setIsModified(true);
  }, []);

  const setResource = useCallback(
    (key: string, next: unknown | null) => setResourceAt(key, 0, next),
    [setResourceAt],
  );

  const exportBundle = async () => {
    if (!loadedBundle || !originalArrayBuffer) {
      toast.error('No bundle loaded to export');
      return;
    }
    try {
      // Two override paths are emitted in parallel:
      //
      //   1. `resources` (keyed by typeId) — legacy/broad overrides for
      //      bundles with one resource per type. Keeps every existing
      //      single-resource editor working with zero changes.
      //   2. `byResourceId` (keyed by formatted u64 hex) — only populated
      //      for `(key, index)` pairs that setResourceAt actually touched
      //      since bundle load. Dirty entries become per-resource overrides,
      //      so untouched resources of the same type write back byte-exact
      //      through the pass-through path. This is what makes multi-
      //      resource bundles like WORLDCOL.BIN round-trip cleanly after
      //      editing a single soup.
      //
      // When byResourceId has an entry for a given resource, writeBundleFresh
      // prefers it over the typeId override, so the two can coexist safely.
      const byResourceId = buildByResourceIdOverrides(
        loadedBundle,
        parsedResourcesAll,
        dirtyMulti,
      );

      // Only emit `resources[typeId]` overrides for keys the user has
      // explicitly touched at index 0. Otherwise, parsedResources — which is
      // auto-populated on bundle load — would apply its "first resource of
      // each type" model to EVERY resource of that type, clobbering the
      // remaining same-typed resources with the first one's bytes. For
      // bundles like WORLDCOL.BIN that hold hundreds of PolygonSoupList
      // resources, this would strip ~14 MB of world geometry on every
      // export, because the first PSL is a 48-byte empty stub.
      //
      // dirtyMulti tracks explicit edits: an entry at `${key}:0` means the
      // user actually changed that resource and wants its override emitted.
      // Unedited types fall through to the writer's pass-through path and
      // round-trip byte-exact.
      const filteredSingleResource = new Map<string, unknown>();
      for (const [k, model] of parsedResources) {
        if (dirtyMulti.has(`${k}:0`)) filteredSingleResource.set(k, model);
      }

      const outBuffer = writeBundleFresh(
        loadedBundle,
        originalArrayBuffer,
        {
          includeDebugData: true,
          overrides: {
            resources: keyedOverridesToTypeIdMap(filteredSingleResource, loadedBundle),
            byResourceId,
          },
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
    parsedResourcesAll,
    getResource,
    getResources,
    setResource,
    setResourceAt,
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
import { getHandlerByKey, getHandlerByTypeId } from '@/lib/core/registry';
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

/**
 * Build a resource-id-keyed override map from `parsedResourcesAll` + a
 * dirty-tracking set. Walks `bundle.resources` in order, counting per-
 * typeId instances so `parsedResourcesAll.get(key)[N]` lines up with the
 * N-th resource of that type in the bundle. Only emits entries for
 * `(key, index)` pairs present in `dirty` — untouched resources are
 * silently omitted so the writer's pass-through path can re-emit their
 * original bytes.
 *
 * Keys are the same hex format `writeBundleFresh` uses internally:
 * `0x{16-upper-hex-padded}`, derived from `u64ToBigInt(resource.resourceId)`.
 */
function buildByResourceIdOverrides(
  bundle: ParsedBundle,
  parsedResourcesAll: Map<string, (unknown | null)[]>,
  dirty: Set<string>,
): Record<string, unknown> {
  if (dirty.size === 0) return {};
  const out: Record<string, unknown> = {};
  const typeCounters = new Map<number, number>();
  for (const resource of bundle.resources) {
    const typeId = resource.resourceTypeId;
    const nBefore = typeCounters.get(typeId) ?? 0;
    typeCounters.set(typeId, nBefore + 1);

    const handler = getHandlerByTypeId(typeId);
    if (!handler || !handler.caps.write) continue;
    if (!dirty.has(`${handler.key}:${nBefore}`)) continue;
    const list = parsedResourcesAll.get(handler.key);
    if (!list) continue;
    const model = list[nBefore];
    if (model == null) continue;

    const idHex = `0x${u64ToBigInt(resource.resourceId).toString(16).toUpperCase().padStart(16, '0')}`;
    out[idHex] = model;
  }
  return out;
}
