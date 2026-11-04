// Pure helpers backing the V12 overlay's live-drag preview layer.
//
// During a gesture the V12 overlay shows the drag against a derived
// `previewModel` rather than mutating data — so the canonical model only
// updates once on release (one HistoryCommit per gesture). These helpers
// pull the math out so the overlay's `useMemo`s stay declarative and the
// math itself becomes node-testable.
//
// Helpers:
//   - `derivePreviewModel(data, drag, resolver)` — runs the shared
//     `transform` on a non-identity drag, returns null when there is no drag,
//     an identity delta, or a gesture that resolved to no change at all.
//   - `derivePreviewSection(previewModel, selSection, selIdx)` — picks the
//     selected section out of the preview model (or falls back to the
//     unmodified one if the preview isn't producing a change for it).
//   - `derivePreviewCorners(previewSection)` — projects the V12 corner
//     storage (Vector2 with y → world Z) onto the shared `Corner` shape.
//   - `deriveAffectedNeighbours(previewModel, selectedIdx,
//        bulkSectionIndices, data)` — collects sections that the preview
//     touched but aren't the inspector pick or bulk members. These are
//     the orange "cascade-affected" outlines drawn during a drag.

import type { AISection, ParsedAISectionsV12 } from '@/lib/core/aiSections';
import { toTransformDelta, transform } from '@/lib/core/transform';
import type { AISectionsResolverT } from '@/lib/core/transform/resolvers/aiSections';
import { isIdentityDelta } from '@/hooks/useBulkTransformDrag';
import type { Corner } from '@/components/aisections/shared';
import type { ActiveDrag } from './aiSectionsDrag.types';

// V12 stores corners as `Vector2` where `y` is the world Z axis.
export function v12Corners(section: AISection): Corner[] {
	return section.corners.map((c) => ({ x: c.x, z: c.y }));
}

export function derivePreviewModel(
	data: ParsedAISectionsV12,
	drag: ActiveDrag | null,
	resolver: AISectionsResolverT,
): ParsedAISectionsV12 | null {
	if (!drag || isIdentityDelta(drag.delta)) return null;
	// Preview and commit call the SAME `transform` with the same refs, pivot
	// and delta, so what the user sees during the drag is bit-for-bit what
	// lands in the model on release. `transform` returns the input reference
	// on a no-op, which we surface as "no preview" so the render layers fall
	// back to `data` instead of re-keying every frame.
	const next = transform(data, drag.refs, toTransformDelta(drag.delta, drag.pivot), resolver);
	return next === data ? null : next;
}

export function derivePreviewSection(
	selSection: AISection | null,
	previewModel: ParsedAISectionsV12 | null,
	selectedSectionIndex: number | null,
): AISection | null {
	if (!selSection) return null;
	if (!previewModel || selectedSectionIndex == null) return selSection;
	return previewModel.sections[selectedSectionIndex] ?? selSection;
}

export function derivePreviewCorners(previewSection: AISection | null): Corner[] | null {
	return previewSection ? v12Corners(previewSection) : null;
}

// Sections other than the inspector pick or bulk members whose preview
// section is a different object reference than the source — those are the
// neighbours the cascade-on path touched. Bulk members are filtered to
// avoid double-painting (they already render in the bulk-member loop).
export function deriveAffectedNeighbours(
	previewModel: ParsedAISectionsV12 | null,
	selectedSectionIndex: number | null,
	bulkSectionIndices: ReadonlySet<number>,
	data: ParsedAISectionsV12,
): { idx: number; corners: Corner[] }[] {
	if (!previewModel || selectedSectionIndex == null) return [];
	const out: { idx: number; corners: Corner[] }[] = [];
	for (let i = 0; i < previewModel.sections.length; i++) {
		if (i === selectedSectionIndex) continue;
		// Skip bulk members — the yellow bulk-member render loop already
		// paints them with the live preview geometry. Without this filter,
		// every bulk member would get a second SelectionOverlay (orange
		// "cascade") on top of its yellow outline.
		if (bulkSectionIndices.has(i)) continue;
		if (previewModel.sections[i] !== data.sections[i]) {
			out.push({ idx: i, corners: v12Corners(previewModel.sections[i]) });
		}
	}
	return out;
}
