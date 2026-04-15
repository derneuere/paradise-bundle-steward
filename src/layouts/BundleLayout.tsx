import { Outlet, NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, Hexagon, Database } from 'lucide-react';
import { useBundle } from '@/context/BundleContext';
import { useRef, useState, useMemo } from 'react';
import { ExportWarningModal } from '@/components/capabilities';
import { getCapabilityByTypeId, type FeatureCapability } from '@/lib/capabilities';
import { registry } from '@/lib/core/registry';

export const BundleLayout = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const {
    isLoading,
    isModified,
    loadedBundle,
    loadBundleFromFile,
    exportBundle,
    parsedResources,
  } = useBundle();

  const hasBundle = !!loadedBundle;

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


