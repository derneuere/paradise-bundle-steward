import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Database, Cpu, HardDrive, Zap, AlertCircle, Download, Search, Filter, File, Image, Volume2, Code } from "lucide-react";
import { toast } from "sonner";
import { parseBundle, getPlatformName, getFlagNames, formatResourceId, type ParsedBundle, type ResourceEntry } from "@/lib/parsers/bundleParser";
import { extractAlignment, packSizeAndAlignment, extractResourceSize, getMemoryTypeName, getResourceData } from "@/lib/core/resourceManager";
import type { ResourceContext } from "@/lib/core/types";
import { PLATFORMS } from "@/lib/core/types";
import { RESOURCE_TYPES, getResourceType, getResourceTypeColor, type ResourceCategory } from "@/lib/resourceTypes";
import { parseDebugData, findDebugResourceById, type DebugResource } from "@/lib/debugDataParser";
import { parseVehicleList, type VehicleListEntry, type ParsedVehicleList } from "@/lib/parsers/vehicleListParser";
import { parsePlayerCarColours, type PlayerCarColours } from "@/lib/parsers/playerCarColoursParser";
import { VehicleList } from "@/components/VehicleList";
import { PlayerCarColoursComponent } from "@/components/PlayerCarColours";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleEditor } from './VehicleEditor';
import { writeVehicleList } from '@/lib/parsers/vehicleListWriter';
import { writePlayerCarColours } from '@/lib/parsers/playerCarColoursWriter';
import { BundleBuilder, createResourceEntry } from '@/lib/core/bundleWriter';

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
          const parsedVehicleData = parseVehicleList(arrayBuffer, vehicleResource, { littleEndian });
          setParsedVehicleList(parsedVehicleData);
          setVehicleList(parsedVehicleData.vehicles);
        } else {
          setParsedVehicleList(null);
          setVehicleList([]);
        }
      } else {
        setParsedVehicleList(null);
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
          vehicles: updatedVehicles
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
          vehicles: updatedVehicles
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
      toast.error('No bundle loaded to export.');
      return;
    }

    try {
      setIsLoading(true);
      
      // Use the same platform detection logic as loading
      const platform = loadedBundle.header.platform;
      const littleEndian = platform !== PLATFORMS.PS3;
      const compress = (loadedBundle.header.flags & 0x1) !== 0;
      
      console.log(`🔧 Exporting bundle: platform=${platform}, littleEndian=${littleEndian}, compressed=${compress}`);
      
      // Create a new bundle builder with original bundle settings
      const builder = new BundleBuilder({
        platform: platform,
        compress: compress,
        includeDebugData: !!loadedBundle.debugData
      });
      
      // Set resource string table if it exists
      if (loadedBundle.debugData) {
        builder.setResourceStringTable(loadedBundle.debugData);
      }

      // Convert each resource to a BundleEntry and add to builder
      for (let i = 0; i < loadedBundle.resources.length; i++) {
        const resource = loadedBundle.resources[i];
        const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
        const colourType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Player Car Colours');
        
        // Get the actual resource data
        let resourceData: Uint8Array;
        
        if (vehicleType && resource.resourceTypeId === vehicleType.id) {
          // Replace vehicle list with modified data
          console.log(`📝 Replacing vehicle list (${vehicleList.length} vehicles)`);

          // Get the decompressed resource data from the parsed bundle
          const resourceContext: ResourceContext = {
            bundle: loadedBundle,
            resource,
            buffer: originalArrayBuffer
          };
          const { data: decompressedData } = getResourceData(resourceContext);

          // Write the vehicle list data and compress it with the same settings as the original bundle
          if (parsedVehicleList) {
            resourceData = writeVehicleList(parsedVehicleList, littleEndian, compress);
          } else {
            // Fallback if we don't have parsed data (shouldn't happen in normal operation)
            resourceData = writeVehicleList({ vehicles: vehicleList, header: { unknown1: 0, unknown2: 0 } }, littleEndian, compress);
          }
          
        } else if (colourType && resource.resourceTypeId === colourType.id && playerCarColours) {
          // Replace player car colours with modified data
          console.log(`🎨 Replacing player car colours (${playerCarColours.palettes.length} palettes)`);

          // Get the decompressed resource data from the parsed bundle
          const resourceContext: ResourceContext = {
            bundle: loadedBundle,
            resource,
            buffer: originalArrayBuffer
          };
          const { data: decompressedData } = getResourceData(resourceContext);

          // Write the player car colours data and compress it with the same settings as the original bundle
          resourceData = writePlayerCarColours(playerCarColours, littleEndian, compress);
          
        } else {
          // Keep existing resource unchanged
          const absoluteResourceOffset = loadedBundle.header.resourceDataOffsets[0] + resource.diskOffsets[0];
          const resourceSize = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);

          resourceData = new Uint8Array(
            originalArrayBuffer.slice(absoluteResourceOffset, absoluteResourceOffset + resourceSize)
          );

          console.log(`📦 Preserving existing resource 0x${resource.resourceTypeId.toString(16)}: extracted ${resourceData.length} bytes, original size was ${resourceSize}`);
          console.log(`📦 Resource offset: ${absoluteResourceOffset}, diskOffset: ${resource.diskOffsets[0]}`);
        }

        console.log(`🔍 Resource ${i} - uncompressed size from entry: ${resourceData.length}, sizeAndAlignmentOnDisk[0]: ${resource.sizeAndAlignmentOnDisk[0]}`);
        
        // Create BundleEntry matching the new API
        const isCompressed = resource.sizeAndAlignmentOnDisk.some(size => extractResourceSize(size) > 0 && extractResourceSize(size) !== resourceData.length);

        const originalCompressedSizes = resource.sizeAndAlignmentOnDisk.slice(0, 3);
        const originalUncompressedSizes = resource.uncompressedSizeAndAlignment.slice(0, 3);
        const diskOffsets = resource.diskOffsets.slice(0, 3);

        const reserveCompressedSizes = resource.sizeAndAlignmentOnDisk.slice(0, 3);
        const reserveUncompressedSizes = resource.uncompressedSizeAndAlignment.slice(0, 3);
        const reserveDiskOffsets = resource.diskOffsets.slice(0, 3);

        if (vehicleType && resource.resourceTypeId === vehicleType.id) {
          const alignment = extractAlignment(resource.uncompressedSizeAndAlignment[0]);
          reserveUncompressedSizes[0] = packSizeAndAlignment(resourceData.length, alignment);
          reserveCompressedSizes[0] = resourceData.length;
        }

        const bundleEntry: ResourceEntry = {
          resourceId: resource.resourceId,
          importHash: resource.importHash,
          resourceTypeId: resource.resourceTypeId,
          uncompressedSizeAndAlignment: originalUncompressedSizes,
          sizeAndAlignmentOnDisk: originalCompressedSizes,
          diskOffsets,
          importOffset: resource.importOffset,
          importCount: resource.importCount,
          flags: resource.flags,
          streamIndex: resource.streamIndex
        };
        
        // Add the entry to the bundle
        builder.addResourceEntry(
          createResourceEntry(
            bundleEntry.resourceId,
            bundleEntry.resourceTypeId,
            bundleEntry.uncompressedSizeAndAlignment,
            bundleEntry.sizeAndAlignmentOnDisk,
            bundleEntry.diskOffsets,
            bundleEntry.importHash,
            bundleEntry.importOffset,
            bundleEntry.importCount
          )
        );

        // Store the resource data
        builder.setResourceData(i, resourceData);
      }

      const newBundleData = await builder.write();
      
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
                {/* Resource search and filters */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight">
                      Bundle Resources
                    </h2>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                        {filteredResources.length} of {resources.length} resources
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Platform: {currentPlatform}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search resources by name, type, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="w-[180px]">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {getUniqueCategories().map(category => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                      <SelectTrigger className="w-[160px]">
                        <Cpu className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="All Platforms" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Platforms</SelectItem>
                        {getUniquePlatforms().map(platform => (
                          <SelectItem key={platform} value={platform}>
                            {platform}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Resource summary statistics */}
                {filteredResources.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Total Resources</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{filteredResources.length}</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Uncompressed Size</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{formatFileSize(totalUncompressed)}</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Compressed Size</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{formatFileSize(totalCompressed)}</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium">Compression Ratio</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{compressionRatio}%</div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Resource grid */}
                {filteredResources.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-4">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                      <Database className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-medium">No Resources Found</h3>
                      <p className="text-sm">
                        {resources.length === 0 
                          ? "This bundle doesn't contain any resources."
                          : "Try adjusting your search or filter criteria."
                        }
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {filteredResources.map((resource, index) => (
                      <ResourceCard key={`${resource.id}-${index}`} resource={resource} />
                    ))}
                  </div>
                )}
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