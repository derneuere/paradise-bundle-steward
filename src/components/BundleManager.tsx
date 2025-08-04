import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Upload, Filter, Database, Cpu, HardDrive, Zap } from "lucide-react";
import { toast } from "sonner";

// Mock data structure based on Burnout Paradise Bundle format
interface BundleResource {
  id: string;
  name: string;
  type: string;
  platform: "PC" | "Xbox360" | "PS3";
  uncompressedSize: number;
  compressedSize: number;
  memoryType: "Main" | "Graphics" | "Physical" | "Disposable";
  imports: string[];
  flags: string[];
}

const mockResources: BundleResource[] = [
  {
    id: "0x12345678",
    name: "VehicleData_Burnout_Paradise",
    type: "Registry",
    platform: "PC",
    uncompressedSize: 524288,
    compressedSize: 262144,
    memoryType: "Main",
    imports: ["TextureAtlas_Vehicles", "MaterialSettings"],
    flags: ["Compressed", "HasDebugData"]
  },
  {
    id: "0x87654321",
    name: "TextureAtlas_Environment",
    type: "Texture",
    platform: "PC",
    uncompressedSize: 2097152,
    compressedSize: 1048576,
    memoryType: "Graphics",
    imports: [],
    flags: ["Compressed", "Graphics"]
  },
  {
    id: "0xABCDEF12",
    name: "Audio_Engine_Samples",
    type: "Audio",
    platform: "Xbox360",
    uncompressedSize: 1572864,
    compressedSize: 786432,
    memoryType: "Physical",
    imports: ["Audio_Master"],
    flags: ["Compressed"]
  }
];

const formatBytes = (bytes: number) => {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const getMemoryIcon = (type: string) => {
  switch (type) {
    case "Main": return <Cpu className="w-4 h-4" />;
    case "Graphics": return <Zap className="w-4 h-4" />;
    case "Physical": return <HardDrive className="w-4 h-4" />;
    default: return <Database className="w-4 h-4" />;
  }
};

const getTypeColor = (type: string) => {
  switch (type) {
    case "Registry": return "bg-info/20 text-info border-info/30";
    case "Texture": return "bg-accent/20 text-accent border-accent/30";
    case "Audio": return "bg-warning/20 text-warning border-warning/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
};

export const BundleManager = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedResource, setSelectedResource] = useState<BundleResource | null>(null);

  const filteredResources = mockResources.filter(resource => {
    const matchesSearch = resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         resource.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         resource.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlatform = selectedPlatform === "all" || resource.platform === selectedPlatform;
    return matchesSearch && matchesPlatform;
  });

  const handleFileUpload = () => {
    toast("Bundle file upload functionality would be implemented here");
  };

  const totalUncompressed = filteredResources.reduce((sum, r) => sum + r.uncompressedSize, 0);
  const totalCompressed = filteredResources.reduce((sum, r) => sum + r.compressedSize, 0);
  const compressionRatio = totalUncompressed > 0 ? (totalCompressed / totalUncompressed * 100).toFixed(1) : "0";

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
            <Button onClick={handleFileUpload} variant="outline" className="gap-2">
              <Upload className="w-4 h-4" />
              Load Bundle
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search and Filters */}
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

            {/* Resource List */}
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
                            <Badge className={getTypeColor(resource.type)}>
                              {resource.type}
                            </Badge>
                            <Badge variant="outline">{resource.platform}</Badge>
                          </div>
                          <h3 className="font-medium text-foreground mb-1">{resource.name}</h3>
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
                    <code className="text-sm bg-muted px-2 py-1 rounded block">{selectedResource.id}</code>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <Badge className={getTypeColor(selectedResource.type)}>{selectedResource.type}</Badge>
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
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <Database className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Select a resource to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};