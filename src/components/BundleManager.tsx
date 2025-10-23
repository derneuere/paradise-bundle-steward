import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Database, Cpu, HardDrive, Zap, AlertCircle, Download, Search, Filter, File, Image, Volume2, Code } from "lucide-react";
import { toast } from "sonner";
import type { VehicleListEntry } from "@/lib/core/vehicleList";
import { useBundle } from "@/context/BundleContext";

import { VehicleEditor } from './VehicleEditor';

// Converted resource type for UI display
type UIResource = {
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
}

export const BundleManager = () => {
  const [selectedResource, setSelectedResource] = useState<UIResource | null>(null);
  const {
    isLoading,
    isModified,
    setIsModified,
    loadedBundle,
    vehicleList,
    parsedVehicleList,
    setVehicleList,
    setParsedVehicleList,
    loadBundleFromFile,
    exportBundle,
  } = useBundle();
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleListEntry | null>(null);
  const [isVehicleEditorOpen, setIsVehicleEditorOpen] = useState(false);
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI resource list and other presentation comes from context elsewhere

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await loadBundleFromFile(file);
    } catch (error) {
      console.error('Error parsing bundle:', error);
      toast.error("Failed to parse bundle file", {
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  };

  const handleSaveVehicle = (savedVehicle: VehicleListEntry) => {
    if (isNewVehicle) {
      // Add new vehicle
      const updatedVehicles = [...vehicleList, savedVehicle];
      setVehicleList(updatedVehicles);
      if (parsedVehicleList) {
        setParsedVehicleList({
          ...parsedVehicleList,
          vehicles: updatedVehicles,
          header: {
            ...parsedVehicleList.header,
            numVehicles: updatedVehicles.length
          }
        });
      }
      toast.success(`Vehicle "${savedVehicle.vehicleName}" added successfully.`);
    } else {
      // Update existing vehicle
      const updatedVehicles = vehicleList.map(v => v.id === savedVehicle.id ? savedVehicle : v);
      setVehicleList(updatedVehicles);
      if (parsedVehicleList) {
        setParsedVehicleList({
          ...parsedVehicleList,
          vehicles: updatedVehicles
        });
      }
      toast.success(`Vehicle "${savedVehicle.vehicleName}" updated successfully.`);
    }
    setIsModified(true);
  };

  const handleExportBundle = async () => {
    try {
      await exportBundle();
    } catch (error) {
      console.error('Error exporting bundle:', error);
      toast.error("Failed to export bundle", {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Online Bundle Manager</h1>
              <p className="text-muted-foreground">
                Burnout Paradise Bundle Editor & Resource Explorer
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isModified && (
                <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Modified
                </Badge>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".bundle,.bndl,.bin,.dat"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                {isLoading ? 'Loading...' : 'Load Bundle'}
              </Button>
              {loadedBundle && (
                <Button
                  onClick={handleExportBundle}
                  disabled={isLoading}
                  variant="outline"
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Bundle
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          {!loadedBundle ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium">No Bundle Loaded</h3>
                <p className="text-muted-foreground">
                  Select a bundle file to get started with editing and resource exploration.
                </p>
              </div>
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" />
                Load Bundle File
              </Button>
            </div>
          ) : null}
        </div>
      </main>

      {/* Vehicle Editor Dialog */}
      <VehicleEditor
        vehicle={selectedVehicle}
        isOpen={isVehicleEditorOpen}
        onClose={() => {
          setIsVehicleEditorOpen(false);
          setSelectedVehicle(null);
          setIsNewVehicle(false);
        }}
        onSave={handleSaveVehicle}
        isNewVehicle={isNewVehicle}
      />
    </div>
  );
};