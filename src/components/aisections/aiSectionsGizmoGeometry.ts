// Pure helpers for the V12 overlay's gizmo geometry — where the gizmo
// anchors in world space and what axes it exposes.
//
// `deriveGizmoPosition` and `deriveGizmoAxes` were inline `useMemo`s in
// the overlay; extracting them lets the math be node-tested and keeps
// the overlay body small. Both are pure: same (target, …) → same
// (position, axes), no React state.
//
// Position rules (matching the overlay's pre-extraction behaviour):
//   - `bulk`: pivot lifted +1.5 on Y, rides along translate delta during a
//     bulk drag so the gizmo visually tracks the bulk.
//   - sub-entity + `bulkPivotOverride` set: gizmo follows the typed pivot
//     verbatim (issue #81); translate preview still adds on top.
//   - `section`: centroid of the live section corners at sectionY+1.5.
//   - `corner`: corner XZ at sectionY+1.5.
//   - `portalAnchor`: portal Vector3 verbatim.
//   - `boundaryLineEndpoint`: endpoint XZ on the parent portal's Y.
//   - `noGoLineEndpoint`: endpoint XZ at sectionY+0.5 (no anchor Y).
//
// Axes rules (ADR-0011 — XZ-packed for everything but portalAnchor):
//   - `section`: XZ-packed.
//   - `bulk`: AND-intersection of every entity's axes (auto-narrows when
//     a future full-3D entity joins the bulk).
//   - `corner` / `boundaryLineEndpoint` / `noGoLineEndpoint`: translate
//     XZ, rotate disabled (single-point — rotation is a no-op).
//   - `portalAnchor`: full 3D translate, rotate disabled.

import type { AISection, ParsedAISectionsV12 } from '@/lib/core/aiSections';
import type { BulkTransformDelta } from '@/hooks/useBulkTransformDrag';
import { bulkAISectionsAxes } from '@/lib/core/aiSectionsOps';
import {
	TRANSFORM_AXES_FULL_3D,
	TRANSFORM_AXES_XZ_PACKED,
	type TransformAxes,
} from '@/lib/core/transformAxes';
import type { ActiveDrag, DragTarget } from './aiSectionsDrag.types';

export const BULK_GIZMO_Y_OFFSET = 1.5;

export function deriveGizmoPosition(
	gizmoTarget: DragTarget | null,
	previewSection: AISection | null,
	data: ParsedAISectionsV12,
	selectedSectionY: number,
	bulkPivotOverride: { x: number; y: number; z: number } | null,
	drag: ActiveDrag | null,
): [number, number, number] | null {
	if (!gizmoTarget) return null;
	// Bulk gizmo anchors at the (snapshotted) Pivot, riding along the live
	// translate delta. Rotation doesn't move the pivot itself (the pivot
	// IS the fixed point a rigid body rotates around).
	if (gizmoTarget.kind === 'bulk') {
		const dxyz = drag?.target.kind === 'bulk' ? drag.delta.translate : { x: 0, y: 0, z: 0 };
		return [
			gizmoTarget.pivot.x + dxyz.x,
			gizmoTarget.pivot.y + BULK_GIZMO_Y_OFFSET + dxyz.y,
			gizmoTarget.pivot.z + dxyz.z,
		];
	}
	// Numeric-panel pivot override for sub-entity selections (issue #81).
	// When the user types a pivot while a sub-entity is selected, the
	// gizmo follows the typed coordinate verbatim. Translate preview
	// still rides on top so a typed-Δ live update visually moves the
	// gizmo along with the staged delta.
	if (bulkPivotOverride) {
		const dxyz: BulkTransformDelta['translate'] = drag?.delta.translate ?? { x: 0, y: 0, z: 0 };
		return [
			bulkPivotOverride.x + dxyz.x,
			bulkPivotOverride.y + dxyz.y,
			bulkPivotOverride.z + dxyz.z,
		];
	}
	// All sub-entity targets live in the same source section — read it
	// off `previewSection` (which already accounts for the in-flight drag)
	// when available, otherwise fall back to the unmodified data.
	const liveSection = previewSection ?? data.sections[gizmoTarget.sectionIdx] ?? null;
	if (!liveSection) return null;
	switch (gizmoTarget.kind) {
		case 'section': {
			if (liveSection.corners.length === 0) return null;
			let sx = 0, sz = 0;
			for (const c of liveSection.corners) { sx += c.x; sz += c.y; }
			const n = liveSection.corners.length;
			return [sx / n, selectedSectionY + BULK_GIZMO_Y_OFFSET, sz / n];
		}
		case 'corner': {
			const c = liveSection.corners[gizmoTarget.cornerIdx];
			if (!c) return null;
			// Corner is a Vector2 on XZ; lift the gizmo just above the
			// section's resolved ground Y so it floats clear of the fill mesh.
			return [c.x, selectedSectionY + BULK_GIZMO_Y_OFFSET, c.y];
		}
		case 'portalAnchor': {
			const p = liveSection.portals[gizmoTarget.portalIdx];
			if (!p) return null;
			// Portal anchor is full Vector3 — anchor the gizmo at the
			// stored Y verbatim (the inspector edits portal.position.y).
			return [p.position.x, p.position.y, p.position.z];
		}
		case 'boundaryLineEndpoint': {
			const p = liveSection.portals[gizmoTarget.portalIdx];
			if (!p) return null;
			const line = p.boundaryLines[gizmoTarget.lineIdx];
			if (!line) return null;
			// Y comes from the parent portal's anchor (matches
			// SectionDetail's boundary-line rendering convention).
			const v = line.verts;
			const x = gizmoTarget.endIdx === 0 ? v.x : v.z;
			const z = gizmoTarget.endIdx === 0 ? v.y : v.w;
			return [x, p.position.y, z];
		}
		case 'noGoLineEndpoint': {
			const line = liveSection.noGoLines[gizmoTarget.lineIdx];
			if (!line) return null;
			// No-go lines have no anchor Y; sit on the section's
			// resolved baseY (matches SectionDetail's noGo rendering).
			const v = line.verts;
			const x = gizmoTarget.endIdx === 0 ? v.x : v.z;
			const z = gizmoTarget.endIdx === 0 ? v.y : v.w;
			return [x, selectedSectionY + 0.5, z];
		}
	}
}

export function deriveGizmoAxes(gizmoTarget: DragTarget | null): TransformAxes {
	if (!gizmoTarget) return TRANSFORM_AXES_FULL_3D;
	switch (gizmoTarget.kind) {
		case 'section':
			return TRANSFORM_AXES_XZ_PACKED;
		case 'bulk':
			// Every AI-section entity is XZ-packed in some way — pitch
			// and roll auto-disable per ADR-0011. `bulkAISectionsAxes`
			// returns the AND-intersection of every selected entity's
			// axes profile so future bulks mixing full-3D resources
			// (trigger boxes, Matrix44 vehicles in later issues) widen
			// the rings accordingly.
			return bulkAISectionsAxes(gizmoTarget.entities) ?? TRANSFORM_AXES_XZ_PACKED;
		case 'corner':
			// Vector2 corners — translate.y is rendered but discarded on
			// commit (see applyDragToModel). Rotate disabled (single point).
			return {
				translate: { x: true, y: false, z: true },
				rotate: { x: false, y: false, z: false },
			};
		case 'portalAnchor':
			// Full Vector3, no rotation (single point has no orientation).
			return {
				translate: { x: true, y: true, z: true },
				rotate: { x: false, y: false, z: false },
			};
		case 'boundaryLineEndpoint':
		case 'noGoLineEndpoint':
			// XZ-only packed Vector4 — translate.y discarded on commit.
			// Rotate disabled (single point).
			return {
				translate: { x: true, y: false, z: true },
				rotate: { x: false, y: false, z: false },
			};
	}
}
