import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Database, Cpu, HardDrive, Zap, AlertCircle, Download, Search, Filter, File, Image, Volume2, Code } from "lucide-react";
import { toast } from "sonner";
import { parseBundle, writeBundle, getPlatformName, getFlagNames, formatResourceId } from "@/lib/core/bundle";
import { parseDebugDataFromXml, findDebugResourceById, type DebugResource } from "@/lib/core/bundle/debugData";
import { u64ToBigInt } from "@/lib/core/u64";
import { parseBundleResources, type ParsedResources } from "@/lib/core/bundle";
import { type VehicleListEntry, type ParsedVehicleList } from "@/lib/core/vehicleList";
import { type PlayerCarColours } from "@/lib/core/playerCarColors";
import type { ParsedIceTakeDictionary } from "@/lib/core/iceTakeDictionary";
import { extractResourceSize, getMemoryTypeName } from "@/lib/core/resourceManager";
import type { ResourceContext, ParsedBundle, ResourceEntry } from "@/lib/core/types";
import { getResourceType, getResourceTypeColor, type ResourceCategory } from "@/lib/resourceTypes";
import { VehicleList } from "@/components/VehicleList";
import { PlayerCarColoursComponent } from "@/components/PlayerCarColours";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleEditor } from './VehicleEditor';
import { IceTakeDictionaryComponent } from '@/components/IceTakeDictionary';
import { HexViewer } from '@/components/hexviewer/HexViewer';

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

export const BundleManager = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<UIResource | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<ParsedBundle | null>(null);
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [resources, setResources] = useState<UIResource[]>([]);
  const [debugResources, setDebugResources] = useState<DebugResource[]>([]);
  const [vehicleList, setVehicleList] = useState<VehicleListEntry[]>([]);
  const [parsedVehicleList, setParsedVehicleList] = useState<ParsedVehicleList | null>(null);
  const [playerCarColours, setPlayerCarColours] = useState<PlayerCarColours | null>(null);
  const [iceDictionary, setIceDictionary] = useState<ParsedIceTakeDictionary | null>(null);
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
    const matchesCategory = selectedCategory === "all" || resource.category === selectedCategory;
    return matchesSearch && matchesPlatform && matchesCategory;
  });

  const convertResourceToUI = (resource: ResourceEntry, bundle: ParsedBundle, debugResources: DebugResource[]): UIResource => {
    const resourceType = getResourceType(resource.resourceTypeId);
    const debugResource = findDebugResourceById(debugResources, formatResourceId(u64ToBigInt(resource.resourceId)));
    
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
      id: formatResourceId(u64ToBigInt(resource.resourceId)),
      name: debugResource?.name || `Resource_${resource.resourceId.low.toString(16)}`,
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
        debugData = parseDebugDataFromXml(bundle.debugData);
      }

      // Convert resources to UI format
      const uiResources = bundle.resources.map(resource =>
        convertResourceToUI(resource, bundle, debugData)
      );
 
      // Parse all known resource types
      const parsedResources = parseBundleResources(arrayBuffer, bundle);
      setParsedVehicleList(parsedResources.vehicleList || null);
      setVehicleList(parsedResources.vehicleList?.vehicles || []);
      setPlayerCarColours(parsedResources.playerCarColours || null);
      setIceDictionary(parsedResources.iceTakeDictionary || null);

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

  const totalUncompressed = filteredResources.reduce((sum, r) => sum + r.uncompressedSize, 0);
  const totalCompressed = filteredResources.reduce((sum, r) => sum + r.compressedSize, 0);
  const compressionRatio = totalUncompressed > 0 ? (totalCompressed / totalUncompressed * 100).toFixed(1) : "0";

  const currentPlatform = loadedBundle ? getPlatformName(loadedBundle.header.platform) : "None";

  // Resource utilities
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getCategoryIcon = (category: ResourceCategory) => {
    switch (category) {
      case 'Graphics': return Image;
      case 'Audio': return Volume2;
      case 'Data': return Database;
      case 'Script': return Code;
      default: return File;
    }
  };

  const getUniqueCategories = () => {
    const categories = new Set(resources.map(r => r.category));
    return Array.from(categories).sort();
  };

  const getUniquePlatforms = () => {
    const platforms = new Set(resources.map(r => r.platform));
    return Array.from(platforms).sort();
  };

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
      setIsModified(true);
      toast.success(`Vehicle "${vehicleToDelete.vehicleName}" deleted successfully.`);
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
    if (!loadedBundle || !originalArrayBuffer) {
      toast.error("No bundle loaded to export");
      return;
    }

    setIsLoading(true);
    console.log(vehicleList);
    console.log(parsedVehicleList);
    try {
      const outBuffer = writeBundle(
        loadedBundle,
        originalArrayBuffer,
        {
          includeDebugData: true,
          overrides: parsedVehicleList ? {
            vehicleList: {
              vehicles: vehicleList,
              header: parsedVehicleList.header
            }
          } : undefined
        },
        (e) => {
          if (e.type === 'write') {
            // Optional: could show a progress bar in future
            console.debug(`[export] ${e.stage}: ${Math.round(e.progress * 100)}% - ${e.message ?? ''}`);
          }
        }
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

      toast.success("Exported bundle", { description: `Size: ${(outBuffer.byteLength / 1024).toFixed(1)} KB` });
    } catch (error) {
      console.error('Error exporting bundle:', error);
      toast.error("Failed to export bundle", {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  console.log(iceDictionary);

  // ResourceCard component
  const ResourceCard = ({ resource }: { resource: UIResource }) => {
    const IconComponent = getCategoryIcon(resource.category as ResourceCategory);
    const categoryColor = getResourceTypeColor(resource.category as ResourceCategory);
    
    return (
      <Card className="h-fit border rounded-lg hover:shadow-lg transition-all duration-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-lg bg-muted/50">
                <IconComponent className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate" title={resource.name}>
                  {resource.name}
                </h3>
                <p className="text-xs text-muted-foreground truncate" title={resource.typeName}>
                  {resource.typeName}
                </p>
              </div>
            </div>
            <Badge variant="outline" className={`text-xs shrink-0 ${categoryColor}`}>
              {resource.category}
            </Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Resource ID:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                {resource.id}
              </code>
            </div>
            
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Type:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                {resource.type}
              </code>
            </div>
            
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Size:</span>
              <div className="text-right">
                <div>{formatFileSize(resource.uncompressedSize)}</div>
                {resource.compressedSize !== resource.uncompressedSize && (
                  <div className="text-muted-foreground">
                    {formatFileSize(resource.compressedSize)} compressed
                  </div>
                )}
              </div>
            </div>
            
            {resource.memoryType && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Memory:</span>
                <span className="bg-muted px-1.5 py-0.5 rounded text-xs">
                  {resource.memoryType}
                </span>
              </div>
            )}
            
            {resource.flags.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Flags:</span>
                <div className="flex flex-wrap gap-1">
                  {resource.flags.map((flag, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
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