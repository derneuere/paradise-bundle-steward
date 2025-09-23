#!/usr/bin/env node

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function debugBundleHeaders() {
  const exampleDir = join(__dirname, '../example');
  const originalFile = join(exampleDir, 'VEHICLELIST.BUNDLE');
  const modifiedFile = join(exampleDir, 'modified_bundle.bundle');

  console.log('\n======================================');
  console.log('BUNDLE FILE HEXDUMP COMPARISON');
  console.log('======================================');

  try {
    // Read both files
    const originalBuffer = readFileSync(originalFile);
    const modifiedBuffer = readFileSync(modifiedFile);
    
    console.log(`\nFile Sizes:`);
    console.log(`  Original: ${originalBuffer.length} bytes`);
    console.log(`  Modified: ${modifiedBuffer.length} bytes`);
    console.log(`  Size Match: ${originalBuffer.length === modifiedBuffer.length ? '✓' : '✗'}`);

    // Compare Bundle V2 headers (first 40 bytes)
    const headerSize = 40;
    console.log(`\n=== BUNDLE HEADER HEXDUMP (First ${headerSize} bytes) ===`);
    
    console.log(`\nOriginal (${originalFile}):`);
    console.log(createHexDump(originalBuffer.subarray(0, headerSize)));
    
    console.log(`\nModified (${modifiedFile}):`);
    console.log(createHexDump(modifiedBuffer.subarray(0, headerSize)));

    // Parse headers
    const originalHeader = parseHeader(originalBuffer);
    const modifiedHeader = parseHeader(modifiedBuffer);

    console.log('\n=== PARSED HEADER FIELDS ===');
    logHeaderComparison('Magic Number', originalHeader.magic, modifiedHeader.magic);
    logHeaderComparison('Version', originalHeader.version.toString(), modifiedHeader.version.toString());
    logHeaderComparison('Platform', getPlatformName(originalHeader.platform), getPlatformName(modifiedHeader.platform));
    logHeaderComparison('Debug Data Offset', `0x${originalHeader.debugDataOffset.toString(16)}`, `0x${modifiedHeader.debugDataOffset.toString(16)}`);
    logHeaderComparison('Resource Entries Count', originalHeader.resourceEntriesCount.toString(), modifiedHeader.resourceEntriesCount.toString());
    logHeaderComparison('Resource Entries Offset', `0x${originalHeader.resourceEntriesOffset.toString(16)}`, `0x${modifiedHeader.resourceEntriesOffset.toString(16)}`);
    logHeaderComparison('Resource Data Offset[0]', `0x${originalHeader.resourceDataOffsets[0].toString(16)}`, `0x${modifiedHeader.resourceDataOffsets[0].toString(16)}`);
    logHeaderComparison('Resource Data Offset[1]', `0x${originalHeader.resourceDataOffsets[1].toString(16)}`, `0x${modifiedHeader.resourceDataOffsets[1].toString(16)}`);
    logHeaderComparison('Resource Data Offset[2]', `0x${originalHeader.resourceDataOffsets[2].toString(16)}`, `0x${modifiedHeader.resourceDataOffsets[2].toString(16)}`);
    logHeaderComparison('Flags', `0x${originalHeader.flags.toString(16)} (${getFlagNames(originalHeader.flags)})`, `0x${modifiedHeader.flags.toString(16)} (${getFlagNames(modifiedHeader.flags)})`);

    // Find byte differences in header
    const headerDiffs = findBytesDifferences(originalBuffer.subarray(0, headerSize), modifiedBuffer.subarray(0, headerSize));
    
    if (headerDiffs.length > 0) {
      console.log(`\n=== HEADER BYTE DIFFERENCES (${headerDiffs.length} bytes) ===`);
      console.log('Offset | Original | Modified | Description');
      console.log('-------|----------|----------|------------');
      headerDiffs.forEach(diff => {
        const fieldDesc = getFieldDescription(diff.offset);
        console.log(`0x${diff.offset.toString(16).padStart(4, '0')} | 0x${diff.original.toString(16).padStart(6, '0')} | 0x${diff.modified.toString(16).padStart(6, '0')} | ${fieldDesc}`);
      });
    } else {
      console.log('\n✓ Headers are byte-for-byte identical!');
    }

    // Full file comparison
    const filesIdentical = originalBuffer.equals(modifiedBuffer);
    console.log(`\n=== FULL FILE COMPARISON ===`);
    console.log(`Files identical: ${filesIdentical ? '✓ YES' : '✗ NO'}`);
    
    if (!filesIdentical) {
      const firstDiff = findFirstDifference(originalBuffer, modifiedBuffer);
      if (firstDiff !== -1) {
        console.log(`First difference at byte: 0x${firstDiff.toString(16)} (${firstDiff})`);
        
        // Show context around first difference
        const contextStart = Math.max(0, firstDiff - 8);
        const contextEnd = Math.min(Math.min(originalBuffer.length, modifiedBuffer.length), firstDiff + 16);
        
        console.log(`\nContext around first difference (0x${contextStart.toString(16)}-0x${contextEnd.toString(16)}):`);
        console.log('Original:');
        console.log(createHexDump(originalBuffer.subarray(contextStart, contextEnd), contextStart));
        console.log('Modified:');
        console.log(createHexDump(modifiedBuffer.subarray(contextStart, contextEnd), contextStart));
      }
    }

    console.log('\n======================================\n');

    // Summary
    console.log('=== SUMMARY ===');
    console.log(`✓ Headers parsed successfully`);
    console.log(`✓ Magic numbers: ${originalHeader.magic} / ${modifiedHeader.magic}`);
    console.log(`${filesIdentical ? '✓' : '✗'} Files are ${filesIdentical ? 'identical' : 'different'}`);

  } catch (error) {
    console.error('Error reading or processing bundle files:', error);
    process.exit(1);
  }
}

function createHexDump(buffer: Buffer, offset: number = 0): string {
  const lines: string[] = [];
  
  for (let i = 0; i < buffer.length; i += 16) {
    const addr = (offset + i).toString(16).padStart(8, '0');
    const chunk = buffer.subarray(i, Math.min(i + 16, buffer.length));
    
    // Create hex representation
    const hex1 = Array.from(chunk.subarray(0, 8))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    const hex2 = Array.from(chunk.subarray(8))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    
    const hexPart = `${hex1.padEnd(23, ' ')} ${hex2.padEnd(23, ' ')}`;
    
    // Create ASCII representation
    const ascii = Array.from(chunk)
      .map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
      .join('');
    
    lines.push(`${addr}  ${hexPart} |${ascii}|`);
  }
  
  return lines.join('\n');
}

function parseHeader(buffer: Buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  return {
    magic: buffer.subarray(0, 4).toString('ascii'),
    version: view.getUint32(0x4, true),
    platform: view.getUint32(0x8, true),
    debugDataOffset: view.getUint32(0xC, true),
    resourceEntriesCount: view.getUint32(0x10, true),
    resourceEntriesOffset: view.getUint32(0x14, true),
    resourceDataOffsets: [
      view.getUint32(0x18, true),
      view.getUint32(0x1C, true),
      view.getUint32(0x20, true)
    ],
    flags: view.getUint32(0x24, true)
  };
}

function getPlatformName(platform: number): string {
  switch (platform) {
    case 1: return 'PC/DX9';
    case 2: return 'Xbox 360';
    case 3: return 'PlayStation 3';
    default: return `Unknown (${platform})`;
  }
}

function getFlagNames(flags: number): string {
  const flagNames: string[] = [];
  if (flags & 0x1) flagNames.push('COMPRESSED');
  if (flags & 0x2) flagNames.push('MAIN_MEM_OPTIMISED');
  if (flags & 0x4) flagNames.push('GRAPHICS_MEM_OPTIMISED');
  if (flags & 0x8) flagNames.push('HAS_DEBUG_DATA');
  return flagNames.length > 0 ? flagNames.join(', ') : 'None';
}

function getFieldDescription(offset: number): string {
  if (offset >= 0x0 && offset <= 0x3) return 'Magic Number';
  if (offset >= 0x4 && offset <= 0x7) return 'Version';
  if (offset >= 0x8 && offset <= 0xB) return 'Platform';
  if (offset >= 0xC && offset <= 0xF) return 'Debug Data Offset';
  if (offset >= 0x10 && offset <= 0x13) return 'Resource Entries Count';
  if (offset >= 0x14 && offset <= 0x17) return 'Resource Entries Offset';
  if (offset >= 0x18 && offset <= 0x1B) return 'Resource Data Offset[0]';
  if (offset >= 0x1C && offset <= 0x1F) return 'Resource Data Offset[1]';
  if (offset >= 0x20 && offset <= 0x23) return 'Resource Data Offset[2]';
  if (offset >= 0x24 && offset <= 0x27) return 'Flags';
  return 'Unknown field';
}

function logHeaderComparison(field: string, original: string, modified: string) {
  const match = original === modified ? '✓' : '✗';
  console.log(`${field.padEnd(25)} | ${original.padEnd(12)} | ${modified.padEnd(12)} | ${match}`);
}

function findBytesDifferences(buffer1: Buffer, buffer2: Buffer): Array<{offset: number, original: number, modified: number}> {
  const differences: Array<{offset: number, original: number, modified: number}> = [];
  const minLength = Math.min(buffer1.length, buffer2.length);
  
  for (let i = 0; i < minLength; i++) {
    if (buffer1[i] !== buffer2[i]) {
      differences.push({
        offset: i,
        original: buffer1[i],
        modified: buffer2[i]
      });
    }
  }
  
  return differences;
}

function findFirstDifference(buffer1: Buffer, buffer2: Buffer): number {
  const minLength = Math.min(buffer1.length, buffer2.length);
  
  for (let i = 0; i < minLength; i++) {
    if (buffer1[i] !== buffer2[i]) {
      return i;
    }
  }
  
  // If all bytes are the same but lengths differ
  if (buffer1.length !== buffer2.length) {
    return minLength;
  }
  
  return -1; // Files are identical
}

// Run the debug function
debugBundleHeaders();