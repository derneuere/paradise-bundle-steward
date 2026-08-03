// Barrel for `@/lib/core/aiSectionsOps`.
//
// Re-exports every public symbol from the directory's sub-modules so that
// external callers can keep `import { ... } from '@/lib/core/aiSectionsOps'`
// without caring which file the symbol lives in. The split itself is a
// navigation aid — there's no API surface change here.
//
// What is NOT here any more: the rigid + bulk translate/rotate ops. Every
// spatial transform for AI sections now runs through the shared
// `@/lib/core/transform` core and its `aiSections` resolver, so this module
// is down to the topology edits (duplicate / delete through an edge), the
// snap helpers, the cascade-on link fix-ups and the legacy V4/V6 paths.

export { deleteSection, duplicateSectionThroughEdge } from './duplicateDelete';
export {
	rotateSectionWithLinksYaw,
	translateCornerWithShared,
	translatePortalAnchorWithMirror,
	translateSectionWithLinks,
} from './translateLinks';
export { snapCornerOffset, snapSectionOffset } from './snap';
export {
	duplicateLegacySectionThroughEdge,
	snapLegacyCornerOffset,
	snapLegacySectionOffset,
	translateLegacyCornerWithShared,
	translateLegacySectionWithLinks,
} from './legacy';
