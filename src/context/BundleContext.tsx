import React, { createContext, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { parseBundle, parseBundleResources, writeBundle, getPlatformName, getFlagNames, formatResourceId } from '@/lib/core/bundle';
import { u64ToBigInt } from '@/lib/core/u64';
import { getResourceType } from '@/lib/resourceTypes';
import { extractResourceSize, getMemoryTypeName } from '@/lib/core/resourceManager';
import { findDebugResourceById } from '@/lib/core/bundle/debugData';
import type { ParsedBundle } from '@/lib/core/types';
import type { DebugResource } from '@/lib/core/bundle/debugData';
import type { ParsedResources } from '@/lib/core/bundle';
import type { VehicleListEntry, ParsedVehicleList } from '@/lib/core/vehicleList';
import type { PlayerCarColours } from '@/lib/core/playerCarColors';
import type { ParsedIceTakeDictionary } from '@/lib/core/iceTakeDictionary';

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
  vehicleList: VehicleListEntry[];
  parsedVehicleList: ParsedVehicleList | null;
  setVehicleList: (list: VehicleListEntry[]) => void;
  setParsedVehicleList: (v: ParsedVehicleList | null) => void;
  playerCarColours: PlayerCarColours | null;
  iceDictionary: ParsedIceTakeDictionary | null;
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
  const [vehicleList, setVehicleList] = useState<VehicleListEntry[]>([]);
  const [parsedVehicleList, setParsedVehicleList] = useState<ParsedVehicleList | null>(null);
  const [playerCarColours, setPlayerCarColours] = useState<PlayerCarColours | null>(null);
  const [iceDictionary, setIceDictionary] = useState<ParsedIceTakeDictionary | null>(null);

  const convertResourceToUI = useMemo(() => {
    return (resource: any, bundle: ParsedBundle, debugResources: DebugResource[]): UIResource => {
      const resourceType = getResourceType(resource.resourceTypeId);
      const debugResource = findDebugResourceById(debugResources, formatResourceId(u64ToBigInt(resource.resourceId)));

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
      const parsedResources: ParsedResources = parseBundleResources(arrayBuffer, bundle);

      setParsedVehicleList(parsedResources.vehicleList || null);
      setVehicleList(parsedResources.vehicleList?.vehicles || []);
      setPlayerCarColours(parsedResources.playerCarColours || null);
      setIceDictionary(parsedResources.iceTakeDictionary || null);

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

  const exportBundle = async () => {
    if (!loadedBundle || !originalArrayBuffer) {
      toast.error('No bundle loaded to export');
      return;
    }
    try {
      const outBuffer = writeBundle(
        loadedBundle,
        originalArrayBuffer,
        {
          includeDebugData: true,
          overrides: parsedVehicleList
            ? {
                vehicleList: {
                  vehicles: vehicleList,
                  header: parsedVehicleList.header
                }
              }
            : undefined
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
    vehicleList,
    parsedVehicleList,
    setVehicleList,
    setParsedVehicleList,
    playerCarColours,
    iceDictionary,
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


