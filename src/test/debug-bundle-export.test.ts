import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBundle } from '../lib/parsers/bundleParser';
import { BundleBuilder } from '../lib/core/bundleWriter';
import type { ParsedBundle } from '../lib/core/types';

const BUNDLE_PATH = join(process.cwd(), 'example', 'VEHICLELIST.BUNDLE');

describe('Debug Bundle Export', () => {
  let originalBundleData: Buffer;
  let originalBundle: ParsedBundle;
  
  beforeAll(() => {
    try {
      originalBundleData = readFileSync(BUNDLE_PATH);
      originalBundle = parseBundle(originalBundleData.buffer);
      console.log(`📦 Original bundle loaded: ${originalBundleData.length} bytes, ${originalBundle.resources.length} resources`);
    } catch (error) {
      console.log('⚠️ Test bundle not found');
    }
  });

  it('should debug the bundle building process', async function() {
    if (!originalBundleData) {
      this.skip();
      return;
    }

    console.log('\n🔍 DEBUGGING BUNDLE EXPORT PROCESS');
    console.log(`📦 Original bundle: ${originalBundleData.length} bytes`);
    console.log(`🏗️ Platform: ${originalBundle.header.platform}, Flags: 0x${originalBundle.header.flags.toString(16)}`);
    
    // Create builder with minimal settings
    const builder = new BundleBuilder({
      platform: originalBundle.header.platform as any,
      compress: false // Force no compression for debugging
    });

    console.log('\n📋 Resources in original bundle:');
    let totalOriginalResourceSize = 0;
    
    for (const resource of originalBundle.resources) {
      const resourceStartOffset = resource.diskOffsets[0];
      const resourceSize = resource.sizeAndAlignmentOnDisk[0];
      totalOriginalResourceSize += resourceSize;
      
      console.log(`  - Resource 0x${resource.resourceTypeId.toString(16)}: ${resourceSize} bytes (flags: 0x${resource.flags.toString(16)})`);
      
      // Extract original resource data
      const resourceData = new Uint8Array(
        originalBundleData.slice(resourceStartOffset, resourceStartOffset + resourceSize)
      );
      
      // Add using the new method
      console.log(`    Adding with size: ${resourceData.length} bytes`);
      builder.addExistingResource(resource, resourceData);
    }

    console.log(`\n📊 Total original resource data: ${totalOriginalResourceSize} bytes`);
    console.log(`📊 Original bundle overhead: ${originalBundleData.length - totalOriginalResourceSize} bytes`);

    // Add debug data if present
    if (originalBundle.debugData) {
      builder.setDebugData(originalBundle.debugData);
      console.log(`📋 Debug data: ${originalBundle.debugData.length} chars`);
    }

    // Build the new bundle
    console.log('\n🏗️ Building new bundle...');
    const exportedBundleBuffer = await builder.build();
    
    console.log(`📦 Exported bundle: ${exportedBundleBuffer.byteLength} bytes`);
    console.log(`📊 Size ratio: ${(exportedBundleBuffer.byteLength / originalBundleData.length * 100).toFixed(1)}%`);
    console.log(`📊 Size difference: ${exportedBundleBuffer.byteLength - originalBundleData.length} bytes`);

    // Parse the exported bundle to verify
    const reloadedBundle = parseBundle(exportedBundleBuffer);
    console.log(`🔄 Reloaded bundle: ${reloadedBundle.resources.length} resources`);

    // Show detailed comparison
    console.log('\n📋 Resource comparison:');
    for (let i = 0; i < Math.min(originalBundle.resources.length, reloadedBundle.resources.length); i++) {
      const orig = originalBundle.resources[i];
      const reload = reloadedBundle.resources[i];
      
      console.log(`  Resource ${i}: 0x${orig.resourceTypeId.toString(16)}`);
      console.log(`    Original: ${orig.sizeAndAlignmentOnDisk[0]} bytes, flags: 0x${orig.flags.toString(16)}`);
      console.log(`    Reloaded: ${reload.sizeAndAlignmentOnDisk[0]} bytes, flags: 0x${reload.flags.toString(16)}`);
      
      if (orig.sizeAndAlignmentOnDisk[0] !== reload.sizeAndAlignmentOnDisk[0]) {
        console.log(`    ⚠️ SIZE MISMATCH!`);
      }
      
      if (orig.flags !== reload.flags) {
        console.log(`    ⚠️ FLAGS MISMATCH!`);
      }
    }

    // Don't fail the test, just gather info
    expect(exportedBundleBuffer.byteLength).toBeGreaterThan(0);
  });
}); 