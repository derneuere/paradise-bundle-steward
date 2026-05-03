// Shared 3D primitives consumed by both AI Sections overlays (V12 editable
// and V4/V6 read-only). Bug fixes and visual tweaks land in both at once.
// See issue #35 for the extraction motivation.

export { fillMaterial, outlineMaterial, portalGeo, portalMat, portalSelMat } from './materials';
export {
	BatchedSections,
	buildBatchedSections,
	type SectionAccessor,
	type BatchedSectionsScene,
} from './BatchedSections';
export { SelectionOverlay, type Corner } from './SelectionOverlay';
export { SectionLabel } from './SectionLabel';
export { EdgeHandles } from './EdgeHandles';
export { EdgeContextMenu, edgeContextMenuRootStyle } from './EdgeContextMenu';
export {
	aiSectionsV12SelectionCodec,
	aiSectionsLegacySelectionCodec,
	markerToSelection,
	selectionToMarker,
	type AISectionMarker,
} from './selection';
