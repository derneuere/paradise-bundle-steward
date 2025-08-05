#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseBundle, extractResourceSize } from './src/lib/bundleParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color: string, message: string) {
  console.log(`${colors[color as keyof typeof colors]}${message}${colors.reset}`);
}

function logHeader(message: string) {
  console.log(`\n${colors.bold}${colors.blue}=== ${message} ===${colors.reset}`);
}

async function debugPlayerCarColours() {
  const bundlePath = join(__dirname, 'example', 'VEHICLELIST.BUNDLE');
  const bundleData = readFileSync(bundlePath);
  
  logHeader('Debug PlayerCarColours Resource Structure');
  
  // Parse bundle
  const bundle = parseBundle(bundleData.buffer);
  
  log('blue', `Bundle contains ${bundle.resources.length} resources:`);
  bundle.resources.forEach((res, idx) => {
    log('blue', `  Resource ${idx}: Type=0x${res.resourceTypeId.toString(16).padStart(8, '0')}, ID=0x${res.resourceId.toString(16)}`);
    
    if (res.resourceTypeId === 0x1001E) {
      log('green', '    ✅ This is PlayerCarColours!');
    } else if (res.resourceTypeId === 0x10005) {
      log('yellow', '    📋 This is VehicleList');
    }
  });
  
  // Find PlayerCarColours resource (0x1001E)
  const playerCarColoursResource = bundle.resources.find(r => r.resourceTypeId === 0x1001E);
  
  if (!playerCarColoursResource) {
    log('red', '❌ No PlayerCarColours resource found in this bundle');
    log('yellow', 'Available resource types:');
    bundle.resources.forEach(res => {
      log('yellow', `  - 0x${res.resourceTypeId.toString(16).padStart(8, '0')}`);
    });
    return;
  }
  
  logHeader('PlayerCarColours Resource Details');
  log('green', `Resource ID: 0x${playerCarColoursResource.resourceId.toString(16)}`);
  log('green', `Resource Type ID: 0x${playerCarColoursResource.resourceTypeId.toString(16)} (PlayerCarColours)`);
  
  // Get the raw resource data
  let resourceData: Uint8Array | null = null;
  let dataOffset = 0;
  
  for (let i = 0; i < 3; i++) {
    const size = extractResourceSize(playerCarColoursResource.sizeAndAlignmentOnDisk[i]);
    if (size > 0) {
      dataOffset = playerCarColoursResource.diskOffsets[i];
      resourceData = new Uint8Array(bundleData.buffer, dataOffset, size);
      log('blue', `Found data at offset 0x${dataOffset.toString(16)}, size=${size} bytes`);
      break;
    }
  }
  
  if (!resourceData) {
    log('red', '❌ No resource data found');
    return;
  }
  
  logHeader('Raw Data Analysis');
  
  // Check if it's a nested bundle
  const magic = new TextDecoder().decode(resourceData.subarray(0, 4));
  log('blue', `First 4 bytes as string: "${magic}"`);
  
  if (magic === 'bnd2') {
    log('yellow', '🔍 This is a nested bundle - extracting...');
    
    // Parse the nested bundle
    const nestedBuffer = resourceData.buffer.slice(resourceData.byteOffset, resourceData.byteOffset + resourceData.byteLength);
    const nestedBundle = parseBundle(nestedBuffer);
    
    log('blue', '\nNested Bundle Analysis:');
    log('blue', `  Resource count: ${nestedBundle.header.resourceEntriesCount}`);
    log('blue', `  Resource entries offset: 0x${nestedBundle.header.resourceEntriesOffset.toString(16)}`);
    log('blue', `  Resource data offsets: [${nestedBundle.header.resourceDataOffsets.map(o => `0x${o.toString(16)}`).join(', ')}]`);
    
    nestedBundle.resources.forEach((res, idx) => {
      log('blue', `\nNested Resource ${idx}:`);
      log('blue', `  Type: 0x${res.resourceTypeId.toString(16)}`);
      log('blue', `  ID: 0x${res.resourceId.toString(16)}`);
      log('blue', `  Disk Offsets: [${res.diskOffsets.map(o => `0x${o.toString(16)}`).join(', ')}]`);
      log('blue', `  Sizes: [${res.sizeAndAlignmentOnDisk.map(s => extractResourceSize(s)).join(', ')}]`);
    });
    
    // Find PlayerCarColours in nested bundle
    const nestedPlayerCarColours = nestedBundle.resources.find(r => r.resourceTypeId === 0x1001E);
    if (nestedPlayerCarColours) {
      log('green', '\n✅ Found PlayerCarColours in nested bundle!');
      
      // Extract the actual data
      for (let i = 0; i < 3; i++) {
        const size = extractResourceSize(nestedPlayerCarColours.sizeAndAlignmentOnDisk[i]);
        if (size > 0) {
          const offset = nestedPlayerCarColours.diskOffsets[i];
          log('blue', `PlayerCarColours data: offset=0x${offset.toString(16)}, size=${size} bytes`);
          
          if (offset < nestedBuffer.byteLength) {
            resourceData = new Uint8Array(nestedBuffer, offset, size);
            dataOffset = offset;
            break;
          }
        }
      }
    } else {
      log('red', '❌ No PlayerCarColours found in nested bundle');
      return;
    }
  }
  
  if (!resourceData) {
    log('red', '❌ Could not extract PlayerCarColours data');
    return;
  }
  
  // Check for compression
  const isCompressed = resourceData.length >= 2 && resourceData[0] === 0x78;
  log('blue', `Compression: ${isCompressed ? '✅ Zlib compressed' : '❌ Not compressed'}`);
  
  if (isCompressed) {
    log('yellow', '⚠️  Data is compressed - need to decompress first for analysis');
    
    // Try to decompress (basic check)
    try {
      const pako = await import('pako');
      const decompressed = pako.inflate(resourceData);
      log('green', `✅ Decompression successful: ${resourceData.length} -> ${decompressed.length} bytes`);
      resourceData = decompressed;
    } catch (error) {
      log('red', `❌ Decompression failed: ${error}`);
      return;
    }
  }
  
  logHeader('Structure Analysis');
  
  log('blue', `Final data length: ${resourceData.length} bytes`);
  log('blue', `Expected structure sizes:`);
  log('blue', `  32-bit: 0x3C (60) bytes = 5 palettes * 12 bytes`);
  log('blue', `  64-bit: 0x78 (120) bytes = 5 palettes * 24 bytes`);
  
  const is32BitSize = resourceData.length >= 60;
  const is64BitSize = resourceData.length >= 120;
  log('blue', `Size compatibility: 32-bit=${is32BitSize ? '✅' : '❌'}, 64-bit=${is64BitSize ? '✅' : '❌'}`);
  
  // Show raw hex data
  log('blue', '\nRaw data (first 128 bytes):');
  for (let i = 0; i < Math.min(128, resourceData.length); i += 16) {
    const chunk = resourceData.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('');
    console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(47)} |${ascii}|`);
  }
  
  logHeader('Structure Parsing Tests');
  
  // Test different parsing configurations
  const configurations = [
    { name: '32-bit Little Endian', is64Bit: false, littleEndian: true },
    { name: '32-bit Big Endian', is64Bit: false, littleEndian: false },
    { name: '64-bit Little Endian', is64Bit: true, littleEndian: true },
    { name: '64-bit Big Endian', is64Bit: true, littleEndian: false }
  ];
  
  configurations.forEach(config => {
    log('yellow', `\n🧪 Testing ${config.name}:`);
    
    try {
      const view = new DataView(resourceData.buffer, resourceData.byteOffset, resourceData.byteLength);
      
      if (config.is64Bit) {
        // 64-bit structure: 5 palettes * 24 bytes each
        for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
          const baseOffset = paletteIndex * 24;
          
          if (baseOffset + 24 <= resourceData.length) {
            // mpPaintColours (8 bytes), mpPearlColours (8 bytes), miNumColours (4 bytes), padding (4 bytes)
            const paintColorsPtr = config.littleEndian ? 
              view.getBigUint64(baseOffset, true) : 
              view.getBigUint64(baseOffset, false);
            const pearlColorsPtr = config.littleEndian ? 
              view.getBigUint64(baseOffset + 8, true) : 
              view.getBigUint64(baseOffset + 8, false);
            const numColors = config.littleEndian ? 
              view.getUint32(baseOffset + 16, true) : 
              view.getUint32(baseOffset + 16, false);
            
            log('blue', `  Palette ${paletteIndex}: numColors=${numColors}, paintPtr=0x${paintColorsPtr.toString(16)}, pearlPtr=0x${pearlColorsPtr.toString(16)}`);
            
            if (numColors > 0 && numColors <= 1000) {
              log('green', `    ✅ Valid color count: ${numColors}`);
            } else {
              log('red', `    ❌ Invalid color count: ${numColors}`);
            }
          }
        }
      } else {
        // 32-bit structure: 5 palettes * 12 bytes each
        for (let paletteIndex = 0; paletteIndex < 5; paletteIndex++) {
          const baseOffset = paletteIndex * 12;
          
          if (baseOffset + 12 <= resourceData.length) {
            // mpPaintColours (4 bytes), mpPearlColours (4 bytes), miNumColours (4 bytes)
            const paintColorsPtr = config.littleEndian ? 
              view.getUint32(baseOffset, true) : 
              view.getUint32(baseOffset, false);
            const pearlColorsPtr = config.littleEndian ? 
              view.getUint32(baseOffset + 4, true) : 
              view.getUint32(baseOffset + 4, false);
            const numColors = config.littleEndian ? 
              view.getUint32(baseOffset + 8, true) : 
              view.getUint32(baseOffset + 8, false);
            
            log('blue', `  Palette ${paletteIndex}: numColors=${numColors}, paintPtr=0x${paintColorsPtr.toString(16)}, pearlPtr=0x${pearlColorsPtr.toString(16)}`);
            
            if (numColors > 0 && numColors <= 1000) {
              log('green', `    ✅ Valid color count: ${numColors}`);
            } else {
              log('red', `    ❌ Invalid color count: ${numColors}`);
            }
          }
        }
      }
    } catch (error) {
      log('red', `  ❌ Parsing failed: ${error}`);
    }
  });
  
  logHeader('Color Data Analysis');
  
  // Look for actual color data after the palette headers
  const headerSize32 = 60;  // 5 * 12
  const headerSize64 = 120; // 5 * 24
  
  [headerSize32, headerSize64].forEach((headerSize, idx) => {
    const structureType = idx === 0 ? '32-bit' : '64-bit';
    log('yellow', `\n🎨 Looking for color data after ${structureType} header (offset ${headerSize}):`);
    
    if (headerSize < resourceData.length) {
      const colorDataStart = headerSize;
      const remainingBytes = resourceData.length - headerSize;
      log('blue', `  Remaining data: ${remainingBytes} bytes`);
      
      // Assume each color is 16 bytes (4 floats * 4 bytes)
      const possibleColors = Math.floor(remainingBytes / 16);
      log('blue', `  Possible colors (16 bytes each): ${possibleColors}`);
      
      // Show first few potential colors
      for (let colorIdx = 0; colorIdx < Math.min(5, possibleColors); colorIdx++) {
        const colorOffset = colorDataStart + (colorIdx * 16);
        const view = new DataView(resourceData.buffer, resourceData.byteOffset + colorOffset, 16);
        
        // Try both endiannesses
        const redLE = view.getFloat32(0, true);
        const greenLE = view.getFloat32(4, true);
        const blueLE = view.getFloat32(8, true);
        const alphaLE = view.getFloat32(12, true);
        
        const redBE = view.getFloat32(0, false);
        const greenBE = view.getFloat32(4, false);
        const blueBE = view.getFloat32(8, false);
        const alphaBE = view.getFloat32(12, false);
        
        log('blue', `  Color ${colorIdx}:`);
        log('blue', `    LE: R=${redLE.toFixed(3)}, G=${greenLE.toFixed(3)}, B=${blueLE.toFixed(3)}, A=${alphaLE.toFixed(3)}`);
        log('blue', `    BE: R=${redBE.toFixed(3)}, G=${greenBE.toFixed(3)}, B=${blueBE.toFixed(3)}, A=${alphaBE.toFixed(3)}`);
        
        // Check if values look reasonable (0.0-1.0 range, though neon colors can exceed)
        const validLE = [redLE, greenLE, blueLE, alphaLE].every(v => !isNaN(v) && v >= -10 && v <= 10);
        const validBE = [redBE, greenBE, blueBE, alphaBE].every(v => !isNaN(v) && v >= -10 && v <= 10);
        
        if (validLE) log('green', `    LE values look reasonable`);
        if (validBE) log('green', `    BE values look reasonable`);
      }
    } else {
      log('red', `  ❌ Not enough data for color values`);
    }
  });
  
  logHeader('Summary & Recommendations');
  
  log('blue', '📋 Findings:');
  log('blue', `  • Data length: ${resourceData.length} bytes`);
  log('blue', `  • Compression: ${isCompressed ? 'Yes (zlib)' : 'No'}`);
  log('blue', `  • Nested bundle: ${magic === 'bnd2' ? 'Yes' : 'No'}`);
  
  log('green', '\n💡 Next steps for parser:');
  log('green', '  1. Test different endianness configurations');
  log('green', '  2. Validate structure size detection');
  log('green', '  3. Implement proper color data reading after headers');
  log('green', '  4. Handle pointer dereferencing vs sequential data');
}

// Run the debug analysis
debugPlayerCarColours().catch(console.error); 