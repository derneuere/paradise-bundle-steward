// applyDragToModel — single dispatcher from a gizmo gesture's (target, delta)
// to the no-cascade op that mutates the model.
//
// Used in two places by the V12 overlay:
//   - inside `previewModel` derivation (live drag-frame; no setResource)
//   - inside `handleGizmoCommit` (one-shot on release; setResource pushes
//     exactly one HistoryCommit — the one-undo-entry-per-gesture contract)
//
// Keeping the dispatch in one helper means preview and commit cannot drift —
// what the user sees during the drag is bit-for-bit what lands in the model
// on release. The corner / endpoint paths discard `delta.translate.y` because
// the underlying storage (Vector2 corners, packed-Vector4 line segments) has
// no Y component (ADR-0011). Section-scope drags also apply yaw rotation
// after translate, around the *post-translate* centroid, so combined gestures
// compose as a single rigid body (the same shape Blender's gizmo uses).

import type { ParsedAISectionsV12 } from '@/lib/core/aiSections';
import {
	bulkRotateEntitiesYaw,
	bulkTranslateEntities,
	rotateSectionAroundCentroidYaw,
	rotateSectionWithLinksYaw,
	translateBoundaryLineEndpointRigid,
	translateCornerRigid,
	translateNoGoLineEndpointRigid,
	translatePortalAnchorRigid,
	translateSectionRigid,
	translateSectionWithLinks,
} from '@/lib/core/aiSectionsOps';
import type { ActiveDrag } from './aiSectionsDrag.types';

export function applyDragToModel(
	model: ParsedAISectionsV12,
	drag: ActiveDrag,
): ParsedAISectionsV12 {
	const { target, delta } = drag;
	switch (target.kind) {
		case 'section': {
			let next = model;
			if (delta.cascade) {
				// Cascade-on (Shift at gesture start, per issue #75 + ADR-0009):
				// translate-with-links cascades neighbour reverse-portal anchors
				// + shared corners; rotate-with-links does the same around the
				// post-translate source centroid. translate.y is dropped because
				// the cascade-on ops are XZ-only (the legacy auto-cascade path
				// never moved on Y).
				if (delta.translate.x !== 0 || delta.translate.z !== 0) {
					next = translateSectionWithLinks(next, target.sectionIdx, {
						x: delta.translate.x,
						z: delta.translate.z,
					});
				}
				if (delta.rotate.y !== 0) {
					next = rotateSectionWithLinksYaw(next, target.sectionIdx, delta.rotate.y);
				}
				return next;
			}
			if (delta.translate.x !== 0 || delta.translate.y !== 0 || delta.translate.z !== 0) {
				next = translateSectionRigid(next, target.sectionIdx, delta.translate);
			}
			if (delta.rotate.y !== 0) {
				next = rotateSectionAroundCentroidYaw(next, target.sectionIdx, delta.rotate.y);
			}
			return next;
		}
		case 'bulk': {
			// Multi-Selection rigid body (issue #74). Translate every entity
			// by the same delta, then yaw-rotate around the post-translate
			// pivot — same compose order as the single-section path so
			// preview and commit agree frame-for-frame. The pivot is the
			// snapshot from the gesture's first frame (drift-prevented).
			let next = model;
			if (delta.translate.x !== 0 || delta.translate.y !== 0 || delta.translate.z !== 0) {
				next = bulkTranslateEntities(next, target.entities, delta.translate);
			}
			if (delta.rotate.y !== 0) {
				next = bulkRotateEntitiesYaw(
					next,
					target.entities,
					{ x: target.pivot.x + delta.translate.x, z: target.pivot.z + delta.translate.z },
					delta.rotate.y,
				);
			}
			return next;
		}
		case 'corner':
			// XZ-only — drop translate.y.
			return translateCornerRigid(model, target.sectionIdx, target.cornerIdx, {
				x: delta.translate.x,
				z: delta.translate.z,
			});
		case 'portalAnchor':
			// Vector3 anchor — full XYZ.
			return translatePortalAnchorRigid(model, target.sectionIdx, target.portalIdx, delta.translate);
		case 'boundaryLineEndpoint':
			return translateBoundaryLineEndpointRigid(
				model,
				target.sectionIdx,
				target.portalIdx,
				target.lineIdx,
				target.endIdx,
				{ x: delta.translate.x, z: delta.translate.z },
			);
		case 'noGoLineEndpoint':
			return translateNoGoLineEndpointRigid(
				model,
				target.sectionIdx,
				target.lineIdx,
				target.endIdx,
				{ x: delta.translate.x, z: delta.translate.z },
			);
	}
}
