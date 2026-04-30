// Bundle-construction helpers backing WorkspaceContext.tsx.
//
// Why a separate module: the React provider drags in `react` + `sonner`
// (toast), which break under our `node` vitest environment. Extracting the
// pure parse-and-wrap step into its own file lets the test suite import
// `makeEditableBundle` without paying that cost.

import {
	formatResourceId,
	getFlagNames,
	getPlatformName,
	parseBundle,
	type UIResource,
} from '@/lib/core/bundle';
import {
	parseAllBundleResourcesViaRegistry,
	parseBundleResourcesViaRegistry,
} from '@/lib/core/registry/bundleOps';
import { u64ToBigInt } from '@/lib/core/u64';
import { getResourceType } from '@/lib/resourceTypes';
import {
	extractResourceSize,
	getMemoryTypeName,
} from '@/lib/core/resourceManager';
import {
	findDebugResourceById,
	parseDebugDataFromXml,
	type DebugResource,
} from '@/lib/core/bundle/debugData';
import type { ParsedBundle } from '@/lib/core/types';
import type { BundleId, EditableBundle } from './WorkspaceContext.types';

function toUIResource(
	resource: ParsedBundle['resources'][number],
	bundle: ParsedBundle,
	debugData: DebugResource[],
): UIResource {
	const resourceType = getResourceType(resource.resourceTypeId);
	const debugResource = findDebugResourceById(
		debugData,
		formatResourceId(u64ToBigInt(resource.resourceId)),
	);

	let memoryTypeIndex = 0;
	let uncompressed = extractResourceSize(resource.uncompressedSizeAndAlignment[0]);
	let compressed = extractResourceSize(resource.sizeAndAlignmentOnDisk[0]);
	for (let i = 0; i < 3; i++) {
		const size = extractResourceSize(resource.uncompressedSizeAndAlignment[i]);
		if (size > 0) {
			memoryTypeIndex = i;
			uncompressed = size;
			compressed = extractResourceSize(resource.sizeAndAlignmentOnDisk[i]);
			break;
		}
	}

	return {
		id: formatResourceId(u64ToBigInt(resource.resourceId)),
		name: debugResource?.name || `Resource_${resource.resourceId.low.toString(16)}`,
		type: resourceType.name,
		typeName: debugResource?.typeName || resourceType.description,
		category: resourceType.category,
		platform: getPlatformName(bundle.header.platform),
		uncompressedSize: uncompressed,
		compressedSize: compressed,
		memoryType: getMemoryTypeName(bundle.header.platform, memoryTypeIndex),
		imports: [],
		flags: getFlagNames(resource.flags),
		raw: resource,
	};
}

/**
 * Build an EditableBundle from a raw byte buffer + filename. Synchronous —
 * the filesystem step happens in `loadBundle`, this is the part that's pure
 * enough to test without a File / Blob shim.
 */
export function makeEditableBundle(
	arrayBuffer: ArrayBuffer,
	id: BundleId,
): EditableBundle {
	const parsed = parseBundle(arrayBuffer);
	const debugResources = parsed.debugData
		? parseDebugDataFromXml(parsed.debugData)
		: [];
	const resources = parsed.resources.map((r) => toUIResource(r, parsed, debugResources));
	const parsedResources = parseBundleResourcesViaRegistry(arrayBuffer, parsed);
	const parsedResourcesAll = parseAllBundleResourcesViaRegistry(arrayBuffer, parsed);
	return {
		id,
		originalArrayBuffer: arrayBuffer,
		parsed,
		resources,
		debugResources,
		parsedResources,
		parsedResourcesAll,
		dirtyMulti: new Set(),
		isModified: false,
	};
}
