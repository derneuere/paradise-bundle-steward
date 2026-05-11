// Barrel for `@/lib/core/aiSectionsOps`.
//
// Re-exports every public symbol from the directory's sub-modules so that
// external callers can keep `import { ... } from '@/lib/core/aiSectionsOps'`
// without caring which file the symbol lives in. The split itself is a
// navigation aid — there's no API surface change here.

export { deleteSection, duplicateSectionThroughEdge } from './duplicateDelete';
export {
	rotateSectionAroundCentroidYaw,
	translateBoundaryLineEndpointRigid,
	translateCornerRigid,
	translateNoGoLineEndpointRigid,
	translatePortalAnchorRigid,
	translateSectionRigid,
} from './translateRigid';
export {
	rotateSectionWithLinksYaw,
	translateCornerWithShared,
	translatePortalAnchorWithMirror,
	translateSectionWithLinks,
} from './translateLinks';
export {
	bulkAISectionsAxes,
	bulkRotateEntitiesYaw,
	bulkSelectionPivot,
	bulkTranslateEntities,
	rotateSelectionWithLinksYaw,
	translateSelectionWithLinks,
	type AISectionEntityRef,
} from './bulk';
export { snapCornerOffset, snapSectionOffset } from './snap';
export {
	duplicateLegacySectionThroughEdge,
	snapLegacyCornerOffset,
	snapLegacySectionOffset,
	translateLegacyCornerWithShared,
	translateLegacySectionWithLinks,
} from './legacy';
