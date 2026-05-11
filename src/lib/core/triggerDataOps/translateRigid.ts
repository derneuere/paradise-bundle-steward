// Bulk-transform single-entity rigid ops for trigger boxes (issue #77).
//
// Trigger boxes (Landmark / Generic / Blackspot / VFXBox) carry a full 3D
// `Vector3` position AND an Euler `Vector3` rotation in radians, so they
// are genuinely 3D-rotation-capable — single-entity selection of a box
// anchors the gizmo at the box's position with all three rotate rings
// interactive (per ADR-0011's "full 3D for trigger boxes" carve-out).
//
// These ops are the cardinality-1 (single-entity) siblings of the bulk
// ops in `./bulk.ts`. Trigger boxes have no neighbour topology — there's
// no portal-shared-corner cascade analogous to AI sections — so all ops
// in this slice are "no cascade by default" because there's nothing to
// cascade to. Issue #75's cascade modifier is therefore irrelevant for
// trigger boxes.
//
// Rotation order (load-bearing): the trigger-box `rotation` Vector3 is
// stored on disk as three contiguous f32s (X / Y / Z) and surfaced to the
// inspector and the 3D overlay as Euler radians in that order. The
// existing renderer (`TriggerDataOverlay.tsx`'s `BatchedRegionBoxes`) sets
// the THREE.Object3D rotation as `dummy.rotation.set(rx, ry, rz)`, which
// applies in three.js's default 'XYZ' intrinsic order. We pin that order
// here in the compose-then-decompose round-trip so the in-memory model,
// the on-screen preview, and the on-disk writeback all agree.
//
// The compose-then-decompose path is unavoidably Euler-representation-
// collapsing — applying a delta yaw to an already-pitched box may produce
// a numerically different `rotation.x/y/z` triple that represents the same
// orientation (Euler representations are not unique). The user-visible
// orientation stays correct; the numbers in the inspector may shift on
// each gesture. Documented in CONTEXT.md / "Bulk transform" + ADR-0011.
//
// Byte-for-byte writeback (BND2 invariant): every op returns the original
// `model` reference when the gesture is the identity (translate zero AND
// rotate zero), so a no-op gesture preserves the on-disk bytes exactly.

import * as THREE from 'three';
import type {
	Blackspot,
	BoxRegion,
	GenericRegion,
	Landmark,
	ParsedTriggerData,
	RoamingLocation,
	SpawnLocation,
	VFXBoxRegion,
	Vector3,
	Vector4,
} from '../triggerData';

// =============================================================================
// Euler rotation order
// =============================================================================

/**
 * Euler rotation order for trigger-box `BoxRegion.rotation` Vector3.
 *
 * Three.js's default Euler order is 'XYZ' (intrinsic Tait–Bryan). The
 * existing `BatchedRegionBoxes` renderer in `TriggerDataOverlay.tsx`
 * calls `dummy.rotation.set(rx, ry, rz)`, which uses this default order;
 * the legacy 2D `RegionsMap` rotation matrix applies only yaw and is
 * consistent with three.js's right-hand rule around +Y. So 'XYZ' is the
 * authoritative order — we use it in every compose-then-decompose path
 * to keep preview, commit, and writeback agreeing.
 *
 * Documented as a constant so the rest of the module can reference it by
 * name; if Burnout's authoring tools turn out to have written a different
 * order, this is the single place to change it (and the constant becomes
 * the home for the regression test).
 */
export const TRIGGER_BOX_EULER_ORDER: THREE.EulerOrder = 'XYZ';

// =============================================================================
// Helpers — pose <-> THREE matrix conversion
// =============================================================================

/**
 * Convert a trigger-box `BoxRegion`'s position + Euler rotation into a
 * THREE.Matrix4 (full 4x4 rigid transform — no scale; dimensions are
 * separate). Centralised so every op composes against the same
 * representation and the rotation order pin (`TRIGGER_BOX_EULER_ORDER`)
 * is applied in exactly one place.
 */
function poseToMatrix(box: { position: Vector3; rotation: Vector3 }): THREE.Matrix4 {
	const euler = new THREE.Euler(
		box.rotation.x,
		box.rotation.y,
		box.rotation.z,
		TRIGGER_BOX_EULER_ORDER,
	);
	const quat = new THREE.Quaternion().setFromEuler(euler);
	return new THREE.Matrix4().compose(
		new THREE.Vector3(box.position.x, box.position.y, box.position.z),
		quat,
		new THREE.Vector3(1, 1, 1),
	);
}

/** Decompose a THREE.Matrix4 back into a position + Euler triple in the
 *  pinned `TRIGGER_BOX_EULER_ORDER`. */
function matrixToPose(mat: THREE.Matrix4): { position: Vector3; rotation: Vector3 } {
	const pos = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	mat.decompose(pos, quat, scale);
	const euler = new THREE.Euler().setFromQuaternion(quat, TRIGGER_BOX_EULER_ORDER);
	return {
		position: { x: pos.x, y: pos.y, z: pos.z },
		rotation: { x: euler.x, y: euler.y, z: euler.z },
	};
}

// =============================================================================
// Single-entity translate
// =============================================================================

/**
 * Translate one trigger-box `BoxRegion` by `(dx, dy, dz)`. Position
 * shifts; rotation and dimensions are untouched. Returns the input
 * reference if the offset is (0, 0, 0).
 */
export function translateBoxRigid(
	box: BoxRegion,
	offset: { x: number; y: number; z: number },
): BoxRegion {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return box;
	return {
		position: {
			x: box.position.x + offset.x,
			y: box.position.y + offset.y,
			z: box.position.z + offset.z,
		},
		rotation: box.rotation,
		dimensions: box.dimensions,
	};
}

/**
 * Compose a delta rotation (given as an Euler triple in the pinned order)
 * with the box's own Euler rotation, treating the box as a rigid body
 * pivoted at `pivot`. The box's position orbits the pivot AND its own
 * orientation gets `delta * own` left-multiplied — same convention three.js
 * uses for Quaternion composition (the delta is applied "after" the
 * existing rotation from the world's perspective).
 *
 * Returns the input reference if the gesture is identity (all zeros).
 *
 * The Euler ↔ Quaternion round-trip may produce a numerically different
 * `rotation.x/y/z` triple even when only one of the input Euler axes is
 * non-zero (because Euler representations are not unique). The
 * orientation stays correct; the numbers in the inspector may shift —
 * documented in CONTEXT.md / "Bulk transform".
 */
export function rotateBoxRigid(
	box: BoxRegion,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): BoxRegion {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return box;

	const deltaQuat = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(deltaEuler.x, deltaEuler.y, deltaEuler.z, TRIGGER_BOX_EULER_ORDER),
	);

	// Compose orientation: delta * own. Using quaternion multiply so the
	// compose is associative and avoids Euler order issues during the
	// composition itself; only the final decompose runs through Euler.
	const ownPose = poseToMatrix(box);
	const ownPos = new THREE.Vector3();
	const ownQuat = new THREE.Quaternion();
	const ownScale = new THREE.Vector3();
	ownPose.decompose(ownPos, ownQuat, ownScale);

	const newQuat = deltaQuat.clone().multiply(ownQuat);

	// Orbit position around pivot.
	const pivotVec = new THREE.Vector3(pivot.x, pivot.y, pivot.z);
	const newPos = ownPos.clone().sub(pivotVec).applyQuaternion(deltaQuat).add(pivotVec);

	const newEuler = new THREE.Euler().setFromQuaternion(newQuat, TRIGGER_BOX_EULER_ORDER);
	return {
		position: { x: newPos.x, y: newPos.y, z: newPos.z },
		rotation: { x: newEuler.x, y: newEuler.y, z: newEuler.z },
		dimensions: box.dimensions,
	};
}

// =============================================================================
// Vector4 helpers — for roaming / spawn translates
// =============================================================================

/** Translate a Vector4 position by (dx, dy, dz). The `.w` component is
 *  preserved verbatim — it isn't a spatial coordinate, just trailing
 *  storage padding from the source format. */
export function translateVec4(
	v: Vector4,
	offset: { x: number; y: number; z: number },
): Vector4 {
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return v;
	return { x: v.x + offset.x, y: v.y + offset.y, z: v.z + offset.z, w: v.w };
}

/** Rotate a Vector4 position around the given pivot by the delta Euler.
 *  Vector4 entries (RoamingLocation, SpawnLocation, player start) have no
 *  orientation field, so only the position orbits. `.w` is preserved. */
export function rotateVec4AroundPivot(
	v: Vector4,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): Vector4 {
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return v;
	const deltaQuat = new THREE.Quaternion().setFromEuler(
		new THREE.Euler(deltaEuler.x, deltaEuler.y, deltaEuler.z, TRIGGER_BOX_EULER_ORDER),
	);
	const pivotVec = new THREE.Vector3(pivot.x, pivot.y, pivot.z);
	const p = new THREE.Vector3(v.x, v.y, v.z);
	p.sub(pivotVec).applyQuaternion(deltaQuat).add(pivotVec);
	return { x: p.x, y: p.y, z: p.z, w: v.w };
}

// =============================================================================
// ParsedTriggerData-scope rigid ops
// =============================================================================

/**
 * Translate one landmark's box by `(dx, dy, dz)`. Returns the original
 * model reference when the offset is identity (BND2 invariant).
 */
export function translateLandmarkRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.landmarks.length) {
		throw new RangeError(`landmark index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.landmarks[idx];
	const next: Landmark = { ...src, box: translateBoxRigid(src.box, offset) };
	return { ...model, landmarks: model.landmarks.map((lm, i) => (i === idx ? next : lm)) };
}

/**
 * Rotate one landmark's box around `pivot` by the delta Euler. The
 * position orbits and the box's own rotation gets `delta * own` composed
 * in. Returns the original model reference on identity.
 */
export function rotateLandmarkRigid(
	model: ParsedTriggerData,
	idx: number,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.landmarks.length) {
		throw new RangeError(`landmark index ${idx} out of range`);
	}
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	const src = model.landmarks[idx];
	const next: Landmark = { ...src, box: rotateBoxRigid(src.box, pivot, deltaEuler) };
	return { ...model, landmarks: model.landmarks.map((lm, i) => (i === idx ? next : lm)) };
}

/** Sibling of `translateLandmarkRigid` for `genericRegions`. */
export function translateGenericRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.genericRegions.length) {
		throw new RangeError(`generic region index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.genericRegions[idx];
	const next: GenericRegion = { ...src, box: translateBoxRigid(src.box, offset) };
	return { ...model, genericRegions: model.genericRegions.map((gr, i) => (i === idx ? next : gr)) };
}

/** Sibling of `rotateLandmarkRigid` for `genericRegions`. */
export function rotateGenericRigid(
	model: ParsedTriggerData,
	idx: number,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.genericRegions.length) {
		throw new RangeError(`generic region index ${idx} out of range`);
	}
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	const src = model.genericRegions[idx];
	const next: GenericRegion = { ...src, box: rotateBoxRigid(src.box, pivot, deltaEuler) };
	return { ...model, genericRegions: model.genericRegions.map((gr, i) => (i === idx ? next : gr)) };
}

/** Sibling of `translateLandmarkRigid` for `blackspots`. */
export function translateBlackspotRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.blackspots.length) {
		throw new RangeError(`blackspot index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.blackspots[idx];
	const next: Blackspot = { ...src, box: translateBoxRigid(src.box, offset) };
	return { ...model, blackspots: model.blackspots.map((bs, i) => (i === idx ? next : bs)) };
}

/** Sibling of `rotateLandmarkRigid` for `blackspots`. */
export function rotateBlackspotRigid(
	model: ParsedTriggerData,
	idx: number,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.blackspots.length) {
		throw new RangeError(`blackspot index ${idx} out of range`);
	}
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	const src = model.blackspots[idx];
	const next: Blackspot = { ...src, box: rotateBoxRigid(src.box, pivot, deltaEuler) };
	return { ...model, blackspots: model.blackspots.map((bs, i) => (i === idx ? next : bs)) };
}

/** Sibling of `translateLandmarkRigid` for `vfxBoxRegions`. */
export function translateVfxRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.vfxBoxRegions.length) {
		throw new RangeError(`vfx index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.vfxBoxRegions[idx];
	const next: VFXBoxRegion = { ...src, box: translateBoxRigid(src.box, offset) };
	return { ...model, vfxBoxRegions: model.vfxBoxRegions.map((v, i) => (i === idx ? next : v)) };
}

/** Sibling of `rotateLandmarkRigid` for `vfxBoxRegions`. */
export function rotateVfxRigid(
	model: ParsedTriggerData,
	idx: number,
	pivot: { x: number; y: number; z: number },
	deltaEuler: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.vfxBoxRegions.length) {
		throw new RangeError(`vfx index ${idx} out of range`);
	}
	if (deltaEuler.x === 0 && deltaEuler.y === 0 && deltaEuler.z === 0) return model;
	const src = model.vfxBoxRegions[idx];
	const next: VFXBoxRegion = { ...src, box: rotateBoxRigid(src.box, pivot, deltaEuler) };
	return { ...model, vfxBoxRegions: model.vfxBoxRegions.map((v, i) => (i === idx ? next : v)) };
}

/** Translate a single roaming location's position. No rotation field. */
export function translateRoamingRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.roamingLocations.length) {
		throw new RangeError(`roaming index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.roamingLocations[idx];
	const next: RoamingLocation = { ...src, position: translateVec4(src.position, offset) };
	return {
		...model,
		roamingLocations: model.roamingLocations.map((rl, i) => (i === idx ? next : rl)),
	};
}

/** Translate a single spawn location's position. No rotation field — only
 *  position moves (direction stays as the spawn's facing). */
export function translateSpawnRigid(
	model: ParsedTriggerData,
	idx: number,
	offset: { x: number; y: number; z: number },
): ParsedTriggerData {
	if (idx < 0 || idx >= model.spawnLocations.length) {
		throw new RangeError(`spawn index ${idx} out of range`);
	}
	if (offset.x === 0 && offset.y === 0 && offset.z === 0) return model;
	const src = model.spawnLocations[idx];
	const next: SpawnLocation = { ...src, position: translateVec4(src.position, offset) };
	return {
		...model,
		spawnLocations: model.spawnLocations.map((sp, i) => (i === idx ? next : sp)),
	};
}

// Internal: re-export the matrix helpers as test-internal in `_internal` so
// the test file can pin the round-trip without re-implementing it.
export const _internalForTests = { poseToMatrix, matrixToPose };
