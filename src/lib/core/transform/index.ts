// The ONLY import path for consumers of the shared **Bulk transform**.
// Overlays import from `@/lib/core/transform`; nothing reaches into the
// individual files.

export type {
	Point,
	Resolver,
	Rotation,
	SlotWrite,
	TransformAxes,
	TransformDelta,
} from './types';

export {
	addPoint,
	isZeroRotation,
	isZeroTranslate,
	median,
	medianPoint,
	rotatePointAboutPivot,
} from './math';

export { resolveSlots, selectionPivot, transform, type ResolvedSlot } from './transform';

export {
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	intersectAxesProfiles,
	intersectTransformAxes,
	resolverAxes,
} from './axes';

export { bindTransform, bindingsAxes, bindingsPivot, type TransformBinding } from './binding';

export { toTransformDelta, type GestureDelta } from './delta';

// Resolvers. Re-exported here so an overlay's whole transform surface arrives
// from one import path. Only three-free resolvers belong in this barrel —
// the CLI and the node test runner pull it in, and neither wants a scene graph.
export {
	streetDataResolver,
	type StreetDataRef,
	type StreetDataResolverT,
} from './resolvers/streetData';
