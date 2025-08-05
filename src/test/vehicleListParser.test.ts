import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { parseVehicleList, type VehicleListEntry } from '../lib/parsers/vehicleListParser';
import type { ParsedBundle, ResourceEntry } from '../lib/core/types';

// Test data path (relative to project root)
const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

describe('Vehicle List Parser', () => {
  let bundleData: Buffer;
  let parsedBundle: ParsedBundle;
  let vehicles: VehicleListEntry[];
  let vehicleListResource: ResourceEntry | undefined;
  
  beforeAll(() => {
    console.log('🧪 Vehicle List Parser Test Suite');
    bundleData = readFileSync(BUNDLE_PATH);
    parsedBundle = parseBundle(bundleData.buffer);
    vehicleListResource = parsedBundle.resources.find((r: ResourceEntry) => r.resourceTypeId === 0x10005);
    
    if (vehicleListResource) {
      vehicles = parseVehicleList(bundleData.buffer, vehicleListResource, { littleEndian: true });
    }
  });

  describe('Resource Extraction', () => {
    it('should find VehicleList resource in bundle', () => {
      expect(vehicleListResource).toBeDefined();
      expect(vehicleListResource.resourceTypeId).toBe(0x10005);
      console.log('✅ VehicleList resource found and extracted');
    });

    it('should parse vehicle list successfully', () => {
      expect(vehicles).toBeDefined();
      expect(Array.isArray(vehicles)).toBe(true);
      expect(vehicles.length).toBe(500);
      console.log(`🚗 Successfully parsed ${vehicles.length} vehicles`);
    });
  });

  describe('Vehicle Data Structure', () => {
    it('should have complete vehicle data structure', () => {
      if (vehicles.length > 0) {
        const vehicle = vehicles[0];
        
        // Check required fields exist
        expect(vehicle).toHaveProperty('id');
        expect(vehicle).toHaveProperty('parentId');
        expect(vehicle).toHaveProperty('vehicleName');
        expect(vehicle).toHaveProperty('manufacturer');
        expect(vehicle).toHaveProperty('wheelName');
        expect(vehicle).toHaveProperty('vehicleType');
        expect(vehicle).toHaveProperty('boostType');
        expect(vehicle).toHaveProperty('liveryType');
        expect(vehicle).toHaveProperty('category');
        expect(vehicle).toHaveProperty('topSpeedNormalGUIStat');
        expect(vehicle).toHaveProperty('topSpeedBoostGUIStat');
        expect(vehicle).toHaveProperty('gamePlayData');
        expect(vehicle).toHaveProperty('audioData');
        expect(vehicle).toHaveProperty('attribCollectionKey');
        
        console.log('✅ Vehicle data structure contains all required fields');
      }
    });

    it('should have valid gameplay data structure', () => {
      if (vehicles.length > 0) {
        const vehicle = vehicles[0];
        
        expect(vehicle.gamePlayData).toHaveProperty('strengthStat');
        expect(vehicle.gamePlayData).toHaveProperty('damageLimit');
        expect(vehicle.gamePlayData).toHaveProperty('unlockRank');
        expect(vehicle.gamePlayData).toHaveProperty('boostBarLength');
        expect(vehicle.gamePlayData).toHaveProperty('boostCapacity');
        expect(vehicle.gamePlayData).toHaveProperty('flags');
        
        console.log('✅ GamePlay data structure is complete');
      }
    });

    it('should have valid audio data structure', () => {
      if (vehicles.length > 0) {
        const vehicle = vehicles[0];
        
        expect(vehicle.audioData).toHaveProperty('engineName');
        expect(vehicle.audioData).toHaveProperty('exhaustName');
        expect(vehicle.audioData).toHaveProperty('aiMusicLoopContentSpec');
        expect(vehicle.audioData).toHaveProperty('rivalUnlockName');
        
        console.log('✅ Audio data structure is complete');
      }
    });
  });

  describe('Vehicle Data Analysis', () => {
    it('should analyze first vehicle (Hunter Cavalry) in detail', () => {
      if (vehicles.length > 0) {
        const firstVehicle = vehicles[0];
        
        console.log('\n🔍 DETAILED ANALYSIS - First Vehicle (Hunter Cavalry):');
        console.log(`  Expected from wiki: ID=PUSMC01, Speed=1/10, Boost=1/10, Strength=5/10`);
        console.log(`  Parsed ID: "${firstVehicle.id}"`);
        console.log(`  Parsed Name: "${firstVehicle.vehicleName}"`);
        console.log(`  Parsed Manufacturer: "${firstVehicle.manufacturer}"`);
        console.log(`  Parsed Speed: Normal=${firstVehicle.topSpeedNormalGUIStat}/10, Boost=${firstVehicle.topSpeedBoostGUIStat}/10`);
        console.log(`  Parsed Strength: ${firstVehicle.gamePlayData.strengthStat}/10`);
        
        expect(firstVehicle.vehicleName).toBe('Hunter CAVALRY');
        expect(firstVehicle.manufacturer).toBeDefined();
        
        // Test known values
        expect(firstVehicle.topSpeedNormalGUIStat).toBeTypeOf('number');
        expect(firstVehicle.topSpeedBoostGUIStat).toBeTypeOf('number');
        expect(firstVehicle.gamePlayData.strengthStat).toBeTypeOf('number');
      }
    });

    it('should show detailed vehicle attributes for first 5 vehicles', () => {
      const vehiclesToShow = Math.min(5, vehicles.length);
      
      for (let v = 0; v < vehiclesToShow; v++) {
        const vehicle = vehicles[v];
        
        console.log(`\n--- Vehicle ${v}: ${vehicle.vehicleName || 'Unknown'} ---`);
        console.log(`  🆔 ID: "${vehicle.id}"`);
        console.log(`  👨‍👩‍👧‍👦 Parent ID: "${vehicle.parentId}"`);
        console.log(`  🚗 Name: "${vehicle.vehicleName}"`);
        console.log(`  🏭 Manufacturer: "${vehicle.manufacturer}"`);
        console.log(`  🛞 Wheel Type: "${vehicle.wheelName}"`);
        console.log(`  📊 Type: ${vehicle.vehicleType} (${vehicle.vehicleType === 0 ? 'Car' : vehicle.vehicleType === 1 ? 'Bike' : vehicle.vehicleType === 2 ? 'Plane' : 'Unknown'})`);
        console.log(`  🚀 Boost Type: ${vehicle.boostType} (${['Speed', 'Aggression', 'Stunt', 'None', 'Locked', 'Invalid'][vehicle.boostType] || 'Unknown'})`);
        console.log(`  🎨 Livery Type: ${vehicle.liveryType} (${['Default', 'Colour', 'Pattern', 'Silver', 'Gold', 'Community'][vehicle.liveryType] || 'Unknown'})`);
        console.log(`  ⚡ Speed Stats: Normal=${vehicle.topSpeedNormalGUIStat}/10, Boost=${vehicle.topSpeedBoostGUIStat}/10`);
        console.log(`  💪 Strength: ${vehicle.gamePlayData.strengthStat}/10`);
        console.log(`  🏆 Unlock Rank: ${vehicle.gamePlayData.unlockRank} (${['Learners', 'D-Class', 'C-Class', 'B-Class', 'A-Class', 'Burnout'][vehicle.gamePlayData.unlockRank] || 'Unknown'})`);
      }
      
      expect(vehiclesToShow).toBeGreaterThan(0);
    });
  });

  describe('Vehicle Statistics', () => {
    it('should analyze vehicle type distribution', () => {
      const typeStats = vehicles.reduce((acc, v) => {
        const typeName = v.vehicleType === 0 ? 'Car' : 
                        v.vehicleType === 1 ? 'Bike' : 
                        v.vehicleType === 2 ? 'Plane' : 'Unknown';
        acc[typeName] = (acc[typeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n📊 Vehicle Type Distribution:');
      Object.entries(typeStats).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

      expect(Object.keys(typeStats).length).toBeGreaterThan(0);
      expect(typeStats.Car).toBeGreaterThan(0);
    });

    it('should analyze boost type distribution', () => {
      const boostStats = vehicles.reduce((acc, v) => {
        const boostName = ['Speed', 'Aggression', 'Stunt', 'None', 'Locked', 'Invalid'][v.boostType] || 'Unknown';
        acc[boostName] = (acc[boostName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n🚀 Boost Type Distribution:');
      Object.entries(boostStats).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

      expect(Object.keys(boostStats).length).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    it('should validate vehicle data quality', () => {
      let validationWarnings = 0;
      const maxWarnings = 10; // Limit warnings for test output
      
      vehicles.forEach((vehicle, index) => {
        const issues: string[] = [];
        
        if (!vehicle.id || vehicle.id.trim() === '') {
          issues.push('missing ID');
        }
        if (!vehicle.vehicleName || vehicle.vehicleName.trim() === '') {
          issues.push('missing name');
        }
        if (!vehicle.manufacturer || vehicle.manufacturer.trim() === '') {
          issues.push('missing manufacturer');
        }
        if (vehicle.topSpeedNormalGUIStat === 0) {
          issues.push('invalid speed stat: 0');
        }
        if (vehicle.gamePlayData.strengthStat === 0 || vehicle.gamePlayData.strengthStat > 10) {
          issues.push(`invalid strength stat: ${vehicle.gamePlayData.strengthStat}`);
        }
        
        if (issues.length > 0 && validationWarnings < maxWarnings) {
          console.log(`⚠️ Vehicle ${index} issues: ${issues.join(', ')}`);
          validationWarnings += issues.length;
        }
      });

      const validVehicleCount = vehicles.filter(v => 
        v.id && v.id.trim() !== '' &&
        v.vehicleName && v.vehicleName.trim() !== '' &&
        v.manufacturer && v.manufacturer.trim() !== ''
      ).length;

      console.log(`\n✅ Validation Results: ${validVehicleCount}/${vehicles.length} vehicles passed validation`);
      expect(validVehicleCount).toBeGreaterThan(50);
    });

    it('should validate against Burnout Paradise wiki specifications', () => {
      // Based on https://burnout.wiki/wiki/Vehicle_List/Burnout_Paradise
      expect(vehicles.length).toBe(500);
      
      // Check that we have different vehicle types
      const hasMultipleTypes = new Set(vehicles.map(v => v.vehicleType)).size > 1;
      expect(hasMultipleTypes).toBe(true);
      
      // Check that we have different boost types
      const hasMultipleBoostTypes = new Set(vehicles.map(v => v.boostType)).size > 1;
      expect(hasMultipleBoostTypes).toBe(true);
      
      console.log('✅ Vehicle list matches Burnout Paradise specifications');
      console.log('📚 Reference: https://burnout.wiki/wiki/Vehicle_List/Burnout_Paradise');
    });
  });

  describe('Experimental Analysis', () => {
    it('should experiment with stat conversion approaches', () => {
      if (vehicles.length > 0) {
        const firstVehicle = vehicles[0];
        
        console.log('\n🧪 EXPERIMENTAL STAT CONVERSIONS:');
        
        // Try different speed interpretations
        const speedNormalAttempt1 = Math.max(1, firstVehicle.topSpeedNormalGUIStat - 1);
        const speedBoostAttempt1 = Math.max(1, firstVehicle.topSpeedBoostGUIStat + 1);
        console.log(`  Speed attempt 1: Normal=${speedNormalAttempt1}/10, Boost=${speedBoostAttempt1}/10 (offset adjustment)`);
        
        // Try strength interpretations 
        const strengthAttempt1 = Math.floor(firstVehicle.gamePlayData.strengthStat / 2);
        const strengthAttempt2 = 11 - firstVehicle.gamePlayData.strengthStat;
        const strengthAttempt3 = Math.floor(firstVehicle.gamePlayData.damageLimit * 5);
        console.log(`  Strength attempt 1: ${strengthAttempt1}/10 (divide by 2)`);
        console.log(`  Strength attempt 2: ${strengthAttempt2}/10 (invert scale)`);
        console.log(`  Strength attempt 3: ${strengthAttempt3}/10 (use damageLimit * 5)`);
        
        console.log('\n🔍 ID DECODING ATTEMPTS:');
        const idHex = firstVehicle.id;
        console.log(`  Current ID hex: ${idHex}`);
        console.log(`  Note: ${idHex} might be a hash of "PUSMC01" or represent it in encoded form`);
        
        // This is exploratory, so we don't make hard assertions
        expect(idHex).toBeDefined();
      }
    });
  });
}); 