// A minimal hand-built `Resolver` for the core transform tests.
//
// Deliberately not any real resource: the core must be provable without a
// parsed Bundle. It still exercises every mechanism the real resolvers rely
// on — container refs that expand to many slots, refs that expand to nothing,
// slots that fail to resolve, key-based subsumption, batched copy-on-write
// with the reference-identity contract.

import type { Point, Resolver, SlotWrite } from '../types';
import { TRANSFORM_AXES_FULL_3D, TRANSFORM_AXES_XZ_PACKED } from '../../transformAxes';

/** `points` may hold nulls — those slots expand but fail to resolve, standing
 *  in for a real resource's out-of-range sub-entity. */
export type FakeModel = {
	points: readonly (Point | null)[];
	groups: readonly (readonly number[])[];
};

export type FakeRef =
	| { kind: 'point'; idx: number }
	| { kind: 'group'; idx: number }
	/** Selectable but deliberately not transformable, like a whole-boundary-line
	 *  marker or trigger-data `playerStart`. */
	| { kind: 'inert' };

export type FakeSlot = { idx: number };

export type FakeResolverProbe = {
	resolver: Resolver<FakeModel, FakeRef, FakeSlot>;
	/** One entry per `write` call — length pins the BATCHED contract. */
	writeCalls: SlotWrite<FakeSlot>[][];
	/** Every model reference `resolve` was handed, for the W1 check. */
	resolveModels: FakeModel[];
};

export function makeFakeModel(points: readonly (Point | null)[], groups: readonly (readonly number[])[] = []): FakeModel {
	return { points, groups };
}

export function makeFakeResolver(): FakeResolverProbe {
	const writeCalls: SlotWrite<FakeSlot>[][] = [];
	const resolveModels: FakeModel[] = [];

	const resolver: Resolver<FakeModel, FakeRef, FakeSlot> = {
		id: 'fake',

		expand(model, ref) {
			if (ref.kind === 'inert') return [];
			if (ref.kind === 'point') {
				// Out of range expands to nothing rather than throwing.
				return ref.idx >= 0 && ref.idx < model.points.length ? [{ idx: ref.idx }] : [];
			}
			const group = model.groups[ref.idx];
			if (!group) return [];
			return group
				.filter((i) => i >= 0 && i < model.points.length)
				.map((i) => ({ idx: i }));
		},

		key(slot) {
			return `p${slot.idx}`;
		},

		resolve(model, slot) {
			resolveModels.push(model);
			return model.points[slot.idx] ?? null;
		},

		write(model, writes) {
			writeCalls.push([...writes]);
			const next = model.points.slice();
			let changed = false;
			for (const w of writes) {
				const cur = next[w.slot.idx];
				if (!cur) continue;
				if (cur.x === w.point.x && cur.y === w.point.y && cur.z === w.point.z) continue;
				next[w.slot.idx] = { x: w.point.x, y: w.point.y, z: w.point.z };
				changed = true;
			}
			// Reference identity: nothing actually moved, so the Bundle stays clean.
			if (!changed) return model;
			return { ...model, points: next };
		},

		axes(refs) {
			if (refs.length === 0) return null;
			// Groups stand in for an XZ-packed family, points for a full-3D one.
			return refs.some((r) => r.kind === 'group')
				? TRANSFORM_AXES_XZ_PACKED
				: TRANSFORM_AXES_FULL_3D;
		},
	};

	return { resolver, writeCalls, resolveModels };
}
