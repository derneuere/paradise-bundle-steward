// Barrel for `@/lib/core/zoneListOps`.
//
// Re-exports every public symbol from the directory's sub-modules so that
// external callers can keep `import { ... } from '@/lib/core/zoneListOps'`
// without caring which file the symbol lives in. Mirrors the shape of
// `aiSectionsOps` — see that directory's `index.ts` for the rationale.

export { ZONE_POINT_AXES } from './transformAxes';
export {
	translateZonePointRigid,
	translateZoneRigid,
} from './translateRigid';
export {
	bulkRotateZoneEntitiesYaw,
	bulkTranslateZoneEntities,
	bulkZoneListAxes,
	zoneListSelectionPivot,
	type ZoneListEntityRef,
} from './bulk';
