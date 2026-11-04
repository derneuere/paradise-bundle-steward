// How each traffic-data storage representation receives one `SlotWrite`.
//
// Split out of `trafficData.ts` because these three-argument packing rules
// are where the resource's real domain knowledge lives, and they read better
// with room for the "why" than inlined between the resolver's methods.

import * as THREE from 'three';

import type { TrafficStaticVehicle, Vec4 } from '../../trafficData';
import type { SlotWrite } from '../types';

// ---------------------------------------------------------------------------
// Matrix44Affine <-> THREE.Matrix4 (static traffic vehicles)
// ---------------------------------------------------------------------------
//
// The on-disk layout is 16 sequential f32s with the translation at [12..14],
// i.e. column-major from three.js's point of view, so `fromArray` maps 1:1
// (the viewport draws these vehicles with the very same call). The pad slots
// [3], [7], [11], [15] are ZERO on disk rather than the homogeneous
// `[0,0,0,1]` — `readMatrix` patches them in so the multiply isn't
// degenerate, and `writeMatrix` patches them back out so writeback stays
// byte-identical.

export function readMatrix(mTransform: readonly number[]): THREE.Matrix4 {
	const m = new THREE.Matrix4().fromArray(mTransform);
	const e = m.elements;
	e[3] = 0;
	e[7] = 0;
	e[11] = 0;
	e[15] = 1;
	return m;
}

export function writeMatrix(mat: THREE.Matrix4): number[] {
	const arr = mat.toArray();
	arr[3] = 0;
	arr[7] = 0;
	arr[11] = 0;
	arr[15] = 0;
	return arr;
}

/**
 * Pre-multiply the vehicle's basis by the gesture rotation and stamp the
 * authoritative position from the shared math.
 *
 * Pre-, not post-: `R · M` turns the world `M` lives in, which is the
 * rigid-body reading the gizmo promises; `M · R` would spin the vehicle in
 * its own local frame instead. The old op hand-rolled the whole
 * `T(P) · R · T(-P) · M` sandwich, whose ordering was only ever guarded by
 * the cross-validation suite; here the orbit is already baked into
 * `w.point`, so only the basis is composed and the sandwich cannot be
 * mis-ordered.
 *
 * Returns the input vehicle when nothing moved, so an unchanged vehicle
 * re-encodes to the bytes it was parsed from.
 */
export function writeVehicle<S>(
	vehicle: TrafficStaticVehicle,
	w: SlotWrite<S>,
): TrafficStaticVehicle {
	const t = vehicle.mTransform;
	if (!w.spin && t[12] === w.point.x && t[13] === w.point.y && t[14] === w.point.z) {
		return vehicle;
	}
	let arr: number[];
	if (w.spin) {
		const m = readMatrix(t);
		m.premultiply(
			new THREE.Matrix4().makeRotationFromEuler(
				new THREE.Euler(w.spin.x, w.spin.y, w.spin.z, 'XYZ'),
			),
		);
		arr = writeMatrix(m);
	} else {
		arr = t.slice();
	}
	arr[12] = w.point.x;
	arr[13] = w.point.y;
	arr[14] = w.point.z;
	return { ...vehicle, mTransform: arr };
}

// ---------------------------------------------------------------------------
// Yaw-packed Vec4
// ---------------------------------------------------------------------------

/**
 * Absolute XYZ write into a yaw-packed `Vec4`.
 *
 * `carriesYaw` is false for lane-rung endpoints only: a rung's `.w` is an
 * opaque authored slot, not a heading, so a rotate must echo it verbatim.
 * Everywhere else `.w` IS the entity's heading in radians about world +Y and
 * takes `+= spin.y` — orbiting a traffic light without that leaves it
 * standing in a new place still facing the old way. Pitch and roll have
 * nowhere to land on a yaw-packed box; ADR-0011 greys those rings out
 * whenever one is in the Selection, so in practice they arrive as zero.
 */
export function writeYawBox<S>(v: Vec4, w: SlotWrite<S>, carriesYaw: boolean): Vec4 {
	const nextW = carriesYaw && w.spin ? v.w + w.spin.y : v.w;
	if (v.x === w.point.x && v.y === w.point.y && v.z === w.point.z && v.w === nextW) {
		return v;
	}
	return { x: w.point.x, y: w.point.y, z: w.point.z, w: nextW };
}

// ---------------------------------------------------------------------------
// Array patching
// ---------------------------------------------------------------------------

/** Rebuild `list` at the addressed indices, returning the INPUT array when
 *  every produced item came back `===` its original (writeback contract). */
export function patchList<T, S>(
	list: T[],
	edits: Map<number, SlotWrite<S>>,
	make: (item: T, w: SlotWrite<S>) => T,
): T[] {
	if (edits.size === 0) return list;
	let changed = false;
	const next = list.map((item, i) => {
		const w = edits.get(i);
		if (!w) return item;
		const made = make(item, w);
		if (made !== item) changed = true;
		return made;
	});
	return changed ? next : list;
}
