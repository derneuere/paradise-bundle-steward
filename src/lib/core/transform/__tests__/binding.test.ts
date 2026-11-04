// Cross-resource / cross-Bundle bulk transform: the existential boundary.
//
// Everything here is about what happens when ONE gesture spans models of
// different types. Three properties carry real user-visible weight:
//
//   1. the shared pivot is the median over the CONCATENATION of every slice's
//      slots, not a median of per-slice medians — so a 40-corner AI section
//      outweighs a single road, exactly as it does within one resource;
//   2. the axis profile AND-intersects across slices, so one XZ-packed member
//      anywhere yaw-locks the whole gesture (ADR-0011);
//   3. a slice whose model did not actually change never calls `commit`, so an
//      untouched Bundle is never marked dirty and still writes back
//      byte-for-byte.

import { describe, it, expect } from 'vitest';
import {
	bindTransform,
	bindingsAxes,
	bindingsPivot,
	intersectAxesProfiles,
	toTransformDelta,
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	intersectTransformAxes,
	type TransformDelta,
} from '../index';
import { makeFakeModel, makeFakeResolver, type FakeModel, type FakeRef } from './_fakeResolver';

function delta(partial: Partial<TransformDelta> = {}): TransformDelta {
	return {
		translate: { x: 0, y: 0, z: 0 },
		rotate: { x: 0, y: 0, z: 0 },
		pivot: null,
		...partial,
	};
}

// ---------------------------------------------------------------------------
// intersectAxesProfiles
// ---------------------------------------------------------------------------

describe('intersectAxesProfiles', () => {
	it('returns null for an empty list — deliberately NOT FULL_3D', () => {
		// `intersectTransformAxes([])` returns FULL_3D (vacuous AND). This layer
		// must not: an empty list here means "nothing in the Selection has any
		// spatial slot", and the caller renders no gizmo at all rather than a
		// fully-enabled one that would silently no-op.
		expect(intersectAxesProfiles([])).toBeNull();
		expect(intersectTransformAxes([])).toEqual(TRANSFORM_AXES_FULL_3D);
	});

	it('returns null when every contributor is null', () => {
		expect(intersectAxesProfiles([null, null])).toBeNull();
	});

	it('skips null contributors rather than treating them as FULL_3D', () => {
		// A resource contributing zero refs must not widen the profile.
		expect(intersectAxesProfiles([null, TRANSFORM_AXES_XZ_PACKED, null]))
			.toEqual(TRANSFORM_AXES_XZ_PACKED);
	});

	it('yaw-locks the whole gesture when one XZ-packed member is present (ADR-0011)', () => {
		const got = intersectAxesProfiles([TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED]);
		expect(got).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: false, y: true, z: false },
		});
		// translate.y stays TRUE even though the XZ family has no Y storage —
		// dropping Y is the resolver's `write` job, not the axis profile's,
		// because a whole-section bulk legitimately moves portal-anchor heights.
		expect(got?.translate.y).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// bindingsPivot
// ---------------------------------------------------------------------------

describe('bindingsPivot', () => {
	const p = (x: number, y = 0, z = 0) => ({ x, y, z });

	function bind(model: FakeModel, refs: readonly FakeRef[]) {
		const { resolver } = makeFakeResolver();
		return bindTransform(resolver, model, refs, () => {});
	}

	it('is the median over the CONCATENATION, not a median of medians', () => {
		// Slice A holds three points at x = 0, 10, 100; slice B holds one at
		// x = 1000. Median of the concatenation [0, 10, 100, 1000] is
		// (10 + 100) / 2 = 55. A median-of-medians would give (10 + 1000)/2 = 505
		// — i.e. the lone outlier would count as much as three real points.
		const a = bind(makeFakeModel([p(0), p(10), p(100)]), [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 2 },
		]);
		const b = bind(makeFakeModel([p(1000)]), [{ kind: 'point', idx: 0 }]);
		expect(bindingsPivot([a, b])).toEqual({ x: 55, y: 0, z: 0 });
	});

	it('ignores slices that contribute no slots', () => {
		const a = bind(makeFakeModel([p(0), p(10), p(100)]), [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 2 },
		]);
		const empty = bind(makeFakeModel([]), []);
		// Only the inert ref kind — selectable, never transformable.
		const inert = bind(makeFakeModel([p(5000)]), [{ kind: 'inert' }]);
		expect(bindingsPivot([a, empty, inert])).toEqual({ x: 10, y: 0, z: 0 });
	});

	it('returns null when no slice contributes anything', () => {
		expect(bindingsPivot([])).toBeNull();
		expect(bindingsPivot([bind(makeFakeModel([p(1)]), [{ kind: 'inert' }])])).toBeNull();
	});

	it('takes the median per axis independently (the pivot need not be a real point)', () => {
		const a = bind(makeFakeModel([{ x: 0, y: 100, z: 0 }, { x: 100, y: 0, z: 50 }]), [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
		]);
		expect(bindingsPivot([a])).toEqual({ x: 50, y: 50, z: 25 });
	});
});

// ---------------------------------------------------------------------------
// bindingsAxes
// ---------------------------------------------------------------------------

describe('bindingsAxes', () => {
	const p = (x: number) => ({ x, y: 0, z: 0 });

	it('ANDs across slices — one XZ-packed slice yaw-locks the pure-3D slice too', () => {
		const { resolver: rA } = makeFakeResolver();
		const { resolver: rB } = makeFakeResolver();
		const roads = bindTransform(rA, makeFakeModel([p(0)]), [{ kind: 'point', idx: 0 }], () => {});
		const zones = bindTransform(
			rB,
			makeFakeModel([p(0)], [[0]]),
			[{ kind: 'group', idx: 0 }],
			() => {},
		);
		expect(bindingsAxes([roads, zones])).toEqual({
			translate: { x: true, y: true, z: true },
			rotate: { x: false, y: true, z: false },
		});
	});

	it('returns null when no slice has refs, so the caller renders no gizmo', () => {
		const { resolver } = makeFakeResolver();
		const empty = bindTransform(resolver, makeFakeModel([p(0)]), [], () => {});
		expect(bindingsAxes([empty])).toBeNull();
		expect(bindingsAxes([])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// bindTransform.apply
// ---------------------------------------------------------------------------

describe('bindTransform.apply', () => {
	const p = (x: number) => ({ x, y: 0, z: 0 });

	it('commits once per slice that actually moved', () => {
		const { resolver } = makeFakeResolver();
		const model = makeFakeModel([p(0)]);
		const commits: FakeModel[] = [];
		const b = bindTransform(resolver, model, [{ kind: 'point', idx: 0 }], (next) => commits.push(next));

		b.apply(delta({ translate: { x: 5, y: 0, z: 0 } }));

		expect(commits).toHaveLength(1);
		expect(commits[0].points[0]).toEqual({ x: 5, y: 0, z: 0 });
		// Copy-on-write: the caller's model object is untouched.
		expect(model.points[0]).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('never commits on an identity delta — an untouched Bundle stays clean', () => {
		// This is the reference-identity contract at the Bundle level: a
		// cross-Bundle gesture where one Bundle contributes nothing must not
		// mark that Bundle dirty, or its writeback stops being byte-exact.
		const { resolver } = makeFakeResolver();
		let commits = 0;
		const b = bindTransform(resolver, makeFakeModel([p(0)]), [{ kind: 'point', idx: 0 }], () => {
			commits++;
		});
		b.apply(delta());
		expect(commits).toBe(0);
	});

	it('never commits when the slice has no transformable refs', () => {
		const { resolver } = makeFakeResolver();
		let commits = 0;
		const b = bindTransform(resolver, makeFakeModel([p(0)]), [{ kind: 'inert' }], () => {
			commits++;
		});
		b.apply(delta({ translate: { x: 5, y: 0, z: 0 } }));
		expect(commits).toBe(0);
	});

	it('exposes the resolver id so bindings stay attributable in diagnostics', () => {
		const { resolver } = makeFakeResolver();
		expect(bindTransform(resolver, makeFakeModel([]), [], () => {}).id).toBe('fake');
	});
});

// ---------------------------------------------------------------------------
// toTransformDelta
// ---------------------------------------------------------------------------

describe('toTransformDelta', () => {
	it('carries translate and rotate through and attaches the snapshot pivot', () => {
		const pivot = { x: 1, y: 2, z: 3 };
		expect(
			toTransformDelta(
				{ translate: { x: 4, y: 5, z: 6 }, rotate: { x: 0, y: 0.5, z: 0 } },
				pivot,
			),
		).toEqual({
			translate: { x: 4, y: 5, z: 6 },
			rotate: { x: 0, y: 0.5, z: 0 },
			pivot,
		});
	});

	it('accepts a null pivot so transform() falls back to the live slot median', () => {
		// A commit that arrives with no preceding `onTransform` frame used to
		// drop the rotation entirely; now it just loses the snapshot and
		// re-derives from the pre-gesture model.
		const d = toTransformDelta(
			{ translate: { x: 0, y: 0, z: 0 }, rotate: { x: 0, y: 1, z: 0 } },
			null,
		);
		expect(d.pivot).toBeNull();
	});

	it('drops the gizmo-only `cascade` flag — cascade changes the REF LIST, not the delta', () => {
		const withCascade = {
			translate: { x: 1, y: 0, z: 0 },
			rotate: { x: 0, y: 0, z: 0 },
			cascade: true,
		};
		const d = toTransformDelta(withCascade, null);
		expect('cascade' in d).toBe(false);
	});
});
