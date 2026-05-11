// Unit test pinning the **Cascade** modifier semantics (issue #75) on the
// `BulkTransformDelta` carrier and the `identityDelta` / `isIdentityDelta`
// helpers. The full drag hook itself is window-event-driven and lives
// inside an R3F component context — we exercise it end-to-end via the
// AISectionsOverlay tests rather than here.
//
// What this file pins:
//   - `BulkTransformDelta.cascade` exists on the type and is forwarded
//     through `identityDelta(cascade)` so consumers always see a stable
//     flag (cascade-off identity is the existing zero-delta shape; cascade-
//     on identity carries the modifier through even when the spatial part
//     is zero, so a Shift-tap that doesn't move the mouse still routes
//     through the cascade-on commit path).
//   - `isIdentityDelta` ignores cascade — it only cares about the spatial
//     transform. A zero translate/rotate with cascade=true is still a no-op
//     gesture (nothing to push to the undo stack).
//
// The "captured at gesture start, not continuously" invariant is asserted
// at the source — `BulkTransformGizmo.beginTranslate` / `.beginRotate`
// each read `e.nativeEvent.shiftKey` once on pointerdown and write it
// into `dragStartRef.current.cascade`. The hook then propagates that
// snapshot into every per-frame delta via `start.cascade` in both
// `computeTranslateDelta` and `computeRotateDelta`. There is no code path
// that re-reads the modifier state mid-gesture.

import { describe, it, expect } from 'vitest';
import {
	identityDelta,
	isIdentityDelta,
	type BulkTransformDelta,
} from '../useBulkTransformDrag';

describe('BulkTransformDelta.cascade (issue #75)', () => {
	it('identityDelta() defaults cascade to false', () => {
		const d = identityDelta();
		expect(d.cascade).toBe(false);
		expect(d.translate).toEqual({ x: 0, y: 0, z: 0 });
		expect(d.rotate).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('identityDelta(true) carries cascade=true through to the consumer', () => {
		const d = identityDelta(true);
		expect(d.cascade).toBe(true);
	});

	it('isIdentityDelta ignores the cascade flag — only the spatial delta counts', () => {
		// A Shift-tap on the gizmo with no mouse motion still produces a
		// cascade=true identity delta. The consumer should treat it as a
		// no-op gesture (don't push to undo stack) — same as cascade=false.
		const cascadeOnNoMotion: BulkTransformDelta = {
			translate: { x: 0, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: true,
		};
		expect(isIdentityDelta(cascadeOnNoMotion)).toBe(true);

		const cascadeOffNoMotion: BulkTransformDelta = {
			translate: { x: 0, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: false,
		};
		expect(isIdentityDelta(cascadeOffNoMotion)).toBe(true);
	});

	it('a non-zero translate with cascade=true is NOT an identity delta', () => {
		const d: BulkTransformDelta = {
			translate: { x: 5, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: true,
		};
		expect(isIdentityDelta(d)).toBe(false);
	});

	it('a non-zero rotate with cascade=true is NOT an identity delta', () => {
		const d: BulkTransformDelta = {
			translate: { x: 0, y: 0, z: 0 },
			rotate: { x: 0, y: 0.3, z: 0 },
			cascade: true,
		};
		expect(isIdentityDelta(d)).toBe(false);
	});

	it('the cascade field is required on the BulkTransformDelta type (compile-time-pinned at runtime via every consumer)', () => {
		// This is a compile-time invariant — TypeScript guarantees every
		// producer of BulkTransformDelta sets `cascade`. The runtime check
		// is just that `identityDelta()` returns a value with the key
		// physically present (not undefined) so consumers can branch on it
		// without type-narrow gymnastics.
		const d = identityDelta();
		expect('cascade' in d).toBe(true);
		expect(typeof d.cascade).toBe('boolean');
	});
});
