import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, Hexagon, Database, Car, Palette } from 'lucide-react';
import { useBundle } from '@/context/BundleContext';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRef } from 'react';

export const BundleLayout = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    isLoading,
    isModified,
    loadedBundle,
    loadBundleFromFile,
    exportBundle,
    vehicleList,
    resources,
    playerCarColours,
    iceDictionary
  } = useBundle();

  const hasBundle = !!loadedBundle;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Bundle Manager</h1>
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
                <Button onClick={() => void exportBundle()} disabled={isLoading} variant="outline" className="gap-2">
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

      <main className="flex-1 overflow-auto">
        <div className="p-6">
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
    </div>
  );
};

export default BundleLayout;


