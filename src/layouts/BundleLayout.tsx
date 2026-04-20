import { Outlet, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, Hexagon, Database, Box } from 'lucide-react';
import { useBundle } from '@/context/BundleContext';
import { useRef, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { ExportWarningModal } from '@/components/capabilities';
import { getCapabilityByTypeId, type FeatureCapability } from '@/lib/capabilities';
import { registry } from '@/lib/core/registry';
import type { ParsedStreetData } from '@/lib/core/streetData';
import type { ParsedTrafficData } from '@/lib/core/trafficData';
import type { ParsedAISections } from '@/lib/core/aiSections';
import type { ParsedTriggerData } from '@/lib/core/triggerData';
import {
  exportWorldLogicToGltf,
  importWorldLogicFromGltf,
  type WorldLogicPayload,
} from '@/lib/core/gltf';

// Which parsedResources keys participate in the worldlogic glTF flow. Order
// matches the on-screen summary text.
const WORLD_LOGIC_KEYS = ['streetData', 'trafficData', 'aiSections', 'triggerData'] as const;
type WorldLogicKey = (typeof WORLD_LOGIC_KEYS)[number];

export const BundleLayout = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gltfInputRef = useRef<HTMLInputElement>(null);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const {
    isLoading,
    isModified,
    loadedBundle,
    loadBundleFromFile,
    exportBundle,
    parsedResources,
    getResource,
    setResource,
  } = useBundle();

  const hasBundle = !!loadedBundle;

  const worldLogicKeys = useMemo(
    () => WORLD_LOGIC_KEYS.filter((k) => parsedResources.has(k)),
    [parsedResources],
  );
  const hasWorldLogic = worldLogicKeys.length > 0;

  // Check which present-but-unsupported-for-write features have been modified.
  // Drives the export warning. Looks up capability metadata by type id so
  // adding a new resource doesn't need edits here.
  const unsupportedModifiedFeatures = useMemo(() => {
    const unsupported: FeatureCapability[] = [];
    for (const handler of registry) {
      if (handler.caps.write) continue;
      if (!parsedResources.has(handler.key)) continue;
      const cap = getCapabilityByTypeId(handler.typeId);
      if (cap) unsupported.push(cap);
    }
    return unsupported;
  }, [parsedResources]);

  const handleExportClick = () => {
    if (isModified && unsupportedModifiedFeatures.length > 0) {
      setShowExportWarning(true);
    } else {
      void exportBundle();
    }
  };

  const handleConfirmExport = () => {
    setShowExportWarning(false);
    void exportBundle();
  };

  const handleExportGltf = async () => {
    if (!hasWorldLogic) {
      toast.error('No world-logic resources in this bundle', {
        description: 'Expected StreetData, TrafficData, AISections, or TriggerData.',
      });
      return;
    }
    try {
      const payload: WorldLogicPayload = {};
      if (parsedResources.has('streetData')) {
        payload.streetData = getResource<ParsedStreetData>('streetData') ?? undefined;
      }
      if (parsedResources.has('trafficData')) {
        payload.trafficData = getResource<ParsedTrafficData>('trafficData') ?? undefined;
      }
      if (parsedResources.has('aiSections')) {
        payload.aiSections = getResource<ParsedAISections>('aiSections') ?? undefined;
      }
      if (parsedResources.has('triggerData')) {
        payload.triggerData = getResource<ParsedTriggerData>('triggerData') ?? undefined;
      }
      const bytes = await exportWorldLogicToGltf(payload);
      const blob = new Blob([bytes], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'world-logic.glb';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success('Exported world-logic glTF', {
        description: `${worldLogicKeys.join(', ')} · ${(bytes.byteLength / 1024).toFixed(1)} KB`,
      });
    } catch (error) {
      console.error('Error exporting glTF:', error);
      toast.error('Failed to export glTF', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleImportGltfClick = () => {
    if (!hasBundle) {
      toast.error('Load a bundle first', {
        description: 'Import replaces world-logic resources in the currently loaded bundle.',
      });
      return;
    }
    gltfInputRef.current?.click();
  };

  const handleImportGltfFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const payload = await importWorldLogicFromGltf(bytes);
      const applied: WorldLogicKey[] = [];
      for (const key of WORLD_LOGIC_KEYS) {
        const model = payload[key];
        if (model !== undefined) {
          setResource(key, model);
          applied.push(key);
        }
      }
      if (applied.length === 0) {
        toast.error('glTF contained no world-logic resources', {
          description: 'Expected StreetData, TrafficData, AISections, or TriggerData.',
        });
        return;
      }
      toast.success('Imported world-logic glTF', {
        description: `${applied.join(', ')} · use Export Bundle to save the rewritten bundle.`,
      });
    } catch (error) {
      console.error('Error importing glTF:', error);
      toast.error('Failed to import glTF', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Online Bundle Manager</h1>
              <p className="text-muted-foreground">Burnout Paradise Bundle Editor & Resource Explorer</p>
            </div>
            <div className="flex items-center gap-3">
              {isModified && (
                <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                  Modified
                </Badge>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".bundle,.bndl,.bin,.dat"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadBundleFromFile(f);
                }}
                className="hidden"
              />
              <input
                ref={gltfInputRef}
                type="file"
                accept=".gltf,.glb"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportGltfFile(f);
                  // Reset so re-selecting the same file fires change again.
                  e.target.value = '';
                }}
                className="hidden"
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="gap-2">
                <Upload className="w-4 h-4" />
                {isLoading ? 'Loading...' : 'Load Bundle'}
              </Button>
              {hasBundle && (
                <Button onClick={handleExportClick} disabled={isLoading} variant="outline" className="gap-2">
                  <Download className="w-4 h-4" />
                  Export Bundle
                </Button>
              )}
              {hasWorldLogic && (
                <Button
                  onClick={() => void handleExportGltf()}
                  disabled={isLoading}
                  variant="outline"
                  className="gap-2"
                  title={`Export ${worldLogicKeys.join(', ')} as a single world-logic glTF for Blender`}
                >
                  <Box className="w-4 h-4" />
                  Export glTF
                </Button>
              )}
              {hasBundle && (
                <Button
                  onClick={handleImportGltfClick}
                  disabled={isLoading}
                  variant="outline"
                  className="gap-2"
                  title="Import an edited world-logic glTF back into the current bundle"
                >
                  <Upload className="w-4 h-4" />
                  Import glTF
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <nav className="px-6 py-2 border-b">
        <div className="flex items-center gap-2">
          <NavLink to="/resources" className={({ isActive }) => `px-3 py-1.5 rounded ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}>
            <Database className="inline w-4 h-4 mr-1" /> Resources
          </NavLink>
          <div className="ml-auto" />
          <NavLink to="/hexview" className={({ isActive }) => `px-3 py-1.5 rounded ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}>
            <Hexagon className="inline w-4 h-4 mr-1" /> Hex View
          </NavLink>
        </div>
      </nav>

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full p-6 overflow-auto">
          {!hasBundle ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium">No Bundle Loaded</h3>
                <p className="text-muted-foreground">Select a bundle file to get started with editing and resource exploration.</p>
              </div>
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" />
                Load Bundle File
              </Button>
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
      
      <ExportWarningModal
        open={showExportWarning}
        onOpenChange={setShowExportWarning}
        onConfirm={handleConfirmExport}
        unsupportedFeatures={unsupportedModifiedFeatures}
      />
    </div>
  );
};

export default BundleLayout;


