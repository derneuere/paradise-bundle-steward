// Single entry point for pulling a resource's decompressed bytes out of a bundle.
// Every caller (CLI, UI, registry test suite) goes through this so the base+rel
// offset math and zlib handling only live in one place.

import type { ParsedBundle, ResourceEntry } from '../types';
import { extractResourceData, isCompressed, decompressData } from '../resourceManager';
import { BundleError } from '../errors';

/**
 * Locate a single resource inside a parsed bundle and return its raw,
 * decompressed byte payload. Throws BundleError when the resource has no
 * populated data block.
 *
 * The plain `extractResourceData` in resourceManager.ts already computes the
 * correct base+rel absolute offset (it was fixed in place during Step 1 of the
 * CLI refactor). This helper adds the decompression step on top so handlers
 * only ever see flat bytes.
 */
export function extractResourceRaw(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
	resource: ResourceEntry,
): Uint8Array {
	const raw = extractResourceData(buffer, bundle, resource);
	if (raw.byteLength === 0) {
		throw new BundleError(
			`Resource 0x${resource.resourceTypeId.toString(16)} has no populated data block`,
			'RESOURCE_EMPTY',
		);
	}
	if (isCompressed(raw)) return decompressData(raw);
	return raw;
}
