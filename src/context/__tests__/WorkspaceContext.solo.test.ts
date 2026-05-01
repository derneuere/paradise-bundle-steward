// Solo-visibility gesture (issue #26): alt+click on a Workspace-tree eye
// solos the node within its Bundle. These tests pin the cascade-aware
// semantics — Bundle never crosses Bundles, ancestors get force-shown, and
// a second alt-press on the only visible peer restores full visibility.

import { describe, expect, it } from 'vitest';
import {
	isSoloed,
	toggleSoloVisibility,
} from '../WorkspaceContext.helpers';
import type { EditableBundle, VisibilityNode } from '../WorkspaceContext.types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Crafted resource shape: two visibility-relevant types, one multi (3
// instances) plus one single. `streetData` and `aiSections` are both in
// WORLD_VIEWPORT_FAMILY_KEYS, so they show eye icons in the tree. `texture`
// is non-visibility-relevant — solo should never write to its keys, since
// hiding it would be meaningless to the WorldViewport scene.
function makeBundle(id: string, multi: number = 3): EditableBundle {
	return {
		id,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		originalArrayBuffer: new ArrayBuffer(0) as any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		parsed: {} as any,
		resources: [],
		debugResources: [],
		parsedResources: new Map(),
		parsedResourcesAll: new Map<string, (unknown | null)[]>([
			['polygonSoupList', new Array(multi).fill({})],
			['aiSections', [{}]],
			['texture', [{}]],
		]),
		dirtyMulti: new Set(),
		isModified: false,
	};
}

// ---------------------------------------------------------------------------
// applySolo — Bundle level
// ---------------------------------------------------------------------------

describe('toggleSoloVisibility — Bundle scope', () => {
	it('hides every other Bundle and leaves this one visible', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL'), makeBundle('C.BNDL')];
		const next = toggleSoloVisibility(new Map(), bundles, { bundleId: 'B.BNDL' });
		expect(next.get('A.BNDL')).toBe(false);
		expect(next.get('C.BNDL')).toBe(false);
		// Default-true semantics — soloed Bundle has no entry, not an explicit `true`.
		expect(next.has('B.BNDL')).toBe(false);
	});

	it('does not touch within-bundle entries — solo at Bundle scope is sibling-only', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const before = new Map<string, boolean>([
			// User had previously hidden one PSL inside the soloed Bundle. That
			// per-instance hide must survive — Bundle solo only manages siblings.
			['B.BNDL::polygonSoupList::1', false],
		]);
		const next = toggleSoloVisibility(before, bundles, { bundleId: 'B.BNDL' });
		expect(next.get('A.BNDL')).toBe(false);
		expect(next.get('B.BNDL::polygonSoupList::1')).toBe(false);
	});

	it('clears a stale `false` on the soloed Bundle itself (force-show ancestor)', () => {
		// Acceptance criterion 4 implicit — soloing a Bundle the user had
		// previously hidden must show that Bundle.
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const before = new Map<string, boolean>([['B.BNDL', false]]);
		const next = toggleSoloVisibility(before, bundles, { bundleId: 'B.BNDL' });
		expect(next.has('B.BNDL')).toBe(false);
		expect(next.get('A.BNDL')).toBe(false);
	});

	it('un-solos: second alt-press restores all bundles to visible', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL'), makeBundle('C.BNDL')];
		const soloed = toggleSoloVisibility(new Map(), bundles, { bundleId: 'B.BNDL' });
		expect(isSoloed(soloed, bundles, { bundleId: 'B.BNDL' })).toBe(true);
		const restored = toggleSoloVisibility(soloed, bundles, { bundleId: 'B.BNDL' });
		expect(restored.has('A.BNDL')).toBe(false);
		expect(restored.has('B.BNDL')).toBe(false);
		expect(restored.has('C.BNDL')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// applySolo — Resource type level
// ---------------------------------------------------------------------------

describe('toggleSoloVisibility — Resource-type scope', () => {
	it('hides every other resource type in the same Bundle, leaves other Bundles untouched', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const node: VisibilityNode = { bundleId: 'A.BNDL', resourceKey: 'polygonSoupList' };
		const next = toggleSoloVisibility(new Map(), bundles, node);
		// Other type in same Bundle hidden.
		expect(next.get('A.BNDL::aiSections')).toBe(false);
		// Other Bundle untouched.
		expect(next.has('B.BNDL')).toBe(false);
		expect(next.has('B.BNDL::aiSections')).toBe(false);
		// Soloed type and Bundle ancestor have no `false` entry.
		expect(next.has('A.BNDL::polygonSoupList')).toBe(false);
		expect(next.has('A.BNDL')).toBe(false);
	});

	it('skips non-visibility-relevant types — texture has no eye, so no solo-write', () => {
		const bundles = [makeBundle('A.BNDL')];
		const next = toggleSoloVisibility(new Map(), bundles, {
			bundleId: 'A.BNDL',
			resourceKey: 'polygonSoupList',
		});
		expect(next.has('A.BNDL::texture')).toBe(false);
	});

	it('un-solos: clears every entry within the Bundle, leaves other Bundles untouched', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const node: VisibilityNode = { bundleId: 'A.BNDL', resourceKey: 'polygonSoupList' };
		const before = new Map<string, boolean>([['B.BNDL::aiSections', false]]);
		const soloed = toggleSoloVisibility(before, bundles, node);
		const restored = toggleSoloVisibility(soloed, bundles, node);
		expect(restored.has('A.BNDL::aiSections')).toBe(false);
		expect(restored.has('A.BNDL::polygonSoupList')).toBe(false);
		// Other Bundle's per-type hide untouched.
		expect(restored.get('B.BNDL::aiSections')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// applySolo — Instance level
// ---------------------------------------------------------------------------

describe('toggleSoloVisibility — Instance scope', () => {
	it('hides other types AND other instances of the same type in the same Bundle', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const node: VisibilityNode = {
			bundleId: 'A.BNDL',
			resourceKey: 'polygonSoupList',
			index: 1,
		};
		const next = toggleSoloVisibility(new Map(), bundles, node);
		// Sibling instances within the same type → hidden.
		expect(next.get('A.BNDL::polygonSoupList::0')).toBe(false);
		expect(next.get('A.BNDL::polygonSoupList::2')).toBe(false);
		// Other type in same Bundle → hidden at the type level.
		expect(next.get('A.BNDL::aiSections')).toBe(false);
		// Soloed instance + ancestors free of `false` entries.
		expect(next.has('A.BNDL::polygonSoupList::1')).toBe(false);
		expect(next.has('A.BNDL::polygonSoupList')).toBe(false);
		expect(next.has('A.BNDL')).toBe(false);
		// Other Bundle untouched.
		expect(next.has('B.BNDL')).toBe(false);
		expect(next.has('B.BNDL::polygonSoupList::0')).toBe(false);
	});

	it('forces a hidden Bundle visible when soloing one of its instances (criterion 5)', () => {
		// Acceptance criterion 5: with a Bundle previously hidden, alt+click
		// an Instance under it makes the Bundle visible AND hides siblings.
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const before = new Map<string, boolean>([['A.BNDL', false]]);
		const node: VisibilityNode = {
			bundleId: 'A.BNDL',
			resourceKey: 'polygonSoupList',
			index: 0,
		};
		const next = toggleSoloVisibility(before, bundles, node);
		expect(next.has('A.BNDL')).toBe(false);
		expect(next.get('A.BNDL::polygonSoupList::1')).toBe(false);
		expect(next.get('A.BNDL::polygonSoupList::2')).toBe(false);
		expect(next.get('A.BNDL::aiSections')).toBe(false);
	});

	it('un-solos: a second alt-press on the soloed instance restores full visibility within the Bundle', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const node: VisibilityNode = {
			bundleId: 'A.BNDL',
			resourceKey: 'polygonSoupList',
			index: 1,
		};
		const soloed = toggleSoloVisibility(new Map(), bundles, node);
		expect(isSoloed(soloed, bundles, node)).toBe(true);
		const restored = toggleSoloVisibility(soloed, bundles, node);
		expect(restored.has('A.BNDL::polygonSoupList::0')).toBe(false);
		expect(restored.has('A.BNDL::polygonSoupList::2')).toBe(false);
		expect(restored.has('A.BNDL::aiSections')).toBe(false);
		// After restore, peers are visible again, so the instance is no longer
		// soloed — a third alt-press would be a fresh solo, not another restore.
		expect(isSoloed(restored, bundles, node)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isSoloed
// ---------------------------------------------------------------------------

describe('isSoloed', () => {
	it('returns false when the node itself is hidden', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL')];
		const v = new Map<string, boolean>([['A.BNDL', false]]);
		expect(isSoloed(v, bundles, { bundleId: 'A.BNDL' })).toBe(false);
	});

	it('returns false when at least one peer is still visible', () => {
		const bundles = [makeBundle('A.BNDL'), makeBundle('B.BNDL'), makeBundle('C.BNDL')];
		// Only A is hidden, B and C both visible — soloing on B should be a fresh
		// solo, not an un-solo.
		const v = new Map<string, boolean>([['A.BNDL', false]]);
		expect(isSoloed(v, bundles, { bundleId: 'B.BNDL' })).toBe(false);
	});
});
