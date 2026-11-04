// Contract test: the World-viewport family list and the overlay render
// bindings must describe the same set of Resources.
//
// These two lists live in different modules for good reasons —
// WORLD_VIEWPORT_FAMILY_KEYS drives composition/ordering and must stay
// React-free, the bindings hold the actual overlay components — but they
// answer the same question ("which Resources draw into the shared world
// scene?"). Before this test, disagreeing was silent in opposite ways: a
// family key with no binding mounts nothing and the user sees an empty
// scene; a bound overlay outside the family never gets composed at all.
//
// Why the leaflet stub: importing `../bindings` pulls in
// triggerDataExtensions → RegionsMap → leaflet, which touches `window` at
// module-load time. The repo's vitest env is `node`, so shim it first
// (same treatment as the schema-editor extension contract test).

import { describe, it, expect, vi } from 'vitest';

vi.mock('leaflet', () => ({ default: {}, Icon: class {}, latLngBounds: () => ({}) }));
vi.mock('react-leaflet', () => ({
	MapContainer: () => null,
	TileLayer: () => null,
	Rectangle: () => null,
	useMap: () => ({}),
	Marker: () => null,
	Popup: () => null,
}));

import { overlayBoundResourceKeys } from '../bindings';
import { WORLD_VIEWPORT_FAMILY_KEYS } from '@/components/workspace/WorldViewportComposition.helpers';

/**
 * PropGraphicsList is in the World-viewport family but deliberately owns no
 * overlay of its own. It is a type→Model catalogue, not spatial data: the
 * prop meshes are drawn by joining it with PropInstanceData in the per-Bundle
 * <PropGeometry> layer. It sits in the family purely so that SELECTING it
 * routes through the shared world scene (track + props stay visible) instead
 * of the single-overlay ViewportPane dead-end. Any OTHER family key without a
 * binding is a bug, so the exception is named here rather than being a
 * blanket "some keys may be missing" allowance.
 */
const FAMILY_KEYS_WITHOUT_OVERLAY = new Set<string>(['propGraphicsList']);

describe('world-viewport family ↔ overlay bindings', () => {
	it('registers every overlay binding against a profile the registry knows', () => {
		// `resourceKeyForProfile` returns undefined for an orphan — a binding
		// whose profile object was never added to the registry's ENTRIES.
		expect(overlayBoundResourceKeys()).not.toContain(undefined);
	});

	it('gives every world-family key an overlay, except propGraphicsList', () => {
		const bound = new Set(overlayBoundResourceKeys());
		const missing = WORLD_VIEWPORT_FAMILY_KEYS.filter(
			(key) => !bound.has(key) && !FAMILY_KEYS_WITHOUT_OVERLAY.has(key),
		);
		expect(missing).toEqual([]);
	});

	it('keeps propGraphicsList overlay-free (it draws via PropInstanceData)', () => {
		expect(new Set(overlayBoundResourceKeys())).not.toContain('propGraphicsList');
	});

	it('does not bind an overlay for any resource outside the world family', () => {
		const family = new Set<string>(WORLD_VIEWPORT_FAMILY_KEYS);
		const strays = [...new Set(overlayBoundResourceKeys())].filter(
			(key) => !family.has(key),
		);
		expect(strays).toEqual([]);
	});
});
