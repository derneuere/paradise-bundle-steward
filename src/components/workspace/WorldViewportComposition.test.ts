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
	filterOverlaysByVisibility,
	isWorldViewportFamilyKey,
	listWorldOverlays,
	selectedPathFor,
	type OverlayDescriptor,
} from './WorldViewportComposition.helpers';
import { isVisibleIn } from '@/context/WorkspaceContext.helpers';
import type {
	EditableBundle,
	VisibilityNode,
} from '@/context/WorkspaceContext.types';
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
			{ bundleId: 'TRK_UNIT_07.BUN', resourceKey: 'aiSections', index: 0, model: ai, bundleSiblings: [ai] },
			{ bundleId: 'TRK_UNIT_07.BUN', resourceKey: 'streetData', index: 0, model: street, bundleSiblings: [street] },
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
		const instances = [null, { tag: 'soup-1' }, { tag: 'soup-2' }];
		const bundle = makeBundle('WORLDCOL.BIN', {
			polygonSoupList: instances,
		});
		// The Bundle's full PSL list (including the null at index 0) is
		// preserved as `bundleSiblings` so the PolygonSoupList overlay still
		// gets the union it needs for batched-mesh rendering.
		expect(listWorldOverlays([bundle])).toEqual([
			{
				bundleId: 'WORLDCOL.BIN',
				resourceKey: 'polygonSoupList',
				index: 1,
				model: { tag: 'soup-1' },
				bundleSiblings: instances,
			},
			{
				bundleId: 'WORLDCOL.BIN',
				resourceKey: 'polygonSoupList',
				index: 2,
				model: { tag: 'soup-2' },
				bundleSiblings: instances,
			},
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

	it('issue #23: routes per-Bundle siblings even when the soups live outside bundles[0]', () => {
		// Acceptance criterion for issue #23: in a Workspace with two Bundles
		// loaded where only the SECOND contains polygon soups, those soups
		// must reach the WorldViewport batch path. The fallback used to
		// resolve to `bundles[0]` regardless, so a non-PSL bundle at index 0
		// silently masked all soups in subsequent bundles. Now the descriptor
		// carries the correct per-Bundle list itself.
		const trk = makeBundle('TRK_UNIT_07.BUN', {
			aiSections: [{ tag: 'trk-ai' }],
			// no polygonSoupList here
		});
		const worldcolSoups = [{ tag: 'soup-0' }, { tag: 'soup-1' }];
		const worldcol = makeBundle('WORLDCOL.BIN', {
			polygonSoupList: worldcolSoups,
		});

		const overlays = listWorldOverlays([trk, worldcol]);

		const psl = overlays.filter((d) => d.resourceKey === 'polygonSoupList');
		expect(psl).toHaveLength(2);
		// Both PSL descriptors must point at WORLDCOL's soup list — NOT at
		// TRK_UNIT_07's (which doesn't even carry one). Same reference shared
		// across siblings so React doesn't re-batch on identity changes.
		expect(psl[0].bundleId).toBe('WORLDCOL.BIN');
		expect(psl[1].bundleId).toBe('WORLDCOL.BIN');
		expect(psl[0].bundleSiblings).toBe(worldcolSoups);
		expect(psl[1].bundleSiblings).toBe(worldcolSoups);
		// And each descriptor's `model` is its own indexed entry.
		expect(psl[0].model).toBe(worldcolSoups[0]);
		expect(psl[1].model).toBe(worldcolSoups[1]);
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

// ---------------------------------------------------------------------------
// filterOverlaysByVisibility — issue #19 mount-filter
//
// The composition feeds its overlay descriptor list through this filter
// before mounting; descriptors whose `(bundleId, resourceKey, index)` are
// hidden by the Workspace's Visibility cascade do not reach the
// WorldViewport. Compose with `isVisibleIn` from WorkspaceContext.helpers
// to exercise the same predicate the live React provider supplies via
// `isVisible`.
// ---------------------------------------------------------------------------

describe('filterOverlaysByVisibility', () => {
	function descriptors(): OverlayDescriptor[] {
		const aAi = { tag: 'a-ai' };
		const aStreet = { tag: 'a-street' };
		const bSoup0 = { tag: 'b-soup-0' };
		const bSoup1 = { tag: 'b-soup-1' };
		const bSoups = [bSoup0, bSoup1];
		return [
			{ bundleId: 'A.BNDL', resourceKey: 'aiSections', index: 0, model: aAi, bundleSiblings: [aAi] },
			{ bundleId: 'A.BNDL', resourceKey: 'streetData', index: 0, model: aStreet, bundleSiblings: [aStreet] },
			{ bundleId: 'B.BNDL', resourceKey: 'polygonSoupList', index: 0, model: bSoup0, bundleSiblings: bSoups },
			{ bundleId: 'B.BNDL', resourceKey: 'polygonSoupList', index: 1, model: bSoup1, bundleSiblings: bSoups },
		];
	}

	it('keeps every overlay when the visibility map is empty (default-visible)', () => {
		const v = new Map<string, boolean>();
		const isVisible = (n: VisibilityNode) => isVisibleIn(v, n);
		const out = filterOverlaysByVisibility(descriptors(), isVisible);
		expect(out).toHaveLength(4);
	});

	it('cascade: hiding a Bundle drops every overlay under it', () => {
		// Acceptance criterion: toggling a Bundle off makes every descendant
		// return false from `isVisible`. The composition then drops all of
		// Bundle A's overlays, but B's stay mounted.
		const v = new Map<string, boolean>([['A.BNDL', false]]);
		const out = filterOverlaysByVisibility(
			descriptors(),
			(n) => isVisibleIn(v, n),
		);
		expect(out.map((d) => d.bundleId)).toEqual(['B.BNDL', 'B.BNDL']);
	});

	it('hides a single resource type without affecting siblings under the same Bundle', () => {
		const v = new Map<string, boolean>([['A.BNDL::aiSections', false]]);
		const out = filterOverlaysByVisibility(
			descriptors(),
			(n) => isVisibleIn(v, n),
		);
		// A.BNDL/aiSections gone; A.BNDL/streetData stays; B.BNDL untouched.
		expect(out.map((d) => `${d.bundleId}/${d.resourceKey}`)).toEqual([
			'A.BNDL/streetData',
			'B.BNDL/polygonSoupList',
			'B.BNDL/polygonSoupList',
		]);
	});

	it('multi-instance: hiding one PolygonSoupList instance keeps its siblings', () => {
		// Every soup gets its own tree node and its own toggle, so multiple
		// soups can be visible simultaneously while one is hidden.
		const v = new Map<string, boolean>([
			['B.BNDL::polygonSoupList::0', false],
		]);
		const out = filterOverlaysByVisibility(
			descriptors(),
			(n) => isVisibleIn(v, n),
		);
		expect(out.map((d) => `${d.bundleId}#${d.index}`)).toEqual([
			'A.BNDL#0',
			'A.BNDL#0',
			'B.BNDL#1',
		]);
	});

	it('toggling a Bundle back on restores the prior per-instance state', () => {
		// User flow:
		//   1. Hide B.BNDL/polygonSoupList #0 (per-instance hide).
		//   2. Hide B.BNDL (cascade hides BOTH soups).
		//   3. Show B.BNDL again — the per-instance hide for #0 must
		//      reassert itself (only #1 comes back, not #0).
		// The cascade is one-way (`isVisibleIn`), so we don't need to clear
		// the per-instance entry when toggling the Bundle off — toggling the
		// Bundle back on automatically restores the prior layer.
		const v = new Map<string, boolean>([
			['B.BNDL::polygonSoupList::0', false],
			['B.BNDL', false],
		]);
		// Step 2 state: every B.BNDL overlay hidden by the Bundle-level cascade.
		const hiddenAll = filterOverlaysByVisibility(
			descriptors(),
			(n) => isVisibleIn(v, n),
		);
		expect(hiddenAll.map((d) => d.bundleId)).toEqual(['A.BNDL', 'A.BNDL']);

		// Step 3: re-enable the Bundle. The per-instance entry for #0 is
		// untouched, so it stays hidden; #1 comes back.
		const restored = new Map(v);
		restored.set('B.BNDL', true);
		const after = filterOverlaysByVisibility(
			descriptors(),
			(n) => isVisibleIn(restored, n),
		);
		expect(after.map((d) => `${d.bundleId}#${d.index}`)).toEqual([
			'A.BNDL#0',
			'A.BNDL#0',
			'B.BNDL#1',
		]);
	});

	it('preserves descriptor order and identity for survivors', () => {
		// Stable ordering matters: WorldViewport draws layers in the order
		// it receives children. The filter must not reshuffle.
		const v = new Map<string, boolean>([['A.BNDL::aiSections', false]]);
		const input = descriptors();
		const out = filterOverlaysByVisibility(
			input,
			(n) => isVisibleIn(v, n),
		);
		expect(out[0]).toBe(input[1]);
		expect(out[1]).toBe(input[2]);
		expect(out[2]).toBe(input[3]);
	});
});
