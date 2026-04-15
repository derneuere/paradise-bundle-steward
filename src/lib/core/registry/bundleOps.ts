// Bundle-level operations that iterate the handler registry.
//
// This module is the single bridge between the low-level bundle parser in
// ../bundle/index.ts and the registry. The CLI and (once Step 6 lands) the UI
// both call into it instead of reaching for per-type parse* functions.

import type { ParsedBundle } from '../types';
import { extractResourceRaw } from './extract';
import { registry, getHandlerByTypeId } from './index';
import { resourceCtxFromBundle } from './handler';

/**
 * Parse every registered resource type out of a bundle and return a map
 * keyed by handler.key. Missing resources are simply absent from the map.
 * Handlers that throw are logged and skipped (mirrors the old
 * parseResourceType soft-fail behavior).
 *
 * This returns the FIRST matching resource per key. Bundles that contain
 * multiple resources of the same type (e.g., WORLDCOL.BIN with ~428
 * PolygonSoupList resources) will only expose the first one via this map.
 * Use `parseAllBundleResourcesViaRegistry` if you need every instance.
 */
export function parseBundleResourcesViaRegistry(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
): Map<string, unknown> {
	const out = new Map<string, unknown>();
	const ctx = resourceCtxFromBundle(bundle);

	for (const handler of registry) {
		const resource = bundle.resources.find((r) => r.resourceTypeId === handler.typeId);
		if (!resource) continue;
		try {
			const raw = extractResourceRaw(buffer, bundle, resource);
			const model = handler.parseRaw(raw, ctx);
			out.set(handler.key, model);
		} catch (error) {
			console.warn(`Failed to parse ${handler.name}:`, error);
		}
	}

	return out;
}

/**
 * Parse EVERY instance of every registered resource type, preserving
 * bundle order. For bundles with N copies of a given type, the returned
 * array has N entries at that key. Entries that fail to parse are replaced
 * with `null` so array indexes still line up with `bundle.resources`.
 *
 * Used by the schema editor's viewport when it needs to visualize a whole
 * world's worth of geometry across many same-typed resources.
 */
export function parseAllBundleResourcesViaRegistry(
	buffer: ArrayBuffer,
	bundle: ParsedBundle,
): Map<string, unknown[]> {
	const out = new Map<string, unknown[]>();
	const ctx = resourceCtxFromBundle(bundle);
	const handlersByTypeId = new Map<number, typeof registry[number]>();
	for (const h of registry) handlersByTypeId.set(h.typeId, h);

	for (const resource of bundle.resources) {
		const handler = handlersByTypeId.get(resource.resourceTypeId);
		if (!handler) continue;
		let list = out.get(handler.key);
		if (!list) {
			list = [];
			out.set(handler.key, list);
		}
		try {
			const raw = extractResourceRaw(buffer, bundle, resource);
			const model = handler.parseRaw(raw, ctx);
			list.push(model);
		} catch (error) {
			console.warn(`Failed to parse ${handler.name} at resource 0x${resource.resourceId.low.toString(16)}:`, error);
			// Preserve index alignment with bundle.resources by slotting in null.
			list.push(null);
		}
	}

	return out;
}

/**
 * Convenience lookup used by the UI during Step 6. Returns the raw handler
 * so callers can also reach describe() / caps / name.
 */
export function findHandlerForResource(bundle: ParsedBundle, typeId: number) {
	if (!bundle.resources.some((r) => r.resourceTypeId === typeId)) return undefined;
	return getHandlerByTypeId(typeId);
}
