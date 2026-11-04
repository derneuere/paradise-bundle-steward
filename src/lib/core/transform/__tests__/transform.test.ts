// Behaviour pins for the shared **Bulk transform** core, against a hand-built
// fake resolver (see `_fakeResolver.ts`) so nothing here depends on a parsed
// Bundle.
//
// What this file protects:
//   - slot expansion + dedupe, and the **Pivot** median taken over it
//   - reference identity on a no-op (drives every overlay's `next !== data`
//     gate and therefore per-Bundle dirty state)
//   - compose order: translate, then rotate about the TRANSLATE-ADJUSTED pivot
//
// The `write`-payload contracts (batching, subsumption, `spin`, W1) are in
// `transform.writes.test.ts`.

import { describe, it, expect } from 'vitest';

import { resolveSlots, selectionPivot, transform } from '../transform';
import { makeFakeModel, makeFakeResolver, type FakeRef } from './_fakeResolver';
import { delta, expectPoint } from './_helpers';

describe('resolveSlots', () => {
	it('dedupes by resolver key, first occurrence wins, order stable', () => {
		// A whole-container ref plus one of its own members: the member must
		// appear exactly once, in the order the container introduced it.
		const model = makeFakeModel(
			[
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 0, z: 0 },
				{ x: 2, y: 0, z: 0 },
			],
			[[0, 1]],
		);
		const { resolver } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'group', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 2 },
		];

		expect(resolveSlots(model, refs, resolver).map((s) => s.slot.idx)).toEqual([0, 1, 2]);
	});

	it('drops slots that fail to resolve instead of throwing', () => {
		const model = makeFakeModel([{ x: 5, y: 0, z: 0 }, null]);
		const { resolver } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 99 },
		];

		expect(resolveSlots(model, refs, resolver).map((s) => s.slot.idx)).toEqual([0]);
	});
});

describe('selectionPivot', () => {
	it('is the per-axis median over the resolved slots', () => {
		const model = makeFakeModel([
			{ x: 0, y: 10, z: 100 },
			{ x: 1, y: 0, z: 300 },
			{ x: 2, y: 20, z: 200 },
		]);
		const { resolver } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 2 },
		];

		expect(selectionPivot(model, refs, resolver)).toEqual({ x: 1, y: 10, z: 200 });
	});

	it('samples each slot once, so a duplicated ref no longer skews it', () => {
		// Legacy per-resource pivot samplers did NOT dedupe while their
		// transform paths did. Both now run over the same slot list.
		const model = makeFakeModel([
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 0, z: 0 },
			{ x: 30, y: 0, z: 0 },
		]);
		const { resolver } = makeFakeResolver();
		const deduped: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 2 },
			{ kind: 'point', idx: 2 },
		];

		expect(selectionPivot(model, deduped, resolver)).toEqual({ x: 15, y: 0, z: 0 });
	});

	it('is null when nothing resolves', () => {
		const { resolver } = makeFakeResolver();
		expect(selectionPivot(makeFakeModel([]), [], resolver)).toBeNull();
		expect(selectionPivot(makeFakeModel([null]), [{ kind: 'point', idx: 0 }], resolver)).toBeNull();
	});
});

describe('transform — no-ops return the SAME model reference', () => {
	const model = makeFakeModel([{ x: 1, y: 2, z: 3 }], [[0]]);

	it('for an identity delta', () => {
		const { resolver, writeCalls } = makeFakeResolver();
		const next = transform(model, [{ kind: 'point', idx: 0 }], delta(), resolver);
		expect(next).toBe(model);
		expect(writeCalls).toHaveLength(0);
	});

	it('for an empty refs list', () => {
		const { resolver, writeCalls } = makeFakeResolver();
		const next = transform(model, [], delta({ translate: { x: 5, y: 0, z: 0 } }), resolver);
		expect(next).toBe(model);
		expect(writeCalls).toHaveLength(0);
	});

	it('for refs whose expansion is empty (selectable, not transformable)', () => {
		const { resolver, writeCalls } = makeFakeResolver();
		const refs: FakeRef[] = [{ kind: 'inert' }, { kind: 'point', idx: 99 }];
		const next = transform(model, refs, delta({ translate: { x: 5, y: 0, z: 0 } }), resolver);
		expect(next).toBe(model);
		expect(writeCalls).toHaveLength(0);
	});

	it('for refs that expand but resolve to nothing', () => {
		const holed = makeFakeModel([null]);
		const { resolver, writeCalls } = makeFakeResolver();
		const next = transform(holed, [{ kind: 'point', idx: 0 }], delta({ translate: { x: 5, y: 0, z: 0 } }), resolver);
		expect(next).toBe(holed);
		expect(writeCalls).toHaveLength(0);
	});

	it('when the resolver reports nothing actually changed', () => {
		// A lone slot sitting exactly on the pivot orbits to its own position,
		// so `write` sees no numeric change and hands the model straight back.
		const { resolver, writeCalls } = makeFakeResolver();
		const next = transform(
			model,
			[{ kind: 'point', idx: 0 }],
			delta({ rotate: { x: 0, y: Math.PI / 3, z: 0 }, pivot: { x: 1, y: 2, z: 3 } }),
			resolver,
		);
		expect(next).toBe(model);
		expect(writeCalls).toHaveLength(1);
	});
});

describe('transform — compose order', () => {
	// p0 and p1 straddle x = 10, so the derived median pivot is (10, 0, 0).
	const model = makeFakeModel([
		{ x: 0, y: 0, z: 0 },
		{ x: 20, y: 0, z: 0 },
	]);
	const refs: FakeRef[] = [
		{ kind: 'point', idx: 0 },
		{ kind: 'point', idx: 1 },
	];

	it('translates every slot when there is no rotation', () => {
		const { resolver } = makeFakeResolver();
		const next = transform(model, refs, delta({ translate: { x: 1, y: 2, z: 3 } }), resolver);
		expect(next.points).toEqual([
			{ x: 1, y: 2, z: 3 },
			{ x: 21, y: 2, z: 3 },
		]);
	});

	it('rotates about the TRANSLATE-ADJUSTED pivot', () => {
		// translate (0,0,50) then yaw +90 deg about pivot (10,0,0):
		// the pivot moves to (10,0,50) and each slot orbits THAT.
		//   p0 -> (0,0,50), rel (-10,0,0), +X->-Z yaw => (0,0,+10) => (10,0,60)
		//   p1 -> (20,0,50), rel (10,0,0)             => (0,0,-10) => (10,0,40)
		const { resolver } = makeFakeResolver();
		const next = transform(
			model,
			refs,
			delta({
				translate: { x: 0, y: 0, z: 50 },
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
				pivot: { x: 10, y: 0, z: 0 },
			}),
			resolver,
		);

		expectPoint(next.points[0], { x: 10, y: 0, z: 60 });
		expectPoint(next.points[1], { x: 10, y: 0, z: 40 });
	});

	it('is NOT rotation about the un-moved pivot', () => {
		// The contrast case for the assertion above. (Rotating about the moved
		// pivot after translating is algebraically the same as rotating about
		// the original pivot and then translating — those two are not what can
		// go wrong. Forgetting to move the pivot is.)
		const { resolver } = makeFakeResolver();
		const next = transform(
			model,
			refs,
			delta({
				translate: { x: 0, y: 0, z: 50 },
				rotate: { x: 0, y: Math.PI / 2, z: 0 },
				pivot: { x: 10, y: 0, z: 0 },
			}),
			resolver,
		);

		// Rotating (0,0,50) about the un-moved (10,0,0) would land at (60,0,10).
		expect(next.points[0]!.x).toBeCloseTo(10, 10);
		expect(next.points[0]!.x).not.toBeCloseTo(60, 6);
	});

	it('uses the supplied gesture-start pivot verbatim, never re-deriving it', () => {
		// Re-deriving the pivot from moving positions each frame is the spiral
		// bug. A pivot the user dragged away from the slot median must be
		// honoured exactly.
		const { resolver } = makeFakeResolver();
		const next = transform(
			model,
			refs,
			delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }),
			resolver,
		);

		expectPoint(next.points[0], { x: 0, y: 0, z: 0 });
		expectPoint(next.points[1], { x: 0, y: 0, z: -20 });
	});

	it('falls back to the slot median when no pivot snapshot is supplied', () => {
		// A commit that arrives with no preceding drag frame must still rotate
		// rather than silently applying the translate only.
		const { resolver } = makeFakeResolver();
		const next = transform(model, refs, delta({ rotate: { x: 0, y: Math.PI / 2, z: 0 } }), resolver);

		expectPoint(next.points[0], { x: 10, y: 0, z: 10 });
		expectPoint(next.points[1], { x: 10, y: 0, z: -10 });
	});
});
