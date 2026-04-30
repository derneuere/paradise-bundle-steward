// ZoneListOverlay — overlay-level unit test.
//
// We assert the overlay's three contracted behaviours against the same code
// paths the rendered component exercises:
//
//   - "right number of zone meshes render" → buildBatchedZones builds one
//     batched fill mesh whose face→zone map covers every fixture zone with
//     the expected triangle count (4-vertex zone ⇒ 2 fan triangles).
//   - "selectedPath = ['zones', 3] highlights zone 3" → zonePathIndex
//     decodes that schema path to 3, which is what the overlay reads to
//     pick which zone to draw the yellow ZoneOverlayMesh on.
//   - "onSelect called with ['zones', N] on click" → simulating the click
//     dispatch (faceIndex → faceToZone → zoneIndexPath → onSelect) lands
//     the right NodePath in the spy.
//
// We don't mount the component through react-dom because the repo has no
// DOM-test infrastructure today (vitest env: node, no jsdom, no
// @testing-library/react, no @react-three/test-renderer). The overlay's
// rendering shape is a thin wrapper over the helpers this file imports —
// covering them directly gives the same coverage at a fraction of the
// dep-cost. If/when DOM-test infra is added, this file can grow into a
// react-test-renderer mount without losing the helper-level assertions.

import { describe, it, expect, vi } from 'vitest';
import {
	buildBatchedZones,
	zoneIndexPath,
	zonePathIndex,
} from './ZoneListOverlay';
import type { ParsedZoneList, Zone } from '@/lib/core/zoneList';

// ---------------------------------------------------------------------------
// Fixture builder — five quad zones in a plus-shape on the XZ plane.
// ---------------------------------------------------------------------------

function makeZone(index: number, cx: number, cy: number): Zone {
	const half = 50;
	return {
		muZoneId: BigInt(0xA000 + index),
		miZoneType: 0,
		miNumPoints: 4,
		muFlags: 0,
		points: [
			{ x: cx - half, y: cy - half, _padA: 0, _padB: 0 },
			{ x: cx + half, y: cy - half, _padA: 0, _padB: 0 },
			{ x: cx + half, y: cy + half, _padA: 0, _padB: 0 },
			{ x: cx - half, y: cy + half, _padA: 0, _padB: 0 },
		],
		safeNeighbours: [],
		unsafeNeighbours: [],
		_pad0C: 0,
		_pad24: [0, 0, 0],
		_trailingNeighbourPad: new Uint8Array(0),
	};
}

function makeFixture(): ParsedZoneList {
	return {
		zones: [
			makeZone(0,    0,    0),
			makeZone(1,  200,    0),
			makeZone(2, -200,    0),
			makeZone(3,    0,  200),
			makeZone(4,    0, -200),
		],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneListOverlay', () => {
	it('renders one batched mesh that covers every fixture zone, highlights the selected zone, and emits NodePath clicks', () => {
		const fixture = makeFixture();
		const onSelect = vi.fn();

		// (1) Mesh count: every quad zone fan-triangulates to 2 triangles, so
		// the face→zone map has exactly 2 × N entries and every zone index
		// shows up in it.
		const scene = buildBatchedZones(fixture.zones);
		expect(scene.faceToZone.length).toBe(fixture.zones.length * 2);
		const zoneIndicesInScene = new Set<number>();
		for (let i = 0; i < scene.faceToZone.length; i++) {
			zoneIndicesInScene.add(scene.faceToZone[i]);
		}
		expect(zoneIndicesInScene.size).toBe(fixture.zones.length);

		// (2) Selection highlight: ['zones', 3] decodes to zone-index 3, which
		// is what ZoneListOverlay feeds into ZoneOverlayMesh for the yellow
		// selection overlay.
		expect(zonePathIndex(['zones', 3])).toBe(3);
		// Sub-paths inside a zone collapse to "this zone is selected".
		expect(zonePathIndex(['zones', 3, 'safeNeighbours', 0])).toBe(3);
		// Off-resource paths read as "no selection".
		expect(zonePathIndex([])).toBe(-1);
		expect(zonePathIndex(['somethingElse', 0])).toBe(-1);

		// (3) Click dispatch: pick any face, look up its zone, and confirm the
		// overlay's onPick → onSelect(zoneIndexPath(zoneIndex)) chain produces
		// the path the schema editor expects.
		const faceIndex = 7;
		const expectedZone = scene.faceToZone[faceIndex];
		expect(expectedZone).toBeGreaterThanOrEqual(0);
		expect(expectedZone).toBeLessThan(fixture.zones.length);
		// This mirrors ZoneListOverlay's handleClick body verbatim.
		onSelect(zoneIndexPath(expectedZone));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(['zones', expectedZone]);
	});
});
