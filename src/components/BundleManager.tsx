import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {  Upload, Database, Cpu, HardDrive, Zap, AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";
import { parseBundle, getPlatformName, getFlagNames, formatResourceId, type ParsedBundle, type ResourceEntry } from "@/lib/parsers/bundleParser";
import { extractResourceSize, getMemoryTypeName } from "@/lib/core/resourceManager";
import { PLATFORMS } from "@/lib/core/types";
import { RESOURCE_TYPES, getResourceType, getResourceTypeColor, type ResourceCategory } from "@/lib/resourceTypes";
import { parseDebugData, findDebugResourceById, type DebugResource } from "@/lib/debugDataParser";
import { parseVehicleList, type VehicleListEntry } from "@/lib/parsers/vehicleListParser";
import { parsePlayerCarColours, type PlayerCarColours } from "@/lib/parsers/playerCarColoursParser";
import { VehicleList } from "@/components/VehicleList";
import { PlayerCarColoursComponent } from "@/components/PlayerCarColours";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VehicleEditor } from './VehicleEditor';
import { writeVehicleList } from '@/lib/parsers/vehicleListWriter';
import {  BundleBuilder } from '@/lib/core/bundleWriter';

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
  raw: ResourceEntry;
}

const formatBytes = (bytes: number) => {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const getMemoryIcon = (type: string) => {
  if (type.includes('Main')) return <Cpu className="w-4 h-4" />;
  if (type.includes('Graphics')) return <Zap className="w-4 h-4" />;
  if (type.includes('Physical') || type.includes('Disposable')) return <HardDrive className="w-4 h-4" />;
  return <Database className="w-4 h-4" />;
};

const getTypeColor = (category: string) => {
  return getResourceTypeColor(category as ResourceCategory);
};

export const BundleManager = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<UIResource | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<ParsedBundle | null>(null);
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [resources, setResources] = useState<UIResource[]>([]);
  const [debugResources, setDebugResources] = useState<DebugResource[]>([]);
  const [vehicleList, setVehicleList] = useState<VehicleListEntry[]>([]);
  const [playerCarColours, setPlayerCarColours] = useState<PlayerCarColours | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModified, setIsModified] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleListEntry | null>(null);
  const [isVehicleEditorOpen, setIsVehicleEditorOpen] = useState(false);
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredResources = resources.filter(resource => {
    const matchesSearch = resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         resource.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         resource.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         resource.typeName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlatform = selectedPlatform === "all" || resource.platform === selectedPlatform;
    return matchesSearch && matchesPlatform;
  });

  const convertResourceToUI = (resource: ResourceEntry, bundle: ParsedBundle, debugResources: DebugResource[]): UIResource => {
    const resourceType = getResourceType(resource.resourceTypeId);
    const debugResource = findDebugResourceById(debugResources, formatResourceId(resource.resourceId));
    
    // Find primary memory type (first non-zero size)
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
      id: formatResourceId(resource.resourceId),
      name: debugResource?.name || `Resource_${resource.resourceId.toString(16)}`,
      type: resourceType.name,
      typeName: debugResource?.typeName || resourceType.description,
      category: resourceType.category,
      platform: getPlatformName(bundle.header.platform),
      uncompressedSize: uncompressed,
      compressedSize: compressed,
      memoryType: getMemoryTypeName(bundle.header.platform, memoryTypeIndex),
      imports: [], // TODO: resolve import names from debug data
      flags: getFlagNames(resource.flags),
      raw: resource
    };
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      setOriginalArrayBuffer(arrayBuffer);
      const bundle = parseBundle(arrayBuffer);
      
      // Parse debug data if available
      let debugData: DebugResource[] = [];
      if (bundle.debugData) {
        debugData = parseDebugData(bundle.debugData);
      }

      // Convert resources to UI format
      const uiResources = bundle.resources.map(resource =>
        convertResourceToUI(resource, bundle, debugData)
      );

      // Parse vehicle list if present
      const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
      if (vehicleType) {
        const vehicleResource = bundle.resources.find(r => r.resourceTypeId === vehicleType.id);
        if (vehicleResource) {
          const littleEndian = bundle.header.platform !== PLATFORMS.PS3;
          const vehicles = parseVehicleList(arrayBuffer, vehicleResource, { littleEndian });
          setVehicleList(vehicles);
        } else {
          setVehicleList([]);
        }
      } else {
        setVehicleList([]);
      }

      // Parse player car colours if present
      const colourType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Player Car Colours');
      if (colourType) {
        const colourResource = bundle.resources.find(r => r.resourceTypeId === colourType.id);
        if (colourResource) {
          const is64Bit = bundle.header.platform === PLATFORMS.PC; // Assume PC is 64-bit
          const colours = parsePlayerCarColours(arrayBuffer, colourResource, is64Bit, { strict: false });
          setPlayerCarColours(colours);
        } else {
          setPlayerCarColours(null);
        }
      } else {
        setPlayerCarColours(null);
      }

      setLoadedBundle(bundle);
      setResources(uiResources);
      setDebugResources(debugData);
      setSelectedResource(null);
      setIsModified(false);
      
      toast.success(`Loaded bundle: ${file.name}`, {
        description: `${bundle.resources.length} resources found, Platform: ${getPlatformName(bundle.header.platform)}`
      });
    } catch (error) {
      console.error('Error parsing bundle:', error);
      toast.error("Failed to parse bundle file", {
        description: error instanceof Error ? error.message : "Unknown error occurred"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const totalUncompressed = filteredResources.reduce((sum, r) => sum + r.uncompressedSize, 0);
  const totalCompressed = filteredResources.reduce((sum, r) => sum + r.compressedSize, 0);
  const compressionRatio = totalUncompressed > 0 ? (totalCompressed / totalUncompressed * 100).toFixed(1) : "0";

  const currentPlatform = loadedBundle ? getPlatformName(loadedBundle.header.platform) : "None";

  const handleAddVehicle = () => {
    setSelectedVehicle(null);
    setIsNewVehicle(true);
    setIsVehicleEditorOpen(true);
  };

  const handleEditVehicle = (vehicle: VehicleListEntry) => {
    setSelectedVehicle(vehicle);
    setIsNewVehicle(false);
    setIsVehicleEditorOpen(true);
  };

  const handleDeleteVehicle = (vehicleToDelete: VehicleListEntry) => {
    if (confirm(`Are you sure you want to delete vehicle "${vehicleToDelete.vehicleName}"?`)) {
      const updatedVehicles = vehicleList.filter(v => v.id !== vehicleToDelete.id);
      setVehicleList(updatedVehicles);
      setIsModified(true);
      toast.success(`Vehicle "${vehicleToDelete.vehicleName}" deleted successfully.`);
    }
  };

  const handleSaveVehicle = (savedVehicle: VehicleListEntry) => {
    if (isNewVehicle) {
      // Add new vehicle
      setVehicleList(prev => [...prev, savedVehicle]);
      toast.success(`Vehicle "${savedVehicle.vehicleName}" added successfully.`);
    } else {
      // Update existing vehicle
      setVehicleList(prev => 
        prev.map(v => v.id === savedVehicle.id ? savedVehicle : v)
      );
      toast.success(`Vehicle "${savedVehicle.vehicleName}" updated successfully.`);
    }
    setIsModified(true);
  };

  const handleExportBundle = async () => {
    if (!loadedBundle || !originalArrayBuffer) {
      toast.error('No bundle loaded to export.');
      return;
    }

    try {
      setIsLoading(true);
      
             // Create a new bundle builder
       const builder = new BundleBuilder({
         platform: loadedBundle.header.platform as any,
         compress: (loadedBundle.header.flags & 0x1) !== 0
       });

       // Add existing resources, replacing vehicle list if modified
       for (const resource of loadedBundle.resources) {
         const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
         
         if (vehicleType && resource.resourceTypeId === vehicleType.id && isModified) {
           // Replace vehicle list with modified data
           const littleEndian = loadedBundle.header.platform !== PLATFORMS.PS3;
           const vehicleListData = writeVehicleList(vehicleList, littleEndian);
           builder.addResource(resource.resourceTypeId, vehicleListData, resource.resourceId);
         } else {
           // Extract original resource data from the bundle
           const resourceStartOffset = resource.diskOffsets[0];
           const resourceSize = resource.sizeAndAlignmentOnDisk[0];
           
           // Extract the raw resource data from the original bundle
           const resourceData = new Uint8Array(
             originalArrayBuffer.slice(resourceStartOffset, resourceStartOffset + resourceSize)
           );
           
                     // Add the original resource data to the new bundle
          // Use the new method to preserve all original resource metadata
          console.log(`📦 Adding existing resource 0x${resource.resourceTypeId.toString(16)}: ${resourceData.length} bytes, flags=0x${resource.flags.toString(16)}`);
          
          builder.addExistingResource(resource, resourceData);
         }
       }

      if (loadedBundle.debugData) {
        builder.setDebugData(loadedBundle.debugData);
      }

      const newBundleData = await builder.build();
      
      // Download the file
      const blob = new Blob([newBundleData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modified_bundle.bundle';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Bundle exported successfully!');
      setIsModified(false);
      
    } catch (error) {
      console.error('Error exporting bundle:', error);
      toast.error(`Failed to export bundle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Bundle Manager</h1>
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
          ) : (
            <Tabs defaultValue="vehicles" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="vehicles">
                  Vehicles ({vehicleList.length})
                </TabsTrigger>
                <TabsTrigger value="resources">
                  Resources ({resources.length})
                </TabsTrigger>
                <TabsTrigger value="colors">
                  Player Colors
                </TabsTrigger>
              </TabsList>

              <TabsContent value="vehicles" className="space-y-6">
                <VehicleList
                  vehicles={vehicleList}
                  onAddVehicle={handleAddVehicle}
                  onEditVehicle={handleEditVehicle}
                  onDeleteVehicle={handleDeleteVehicle}
                  onExportBundle={handleExportBundle}
                />
              </TabsContent>

              <TabsContent value="resources" className="space-y-6">
                {/* Existing resources tab content */}
              </TabsContent>

                             <TabsContent value="colors" className="space-y-6">
                 {playerCarColours ? (
                   <PlayerCarColoursComponent colours={playerCarColours} />
                 ) : (
                   <Alert>
                     <AlertCircle className="h-4 w-4" />
                     <AlertDescription>
                       No player car colours found in this bundle.
                     </AlertDescription>
                   </Alert>
                 )}
               </TabsContent>
            </Tabs>
          )}
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