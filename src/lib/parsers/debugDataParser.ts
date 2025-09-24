// Parser for Bundle debug data (ResourceStringTable XML)

export type DebugResource = {
  id: string;
  name: string;
  typeName: string;
}

export function parseDebugData(xmlData: string): DebugResource[] {
  const resources: DebugResource[] = [];
  
  try {
    // Simple XML parsing for ResourceStringTable
    // Look for <Resource> elements with Id, Name, and TypeName attributes
    const resourceRegex = /<Resource\s+([^>]+)>/g;
    let match;
    
    while ((match = resourceRegex.exec(xmlData)) !== null) {
      const attributes = match[1];
      
      // Extract attributes
      const idMatch = attributes.match(/Id\s*=\s*["']([^"']+)["']/);
      const nameMatch = attributes.match(/Name\s*=\s*["']([^"']+)["']/);
      const typeNameMatch = attributes.match(/TypeName\s*=\s*["']([^"']+)["']/);
      
      if (idMatch && nameMatch && typeNameMatch) {
        resources.push({
          id: idMatch[1],
          name: nameMatch[1],
          typeName: typeNameMatch[1]
        });
      }
    }
  } catch (error) {
    console.error('Error parsing debug data:', error);
  }
  
  return resources;
}

export function findDebugResourceByName(debugResources: DebugResource[], name: string): DebugResource | undefined {
  return debugResources.find(r => r.name === name);
}

export function findDebugResourceById(debugResources: DebugResource[], id: string): DebugResource | undefined {
  return debugResources.find(r => r.id === id);
}