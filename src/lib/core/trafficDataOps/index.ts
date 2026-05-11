// Barrel for `@/lib/core/trafficDataOps`.
//
// Re-exports every public symbol from the directory's sub-modules so that
// external callers can keep `import { ... } from '@/lib/core/trafficDataOps'`
// without caring which file the symbol lives in. Scope is the full
// traffic-data resource family:
//
//   - Yaw-packed Vec4 entities (junction logic boxes, light triggers,
//     traffic-light instances, corona positions) — XZ-packed per ADR-0011,
//     yaw-only rotate (issue #79).
//   - Lane rungs (two-endpoint segments) — also XZ-packed (issue #79).
//   - Static traffic vehicles (Matrix44, full 3D) — the only family with a
//     full rigid 4×4 transform; full 3-axis rotate (issue #78).

export {
	TRAFFIC_LANE_RUNG_AXES,
	TRAFFIC_STATIC_VEHICLE_AXES,
	TRAFFIC_YAW_PACKED_AXES,
} from './transformAxes';
export {
	translateCoronaRigid,
	translateJunctionRigid,
	translateLaneRungRigid,
	translateLightInstanceRigid,
	translateLightTriggerRigid,
} from './translateRigid';
export {
	rotateStaticVehicleMatrix44,
	rotateStaticVehicleRigid,
	STATIC_VEHICLE_DELTA_EULER_ORDER,
	translateStaticVehicleMatrix44,
	translateStaticVehicleRigid,
} from './staticVehicleMatrix44';
export {
	bulkRotateTrafficEntitiesMatrix44,
	bulkRotateTrafficEntitiesYaw,
	bulkTrafficDataAxes,
	bulkTranslateTrafficEntities,
	trafficDataRefAxes,
	trafficDataSelectionPivot,
	type TrafficDataEntityRef,
} from './bulk';
