#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseBundle, extractResourceSize } from './src/lib/bundleParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function debugResource() {
  const bundlePath = join(__dirname, 'example', 'VEHICLELIST.BUNDLE');
  const bundleData = readFileSync(bundlePath);
  
  console.log('=== Debug Resource Structure ===');
  
  // Parse bundle
  const bundle = parseBundle(bundleData.buffer);
  
  // Find VehicleList resource
  const vehicleListResource = bundle.resources.find(r => r.resourceTypeId === 0x10005);
  
  if (!vehicleListResource) {
    console.log('No VehicleList resource found');
    return;
  }
  
  console.log('\nVehicleList Resource Details:');
  console.log('Resource ID:', vehicleListResource.resourceId.toString(16));
  console.log('Resource Type ID:', vehicleListResource.resourceTypeId.toString(16));
  
  // Get the raw resource data
  let resourceData: Uint8Array | null = null;
  let dataOffset = 0;
  
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(vehicleListResource.sizeAndAlignmentOnDisk[i]);
    if (size > 0) {
      dataOffset = vehicleListResource.diskOffsets[i];
      resourceData = new Uint8Array(bundleData.buffer, dataOffset, size);
      console.log(`\nFound data at offset 0x${dataOffset.toString(16)}, size=${size} bytes`);
      break;
    }
  }
  
  if (!resourceData) {
    console.log('No resource data found');
    return;
  }
  
  // Parse the nested bundle
  const nestedBuffer = resourceData.buffer.slice(resourceData.byteOffset, resourceData.byteOffset + resourceData.byteLength);
  const nestedBundle = parseBundle(nestedBuffer);
  
  console.log('\nNested Bundle Analysis:');
  console.log('Nested bundle header:');
  console.log('  Resource count:', nestedBundle.header.resourceEntriesCount);
  console.log('  Resource entries offset:', '0x' + nestedBundle.header.resourceEntriesOffset.toString(16));
  console.log('  Resource data offsets:', nestedBundle.header.resourceDataOffsets.map(o => '0x' + o.toString(16)));
  
  nestedBundle.resources.forEach((res, idx) => {
    console.log(`\nNested Resource ${idx}:`);
    console.log(`  Type: 0x${res.resourceTypeId.toString(16)}`);
    console.log(`  ID: 0x${res.resourceId.toString(16)}`);
    console.log(`  Disk Offsets: [${res.diskOffsets.map(o => `0x${o.toString(16)}`).join(', ')}]`);
    console.log(`  Sizes: [${res.sizeAndAlignmentOnDisk.map(s => extractResourceSize(s)).join(', ')}]`);
    
    // Try to extract data for each resource
    for (let i = 0; i < 3; i++) {
      const size = extractResourceSize(res.sizeAndAlignmentOnDisk[i]);
      if (size > 0) {
        const offset = res.diskOffsets[i];
        console.log(`  Data ${i}: offset=0x${offset.toString(16)}, size=${size}`);
        
        // Check what's at this offset in the nested buffer
        if (offset < nestedBuffer.byteLength) {
          const sampleData = new Uint8Array(nestedBuffer, offset, Math.min(32, size));
          console.log(`  First 32 bytes:`, Array.from(sampleData).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
          
          // Check if it looks like vehicle count data
          const view = new DataView(nestedBuffer, offset, Math.min(16, size));
          console.log(`  As uint32 LE: [${Array.from({length: Math.min(4, size/4)}, (_, i) => view.getUint32(i*4, true)).join(', ')}]`);
          
          // Check for compression markers
          if (sampleData.length >= 2) {
            const isZlib = sampleData[0] === 0x78;
            console.log(`  Compression: ${isZlib ? 'Likely zlib' : 'Not compressed'}`);
          }
        }
        
        break; // Only check first valid data block
      }
    }
  });
  
  // Now specifically look at the VehicleList resource in nested bundle
  const nestedVehicleList = nestedBundle.resources.find(r => r.resourceTypeId === 0x10005);
  if (nestedVehicleList) {
    console.log('\n=== VehicleList Resource in Nested Bundle ===');
    
    for (let i = 0; i < 3; i++) {
      const size = extractResourceSize(nestedVehicleList.sizeAndAlignmentOnDisk[i]);
      if (size > 0) {
        const offset = nestedVehicleList.diskOffsets[i];
        
        console.log(`VehicleList data block ${i}:`);
        console.log(`  Offset in nested bundle: 0x${offset.toString(16)} (${offset})`);
        console.log(`  Size: ${size} bytes`);
        console.log(`  Absolute offset in main file: 0x${(dataOffset + offset).toString(16)}`);
        
        // This is the actual vehicle list data - let's examine it carefully
        if (offset < nestedBuffer.byteLength) {
          const actualData = new Uint8Array(nestedBuffer, offset, Math.min(64, size));
          console.log(`  Raw data (first 64 bytes):`);
          for (let j = 0; j < actualData.length; j += 16) {
            const chunk = actualData.slice(j, j + 16);
            const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const ascii = Array.from(chunk).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
            console.log(`    ${(offset + j).toString(16).padStart(8, '0')}: ${hex.padEnd(47)} |${ascii}|`);
          }
        }
        
        break;
      }
    }
  }
}

debugResource(); 