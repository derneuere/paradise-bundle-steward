import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Upload, Filter, Database, Cpu, HardDrive, Zap, FileText, AlertCircle, Car } from "lucide-react";
import { toast } from "sonner";
import { parseBundle, getPlatformName, getMemoryTypeName, getFlagNames, extractResourceSize, formatResourceId, type ParsedBundle, type ResourceEntry } from "@/lib/bundleParser";
import { getResourceType, getResourceTypeColor } from "@/lib/resourceTypes";
import { parseDebugData, findDebugResourceById, type DebugResource } from "@/lib/debugDataParser";
import { parseVehicleList, type VehicleListEntry } from "@/lib/vehicleListParser";

// Converted resource interface for UI display
interface UIResource {
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
  return getResourceTypeColor(category);
};

export const BundleManager = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<UIResource | null>(null);
  const [loadedBundle, setLoadedBundle] = useState<ParsedBundle | null>(null);
  const [resources, setResources] = useState<UIResource[]>([]);
  const [debugResources, setDebugResources] = useState<DebugResource[]>([]);
  const [vehicleList, setVehicleList] = useState<VehicleListEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
      const vehicleResource = bundle.resources.find(r => r.resourceTypeId === 0x00010005);
      if (vehicleResource) {
        const vehicles = parseVehicleList(arrayBuffer, vehicleResource);
        setVehicleList(vehicles);
      } else {
        setVehicleList(null);
      }

      setLoadedBundle(bundle);
      setResources(uiResources);
      setDebugResources(debugData);
      setSelectedResource(null);
      
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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-primary rounded-lg">
                <Database className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Burnout Paradise Bundle Manager
                </h1>
                <p className="text-sm text-muted-foreground">Resource analysis and management tool</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleFileUpload} 
                variant="outline" 
                className="gap-2"
                disabled={isLoading}
              >
                <Upload className="w-4 h-4" />
                {isLoading ? 'Loading...' : 'Load Bundle'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".bundle,.bnd"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Bundle Info */}
            {loadedBundle && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Bundle Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Platform</div>
                      <div className="font-medium">{currentPlatform}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Version</div>
                      <div className="font-medium">{loadedBundle.header.version}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Flags</div>
                      <div className="flex flex-wrap gap-1">
                        {getFlagNames(loadedBundle.header.flags).map(flag => (
                          <Badge key={flag} variant="secondary" className="text-xs">{flag}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Debug Data</div>
                      <div className="font-medium">{debugResources.length > 0 ? 'Available' : 'None'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {vehicleList && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="w-5 h-5" />
                    Vehicle List
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {vehicleList.map(v => (
                      <li key={v.id} className="text-sm">
                        {v.vehicleName || v.id}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {!loadedBundle && (
              <Card>
                <CardContent className="text-center py-12">
                  <Database className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Bundle Loaded</h3>
                  <p className="text-muted-foreground mb-4">
                    Load a Burnout Paradise .bundle file to start exploring resources
                  </p>
                  <Button onClick={handleFileUpload} variant="default" className="gap-2">
                    <Upload className="w-4 h-4" />
                    Load Bundle File
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Search and Filters */}
            {loadedBundle && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    Resource Explorer
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name, type, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <select
                      value={selectedPlatform}
                      onChange={(e) => setSelectedPlatform(e.target.value)}
                      className="px-3 py-2 bg-input border border-border rounded-lg"
                    >
                      <option value="all">All Platforms</option>
                      <option value="PC">PC</option>
                      <option value="Xbox360">Xbox 360</option>
                      <option value="PS3">PlayStation 3</option>
                    </select>
                  </div>

                  {/* Statistics */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-primary">{filteredResources.length}</div>
                      <div className="text-sm text-muted-foreground">Resources</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-accent">{formatBytes(totalUncompressed)}</div>
                      <div className="text-sm text-muted-foreground">Uncompressed</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-warning">{compressionRatio}%</div>
                      <div className="text-sm text-muted-foreground">Compression</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Resource List */}
            {loadedBundle && filteredResources.length > 0 && (
              <Card>
                <CardContent className="p-0">
                  <div className="max-h-96 overflow-auto">
                    {filteredResources.map((resource) => (
                      <div
                        key={resource.id}
                        className="p-4 border-b border-border hover:bg-accent/10 cursor-pointer transition-colors"
                        onClick={() => setSelectedResource(resource)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <code className="text-sm bg-muted px-2 py-1 rounded">{resource.id}</code>
                              <Badge className={getTypeColor(resource.category)}>
                                {resource.type}
                              </Badge>
                              <Badge variant="outline">{resource.platform}</Badge>
                            </div>
                            <h3 className="font-medium text-foreground mb-1" title={resource.typeName}>{resource.name}</h3>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                {getMemoryIcon(resource.memoryType)}
                                {resource.memoryType}
                              </span>
                              <span>{formatBytes(resource.uncompressedSize)}</span>
                              <span className="text-success">{formatBytes(resource.compressedSize)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {selectedResource ? (
              <Card>
                <CardHeader>
                  <CardTitle>Resource Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">{selectedResource.name}</h4>
                    <code className="text-sm bg-muted px-2 py-1 rounded block mb-2">{selectedResource.id}</code>
                    <div className="text-sm text-muted-foreground">{selectedResource.typeName}</div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <Badge className={getTypeColor(selectedResource.category)}>{selectedResource.type}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Platform:</span>
                      <span>{selectedResource.platform}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Memory:</span>
                      <span className="flex items-center gap-1">
                        {getMemoryIcon(selectedResource.memoryType)}
                        {selectedResource.memoryType}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Uncompressed:</span>
                      <span>{formatBytes(selectedResource.uncompressedSize)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Compressed:</span>
                      <span className="text-success">{formatBytes(selectedResource.compressedSize)}</span>
                    </div>
                  </div>

                  {selectedResource.flags.length > 0 && (
                    <div>
                      <h5 className="font-medium mb-2">Flags</h5>
                      <div className="flex flex-wrap gap-1">
                        {selectedResource.flags.map((flag) => (
                          <Badge key={flag} variant="secondary" className="text-xs">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedResource.imports.length > 0 && (
                    <div>
                      <h5 className="font-medium mb-2">Dependencies</h5>
                      <div className="space-y-1">
                        {selectedResource.imports.map((imp) => (
                          <div key={imp} className="text-sm bg-muted/50 px-2 py-1 rounded">
                            {imp}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Raw data section for debugging */}
                  <div>
                    <h5 className="font-medium mb-2">Raw Data</h5>
                    <div className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-32">
                      <div>Resource Type ID: 0x{selectedResource.raw.resourceTypeId.toString(16).toUpperCase()}</div>
                      <div>Import Hash: 0x{selectedResource.raw.importHash.toString(16).toUpperCase()}</div>
                      <div>Import Count: {selectedResource.raw.importCount}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {loadedBundle ? 'Select a resource to view details' : 'Load a bundle file to get started'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};