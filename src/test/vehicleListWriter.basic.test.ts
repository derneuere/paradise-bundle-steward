import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { parseVehicleList, type VehicleListEntry } from '../lib/parsers/vehicleListParser';
import { writeVehicleList, validateVehicleEntry } from '../lib/parsers/vehicleListWriter';
import { Rank, VehicleType, CarType, LiveryType } from '../lib/core/types';
import type { ParsedBundle, ResourceEntry } from '../lib/core/types';

// Test data path
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

/**
 * Create a minimal test vehicle with known values
 */
function createTestVehicle(): VehicleListEntry {
  return {
    id: 'TestCar01',
    parentId: 'TestParent01',
    vehicleName: 'Test Vehicle Name',
    manufacturer: 'Test Manufacturer',
    wheelName: 'TestWheels',
    gamePlayData: {
      damageLimit: 100.0,
      flags: 0x1,
      boostBarLength: 100,
      unlockRank: Rank.D_CLASS,
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
    vehicleType: VehicleType.CAR,
    boostType: CarType.SPEED,
    liveryType: LiveryType.DEFAULT,
    topSpeedNormal: 150,
    topSpeedBoost: 180,
    topSpeedNormalGUIStat: 7,
    topSpeedBoostGUIStat: 8,
    colorIndex: 5,
    paletteIndex: 2
  };
}

describe('Vehicle List Writer - Basic Tests', () => {
  let realVehicles: VehicleListEntry[] = [];
  
  beforeAll(() => {
    try {
      const bundleData = readFileSync(BUNDLE_PATH);
      const parsedBundle = parseBundle(bundleData.buffer);
      const vehicleListResource = parsedBundle.resources.find((r: ResourceEntry) => r.resourceTypeId === 0x10005);
      
      if (vehicleListResource) {
        realVehicles = parseVehicleList(bundleData.buffer, vehicleListResource, { littleEndian: true });
        console.log(`✅ Loaded ${realVehicles.length} vehicles from test bundle`);
      }
    } catch (error) {
      console.log('⚠️ Test bundle not found, using synthetic data only');
    }
  });

  describe('Basic Round-Trip', () => {
    it('should write and read back a test vehicle correctly', () => {
      const testVehicle = createTestVehicle();
      const vehicles = [testVehicle];
      
      // Write to binary format
      const binaryData = writeVehicleList(vehicles, true);
      expect(binaryData).toBeInstanceOf(Uint8Array);
      expect(binaryData.length).toBeGreaterThan(0);
      
      // Create mock resource for parsing
      const mockResource: ResourceEntry = {
        resourceId: 0x12345n,
        importHash: 0n,
        uncompressedSizeAndAlignment: [binaryData.length, 0, 0],
        sizeAndAlignmentOnDisk: [binaryData.length, 0, 0],
        diskOffsets: [0, 0, 0],
        importOffset: 0,
        resourceTypeId: 0x10005,
        importCount: 0,
        flags: 0,
        streamIndex: 0
      };
      
      // Parse it back
      const parsedVehicles = parseVehicleList(binaryData.buffer, mockResource, { littleEndian: true });
      
      // Basic verification
      expect(parsedVehicles).toHaveLength(1);
      const parsedVehicle = parsedVehicles[0];
      expect(parsedVehicle.vehicleName).toBe(testVehicle.vehicleName);
      expect(parsedVehicle.manufacturer).toBe(testVehicle.manufacturer);
      expect(parsedVehicle.topSpeedNormal).toBe(testVehicle.topSpeedNormal);
    });
  });

  describe('Validation', () => {
    it('should validate a correct vehicle', () => {
      const validVehicle = createTestVehicle();
      const errors = validateVehicleEntry(validVehicle);
      expect(errors).toHaveLength(0);
    });

    it('should catch basic validation errors', () => {
      const invalidVehicle = createTestVehicle();
      invalidVehicle.id = '';
      invalidVehicle.vehicleName = '';
      
      const errors = validateVehicleEntry(invalidVehicle);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Vehicle ID cannot be empty');
      expect(errors).toContain('Vehicle name cannot be empty');
    });
  });

  describe('Real Data Test', () => {
    it('should handle real vehicle data if available', function() {
      if (realVehicles.length === 0) {
        this.skip();
        return;
      }

      // Take only first vehicle for quick test
      const testVehicles = realVehicles.slice(0, 1);
      
      // Write and read back
      const writtenData = writeVehicleList(testVehicles, true);
      
      const mockResource: ResourceEntry = {
        resourceId: 0x12345n,
        importHash: 0n,
        uncompressedSizeAndAlignment: [writtenData.length, 0, 0],
        sizeAndAlignmentOnDisk: [writtenData.length, 0, 0],
        diskOffsets: [0, 0, 0],
        importOffset: 0,
        resourceTypeId: 0x10005,
        importCount: 0,
        flags: 0,
        streamIndex: 0
      };
      
      const reparsedVehicles = parseVehicleList(writtenData.buffer, mockResource, { littleEndian: true });
      
      expect(reparsedVehicles).toHaveLength(testVehicles.length);
      expect(reparsedVehicles[0].vehicleName).toBe(testVehicles[0].vehicleName);
      expect(reparsedVehicles[0].topSpeedNormal).toBe(testVehicles[0].topSpeedNormal);
    });
  });
}); 