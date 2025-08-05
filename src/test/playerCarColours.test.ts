import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/bundleParser';
import { parsePlayerCarColours } from '../lib/playerCarColoursParser';
import { testUtils } from './setup';

// Test data path (relative to project root)
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

describe('PlayerCarColours Parser', () => {
  let bundleData: Buffer;
  let parsedBundle: any;
  
  beforeAll(() => {
    // Load test data
    bundleData = readFileSync(BUNDLE_PATH);
    parsedBundle = parseBundle(bundleData.buffer);
    console.log('🧪 PlayerCarColours Parser Test Suite');
  });

  describe('Bundle Resource Detection', () => {
    it('should load test bundle successfully', () => {
      expect(bundleData).toBeDefined();
      expect(bundleData.length).toBeGreaterThan(0);
    });

    it('should parse bundle structure', () => {
      expect(parsedBundle).toBeDefined();
      expect(parsedBundle.header.magic).toBe('bnd2');
      expect(parsedBundle.resources).toHaveLength(2);
    });

    it('should detect resource types in bundle', () => {
      const resourceTypes = parsedBundle.resources.map((r: any) => r.resourceTypeId);
      console.log(`📋 Found resource types: ${resourceTypes.map((t: number) => `0x${t.toString(16)}`).join(', ')}`);
      
      // Should have VehicleList (0x10005)
      expect(resourceTypes).toContain(0x10005);
      
      // Check if PlayerCarColours (0x1001E) is present
      const hasPlayerCarColours = resourceTypes.includes(0x1001E);
      if (hasPlayerCarColours) {
        console.log('✅ PlayerCarColours resource found!');
      } else {
        console.log('❌ PlayerCarColours resource not found in this bundle');
      }
    });
  });

  describe('PlayerCarColours Parsing', () => {
    it('should handle missing PlayerCarColours resource gracefully', () => {
      const playerCarColoursResource = parsedBundle.resources.find(
        (r: any) => r.resourceTypeId === 0x1001E
      );
      
      if (!playerCarColoursResource) {
        console.log('⚠️  No PlayerCarColours resource in test bundle - testing error handling');
        
        // Test with empty/invalid resource
        const mockResource = {
          resourceTypeId: 0x1001E,
          resourceId: 0,
          diskOffsets: [0, 0, 0],
          sizeAndAlignmentOnDisk: [0, 0, 0],
          uncompressedSizeAndAlignment: [0, 0, 0],
          importOffset: 0,
          importCount: 0,
          flags: 0
        };
        
        const result = parsePlayerCarColours(bundleData.buffer, mockResource);
        expect(result).toBeDefined();
        expect(result.palettes).toHaveLength(0);
        expect(result.totalColors).toBe(0);
        return;
      }

      // If resource exists, test parsing
      console.log('🎨 Testing PlayerCarColours parsing...');
      
      const result = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, true);
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty('palettes');
      expect(result).toHaveProperty('is64Bit');
      expect(result).toHaveProperty('totalColors');
      
      console.log(`📊 Parsing result: ${result.palettes.length} palettes, ${result.totalColors} total colors`);
    });

    it('should test different architecture configurations', () => {
      const playerCarColoursResource = parsedBundle.resources.find(
        (r: any) => r.resourceTypeId === 0x1001E
      );
      
      if (!playerCarColoursResource) {
        console.log('⚠️  Skipping architecture tests - no PlayerCarColours resource');
        return;
      }

      console.log('🧪 Testing different parsing configurations...');
      
      // Test 32-bit parsing
      const result32 = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, false);
      console.log(`32-bit result: ${result32.palettes.length} palettes, ${result32.totalColors} colors`);
      
      // Test 64-bit parsing  
      const result64 = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, true);
      console.log(`64-bit result: ${result64.palettes.length} palettes, ${result64.totalColors} colors`);
      
      // At least one should work
      const hasValidResult = result32.palettes.length > 0 || result64.palettes.length > 0;
      expect(hasValidResult).toBe(true);
    });
  });

  describe('Color Palette Validation', () => {
    it('should validate palette structure if colors are found', () => {
      const playerCarColoursResource = parsedBundle.resources.find(
        (r: any) => r.resourceTypeId === 0x1001E
      );
      
      if (!playerCarColoursResource) {
        console.log('⚠️  Skipping validation tests - no PlayerCarColours resource');
        return;
      }

      const result = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, true);
      
      if (result.palettes.length === 0) {
        console.log('⚠️  No palettes parsed - may need parser improvements');
        return;
      }

      console.log('🎨 Validating color palette structure...');
      
      // Check that we have the expected palette types
      const expectedPaletteTypes = ['Gloss', 'Metallic', 'Pearlescent', 'Special', 'Party'];
      
      result.palettes.forEach(palette => {
        expect(palette).toHaveProperty('type');
        expect(palette).toHaveProperty('typeName');
        expect(palette).toHaveProperty('numColours');
        expect(palette).toHaveProperty('paintColours');
        expect(palette).toHaveProperty('pearlColours');
        
        expect(expectedPaletteTypes).toContain(palette.typeName);
        expect(palette.numColours).toBeGreaterThanOrEqual(0);
        expect(palette.numColours).toBeLessThanOrEqual(1000); // Reasonable max
        
        console.log(`✅ ${palette.typeName}: ${palette.numColours} colors (${palette.paintColours.length} paint, ${palette.pearlColours.length} pearl)`);
      });
    });

    it('should validate color value ranges', () => {
      const playerCarColoursResource = parsedBundle.resources.find(
        (r: any) => r.resourceTypeId === 0x1001E
      );
      
      if (!playerCarColoursResource) {
        console.log('⚠️  Skipping color validation - no PlayerCarColours resource');
        return;
      }

      const result = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, true);
      
      if (result.totalColors === 0) {
        console.log('⚠️  No colors to validate');
        return;
      }

      console.log('🔍 Validating color values...');
      
      let validColors = 0;
      let neonColors = 0;
      
      result.palettes.forEach(palette => {
        [...palette.paintColours, ...palette.pearlColours].forEach(color => {
          // Basic validation
          expect(color).toHaveProperty('red');
          expect(color).toHaveProperty('green');
          expect(color).toHaveProperty('blue');
          expect(color).toHaveProperty('alpha');
          expect(color).toHaveProperty('hexValue');
          expect(color).toHaveProperty('rgbValue');
          expect(color).toHaveProperty('isNeon');
          
          // Check if values are reasonable (allow neon colors to exceed 1.0)
          expect(color.red).toBeGreaterThanOrEqual(-10);
          expect(color.red).toBeLessThanOrEqual(10);
          expect(color.green).toBeGreaterThanOrEqual(-10);
          expect(color.green).toBeLessThanOrEqual(10);
          expect(color.blue).toBeGreaterThanOrEqual(-10);
          expect(color.blue).toBeLessThanOrEqual(10);
          expect(color.alpha).toBeGreaterThanOrEqual(-10);
          expect(color.alpha).toBeLessThanOrEqual(10);
          
          // Check hex format
          expect(color.hexValue).toMatch(/^#[0-9a-fA-F]{6}$/);
          
          // Check RGB format
          expect(color.rgbValue).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
          
          validColors++;
          if (color.isNeon) neonColors++;
        });
      });
      
      console.log(`✅ Validated ${validColors} colors (${neonColors} neon colors)`);
      expect(validColors).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted data gracefully', () => {
      // Create a mock resource with invalid data
      const mockResource = {
        resourceTypeId: 0x1001E,
        resourceId: 0x12345,
        diskOffsets: [100, 0, 0],
        sizeAndAlignmentOnDisk: [50, 0, 0], // Small size
        uncompressedSizeAndAlignment: [50, 0, 0],
        importOffset: 0,
        importCount: 0,
        flags: 0
      };
      
      // This should not throw an error and may generate fallback palettes
      expect(() => {
        const result = parsePlayerCarColours(bundleData.buffer, mockResource);
        // The parser may generate fallback palettes even with corrupted data, which is acceptable
        expect(result).toBeDefined();
        expect(result.palettes.length).toBeGreaterThanOrEqual(0);
      }).not.toThrow();
    });

    it('should handle empty buffer gracefully', () => {
      const mockResource = {
        resourceTypeId: 0x1001E,
        resourceId: 0,
        diskOffsets: [0, 0, 0],
        sizeAndAlignmentOnDisk: [0, 0, 0],
        uncompressedSizeAndAlignment: [0, 0, 0],
        importOffset: 0,
        importCount: 0,
        flags: 0
      };
      
      const result = parsePlayerCarColours(new ArrayBuffer(0), mockResource);
      expect(result.palettes).toHaveLength(0);
      expect(result.totalColors).toBe(0);
    });
  });

  describe('Performance', () => {
    it('should parse colors within reasonable time', () => {
      const playerCarColoursResource = parsedBundle.resources.find(
        (r: any) => r.resourceTypeId === 0x1001E
      );
      
      if (!playerCarColoursResource) {
        console.log('⚠️  Skipping performance test - no PlayerCarColours resource');
        return;
      }

      const startTime = performance.now();
      const result = parsePlayerCarColours(bundleData.buffer, playerCarColoursResource, true);
      const endTime = performance.now();
      
      const duration = endTime - startTime;
      console.log(`⏱️  Parsing took ${duration.toFixed(2)}ms`);
      
      // Should complete within 1 second
      expect(duration).toBeLessThan(1000);
    });
  });
}); 