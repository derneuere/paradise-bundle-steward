import { useMemo, useState } from 'react';
import { useBundle } from '@/context/BundleContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, Cpu, Filter, Search, File, Image, Volume2, Code, Palette, Car } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'Graphics': return Image;
    case 'Audio': return Volume2;
    case 'Data': return Database;
    case 'Script': return Code;
    default: return File;
  }
};

const ResourcesPage = () => {
  const { resources, loadedBundle, iceDictionary } = useBundle();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredResources = useMemo(() => {
    return resources.filter(resource => {
      const matchesSearch = resource.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resource.typeName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = selectedPlatform === 'all' || resource.platform === selectedPlatform;
      const matchesCategory = selectedCategory === 'all' || resource.category === selectedCategory;
      return matchesSearch && matchesPlatform && matchesCategory;
    });
  }, [resources, searchQuery, selectedPlatform, selectedCategory]);

  const getUniqueCategories = () => {
    return Array.from(new Set(resources.map(r => r.category))).sort();
  };



  const getUniquePlatforms = () => {
    return Array.from(new Set(resources.map(r => r.platform))).sort();
  };

  const totalUncompressed = filteredResources.reduce((sum, r) => sum + r.uncompressedSize, 0);
  const totalCompressed = filteredResources.reduce((sum, r) => sum + r.compressedSize, 0);
  const compressionRatio = totalUncompressed > 0 ? (totalCompressed / totalUncompressed * 100).toFixed(1) : '0';
  const currentPlatform = loadedBundle ? ['PC', 'Xbox 360', 'PlayStation 3'][loadedBundle.header.platform - 1] || 'None' : 'None';

  const ResourceCard = ({ resource }: { resource: any }) => {
    const IconComponent = getCategoryIcon(resource.category);
    return (
      <Card className="h-fit border rounded-lg hover:shadow-lg transition-all duration-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="p-2 rounded-lg bg-muted/50">
                <IconComponent className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate" title={resource.name}>{resource.name}</h3>
                <p className="text-xs text-muted-foreground truncate" title={resource.typeName}>{resource.typeName}</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs shrink-0">{resource.category}</Badge>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Resource ID:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{resource.id}</code>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Type:</span>
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{resource.type}</code>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Size:</span>
              <div className="text-right">
                <div>{formatFileSize(resource.uncompressedSize)}</div>
                {resource.compressedSize !== resource.uncompressedSize && (
                  <div className="text-muted-foreground">{formatFileSize(resource.compressedSize)} compressed</div>
                )}
              </div>
            </div>
          </div>
          {resource.type === 'Vehicle List' && (
            <NavLink to="/vehicles" className={({ isActive }) => `px-3 py-1.5 rounded ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}>
            <Car className="inline w-4 h-4 mr-1" /> Edit Vehicles
          </NavLink>)}
          {resource.type === 'Player Car Colours' && (
            <NavLink to="/colors" className={({ isActive }) => `px-3 py-1.5 rounded ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}>
            <Palette className="inline w-4 h-4 mr-1" /> Edit Player Colours
          </NavLink>)}
          {resource.type === 'ICE Dictionary' && (
            <NavLink to="/ice" className={({ isActive }) => `px-3 py-1.5 rounded ${isActive ? 'bg-muted' : 'hover:bg-muted/60'}`}>
              Edit ICE Takes
            </NavLink>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Bundle Resources</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
            {filteredResources.length} of {resources.length} resources
          </div>
          <div className="text-sm text-muted-foreground">Platform: {currentPlatform}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search resources by name, type, or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-[180px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {getUniqueCategories().map(category => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
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
              <SelectItem key={platform} value={platform}>{platform}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredResources.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total Resources</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{filteredResources.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Uncompressed Size</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatFileSize(totalUncompressed)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Compressed Size</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatFileSize(totalCompressed)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Compression Ratio</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{compressionRatio}%</div></CardContent>
          </Card>
        </div>
      )}

      {filteredResources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center"><Database className="w-8 h-8" /></div>
          <div className="text-center">
            <h3 className="text-lg font-medium">No Resources Found</h3>
            <p className="text-sm">{resources.length === 0 ? "This bundle doesn't contain any resources." : 'Try adjusting your search or filter criteria.'}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredResources.map((resource, index) => (
            <ResourceCard key={`${resource.id}-${index}`} resource={resource} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ResourcesPage;


