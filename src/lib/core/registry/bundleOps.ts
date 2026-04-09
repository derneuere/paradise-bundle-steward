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
 * Convenience lookup used by the UI during Step 6. Returns the raw handler
 * so callers can also reach describe() / caps / name.
 */
export function findHandlerForResource(bundle: ParsedBundle, typeId: number) {
	if (!bundle.resources.some((r) => r.resourceTypeId === typeId)) return undefined;
	return getHandlerByTypeId(typeId);
}
