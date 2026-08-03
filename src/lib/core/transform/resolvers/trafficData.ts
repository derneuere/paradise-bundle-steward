// The traffic-data half of the shared **Bulk transform**.
//
// Traffic data is the only resource that mixes BOTH of the editor's rotation
// representations inside a single gesture, which is exactly why it used to
// counter-rotate:
//
//   * Yaw-packed `Vec4` boxes — junction logic boxes (`mPosition`), light
//     triggers (`mPosPlusYRot`), traffic-light instances
//     (`posAndYRotations[]`) and coronas (`coronaPositions[]`) — carry
//     `(x, y, z)` in the XYZ slots and the entity's OWN heading, in radians
//     about world +Y, packed into `.w`.
//   * Static traffic vehicles carry a full `Matrix44Affine` (`mTransform`),
//     so their basis takes the whole three-axis delta.
//
// Both families now receive the SAME `spin`, and the orbit for both is
// computed once by `rotatePointAboutPivot` — so the two can no longer
// disagree about which way +Y turns. `__tests__/resolvers/trafficData.test.ts`
// pins that agreement element-for-element.
//
// Deliberate non-slots (a generic "walk every Vec4" resolver would corrupt
// all of them): `TrafficPvs.mGridMin` / `mCellSize` / `mRecipCellSize` are a
// spatial-hash grid origin and stride, not entity positions — moving them
// re-bins the whole PVS. `TrafficLightTrigger.mDimensions` is a half-extent.
// `TrafficLightTriggerStartData.maStartingPositions/Directions` are grid
// placements. `TrafficHull.cumulativeRungLengths` is index-parallel to
// `rungs` and is authored data the game reads for lane arc-length lookups —
// it is NEVER recomputed here, even when a rung moves.

import type {
	ParsedTrafficDataRetail,
	TrafficHull,
	TrafficJunctionLogicBox,
	TrafficLaneRung,
	TrafficLightCollection,
	TrafficLightTrigger,
	Vec4,
} from '../../trafficData';
import {
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	intersectTransformAxes,
} from '../../transformAxes';
import type { Point, Resolver, SlotWrite } from '../types';
import { patchList, writeVehicle, writeYawBox } from './trafficDataPacking';

/** Discriminated reference to a selectable traffic-data entity. */
export type TrafficDataRef =
	| { kind: 'junction'; hullIdx: number; junctionIdx: number }
	| { kind: 'lightTrigger'; hullIdx: number; triggerIdx: number }
	| { kind: 'lightInstance'; instanceIdx: number }
	| { kind: 'corona'; coronaIdx: number }
	| { kind: 'laneRung'; hullIdx: number; rungIdx: number }
	| { kind: 'staticVehicle'; hullIdx: number; vehicleIdx: number };

/**
 * Slots differ from refs only for lane rungs: a rung is a two-endpoint
 * segment (`maPoints[2]`), so it addresses two independent positions. Both
 * are resolved from the pre-gesture model before either is written (contracts
 * W1/W2), which is what keeps the segment rigid instead of letting the second
 * write re-rotate the first.
 */
export type TrafficDataSlot =
	| Exclude<TrafficDataRef, { kind: 'laneRung' }>
	| { kind: 'laneRungPoint'; hullIdx: number; rungIdx: number; pointIdx: 0 | 1 };

export type TrafficDataResolverT = Resolver<
	ParsedTrafficDataRetail,
	TrafficDataRef,
	TrafficDataSlot
>;

type Edit = SlotWrite<TrafficDataSlot>;

type HullEdits = {
	junctions: Map<number, Edit>;
	lightTriggers: Map<number, Edit>;
	vehicles: Map<number, Edit>;
	/** rungIdx -> endpoint index -> write. */
	rungs: Map<number, Map<number, Edit>>;
};

function emptyHullEdits(): HullEdits {
	return {
		junctions: new Map(),
		lightTriggers: new Map(),
		vehicles: new Map(),
		rungs: new Map(),
	};
}

export const trafficDataResolver: TrafficDataResolverT = {
	id: 'trafficData',

	// Only lane rungs are containers. Out-of-range indices are not filtered
	// here — `resolve` nulls them and `resolveSlots` drops them, keeping one
	// silent-skip path (the old ops threw RangeError; nothing guarded first).
	expand(_model, ref) {
		if (ref.kind !== 'laneRung') return [ref];
		return [
			{ kind: 'laneRungPoint', hullIdx: ref.hullIdx, rungIdx: ref.rungIdx, pointIdx: 0 },
			{ kind: 'laneRungPoint', hullIdx: ref.hullIdx, rungIdx: ref.rungIdx, pointIdx: 1 },
		];
	},

	key(slot) {
		switch (slot.kind) {
			case 'junction':
				return `junction:${slot.hullIdx}:${slot.junctionIdx}`;
			case 'lightTrigger':
				return `lightTrigger:${slot.hullIdx}:${slot.triggerIdx}`;
			case 'lightInstance':
				return `lightInstance:${slot.instanceIdx}`;
			case 'corona':
				return `corona:${slot.coronaIdx}`;
			case 'laneRungPoint':
				return `laneRungPoint:${slot.hullIdx}:${slot.rungIdx}:${slot.pointIdx}`;
			case 'staticVehicle':
				return `staticVehicle:${slot.hullIdx}:${slot.vehicleIdx}`;
		}
	},

	// Copies, never live handles into the pre-gesture model: the caller holds
	// these for the whole gesture.
	resolve(model, slot) {
		const xyz = (v: Vec4 | undefined): Point | null =>
			v ? { x: v.x, y: v.y, z: v.z } : null;
		switch (slot.kind) {
			case 'junction':
				return xyz(model.hulls[slot.hullIdx]?.junctions[slot.junctionIdx]?.mPosition);
			case 'lightTrigger':
				return xyz(model.hulls[slot.hullIdx]?.lightTriggers[slot.triggerIdx]?.mPosPlusYRot);
			case 'lightInstance':
				return xyz(model.trafficLights.posAndYRotations[slot.instanceIdx]);
			case 'corona':
				return xyz(model.trafficLights.coronaPositions[slot.coronaIdx]);
			case 'laneRungPoint':
				return xyz(model.hulls[slot.hullIdx]?.rungs[slot.rungIdx]?.maPoints[slot.pointIdx]);
			case 'staticVehicle': {
				const t = model.hulls[slot.hullIdx]?.staticTrafficVehicles[slot.vehicleIdx]
					?.mTransform;
				return t ? { x: t[12] ?? 0, y: t[13] ?? 0, z: t[14] ?? 0 } : null;
			}
		}
	},

	write(model, writes) {
		if (writes.length === 0) return model;

		const hullEdits = new Map<number, HullEdits>();
		const forHull = (h: number): HullEdits => {
			let e = hullEdits.get(h);
			if (!e) hullEdits.set(h, (e = emptyHullEdits()));
			return e;
		};
		const instanceEdits = new Map<number, Edit>();
		const coronaEdits = new Map<number, Edit>();

		for (const w of writes) {
			switch (w.slot.kind) {
				case 'junction':
					forHull(w.slot.hullIdx).junctions.set(w.slot.junctionIdx, w);
					break;
				case 'lightTrigger':
					forHull(w.slot.hullIdx).lightTriggers.set(w.slot.triggerIdx, w);
					break;
				case 'staticVehicle':
					forHull(w.slot.hullIdx).vehicles.set(w.slot.vehicleIdx, w);
					break;
				case 'laneRungPoint': {
					const rungs = forHull(w.slot.hullIdx).rungs;
					let pts = rungs.get(w.slot.rungIdx);
					if (!pts) rungs.set(w.slot.rungIdx, (pts = new Map()));
					pts.set(w.slot.pointIdx, w);
					break;
				}
				case 'lightInstance':
					instanceEdits.set(w.slot.instanceIdx, w);
					break;
				case 'corona':
					coronaEdits.set(w.slot.coronaIdx, w);
					break;
			}
		}

		let hullsChanged = false;
		const nextHulls = model.hulls.map((hull, hullIdx): TrafficHull => {
			const edits = hullEdits.get(hullIdx);
			if (!edits) return hull;

			const junctions = patchList(
				hull.junctions,
				edits.junctions,
				(j, w): TrafficJunctionLogicBox => {
					const mPosition = writeYawBox(j.mPosition, w, true);
					return mPosition === j.mPosition ? j : { ...j, mPosition };
				},
			);
			// `mDimensions` (the trigger's half-extent) rides along untouched.
			const lightTriggers = patchList(
				hull.lightTriggers,
				edits.lightTriggers,
				(t, w): TrafficLightTrigger => {
					const mPosPlusYRot = writeYawBox(t.mPosPlusYRot, w, true);
					return mPosPlusYRot === t.mPosPlusYRot ? t : { ...t, mPosPlusYRot };
				},
			);
			const staticTrafficVehicles = patchList(
				hull.staticTrafficVehicles,
				edits.vehicles,
				writeVehicle,
			);

			let rungsChanged = false;
			const rungs = edits.rungs.size === 0
				? hull.rungs
				: hull.rungs.map((r, i): TrafficLaneRung => {
						const pts = edits.rungs.get(i);
						if (!pts) return r;
						const a = pts.get(0);
						const b = pts.get(1);
						const p0 = a ? writeYawBox(r.maPoints[0], a, false) : r.maPoints[0];
						const p1 = b ? writeYawBox(r.maPoints[1], b, false) : r.maPoints[1];
						if (p0 === r.maPoints[0] && p1 === r.maPoints[1]) return r;
						rungsChanged = true;
						return { maPoints: [p0, p1] };
					});

			if (
				junctions === hull.junctions
				&& lightTriggers === hull.lightTriggers
				&& staticTrafficVehicles === hull.staticTrafficVehicles
				&& !rungsChanged
			) {
				return hull;
			}
			hullsChanged = true;
			// Spread, so `cumulativeRungLengths` (index-parallel authored lane
			// arc lengths) and every other hull field carry over by reference.
			// Moving a rung does NOT invalidate them: the game indexes them by
			// rung ordinal, and recomputing would rewrite authored data.
			return {
				...hull,
				junctions,
				lightTriggers,
				rungs: rungsChanged ? rungs : hull.rungs,
				staticTrafficVehicles,
			};
		});

		let lights: TrafficLightCollection = model.trafficLights;
		const posAndYRotations = patchList(
			lights.posAndYRotations,
			instanceEdits,
			(v, w) => writeYawBox(v, w, true),
		);
		const coronaPositions = patchList(
			lights.coronaPositions,
			coronaEdits,
			(v, w) => writeYawBox(v, w, true),
		);
		const lightsChanged = posAndYRotations !== lights.posAndYRotations
			|| coronaPositions !== lights.coronaPositions;
		if (lightsChanged) lights = { ...lights, posAndYRotations, coronaPositions };

		if (!hullsChanged && !lightsChanged) return model;
		return {
			...model,
			...(hullsChanged ? { hulls: nextHulls } : {}),
			...(lightsChanged ? { trafficLights: lights } : {}),
		};
	},

	/**
	 * Static vehicles are the family's only full-3D contributor (a Matrix44
	 * has somewhere for pitch and roll to land). Every other kind is
	 * XZ-packed, so one junction / light trigger / corona / lane rung
	 * anywhere in the Selection AND-collapses pitch and roll off for the
	 * whole gesture (ADR-0011) — including for the static vehicles, which
	 * then take the yaw-only delta through their matrix path.
	 */
	axes(refs) {
		if (refs.length === 0) return null;
		return intersectTransformAxes(
			refs.map((r) =>
				r.kind === 'staticVehicle' ? TRANSFORM_AXES_FULL_3D : TRANSFORM_AXES_XZ_PACKED,
			),
		);
	},
};
