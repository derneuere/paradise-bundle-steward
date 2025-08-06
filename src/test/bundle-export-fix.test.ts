// Bundle Export Fix Test - Test round-trip export of VEHICLELIST.BUNDLE

import { readFileSync } from 'fs';
import { parseBundle } from '../lib/parsers/bundleParser';
import { parseVehicleList } from '../lib/parsers/vehicleListParser';
import { writeVehicleList } from '../lib/parsers/vehicleListWriter';
import { BundleBuilder } from '../lib/core/bundleWriter';
import { extractResourceSize } from '../lib/core/resourceManager';
import { PLATFORMS } from '../lib/core/types';
import { RESOURCE_TYPES } from '../lib/resourceTypes';

describe('Bundle Export Fix', () => {
  let originalArrayBuffer: ArrayBuffer;
  let parsedBundle: any;
  let vehicleListResource: any;

  beforeAll(() => {
    console.log('🔧 Bundle Export Fix Test Suite');
    
    // Load the VEHICLELIST.BUNDLE file
    const bundleData = readFileSync('example/VEHICLELIST.BUNDLE');
    originalArrayBuffer = bundleData.buffer.slice(bundleData.byteOffset, bundleData.byteOffset + bundleData.byteLength);
    
    parsedBundle = parseBundle(originalArrayBuffer);
    vehicleListResource = parsedBundle.resources.find((r: any) => r.resourceTypeId === 0x10005);
  });

  it('should correctly calculate resource offset', () => {
    expect(vehicleListResource).toBeDefined();
    
    // Log the original offset calculation
    console.log('📊 Original resource offsets:');
    console.log(`  Header resourceDataOffsets[0]: 0x${parsedBundle.header.resourceDataOffsets[0].toString(16)}`);
    console.log(`  Resource diskOffsets[0]: 0x${vehicleListResource.diskOffsets[0].toString(16)}`);
    console.log(`  Absolute offset: 0x${(parsedBundle.header.resourceDataOffsets[0] + vehicleListResource.diskOffsets[0]).toString(16)}`);
    
    // Extract data with the corrected offset calculation
    const absoluteResourceOffset = parsedBundle.header.resourceDataOffsets[0] + vehicleListResource.diskOffsets[0];
    const resourceSize = extractResourceSize(vehicleListResource.sizeAndAlignmentOnDisk[0]);
    
    const originalResourceData = new Uint8Array(
      originalArrayBuffer.slice(absoluteResourceOffset, absoluteResourceOffset + resourceSize)
    );
    
    console.log(`  Resource size: ${resourceSize} bytes`);
    console.log(`  First 16 bytes: ${Array.from(originalResourceData.slice(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Check if this looks like valid data
    expect(originalResourceData.length).toBe(resourceSize);
    expect(originalResourceData.length).toBeGreaterThan(0);
  });

  it('should export and re-import successfully', async () => {
    // Parse original vehicle list
    const originalVehicles = parseVehicleList(vehicleListResource, parsedBundle, originalArrayBuffer);
    console.log(`📝 Original vehicle list: ${originalVehicles.length} vehicles`);
    
    // Export with the fixed offset calculation
    const platform = parsedBundle.header.platform;
    const littleEndian = platform !== PLATFORMS.PS3;
    const compress = (parsedBundle.header.flags & 0x1) !== 0;
    
    const builder = new BundleBuilder({
      platform: platform as any,
      compress: compress,
      includeDebugData: !!parsedBundle.debugData
    });
    
    // Preserve original flags
    builder.setFlags(parsedBundle.header.flags);

    // Add all resources with corrected offset calculation
    for (const resource of parsedBundle.resources) {
      const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
      
      if (vehicleType && resource.resourceTypeId === vehicleType.id) {
        // Replace vehicle list with re-serialized data
        const absoluteResourceOffset = parsedBundle.header.resourceDataOffsets[0] + resource.diskOffsets[0];
        const resourceSize = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
        const originalResourceData = new Uint8Array(
          originalArrayBuffer.slice(absoluteResourceOffset, absoluteResourceOffset + resourceSize)
        );
        
        const isDataLevelCompressed = originalResourceData.length >= 2 && originalResourceData[0] === 0x78;
        const vehicleListData = writeVehicleList(originalVehicles, littleEndian, isDataLevelCompressed);
        
        builder.addResource(
          resource.resourceTypeId,
          vehicleListData,
          resource.resourceId,
          false, // compression already handled by writer
          false
        );
      } else {
        // Keep existing resource unchanged with corrected offset
        const absoluteResourceOffset = parsedBundle.header.resourceDataOffsets[0] + resource.diskOffsets[0];
        const resourceSize = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
        
        const resourceData = new Uint8Array(
          originalArrayBuffer.slice(absoluteResourceOffset, absoluteResourceOffset + resourceSize)
        );
        
        builder.addExistingResource(resource, resourceData);
      }
    }

    // Add debug data if it exists
    if (parsedBundle.debugData) {
      builder.setDebugData(parsedBundle.debugData);
    }

    const newBundleData = await builder.build();
    
    // Parse the exported bundle
    const exportedBundle = parseBundle(newBundleData);
    
    console.log('📊 Exported bundle comparison:');
    console.log(`  Original resources: ${parsedBundle.resources.length}`);
    console.log(`  Exported resources: ${exportedBundle.resources.length}`);
    
    // Check that we have the same number of resources
    expect(exportedBundle.resources.length).toBe(parsedBundle.resources.length);
    
    // Check that the vehicle list resource exists and has the correct type
    const exportedVehicleListResource = exportedBundle.resources.find((r: any) => r.resourceTypeId === 0x10005);
    expect(exportedVehicleListResource).toBeDefined();
    expect(exportedVehicleListResource.resourceTypeId).toBe(0x10005);
    
    // Parse the exported vehicle list
    const exportedVehicles = parseVehicleList(exportedVehicleListResource, exportedBundle, newBundleData);
    console.log(`📝 Exported vehicle list: ${exportedVehicles.length} vehicles`);
    
    // Check that we have the same vehicles
    expect(exportedVehicles.length).toBe(originalVehicles.length);
    
    // Check the first vehicle to make sure the data is correct
    if (originalVehicles.length > 0 && exportedVehicles.length > 0) {
      expect(exportedVehicles[0].vehicleName).toBe(originalVehicles[0].vehicleName);
      expect(exportedVehicles[0].manufacturer).toBe(originalVehicles[0].manufacturer);
    }
    
    console.log('✅ Round-trip export successful!');
  });
});