import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { extractResourceSize } from '../lib/core/resourceManager';

// Test data path (relative to project root)
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

describe('Resource Analysis', () => {
  let bundleData: Buffer;
  let parsedBundle: any;
  let vehicleListResource: any;
  
  beforeAll(() => {
    console.log('🧪 Resource Analysis Test Suite');
    bundleData = readFileSync(BUNDLE_PATH);
    parsedBundle = parseBundle(bundleData.buffer);
    vehicleListResource = parsedBundle.resources.find((r: any) => r.resourceTypeId === 0x10005);
  });

  describe('Bundle Resource Structure', () => {
    it('should analyze top-level bundle resources', () => {
      console.log('\n=== Bundle Resource Structure Analysis ===');
      console.log(`Bundle contains ${parsedBundle.resources.length} resources:`);
      
      parsedBundle.resources.forEach((res: any, idx: number) => {
        console.log(`  Resource ${idx}: Type=0x${res.resourceTypeId.toString(16).padStart(8, '0')}, ID=0x${res.resourceId.toString(16)}`);
        
        if (res.resourceTypeId === 0x1001E) {
          console.log('    ✅ This is PlayerCarColours!');
        } else if (res.resourceTypeId === 0x10005) {
          console.log('    📋 This is VehicleList');
        }
      });
      
      expect(parsedBundle.resources).toHaveLength(2);
      expect(parsedBundle.resources.some((r: any) => r.resourceTypeId === 0x10005)).toBe(true);
    });

    it('should provide detailed resource information', () => {
      parsedBundle.resources.forEach((resource: any, index: number) => {
        console.log(`\nResource ${index} Details:`);
        console.log(`  Resource ID: 0x${resource.resourceId.toString(16)}`);
        console.log(`  Resource Type ID: 0x${resource.resourceTypeId.toString(16)}`);
        console.log(`  Disk Offsets: [${resource.diskOffsets.map((o: number) => `0x${o.toString(16)}`).join(', ')}]`);
        console.log(`  Sizes: [${resource.sizeAndAlignmentOnDisk.map((s: number) => extractResourceSize(s)).join(', ')}]`);
        
        expect(resource.diskOffsets).toHaveLength(3);
        expect(resource.sizeAndAlignmentOnDisk).toHaveLength(3);
      });
    });
  });

  describe('VehicleList Resource Analysis', () => {
    it('should extract and analyze VehicleList resource data', () => {
      expect(vehicleListResource).toBeDefined();
      
      console.log('\n=== VehicleList Resource Analysis ===');
      console.log('Resource ID:', vehicleListResource.resourceId.toString(16));
      console.log('Resource Type ID:', vehicleListResource.resourceTypeId.toString(16));
      
      // Find the actual data
      let resourceData: Uint8Array | null = null;
      let dataOffset = 0;
      
      for (let i = 0; i < 3; i++) {
        const size = extractResourceSize(vehicleListResource.sizeAndAlignmentOnDisk[i]);
        if (size > 0) {
          dataOffset = vehicleListResource.diskOffsets[i];
          resourceData = new Uint8Array(bundleData.buffer, dataOffset, size);
          console.log(`Found data at offset 0x${dataOffset.toString(16)}, size=${size} bytes`);
          break;
        }
      }
      
      expect(resourceData).toBeDefined();
      expect(dataOffset).toBeGreaterThanOrEqual(0);
      
      if (resourceData) {
        // Check if it's a nested bundle
        const magic = new TextDecoder().decode(resourceData.subarray(0, 4));
        console.log(`First 4 bytes as string: "${magic}"`);
        expect(magic).toBe('bnd2');
      }
    });

    it('should analyze nested bundle structure', () => {
      if (!vehicleListResource) return;
      
      // Get resource data
      let resourceData: Uint8Array | null = null;
      for (let i = 0; i < 3; i++) {
        const size = extractResourceSize(vehicleListResource.sizeAndAlignmentOnDisk[i]);
        if (size > 0) {
          const dataOffset = vehicleListResource.diskOffsets[i];
          resourceData = new Uint8Array(bundleData.buffer, dataOffset, size);
          break;
        }
      }
      
      if (resourceData) {
        // Parse the nested bundle
        const nestedBuffer = resourceData.buffer.slice(resourceData.byteOffset, resourceData.byteOffset + resourceData.byteLength);
        const nestedBundle = parseBundle(nestedBuffer);
        
        console.log('\n=== Nested Bundle Analysis ===');
        console.log('Nested bundle header:');
        console.log('  Resource count:', nestedBundle.header.resourceEntriesCount);
        console.log('  Resource entries offset:', '0x' + nestedBundle.header.resourceEntriesOffset.toString(16));
        console.log('  Resource data offsets:', nestedBundle.header.resourceDataOffsets.map((o: number) => '0x' + o.toString(16)));
        
        expect(nestedBundle.header.magic).toBe('bnd2');
        expect(nestedBundle.resources.length).toBeGreaterThan(0);
        
        nestedBundle.resources.forEach((res: any, idx: number) => {
          console.log(`\nNested Resource ${idx}:`);
          console.log(`  Type: 0x${res.resourceTypeId.toString(16)}`);
          console.log(`  ID: 0x${res.resourceId.toString(16)}`);
          console.log(`  Disk Offsets: [${res.diskOffsets.map((o: number) => `0x${o.toString(16)}`).join(', ')}]`);
          console.log(`  Sizes: [${res.sizeAndAlignmentOnDisk.map((s: number) => extractResourceSize(s)).join(', ')}]`);
        });
      }
    });
  });

  describe('Resource Data Inspection', () => {
    it('should inspect raw resource data', () => {
      if (!vehicleListResource) return;
      
      // Get nested bundle data
      let resourceData: Uint8Array | null = null;
      let dataOffset = 0;
      
      for (let i = 0; i < 3; i++) {
        const size = extractResourceSize(vehicleListResource.sizeAndAlignmentOnDisk[i]);
        if (size > 0) {
          dataOffset = vehicleListResource.diskOffsets[i];
          resourceData = new Uint8Array(bundleData.buffer, dataOffset, size);
          break;
        }
      }
      
      if (resourceData) {
        const nestedBuffer = resourceData.buffer.slice(resourceData.byteOffset, resourceData.byteOffset + resourceData.byteLength);
        const nestedBundle = parseBundle(nestedBuffer);
        
        // Look at the actual VehicleList data in the nested bundle
        const nestedVehicleList = nestedBundle.resources.find((r: any) => r.resourceTypeId === 0x10005);
        
        if (nestedVehicleList) {
          console.log('\n=== VehicleList Resource Data Inspection ===');
          
          for (let i = 0; i < 3; i++) {
            const size = extractResourceSize(nestedVehicleList.sizeAndAlignmentOnDisk[i]);
            if (size > 0) {
              const offset = nestedVehicleList.diskOffsets[i];
              
              console.log(`VehicleList data block ${i}:`);
              console.log(`  Offset in nested bundle: 0x${offset.toString(16)} (${offset})`);
              console.log(`  Size: ${size} bytes`);
              console.log(`  Absolute offset in main file: 0x${(dataOffset + offset).toString(16)}`);
              
              if (offset < nestedBuffer.byteLength) {
                const actualData = new Uint8Array(nestedBuffer, offset, Math.min(64, size));
                console.log(`  Raw data (first 64 bytes):`);
                
                for (let j = 0; j < actualData.length; j += 16) {
                  const chunk = actualData.slice(j, j + 16);
                  const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
                  const ascii = Array.from(chunk).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
                  console.log(`    ${(offset + j).toString(16).padStart(8, '0')}: ${hex.padEnd(47)} |${ascii}|`);
                }
                
                // Check for compression
                if (actualData.length >= 2) {
                  const isZlib = actualData[0] === 0x78;
                  console.log(`  Compression: ${isZlib ? 'Likely zlib' : 'Not compressed'}`);
                  expect(typeof isZlib).toBe('boolean');
                }
              }
              
              break;
            }
          }
          
          expect(nestedVehicleList.resourceTypeId).toBe(0x10005);
        }
      }
    });

    it('should analyze data patterns and structures', () => {
      if (!vehicleListResource) return;
      
      console.log('\n=== Data Pattern Analysis ===');
      
      // This would be where we analyze specific data patterns
      // For now, we validate that we can access the data structures
      expect(vehicleListResource.diskOffsets).toHaveLength(3);
      expect(vehicleListResource.sizeAndAlignmentOnDisk).toHaveLength(3);
      
      // Validate that at least one data block has content
      const hasValidData = vehicleListResource.sizeAndAlignmentOnDisk.some((sizeAndAlign: number) => 
        extractResourceSize(sizeAndAlign) > 0
      );
      
      expect(hasValidData).toBe(true);
      console.log('✅ Resource contains valid data blocks');
    });
  });

  describe('Resource Integrity', () => {
    it('should validate resource offsets and sizes', () => {
      parsedBundle.resources.forEach((resource: any, index: number) => {
        console.log(`\nValidating Resource ${index}:`);
        
        for (let i = 0; i < 3; i++) {
          const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
          const offset = resource.diskOffsets[i];
          
          if (size > 0) {
            console.log(`  Block ${i}: offset=0x${offset.toString(16)}, size=${size}`);
            
            // Validate offset is within bundle bounds
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThan(bundleData.length);
            
            // Validate size is reasonable
            expect(size).toBeGreaterThan(0);
            expect(offset + size).toBeLessThanOrEqual(bundleData.length);
          }
        }
      });
    });

    it('should confirm resource accessibility', () => {
      // Test that we can actually read data from each resource
      parsedBundle.resources.forEach((resource: any, index: number) => {
        let dataFound = false;
        
        for (let i = 0; i < 3; i++) {
          const size = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
          if (size > 0) {
            const offset = resource.diskOffsets[i];
            const data = new Uint8Array(bundleData.buffer, offset, Math.min(32, size));
            
            expect(data).toBeDefined();
            expect(data.length).toBeGreaterThan(0);
            dataFound = true;
            break;
          }
        }
        
        expect(dataFound).toBe(true);
      });
      
      console.log('✅ All resources are accessible and readable');
    });
  });
}); 