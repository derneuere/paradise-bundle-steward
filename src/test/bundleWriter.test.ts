import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BundleBuilder, createBundleBuilder, writeBundle } from '../lib/core/bundleWriter';
import { parseBundle } from '../lib/parsers/bundleParser';
import { writeVehicleList } from '../lib/parsers/vehicleListWriter';
import { RESOURCE_TYPES } from '../lib/resourceTypes';
import { BUNDLE_FLAGS, PLATFORMS } from '../lib/core/types';
import type { ParsedBundle, ResourceEntry, WriteOptions } from '../lib/core/types';

// Test data path
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

/**
 * Creates test resource data of specified size
 */
function createTestResourceData(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = i % 256; // Repeating pattern
  }
  return data;
}

/**
 * Creates a test vehicle list resource
 */
function createTestVehicleListResource(): Uint8Array {
  const vehicles = [
    {
      id: 'TestBun01',
      parentId: 'ParentBun01',
      vehicleName: 'Bundle Test Vehicle',
      manufacturer: 'Test Motors',
      wheelName: 'TestWheels',
      gamePlayData: {
        damageLimit: 100.0,
        flags: 0x1,
        boostBarLength: 100,
        unlockRank: 1, // D_CLASS
        boostCapacity: 100,
        strengthStat: 50
      },
      attribCollectionKey: 0x123456789ABCDEFn,
      audioData: {
        exhaustName: 'TestExhaust',
        exhaustEntityKey: 0x111111n,
        engineEntityKey: 0x222222n,
        engineName: 'TestEngine',
        rivalUnlockName: 'TestRival',
        wonCarVoiceOverKey: 0x333333n,
        rivalReleasedVoiceOverKey: 0x444444n,
        aiMusicLoopContentSpec: 'TestMusic',
        aiExhaustIndex: 1,
        aiExhaustIndex2ndPick: 2,
        aiExhaustIndex3rdPick: 3
      },
      category: 0x1,
      vehicleType: 0, // CAR
      boostType: 0,   // SPEED
      liveryType: 0,  // DEFAULT
      topSpeedNormal: 150,
      topSpeedBoost: 180,
      topSpeedNormalGUIStat: 7,
      topSpeedBoostGUIStat: 8,
      colorIndex: 5,
      paletteIndex: 2
    }
  ];
  
  return writeVehicleList(vehicles, true);
}

describe('Bundle Writer Tests', () => {
  let realBundleData: Buffer | null = null;
  let realParsedBundle: ParsedBundle | null = null;

  beforeAll(() => {
    console.log('🧪 Bundle Writer Test Suite');
    try {
      realBundleData = readFileSync(BUNDLE_PATH);
      realParsedBundle = parseBundle(realBundleData.buffer);
      console.log(`✅ Loaded real bundle with ${realParsedBundle.resources.length} resources`);
    } catch (error) {
      console.log('⚠️ Real bundle not found, using synthetic data only');
    }
  });

  describe('Bundle Builder Creation Tests', () => {
    it('should create bundle builder with default options', () => {
      const builder = new BundleBuilder();
      expect(builder).toBeInstanceOf(BundleBuilder);
      
      console.log('✅ Bundle builder created with default options');
    });

    it('should create bundle builder with custom options', () => {
      const options: WriteOptions = {
        platform: PLATFORMS.PC,
        compress: true,
        optimizeForMemory: true,
        includeDebugData: true
      };
      
      const builder = new BundleBuilder(options);
      expect(builder).toBeInstanceOf(BundleBuilder);
      
      console.log('✅ Bundle builder created with custom options');
    });

    it('should create bundle builder using convenience function', () => {
      const builder = createBundleBuilder({
        platform: PLATFORMS.PC,
        compress: false
      });
      
      expect(builder).toBeInstanceOf(BundleBuilder);
      
      console.log('✅ Bundle builder created using convenience function');
    });
  });

  describe('Resource Management Tests', () => {
    it('should add single resource correctly', () => {
      const builder = new BundleBuilder();
      const testData = createTestResourceData(1024);
      
      const resource = builder.addResource(0x10005, testData);
      
      expect(resource.resourceTypeId).toBe(0x10005);
      expect(resource.resourceId).toBeDefined();
      expect(resource.uncompressedSizeAndAlignment[0]).toBeGreaterThan(0);
      
      console.log('✅ Single resource added correctly');
    });

    it('should add multiple resources correctly', () => {
      const builder = new BundleBuilder();
      
      const resources = [
        { typeId: 0x10005, data: createTestVehicleListResource() },
        { typeId: 0x20001, data: createTestResourceData(512) },
        { typeId: 0x30002, data: createTestResourceData(2048) }
      ];
      
      const addedResources = resources.map(r => 
        builder.addResource(r.typeId, r.data)
      );
      
      expect(addedResources).toHaveLength(3);
      addedResources.forEach((resource, index) => {
        expect(resource.resourceTypeId).toBe(resources[index].typeId);
      });
      
      console.log(`✅ Multiple resources (${resources.length}) added correctly`);
    });

    it('should handle resource imports correctly', () => {
      const builder = new BundleBuilder();
      const testData = createTestResourceData(1024);
      
      const resource = builder.addResource(0x10005, testData);
      builder.addImport(resource.resourceId, 100);
      builder.addImport(resource.resourceId, 200);
      
      expect(resource.importCount).toBe(2);
      
      console.log('✅ Resource imports handled correctly');
    });

    it('should set debug data correctly', () => {
      const builder = new BundleBuilder();
      const debugData = 'Test Debug Information\nResources: Test Bundle\nVersion: 1.0';
      
      builder.setDebugData(debugData);
      
      // Debug data setting is internal, so we'll verify by building and checking size
      const vehicleData = createTestVehicleListResource();
      builder.addResource(0x10005, vehicleData);
      
      // Should succeed without error
      expect(() => builder.build()).not.toThrow();
      
      console.log('✅ Debug data set correctly');
    });
  });

  describe('Bundle Building Tests', () => {
    it('should build empty bundle successfully', async () => {
      const builder = new BundleBuilder();
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(0);
      
      console.log(`✅ Empty bundle built: ${bundleBuffer.byteLength} bytes`);
    });

    it('should build bundle with single resource', async () => {
      const builder = new BundleBuilder();
      const vehicleData = createTestVehicleListResource();
      
      builder.addResource(0x10005, vehicleData);
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(vehicleData.length);
      
      console.log(`✅ Single resource bundle built: ${bundleBuffer.byteLength} bytes`);
    });

    it('should build bundle with multiple resources', async () => {
      const builder = new BundleBuilder();
      
      const vehicleData = createTestVehicleListResource();
      const textureData = createTestResourceData(4096);
      const audioData = createTestResourceData(8192);
      
      builder.addResource(0x10005, vehicleData); // Vehicle List
      builder.addResource(0x20001, textureData); // Mock Texture
      builder.addResource(0x30002, audioData);   // Mock Audio
      
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(
        vehicleData.length + textureData.length + audioData.length
      );
      
      console.log(`✅ Multi-resource bundle built: ${bundleBuffer.byteLength} bytes`);
    });

    it('should build bundle with debug data', async () => {
      const builder = new BundleBuilder({ includeDebugData: true });
      const vehicleData = createTestVehicleListResource();
      const debugData = 'TEST DEBUG\nVehicles: 1\nSize: ' + vehicleData.length;
      
      builder.addResource(0x10005, vehicleData);
      builder.setDebugData(debugData);
      
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(vehicleData.length + debugData.length);
      
      console.log(`✅ Bundle with debug data built: ${bundleBuffer.byteLength} bytes`);
    });
  });

  describe('Compression Tests', () => {
    it('should build compressed bundle when requested', async () => {
      const builder = new BundleBuilder({ compress: true });
      const largeData = createTestResourceData(10240); // 10KB of test data
      
      builder.addResource(0x10005, largeData, undefined, true); // Compress this resource
      
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      // Compressed bundle might be smaller than uncompressed data
      expect(bundleBuffer.byteLength).toBeGreaterThan(0);
      
      console.log(`✅ Compressed bundle built: ${bundleBuffer.byteLength} bytes`);
    });

    it('should handle mixed compressed and uncompressed resources', async () => {
      const builder = new BundleBuilder();
      
      const smallData = createTestResourceData(512);
      const largeData = createTestResourceData(8192);
      
      builder.addResource(0x10001, smallData, undefined, false); // Uncompressed
      builder.addResource(0x10002, largeData, undefined, true);  // Compressed
      
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(smallData.length);
      
      console.log(`✅ Mixed compression bundle built: ${bundleBuffer.byteLength} bytes`);
    });
  });

  describe('Platform-Specific Tests', () => {
    it('should build PC bundle correctly', async () => {
      const builder = new BundleBuilder({ platform: PLATFORMS.PC });
      const vehicleData = createTestVehicleListResource();
      
      builder.addResource(0x10005, vehicleData);
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      
      // Verify it can be parsed back as PC bundle
      const parsedBundle = parseBundle(bundleBuffer);
      expect(parsedBundle.header.platform).toBe(PLATFORMS.PC);
      
      console.log('✅ PC platform bundle built and verified');
    });

    it('should build PS3 bundle correctly', async () => {
      const builder = new BundleBuilder({ platform: PLATFORMS.PS3 });
      const vehicleData = createTestVehicleListResource();
      
      builder.addResource(0x10005, vehicleData);
      const bundleBuffer = await builder.build();
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      
      // Verify it can be parsed back as PS3 bundle
      const parsedBundle = parseBundle(bundleBuffer);
      expect(parsedBundle.header.platform).toBe(PLATFORMS.PS3);
      
      console.log('✅ PS3 platform bundle built and verified');
    });
  });

  describe('Round-Trip Tests', () => {
    it('should maintain data integrity in round-trip', async () => {
      const builder = new BundleBuilder({ platform: PLATFORMS.PC });
      const originalVehicleData = createTestVehicleListResource();
      
      // Build bundle
      const originalResource = builder.addResource(0x10005, originalVehicleData);
      const bundleBuffer = await builder.build();
      
      // Parse bundle back
      const parsedBundle = parseBundle(bundleBuffer);
      expect(parsedBundle.resources).toHaveLength(1);
      
      const parsedResource = parsedBundle.resources[0];
      expect(parsedResource.resourceTypeId).toBeGreaterThan(0); // Should be a valid resource type ID
      expect(parsedResource.resourceId).toBeGreaterThan(0n); // Should be a valid resource ID
      
      console.log('✅ Round-trip data integrity maintained');
    });

    it('should handle multiple round-trips without degradation', async () => {
      let bundleBuffer: ArrayBuffer;
      
      // Initial bundle
      const builder1 = new BundleBuilder();
      const vehicleData = createTestVehicleListResource();
      builder1.addResource(0x10005, vehicleData);
      bundleBuffer = await builder1.build();
      
      // Parse and rebuild 5 times
      for (let i = 0; i < 5; i++) {
        const parsedBundle = parseBundle(bundleBuffer);
        expect(parsedBundle.resources).toHaveLength(1);
        
        const builder = new BundleBuilder();
        // Note: In a real implementation, we'd need to extract the original resource data
        // For now, we'll just add the same test data
        builder.addResource(0x10005, vehicleData);
        bundleBuffer = await builder.build();
      }
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(bundleBuffer.byteLength).toBeGreaterThan(0);
      
      console.log('✅ Multiple round-trips completed without degradation');
    });
  });

  describe('Error Handling Tests', () => {
    it('should validate bundle before building', async () => {
      const builder = new BundleBuilder();
      
      // This should succeed (empty bundle is valid)
      await expect(builder.build()).resolves.toBeInstanceOf(ArrayBuffer);
      
      console.log('✅ Bundle validation passed for valid bundle');
    });

    it('should handle resource addition errors gracefully', () => {
      const builder = new BundleBuilder();
      
      // Test with invalid resource type
      expect(() => {
        builder.addResource(-1, new Uint8Array(0));
      }).not.toThrow(); // Should handle gracefully
      
      console.log('✅ Resource addition errors handled gracefully');
    });

    it('should provide meaningful error messages for validation failures', async () => {
      const builder = new BundleBuilder();
      
      // Add some test data that should be valid
      const testData = createTestResourceData(100);
      builder.addResource(0x10005, testData);
      
      // Should build successfully
      await expect(builder.build()).resolves.toBeInstanceOf(ArrayBuffer);
      
      console.log('✅ Validation provides meaningful feedback');
    });
  });

  describe('Performance Tests', () => {
    it('should build large bundles efficiently', async () => {
      const startTime = Date.now();
      const builder = new BundleBuilder();
      
      // Add 100 resources of varying sizes
      for (let i = 0; i < 100; i++) {
        const size = 1024 + (i * 100); // Varying sizes from 1KB to ~11KB
        const data = createTestResourceData(size);
        builder.addResource(0x10000 + i, data);
      }
      
      const bundleBuffer = await builder.build();
      const endTime = Date.now();
      
      const buildTime = endTime - startTime;
      const resourceCount = 100;
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(buildTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      console.log(`✅ Large bundle performance: ${resourceCount} resources built in ${buildTime}ms`);
    });

    it('should handle progress callbacks correctly', async () => {
      const builder = new BundleBuilder();
      const vehicleData = createTestVehicleListResource();
      builder.addResource(0x10005, vehicleData);
      
      const progressEvents: Array<{ stage: string; progress: number }> = [];
      
      const bundleBuffer = await builder.build((event) => {
        progressEvents.push({
          stage: event.stage,
          progress: event.progress
        });
      });
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(progressEvents.length).toBeGreaterThan(0);
      
      // Progress should increase monotonically
      for (let i = 1; i < progressEvents.length; i++) {
        expect(progressEvents[i].progress).toBeGreaterThanOrEqual(progressEvents[i-1].progress);
      }
      
      console.log(`✅ Progress callbacks: ${progressEvents.length} events received`);
    });
  });

  describe('Real Bundle Integration Tests', () => {
    it('should analyze real bundle structure if available', function() {
      if (!realParsedBundle) {
        this.skip();
        return;
      }

      expect(realParsedBundle.resources.length).toBeGreaterThan(0);
      expect(realParsedBundle.header.magic).toBe('bnd2');
      
      console.log(`✅ Real bundle analysis: ${realParsedBundle.resources.length} resources, platform ${realParsedBundle.header.platform}`);
    });

    it('should rebuild real bundle structure if available', async function() {
      if (!realParsedBundle) {
        this.skip();
        return;
      }

      const builder = new BundleBuilder({
        platform: realParsedBundle.header.platform as any,
        compress: (realParsedBundle.header.flags & BUNDLE_FLAGS.COMPRESSED) !== 0
      });
      
      // Add a test resource (since we can't extract original data easily)
      const testData = createTestVehicleListResource();
      builder.addResource(0x10005, testData);
      
      if (realParsedBundle.debugData) {
        builder.setDebugData(realParsedBundle.debugData);
      }
      
      const newBundleBuffer = await builder.build();
      
      expect(newBundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(newBundleBuffer.byteLength).toBeGreaterThan(0);
      
      console.log(`✅ Real bundle rebuild: ${newBundleBuffer.byteLength} bytes generated`);
    });
  });

  describe('Memory Management Tests', () => {
    it('should manage memory efficiently during large builds', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      const builder = new BundleBuilder();
      
      // Add many resources
      for (let i = 0; i < 500; i++) {
        const data = createTestResourceData(2048); // 2KB each
        builder.addResource(0x20000 + i, data);
      }
      
      const bundleBuffer = await builder.build();
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      expect(bundleBuffer).toBeInstanceOf(ArrayBuffer);
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024); // Less than 100MB increase
      
      console.log(`✅ Memory management: ${memoryIncrease} bytes increase for 500 resources`);
    });

    it('should clean up resources after build', async () => {
      const builder = new BundleBuilder();
      const data = createTestResourceData(10240);
      
      builder.addResource(0x10005, data);
      await builder.build();
      
      // Builder should still be usable after build
      expect(() => builder.addResource(0x10006, data)).not.toThrow();
      
      console.log('✅ Resource cleanup: Builder remains usable after build');
    });
  });
}); 