import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { parseVehicleList, type VehicleListEntry } from '../lib/parsers/vehicleListParser';
import { writeVehicleList, validateVehicleEntry } from '../lib/parsers/vehicleListWriter';
import { Rank, VehicleType, CarType, LiveryType } from '../lib/core/types';
import type { ResourceEntry } from '../lib/core/types';

const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

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

function createMockResource(dataLength: number): ResourceEntry {
  return {
    resourceId: 0x12345n,
    importHash: 0n,
    uncompressedSizeAndAlignment: [dataLength, 0, 0],
    sizeAndAlignmentOnDisk: [dataLength, 0, 0],
    diskOffsets: [0, 0, 0],
    importOffset: 0,
    resourceTypeId: 0x10005,
    importCount: 0,
    flags: 0,
    streamIndex: 0
  };
}

describe('Vehicle List Writer Tests', () => {
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

  describe('Round-Trip Tests', () => {
    it('should write and read back a single test vehicle correctly', () => {
      const testVehicle = createTestVehicle();
      const binaryData = writeVehicleList([testVehicle], true);
      const mockResource = createMockResource(binaryData.length);
      const parsedVehicles = parseVehicleList(binaryData.buffer, mockResource, { littleEndian: true });
      
      expect(parsedVehicles).toHaveLength(1);
      expect(parsedVehicles[0].vehicleName).toBe(testVehicle.vehicleName);
      expect(parsedVehicles[0].topSpeedNormal).toBe(testVehicle.topSpeedNormal);
    });

    it('should handle multiple vehicles correctly', () => {
      const vehicles = [
        createTestVehicle(),
        { ...createTestVehicle(), id: 'TestCar02', vehicleName: 'Second Test Vehicle' },
        { ...createTestVehicle(), id: 'TestCar03', topSpeedNormal: 200 }
      ];
      
      const binaryData = writeVehicleList(vehicles, true);
      const mockResource = createMockResource(binaryData.length);
      const parsedVehicles = parseVehicleList(binaryData.buffer, mockResource, { littleEndian: true });
      
      expect(parsedVehicles).toHaveLength(vehicles.length);
      for (let i = 0; i < vehicles.length; i++) {
        expect(parsedVehicles[i].vehicleName).toBe(vehicles[i].vehicleName);
      }
    });

    it('should perform round-trip on real vehicle data', function() {
      if (realVehicles.length === 0) {
        this.skip();
        return;
      }

      const testVehicles = realVehicles.slice(0, 5); // Test with first 5 vehicles
      const writtenData = writeVehicleList(testVehicles, true);
      const mockResource = createMockResource(writtenData.length);
      const reparsedVehicles = parseVehicleList(writtenData.buffer, mockResource, { littleEndian: true });
      
      expect(reparsedVehicles.length).toBeGreaterThan(0);
      expect(reparsedVehicles[0].vehicleName).toBe(testVehicles[0].vehicleName);
      expect(reparsedVehicles[0].topSpeedNormal).toBe(testVehicles[0].topSpeedNormal);
    });
  });

  describe('Validation Tests', () => {
    it('should validate a correct vehicle', () => {
      const validVehicle = createTestVehicle();
      const errors = validateVehicleEntry(validVehicle);
      expect(errors).toHaveLength(0);
    });

    it('should catch validation errors', () => {
      const invalidVehicle = createTestVehicle();
      invalidVehicle.id = '';
      invalidVehicle.vehicleName = '';
      invalidVehicle.topSpeedNormalGUIStat = 15; // Out of range
      invalidVehicle.gamePlayData.damageLimit = -10; // Invalid
      
      const errors = validateVehicleEntry(invalidVehicle);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Vehicle ID cannot be empty');
      expect(errors).toContain('Vehicle name cannot be empty');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty vehicle list', () => {
      const binaryData = writeVehicleList([], true);
      expect(binaryData).toBeInstanceOf(Uint8Array);
      expect(binaryData.length).toBe(16); // Just the header
    });

    it('should handle maximum field values', () => {
      const maxVehicle = createTestVehicle();
      maxVehicle.topSpeedNormal = 255;
      maxVehicle.topSpeedBoost = 255;
      maxVehicle.topSpeedNormalGUIStat = 10;
      
      const binaryData = writeVehicleList([maxVehicle], true);
      expect(binaryData.length).toBeGreaterThan(16);
    });

    it('should handle different endianness', () => {
      const vehicles = [createTestVehicle()];
      const littleEndianData = writeVehicleList(vehicles, true);
      const bigEndianData = writeVehicleList(vehicles, false);
      
      expect(littleEndianData.length).toBe(bigEndianData.length);
      expect(littleEndianData).not.toEqual(bigEndianData);
    });
  });

  describe('Data Precision Tests', () => {
    it('should change exactly the right bytes when modifying fields', () => {
      const original = createTestVehicle();
      const modified = { ...original, topSpeedNormal: original.topSpeedNormal + 10 };
      
      const originalData = writeVehicleList([original], true);
      const modifiedData = writeVehicleList([modified], true);
      
      let differences = 0;
      for (let i = 0; i < originalData.length; i++) {
        if (originalData[i] !== modifiedData[i]) differences++;
      }
      
      expect(differences).toBe(1); // Should change exactly 1 byte for uint8 field
    });

    it('should produce identical output for identical input', () => {
      const vehicle = createTestVehicle();
      const data1 = writeVehicleList([vehicle], true);
      const data2 = writeVehicleList([{ ...vehicle }], true);
      
      expect(data1).toEqual(data2);
    });
  });
}); 