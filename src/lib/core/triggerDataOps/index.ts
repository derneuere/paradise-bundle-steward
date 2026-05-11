// Barrel for `@/lib/core/triggerDataOps`.
//
// Resource-adapter module for trigger-box regions in the unified
// **Bulk transform** gizmo (issue #77). Mirrors the directory shape of
// `@/lib/core/aiSectionsOps` so future slices — #78 Matrix44 static
// vehicles, #79 other XZ-packed resources — drop in as siblings with the
// same exports surface.
//
// Trigger boxes carry full 3D pose (Vector3 position + Euler Vector3
// rotation), so this module establishes the "rigid-body Euler composition"
// pattern: bulk rotate orbits each box's position around a shared pivot
// AND composes the gesture rotation into each box's own Euler. See
// `translateRigid.ts` for the rotation-order pin and the compose-then-
// decompose contract; see `bulk.ts` for the cardinality-≥-1 entry points.

export {
	rotateBlackspotRigid,
	rotateBoxRigid,
	rotateGenericRigid,
	rotateLandmarkRigid,
	rotateVec4AroundPivot,
	rotateVfxRigid,
	translateBlackspotRigid,
	translateBoxRigid,
	translateGenericRigid,
	translateLandmarkRigid,
	translateRoamingRigid,
	translateSpawnRigid,
	translateVec4,
	translateVfxRigid,
	TRIGGER_BOX_EULER_ORDER,
} from './translateRigid';
export {
	bulkRotateTriggerBoxes,
	bulkTranslateTriggerBoxes,
	bulkTriggerBoxPivot,
	type TriggerBoxEntityRef,
} from './bulk';
export {
	bulkTriggerBoxAxes,
	triggerBoxRefAxes,
} from './transformAxes';
