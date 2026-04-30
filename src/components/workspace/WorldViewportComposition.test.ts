// WorldViewportComposition helpers — pure-function tests for the overlay
// enumeration and selection routing that drive issue #18's cross-Bundle
// scene composition.
//
// We avoid mounting <WorldViewport> here: the chrome pulls in
// react-three-fiber + three.js which want a DOM/canvas, and our vitest env
// is `node`. The interesting behaviour — "list every overlay across every
// Bundle," "emit one per multi-instance index," "selectedPath only resolves
// for the matching descriptor" — lives in the pure helpers, so testing
// those gives the equivalent coverage at a fraction of the dep cost.

import { describe, expect, it } from 'vitest';

import {
	WORLD_VIEWPORT_FAMILY_KEYS,
	isWorldViewportFamilyKey,
	listWorldOverlays,
	selectedPathFor,
} from './WorldViewportComposition.helpers';
import type { EditableBundle } from '@/context/WorkspaceContext.types';
import type { ParsedBundle } from '@/lib/core/types';

// ---------------------------------------------------------------------------
// Fixture helpers — hand-rolled minimal EditableBundles to exercise the
// composition logic without touching the registry / parsers.
// ---------------------------------------------------------------------------

const EMPTY_PARSED: ParsedBundle = {
	header: {} as ParsedBundle['header'],
	resources: [],
	imports: [],
};

function makeBundle(
	id: string,
	resources: Record<string, (unknown | null)[]>,
): EditableBundle {
	const parsedResourcesAll = new Map<string, (unknown | null)[]>();
	const parsedResources = new Map<string, unknown>();
	for (const [k, list] of Object.entries(resources)) {
		parsedResourcesAll.set(k, list);
		const first = list[0];
		if (first != null) parsedResources.set(k, first);
	}
	return {
		id,
		originalArrayBuffer: new ArrayBuffer(0),
		parsed: EMPTY_PARSED,
		resources: [],
		debugResources: [],
		parsedResources,
		parsedResourcesAll,
		dirtyMulti: new Set(),
		isModified: false,
	};
}

// ---------------------------------------------------------------------------
// Family declaration
// ---------------------------------------------------------------------------

describe('WORLD_VIEWPORT_FAMILY_KEYS', () => {
	it('covers every World-viewport overlay we ship today', () => {
		// If a new World-viewport overlay lands, add its key here AND to the
		// family list so the composition mounts it. Failing this test is the
		// signal that the registry and the composition have diverged.
		expect([...WORLD_VIEWPORT_FAMILY_KEYS].sort()).toEqual([
			'aiSections',
			'polygonSoupList',
			'streetData',
			'trafficData',
			'triggerData',
			'zoneList',
		]);
	});

	it('isWorldViewportFamilyKey acts as a membership test', () => {
		expect(isWorldViewportFamilyKey('aiSections')).toBe(true);
		expect(isWorldViewportFamilyKey('polygonSoupList')).toBe(true);
		expect(isWorldViewportFamilyKey('renderable')).toBe(false);
		expect(isWorldViewportFamilyKey('texture')).toBe(false);
		expect(isWorldViewportFamilyKey('shader')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// listWorldOverlays — single-Bundle baseline
// ---------------------------------------------------------------------------

describe('listWorldOverlays', () => {
	it('returns an empty list for an empty Workspace', () => {
		expect(listWorldOverlays([])).toEqual([]);
	});

	it('emits one descriptor per non-null instance for a single Bundle', () => {
		const ai = { tag: 'ai-model' };
		const street = { tag: 'street-model' };
		const bundle = makeBundle('TRK_UNIT_07.BUN', {
			aiSections: [ai],
			streetData: [street],
		});

		const overlays = listWorldOverlays([bundle]);

		expect(overlays).toEqual([
			{ bundleId: 'TRK_UNIT_07.BUN', resourceKey: 'aiSections', index: 0, model: ai },
			{ bundleId: 'TRK_UNIT_07.BUN', resourceKey: 'streetData', index: 0, model: street },
		]);
	});

	it('skips non-family keys (renderable, texture, shader)', () => {
		const bundle = makeBundle('VEH_PASBSCA2_GR.BIN', {
			renderable: [{ tag: 'r' }],
			texture: [{ tag: 't0' }, { tag: 't1' }],
			shader: [{ tag: 's' }],
			// One world-family entry to confirm the rest weren't accidentally
			// dropped by the filter.
			aiSections: [{ tag: 'ai' }],
		});
		const keys = listWorldOverlays([bundle]).map((d) => d.resourceKey);
		expect(keys).toEqual(['aiSections']);
	});

	it('drops null instances but keeps the index of valid neighbours', () => {
		// Multi-instance resource where index 0 failed to parse but index 1
		// succeeded. The descriptor for index 1 must keep its index — selection
		// addresses are stored as `(key, index)` and the renderer uses that
		// index to wire onSelect / onChange back to setResourceAt.
		const bundle = makeBundle('WORLDCOL.BIN', {
			polygonSoupList: [null, { tag: 'soup-1' }, { tag: 'soup-2' }],
		});
		expect(listWorldOverlays([bundle])).toEqual([
			{ bundleId: 'WORLDCOL.BIN', resourceKey: 'polygonSoupList', index: 1, model: { tag: 'soup-1' } },
			{ bundleId: 'WORLDCOL.BIN', resourceKey: 'polygonSoupList', index: 2, model: { tag: 'soup-2' } },
		]);
	});
});

// ---------------------------------------------------------------------------
// listWorldOverlays — multi-Bundle composition
// ---------------------------------------------------------------------------

describe('listWorldOverlays — cross-Bundle composition', () => {
	it('emits descriptors from every loaded Bundle in load order', () => {
		const a = makeBundle('TRK_UNIT_07.BUN', {
			aiSections: [{ tag: 'a-ai' }],
		});
		const b = makeBundle('WORLDCOL.BIN', {
			polygonSoupList: [{ tag: 'b-soup-0' }, { tag: 'b-soup-1' }],
		});

		const overlays = listWorldOverlays([a, b]);

		// Bundle A's overlay first (load order), then Bundle B's two soups.
		expect(overlays.map((d) => `${d.bundleId}/${d.resourceKey}#${d.index}`)).toEqual([
			'TRK_UNIT_07.BUN/aiSections#0',
			'WORLDCOL.BIN/polygonSoupList#0',
			'WORLDCOL.BIN/polygonSoupList#1',
		]);
	});

	it('emits one descriptor per multi-instance entry per Bundle', () => {
		// Two bundles each holding multiple PolygonSoupList instances. Issue
		// #18 acceptance: "Multi-instance resources mount one overlay element
		// per instance per Bundle" — verify we get 2+3 = 5 descriptors.
		const a = makeBundle('A.BIN', {
			polygonSoupList: [{ tag: 'a-0' }, { tag: 'a-1' }],
		});
		const b = makeBundle('B.BIN', {
			polygonSoupList: [{ tag: 'b-0' }, { tag: 'b-1' }, { tag: 'b-2' }],
		});

		const overlays = listWorldOverlays([a, b]);

		expect(overlays).toHaveLength(5);
		expect(overlays.map((d) => ({ b: d.bundleId, i: d.index }))).toEqual([
			{ b: 'A.BIN', i: 0 },
			{ b: 'A.BIN', i: 1 },
			{ b: 'B.BIN', i: 0 },
			{ b: 'B.BIN', i: 1 },
			{ b: 'B.BIN', i: 2 },
		]);
	});

	it('within a Bundle, orders descriptors by WORLD_VIEWPORT_FAMILY_KEYS', () => {
		// Inserting in the opposite order from the family list — the helper
		// must follow the family list, not insertion order, so renders stay
		// deterministic regardless of which resource was parsed first.
		const bundle = makeBundle('MIXED.BNDL', {
			zoneList: [{ tag: 'z' }],
			aiSections: [{ tag: 'a' }],
			polygonSoupList: [{ tag: 'p' }],
		});
		const keys = listWorldOverlays([bundle]).map((d) => d.resourceKey);
		// polygonSoupList comes first in WORLD_VIEWPORT_FAMILY_KEYS, then
		// aiSections, with zoneList last among those three.
		expect(keys).toEqual(['polygonSoupList', 'aiSections', 'zoneList']);
	});
});

// ---------------------------------------------------------------------------
// selectedPathFor — selection routing across descriptors
// ---------------------------------------------------------------------------

describe('selectedPathFor', () => {
	const baseDesc = {
		bundleId: 'TRK_UNIT_07.BUN',
		resourceKey: 'aiSections' as const,
		index: 0,
	};

	it('returns the empty path when there is no Selection', () => {
		expect(selectedPathFor(null, baseDesc)).toEqual([]);
	});

	it('returns the Selection path when bundleId, resourceKey, and index all match', () => {
		const selection = {
			bundleId: 'TRK_UNIT_07.BUN',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 42] as ['sections', number],
		};
		expect(selectedPathFor(selection, baseDesc)).toEqual(['sections', 42]);
	});

	it('returns the empty path when the Selection is in a different Bundle', () => {
		const selection = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 42] as ['sections', number],
		};
		expect(selectedPathFor(selection, baseDesc)).toEqual([]);
	});

	it('returns the empty path when the Selection is on a different resource key', () => {
		const selection = {
			bundleId: 'TRK_UNIT_07.BUN',
			resourceKey: 'streetData',
			index: 0,
			path: ['streets', 7] as ['streets', number],
		};
		expect(selectedPathFor(selection, baseDesc)).toEqual([]);
	});

	it('returns the empty path when the Selection is on a different multi-instance index', () => {
		// Same Bundle, same key, different index — the matching overlay (idx 1)
		// gets the path; idx 0 stays unselected.
		const selection = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList',
			index: 1,
			path: ['soups', 0, 'polygons', 3] as ['soups', number, 'polygons', number],
		};
		const matching = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList' as const,
			index: 1,
		};
		const sibling = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'polygonSoupList' as const,
			index: 0,
		};
		expect(selectedPathFor(selection, matching)).toEqual(['soups', 0, 'polygons', 3]);
		expect(selectedPathFor(selection, sibling)).toEqual([]);
	});

	it('returns the same empty-array reference for every non-match', () => {
		// Stable identity for the empty-path return: lets React skip
		// shallow-equal updates on overlays whose selection state didn't move.
		const selection = {
			bundleId: 'WORLDCOL.BIN',
			resourceKey: 'aiSections',
			index: 0,
			path: ['sections', 1] as ['sections', number],
		};
		const a = selectedPathFor(selection, baseDesc);
		const b = selectedPathFor(null, baseDesc);
		expect(a).toBe(b);
	});
});
