#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from './src/lib/parsers/bundleParser';
import { parseVehicleList } from './src/lib/parsers/vehicleListParser';
import { writeVehicleList } from './src/lib/parsers/vehicleListWriter';
import { BundleBuilder } from './src/lib/core/bundleWriter';
import { getResourceData } from './src/lib/core/resourceManager';
import { PLATFORMS } from './src/lib/core/types';
import { RESOURCE_TYPES } from './src/lib/resourceTypes';

async function testBundleExport() {
  const bundlePath = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

  console.log('🧪 Testing vehicle list round-trip with fixed encryption...');

  // Load and parse original bundle
  const bundleData = readFileSync(bundlePath);
  const parsedBundle = parseBundle(bundleData.buffer);

  // Find vehicle list resource
  const vehicleType = Object.values(RESOURCE_TYPES).find(rt => rt.name === 'Vehicle List');
  if (!vehicleType) {
    console.error('❌ Could not find vehicle list resource type');
    return;
  }

  const vehicleResource = parsedBundle.resources.find(r => r.resourceTypeId === vehicleType.id);
  if (!vehicleResource) {
    console.error('❌ Could not find vehicle list resource');
    return;
  }

  console.log('🚗 Found vehicle list resource');

  // Get the original decompressed data
  const resourceContext = {
    bundle: parsedBundle,
    resource: vehicleResource,
    buffer: bundleData.buffer
  };
  const { data: originalDecompressedData } = getResourceData(resourceContext);
  console.log(`📦 Original decompressed vehicle list size: ${originalDecompressedData.length} bytes`);

  // Parse vehicle list
  const vehicles = parseVehicleList(bundleData.buffer, vehicleResource, { littleEndian: true });
  console.log(`📖 Parsed ${vehicles.length} vehicles`);

  // Write vehicle list back
  const littleEndian = parsedBundle.header.platform !== PLATFORMS.PS3;
  const compress = (parsedBundle.header.flags & 0x1) !== 0;
  console.log(`🔧 Writing with: littleEndian=${littleEndian}, compress=${compress}`);

  const writtenData = writeVehicleList(vehicles, littleEndian, compress);
  console.log(`📝 Written vehicle list size: ${writtenData.length} bytes`);

  // Compare sizes
  const sizeDifference = writtenData.length - originalDecompressedData.length;
  console.log(`\n📊 Size comparison:`);
  console.log(`  Original: ${originalDecompressedData.length} bytes`);
  console.log(`  Written:  ${writtenData.length} bytes`);
  console.log(`  Difference: ${sizeDifference} bytes`);

  if (Math.abs(sizeDifference) <= 1) {
    console.log('✅ SUCCESS: Vehicle list sizes are nearly identical! Encryption fix worked.');
  } else if (Math.abs(sizeDifference) < 100) {
    console.log('⚠️ WARNING: Small size difference detected, but acceptable.');
  } else {
    console.log('❌ ISSUE: Significant size difference detected');

    // Save for debugging
    writeFileSync(join(process.cwd(), 'example', 'original_vehicle_data.bin'), originalDecompressedData);
    writeFileSync(join(process.cwd(), 'example', 'written_vehicle_data.bin'), writtenData);
    console.log('💾 Saved debug files for analysis');
  }

  // Test if the data can be parsed back
  console.log('\n🔄 Testing round-trip parsing...');
  try {
    // Create a fake resource entry for parsing the written data
    const fakeResource = {
      ...vehicleResource,
      uncompressedSizeAndAlignment: [writtenData.length, 0, 0],
      sizeAndAlignmentOnDisk: [writtenData.length, 0, 0]
    };

    const reparsedVehicles = parseVehicleList(writtenData.buffer, fakeResource, { littleEndian });
    console.log(`📖 Successfully re-parsed ${reparsedVehicles.length} vehicles from written data`);

    if (reparsedVehicles.length === vehicles.length) {
      console.log('✅ Round-trip parsing successful!');
    } else {
      console.log('❌ Round-trip parsing failed: vehicle count mismatch');
    }
  } catch (error) {
    console.log('❌ Round-trip parsing failed:', error);
  }
}

function extractResourceSize(sizeAndAlignment: number): number {
  return sizeAndAlignment & 0x0FFFFFFF;
}

function extractAlignment(sizeAndAlignment: number): number {
  return (sizeAndAlignment >> 28) & 0xF;
}

// Run the test
testBundleExport().catch(console.error);
