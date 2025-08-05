import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { parseVehicleList } from '../lib/parsers/vehicleListParser';
import { writeVehicleList } from '../lib/parsers/vehicleListWriter';
import { BundleBuilder } from '../lib/core/bundleWriter';
import { RESOURCE_TYPES } from '../lib/resourceTypes';
import { PLATFORMS } from '../lib/core/types';
import type { ParsedBundle, ResourceEntry } from '../lib/core/types';

// Test data path
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

/**
 * Compare two buffers and return size difference info
 */
function compareSizes(original: ArrayBuffer, exported: ArrayBuffer) {
  return {
    originalSize: original.byteLength,
    exportedSize: exported.byteLength,
    sizeDiff: exported.byteLength - original.byteLength,
    sizeRatio: exported.byteLength / original.byteLength
  };
}

describe('Vehicle List Writer - UI Export Tests', () => {
  let originalBundleData: Buffer;
  let originalBundle: ParsedBundle;
  let realVehicles: any[] = [];
  let vehicleListResource: ResourceEntry | undefined;
  
  beforeAll(() => {
    try {
      originalBundleData = readFileSync(BUNDLE_PATH);
      originalBundle = parseBundle(originalBundleData.buffer);
      vehicleListResource = originalBundle.resources.find((r: ResourceEntry) => r.resourceTypeId === 0x10005);
      
      if (vehicleListResource) {
        realVehicles = parseVehicleList(originalBundleData.buffer, vehicleListResource, { littleEndian: true });
        console.log(`✅ Loaded ${realVehicles.length} vehicles from ${originalBundleData.length} byte bundle`);
      }
    } catch (error) {
      console.log('⚠️ Test bundle not found, skipping UI export tests');
    }
  });

  describe('UI Export Size Analysis', () => {
    it('should not significantly increase bundle size when exporting unchanged data', async function() {
      if (!originalBundleData || realVehicles.length === 0) {
        this.skip();
        return;
      }

      console.log('🔍 Testing UI export with unchanged vehicle data...');
      console.log(`📦 Original bundle: ${originalBundleData.length} bytes (${originalBundle.resources.length} resources)`);
      
      // Simulate the exact UI export process
      const builder = new BundleBuilder({
        platform: originalBundle.header.platform as any,
        compress: (originalBundle.header.flags & 0x1) !== 0
      });

      console.log(`🏗️ Builder settings: platform=${originalBundle.header.platform}, compress=${(originalBundle.header.flags & 0x1) !== 0}`);

      // Add existing resources exactly like the UI does
      for (const resource of originalBundle.resources) {
        const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
        
        if (vehicleType && resource.resourceTypeId === vehicleType.id) {
          // Replace vehicle list with "unchanged" data (simulates UI modification flag)
          const littleEndian = originalBundle.header.platform !== PLATFORMS.PS3;
          const vehicleListData = writeVehicleList(realVehicles, littleEndian);
          console.log(`🚗 Adding vehicle list: ${vehicleListData.length} bytes (platform=${originalBundle.header.platform}, littleEndian=${littleEndian})`);
          builder.addResource(resource.resourceTypeId, vehicleListData, resource.resourceId);
        } else {
          // Extract original resource data exactly like the UI
          const resourceStartOffset = resource.diskOffsets[0];
          const resourceSize = resource.sizeAndAlignmentOnDisk[0];
          
          const resourceData = new Uint8Array(
            originalBundleData.slice(resourceStartOffset, resourceStartOffset + resourceSize)
          );
          
          // Debug compression state
          const wasCompressed = (resource.flags & 0x1) !== 0;
          console.log(`📦 Adding resource 0x${resource.resourceTypeId.toString(16)}: ${resourceData.length} bytes, wasCompressed=${wasCompressed}, flags=0x${resource.flags.toString(16)}`);
          
          // The extracted data is already in its final form (compressed or uncompressed)
          builder.addResource(resource.resourceTypeId, resourceData, resource.resourceId, 
            false, // Don't compress again
            wasCompressed // Tell builder if data is already compressed
          );
        }
      }

      // Add debug data if present (like UI does)
      if (originalBundle.debugData) {
        builder.setDebugData(originalBundle.debugData);
        console.log(`📋 Added debug data: ${originalBundle.debugData.length} chars`);
      }

      // Build the new bundle
      const exportedBundleBuffer = await builder.build();
      
      // Compare sizes
      const sizeComparison = compareSizes(originalBundleData.buffer, exportedBundleBuffer);
      console.log(`📊 Size comparison:`);
      console.log(`   Original: ${sizeComparison.originalSize} bytes`);
      console.log(`   Exported: ${sizeComparison.exportedSize} bytes`);
      console.log(`   Difference: ${sizeComparison.sizeDiff > 0 ? '+' : ''}${sizeComparison.sizeDiff} bytes`);
      console.log(`   Ratio: ${(sizeComparison.sizeRatio * 100).toFixed(1)}%`);

      // This is the key test - exported bundle should not be significantly larger
      // Allow for some minor differences due to padding/alignment, but not massive increase
      expect(sizeComparison.sizeRatio).toBeLessThan(1.2); // No more than 20% increase
      expect(Math.abs(sizeComparison.sizeDiff)).toBeLessThan(2000); // No more than 2KB difference

      // Verify the exported bundle can be parsed correctly
      const reloadedBundle = parseBundle(exportedBundleBuffer);
      expect(reloadedBundle.resources.length).toBe(originalBundle.resources.length);
      
      // Verify vehicle list can still be read
      const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
      const reloadedVehicleResource = reloadedBundle.resources.find(r => r.resourceTypeId === vehicleType?.id);
      expect(reloadedVehicleResource).toBeDefined();

      console.log('✅ UI export test passed - bundle size is reasonable');
    });

    it('should identify compression issues in resource handling', async function() {
      if (!originalBundleData || realVehicles.length === 0) {
        this.skip();
        return;
      }

      console.log('🔍 Testing compression handling in resources...');
      
      // Check each resource's compression status
      let compressedResources = 0;
      let uncompressedResources = 0;
      
      for (const resource of originalBundle.resources) {
        const isCompressed = (resource.flags & 0x1) !== 0;
        if (isCompressed) {
          compressedResources++;
        } else {
          uncompressedResources++;
        }
        
        console.log(`📦 Resource 0x${resource.resourceTypeId.toString(16)}: ${isCompressed ? 'compressed' : 'uncompressed'}, size=${resource.sizeAndAlignmentOnDisk[0]}`);
      }
      
      console.log(`📊 Original bundle compression: ${compressedResources} compressed, ${uncompressedResources} uncompressed`);
      
      // Test with forced compression disabled
      const builderNoCompress = new BundleBuilder({
        platform: originalBundle.header.platform as any,
        compress: false // Force no compression
      });

      for (const resource of originalBundle.resources) {
        const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
        
        if (vehicleType && resource.resourceTypeId === vehicleType.id) {
          const littleEndian = originalBundle.header.platform !== PLATFORMS.PS3;
          const vehicleListData = writeVehicleList(realVehicles, littleEndian);
          builderNoCompress.addResource(resource.resourceTypeId, vehicleListData, resource.resourceId, false); // Force no compression
        } else {
          const resourceStartOffset = resource.diskOffsets[0];
          const resourceSize = resource.sizeAndAlignmentOnDisk[0];
          const resourceData = new Uint8Array(
            originalBundleData.slice(resourceStartOffset, resourceStartOffset + resourceSize)
          );
          builderNoCompress.addResource(resource.resourceTypeId, resourceData, resource.resourceId, false); // Force no compression
        }
      }

      const uncompressedBundle = await builderNoCompress.build();
      const uncompressedComparison = compareSizes(originalBundleData.buffer, uncompressedBundle);
      
      console.log(`📊 Uncompressed bundle: ${uncompressedComparison.exportedSize} bytes (${(uncompressedComparison.sizeRatio * 100).toFixed(1)}% of original)`);
      
      // This helps identify if compression is the culprit
      expect(uncompressedBundle.byteLength).toBeGreaterThan(0);
    });
  });

  describe('Resource Extraction Validation', () => {
    it('should extract vehicle list resource correctly', function() {
      if (!vehicleListResource || !originalBundleData) {
        this.skip();
        return;
      }

      console.log('🔍 Testing vehicle list resource extraction...');
      
      // Extract vehicle list resource exactly like UI does
      const resourceStartOffset = vehicleListResource.diskOffsets[0];
      const resourceSize = vehicleListResource.sizeAndAlignmentOnDisk[0];
      
      console.log(`📦 Vehicle list resource: offset=${resourceStartOffset}, size=${resourceSize}`);
      
      const extractedData = new Uint8Array(
        originalBundleData.slice(resourceStartOffset, resourceStartOffset + resourceSize)
      );
      
      // Re-write the same data using our writer
      const rewrittenData = writeVehicleList(realVehicles, true);
      
      console.log(`📊 Size comparison: extracted=${extractedData.length}, rewritten=${rewrittenData.length}`);
      
      // The sizes should be very close (allowing for minor differences in padding)
      const sizeDiff = Math.abs(extractedData.length - rewrittenData.length);
      expect(sizeDiff).toBeLessThan(100); // Allow up to 100 bytes difference for padding
      
      console.log('✅ Vehicle list extraction test passed');
    });
  });
}); 