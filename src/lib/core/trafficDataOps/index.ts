// Barrel for `@/lib/core/trafficDataOps`.
//
// Re-exports every public symbol from the directory's sub-modules so that
// external callers can keep `import { ... } from '@/lib/core/trafficDataOps'`
// without caring which file the symbol lives in. Scope is yaw-packed boxes
// (junction logic boxes, light triggers, traffic-light collection elements,
// corona positions) plus lane rungs — every traffic entity whose spatial
// data is XZ-packed per ADR-0011. Static traffic vehicles (Matrix44, full
// 3D) live in their own module and are tracked by issue #78.

export {
	TRAFFIC_LANE_RUNG_AXES,
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
	bulkRotateTrafficEntitiesYaw,
	bulkTrafficDataAxes,
	bulkTranslateTrafficEntities,
	trafficDataSelectionPivot,
	type TrafficDataEntityRef,
} from './bulk';
