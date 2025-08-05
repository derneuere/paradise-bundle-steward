import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle, formatResourceId, getPlatformName, getFlagNames } from '../lib/parsers/bundleParser';
import type { ParsedBundle, ResourceEntry } from '../lib/core/types';

// Test data path (relative to project root)
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

describe('Bundle Parser', () => {
  let bundleData: Buffer;
  let parsedBundle: ParsedBundle;
  
  beforeAll(() => {
    console.log('🧪 Bundle Parser Test Suite');
    bundleData = readFileSync(BUNDLE_PATH);
    parsedBundle = parseBundle(bundleData.buffer);
  });

  describe('Raw Binary Structure', () => {
    it('should parse header fields correctly', () => {
      const magic = new TextDecoder().decode(new Uint8Array(bundleData.buffer.slice(bundleData.byteOffset, bundleData.byteOffset + 4)));
      const version = new DataView(bundleData.buffer).getUint32(4, true);
      const platform = new DataView(bundleData.buffer).getUint32(8, true);
      const debugDataOffset = new DataView(bundleData.buffer).getUint32(12, true);
      const resourceCount = new DataView(bundleData.buffer).getUint32(16, true);
      const resourceEntriesOffset = new DataView(bundleData.buffer).getUint32(24, true);
      
      console.log(`📋 Raw header - Magic: ${magic}, Version: ${version}, Platform: ${platform}`);
      console.log(`📋 Raw header - Resources: ${resourceCount}, Entries Offset: 0x${resourceEntriesOffset.toString(16)}`);
      
      expect(magic).toBe('bnd2');
      expect(version).toBe(2);
      expect(platform).toBe(1);
      expect(resourceCount).toBe(2);
    });

    it('should validate bundle file exists and has content', () => {
      expect(bundleData).toBeDefined();
      expect(bundleData.length).toBeGreaterThan(0);
      console.log(`📁 Bundle file size: ${bundleData.byteLength} bytes`);
    });
  });

  describe('Bundle Header Parsing', () => {
    it('should parse magic signature correctly', () => {
      expect(parsedBundle.header.magic).toBe('bnd2');
    });

    it('should parse version correctly', () => {
      expect(parsedBundle.header.version).toBe(2);
    });

    it('should identify platform correctly', () => {
      const platformName = getPlatformName(parsedBundle.header.platform);
      expect(platformName).toBe('PC');
      expect(parsedBundle.header.platform).toBe(1);
    });

    it('should parse resource count correctly', () => {
      expect(parsedBundle.header.resourceEntriesCount).toBe(2);
    });

    it('should parse flags correctly', () => {
      const flagNames = getFlagNames(parsedBundle.header.flags);
      console.log(`🏁 Bundle flags: ${flagNames.join(', ')}`);
      
      expect(flagNames).toContain('Compressed');
      expect(flagNames).toContain('Main Memory Optimised');
      expect(flagNames).toContain('Graphics Memory Optimised');
      expect(flagNames).toContain('Has Debug Data');
    });
  });

  describe('Resource Entries', () => {
    it('should parse correct number of resources', () => {
      expect(parsedBundle.resources).toHaveLength(2);
    });

    it('should parse resource entries with valid IDs and types', () => {
      parsedBundle.resources.forEach((resource: ResourceEntry, index: number) => {
        console.log(`🔍 Resource ${index}: ID=${formatResourceId(resource.resourceId)}, Type=0x${resource.resourceTypeId.toString(16).padStart(8, '0')}`);
        
        expect(resource.resourceId).toBeDefined();
        expect(resource.resourceTypeId).toBeDefined();
        expect(resource.diskOffsets).toBeDefined();
        expect(resource.sizeAndAlignmentOnDisk).toBeDefined();
      });
    });

    it('should find VehicleList resource', () => {
      const vehicleListResource = parsedBundle.resources.find((r: ResourceEntry) => r.resourceTypeId === 0x10005);
      
      expect(vehicleListResource).toBeDefined();
      expect(formatResourceId(vehicleListResource.resourceId)).toBe('0x000000001521E14B');
      console.log('✅ Found VehicleList resource: 0x000000001521E14B');
    });

    it('should check for PlayerCarColours resource', () => {
      const playerCarColoursResource = parsedBundle.resources.find((r: ResourceEntry) => r.resourceTypeId === 0x1001E);
      
      if (playerCarColoursResource) {
        console.log('✅ Found PlayerCarColours resource');
        expect(playerCarColoursResource.resourceTypeId).toBe(0x1001E);
      } else {
        console.log('ℹ️ PlayerCarColours resource not found in this bundle (expected for this test file)');
      }
    });
  });

  describe('Debug Data', () => {
    it('should extract debug data when present', () => {
      if (parsedBundle.debugData) {
        const debugDataStr = parsedBundle.debugData;
        
        expect(debugDataStr.length).toBeGreaterThan(16000);
        expect(debugDataStr).toContain('ResourceStringTable');
        expect(debugDataStr).toContain('VehicleListResourceType');
        
        console.log(`📝 Debug data extracted: ${debugDataStr.length} characters`);
        console.log('✅ Debug data contains expected resource type information');
      } else {
        console.log('ℹ️ No debug data found in bundle');
      }
    });
  });

  describe('Bundle Validation', () => {
    it('should have valid bundle structure', () => {
      expect(parsedBundle).toBeDefined();
      expect(parsedBundle.header).toBeDefined();
      expect(parsedBundle.resources).toBeDefined();
      expect(Array.isArray(parsedBundle.resources)).toBe(true);
    });

    it('should have correct resource structure', () => {
      parsedBundle.resources.forEach((resource: ResourceEntry, index: number) => {
        expect(resource.resourceId).toBeTypeOf('bigint');
        expect(resource.resourceTypeId).toBeTypeOf('number');
        expect(Array.isArray(resource.diskOffsets)).toBe(true);
        expect(Array.isArray(resource.sizeAndAlignmentOnDisk)).toBe(true);
        expect(resource.diskOffsets).toHaveLength(3);
        expect(resource.sizeAndAlignmentOnDisk).toHaveLength(3);
      });
    });

    it('should match Bundle Manager reference implementation expectations', () => {
      // Based on Bundle Manager specs
      expect(parsedBundle.header.magic).toBe('bnd2');
      expect(parsedBundle.header.version).toBe(2);
      expect([1, 2, 3]).toContain(parsedBundle.header.platform); // PC, Xbox360, PS3
      
      console.log('✅ Bundle structure matches Bundle Manager reference implementation');
      console.log('🔗 Reference: https://github.com/burninrubber0/Bundle-Manager');
    });
  });
}); 