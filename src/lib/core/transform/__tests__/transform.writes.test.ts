// The `write` half of the shared **Bulk transform** contract: batching, slot
// dedupe / whole-container subsumption, the `spin` payload, reference identity
// of untouched sub-objects, and contract W1 (`resolve` never sees a
// mid-gesture model). Compose order and the no-op cases live in
// `transform.test.ts`.

import { describe, it, expect } from 'vitest';

import { transform } from '../transform';
import { makeFakeModel, makeFakeResolver, type FakeRef } from './_fakeResolver';
import { delta } from './_helpers';

const model = makeFakeModel(
	[
		{ x: 0, y: 0, z: 0 },
		{ x: 10, y: 0, z: 0 },
		{ x: 20, y: 0, z: 0 },
	],
	[[0, 1]],
);

describe('transform — write payload', () => {
	it('calls write exactly once, with every slot', () => {
		// Batched rather than folded per slot: a 500-section bulk is ~5,000
		// slots, and per-slot folding would rebuild the model array 5,000 times
		// per drag frame.
		const { resolver, writeCalls } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
			{ kind: 'point', idx: 2 },
		];
		transform(model, refs, delta({ translate: { x: 1, y: 0, z: 0 } }), resolver);

		expect(writeCalls).toHaveLength(1);
		expect(writeCalls[0].map((w) => w.slot.idx)).toEqual([0, 1, 2]);
	});

	it('subsumes a member ref into its container ref — one write per slot', () => {
		// {group 0} covers points 0 and 1; picking point 1 as well must not
		// translate it twice, and with `spin` in play a double write would also
		// double-compose the rotation into an orientation.
		const { resolver, writeCalls } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'group', idx: 0 },
			{ kind: 'point', idx: 1 },
		];
		const next = transform(model, refs, delta({ translate: { x: 100, y: 0, z: 0 } }), resolver);

		expect(writeCalls[0].map((w) => w.slot.idx)).toEqual([0, 1]);
		expect(next.points).toEqual([
			{ x: 100, y: 0, z: 0 },
			{ x: 110, y: 0, z: 0 },
			{ x: 20, y: 0, z: 0 },
		]);
	});

	it('applies a duplicated ref once', () => {
		// Marquee ∪ inspector picks routinely produce duplicates.
		const { resolver, writeCalls } = makeFakeResolver();
		const refs: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 0 },
		];
		const next = transform(model, refs, delta({ translate: { x: 7, y: 0, z: 0 } }), resolver);

		expect(writeCalls[0]).toHaveLength(1);
		expect(next.points[0]).toEqual({ x: 7, y: 0, z: 0 });
	});

	it('leaves untouched entries at their original references', () => {
		// Structural sharing is a correctness requirement for byte-for-byte
		// writeback and a UI signal (the AI-sections overlay paints
		// cascade-affected neighbours by `!==`), not a perf tweak.
		const { resolver } = makeFakeResolver();
		const next = transform(
			model,
			[{ kind: 'point', idx: 0 }],
			delta({ translate: { x: 7, y: 0, z: 0 } }),
			resolver,
		);

		expect(next).not.toBe(model);
		expect(next.points[1]).toBe(model.points[1]);
		expect(next.points[2]).toBe(model.points[2]);
	});

	it('carries spin only when the gesture rotates, identically for every slot', () => {
		const refs: FakeRef[] = [
			{ kind: 'point', idx: 0 },
			{ kind: 'point', idx: 1 },
		];

		const translateOnly = makeFakeResolver();
		transform(model, refs, delta({ translate: { x: 1, y: 0, z: 0 } }), translateOnly.resolver);
		expect(translateOnly.writeCalls[0].map((w) => w.spin)).toEqual([null, null]);

		const rotating = makeFakeResolver();
		const rotate = { x: 0, y: 0.5, z: 0 };
		transform(model, refs, delta({ rotate }), rotating.resolver);
		expect(rotating.writeCalls[0].map((w) => w.spin)).toEqual([rotate, rotate]);
	});
});

describe('transform — contract W1', () => {
	it('only ever resolves against the pre-gesture model', () => {
		// Nothing may read back its own writes; derived data (AI-section corner
		// Ys) is computed once per gesture against this exact model reference.
		const pre = makeFakeModel([
			{ x: 0, y: 0, z: 0 },
			{ x: 10, y: 0, z: 0 },
		]);
		const { resolver, resolveModels } = makeFakeResolver();
		transform(
			pre,
			[
				{ kind: 'point', idx: 0 },
				{ kind: 'point', idx: 1 },
			],
			delta({ translate: { x: 1, y: 1, z: 1 }, rotate: { x: 0, y: 0.25, z: 0 } }),
			resolver,
		);

		expect(resolveModels).toHaveLength(2);
		for (const m of resolveModels) expect(m).toBe(pre);
	});
});
