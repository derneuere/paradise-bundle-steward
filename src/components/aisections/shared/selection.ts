// AI Sections selection codecs — shared between the V12 editable overlay and
// the V4/V6 read-only overlay so the marker shape stays in lock-step across
// both. The two overlays own the same seven selection kinds (section / portal
// / boundaryLine / noGoLine / corner / boundaryLineEndpoint /
// noGoLineEndpoint); they differ only in the schema path prefix (V12 paths
// are top-level under `sections`, V4/V6 paths nest under a `legacy` wrapper
// field).
//
// Selection shape uses the unified `{ kind, indices }` form from
// `@/components/schema-editor/viewports/selection`. Indices encode the
// nesting tuple:
//   - { kind: 'section',              indices: [sectionIdx] }
//   - { kind: 'portal',               indices: [sectionIdx, portalIdx] }
//   - { kind: 'boundaryLine',         indices: [sectionIdx, portalIdx, lineIdx] }
//   - { kind: 'noGoLine',             indices: [sectionIdx, lineIdx] }
//   - { kind: 'corner',               indices: [sectionIdx, cornerIdx] }
//   - { kind: 'boundaryLineEndpoint', indices: [sectionIdx, portalIdx, lineIdx, endIdx] }
//   - { kind: 'noGoLineEndpoint',     indices: [sectionIdx, lineIdx, endIdx] }
//
// The corner / endpoint kinds (issue #73) target the bulk-transform gizmo at
// a single sub-entity. `endIdx ∈ {0, 1}` picks the start (verts.x/y) or end
// (verts.z/w) endpoint of a packed-Vector4 line segment.
//
// Sub-paths inside a primitive (e.g. a portal's `position.x`) collapse to
// the nearest selectable kind — the inspector can drill deeper while the 3D
// overlay still highlights the parent.
//
// Each overlay also re-exports the legacy `*PathMarker` / `*MarkerPath`
// helpers as thin wrappers over the codec for back-compat.

import {
	defineSelectionCodec,
	type Selection,
	type SelectionCodec,
} from '@/components/schema-editor/viewports/selection';
import type { NodePath } from '@/lib/schema/walk';

// ---------------------------------------------------------------------------
// Legacy marker shapes (the per-overlay objects pre-migration). Kept exported
// so the overlay test files can keep importing them without changing.
// ---------------------------------------------------------------------------

export type AISectionMarker =
	| { kind: 'section'; sectionIndex: number }
	| { kind: 'portal'; sectionIndex: number; portalIndex: number }
	| { kind: 'boundaryLine'; sectionIndex: number; portalIndex: number; lineIndex: number }
	| { kind: 'noGoLine'; sectionIndex: number; lineIndex: number }
	// Sub-entity markers (issue #73) — single corners + single line endpoints
	// addressable for the bulk-transform gizmo. `endIndex ∈ {0, 1}` picks the
	// start (verts.x/y) or end (verts.z/w) of a packed-Vector4 segment.
	| { kind: 'corner'; sectionIndex: number; cornerIndex: number }
	| { kind: 'boundaryLineEndpoint'; sectionIndex: number; portalIndex: number; lineIndex: number; endIndex: number }
	| { kind: 'noGoLineEndpoint'; sectionIndex: number; lineIndex: number; endIndex: number }
	| null;

// ---------------------------------------------------------------------------
// Marker ↔ Selection adapters. The marker shape is the legacy pre-migration
// object; the Selection shape is the new uniform one. Each overlay needs both
// — the codec emits Selection (for the hook), the legacy aliases emit Marker.
// ---------------------------------------------------------------------------

/** Translate a Selection into the legacy marker object. */
export function selectionToMarker(sel: Selection | null): AISectionMarker {
	if (!sel) return null;
	switch (sel.kind) {
		case 'section':
			return { kind: 'section', sectionIndex: sel.indices[0] };
		case 'portal':
			return { kind: 'portal', sectionIndex: sel.indices[0], portalIndex: sel.indices[1] };
		case 'boundaryLine':
			return {
				kind: 'boundaryLine',
				sectionIndex: sel.indices[0],
				portalIndex: sel.indices[1],
				lineIndex: sel.indices[2],
			};
		case 'noGoLine':
			return { kind: 'noGoLine', sectionIndex: sel.indices[0], lineIndex: sel.indices[1] };
		case 'corner':
			return { kind: 'corner', sectionIndex: sel.indices[0], cornerIndex: sel.indices[1] };
		case 'boundaryLineEndpoint':
			return {
				kind: 'boundaryLineEndpoint',
				sectionIndex: sel.indices[0],
				portalIndex: sel.indices[1],
				lineIndex: sel.indices[2],
				endIndex: sel.indices[3],
			};
		case 'noGoLineEndpoint':
			return {
				kind: 'noGoLineEndpoint',
				sectionIndex: sel.indices[0],
				lineIndex: sel.indices[1],
				endIndex: sel.indices[2],
			};
	}
	return null;
}

/** Translate the legacy marker into a Selection. */
export function markerToSelection(m: AISectionMarker): Selection | null {
	if (!m) return null;
	switch (m.kind) {
		case 'section':
			return { kind: 'section', indices: [m.sectionIndex] };
		case 'portal':
			return { kind: 'portal', indices: [m.sectionIndex, m.portalIndex] };
		case 'boundaryLine':
			return { kind: 'boundaryLine', indices: [m.sectionIndex, m.portalIndex, m.lineIndex] };
		case 'noGoLine':
			return { kind: 'noGoLine', indices: [m.sectionIndex, m.lineIndex] };
		case 'corner':
			return { kind: 'corner', indices: [m.sectionIndex, m.cornerIndex] };
		case 'boundaryLineEndpoint':
			return {
				kind: 'boundaryLineEndpoint',
				indices: [m.sectionIndex, m.portalIndex, m.lineIndex, m.endIndex],
			};
		case 'noGoLineEndpoint':
			return {
				kind: 'noGoLineEndpoint',
				indices: [m.sectionIndex, m.lineIndex, m.endIndex],
			};
	}
}

// ---------------------------------------------------------------------------
// V12 codec — paths begin at the top of the parsed root.
//
//   - ['sections', i]
//   - ['sections', i, 'portals', p]
//   - ['sections', i, 'portals', p, 'boundaryLines', l]
//   - ['sections', i, 'portals', p, 'boundaryLines', l, 'endpoints', e]  (issue #73)
//   - ['sections', i, 'noGoLines', l]
//   - ['sections', i, 'noGoLines', l, 'endpoints', e]                    (issue #73)
//   - ['sections', i, 'corners', c]                                      (issue #73)
//
// `endpoints/e` is a synthetic path segment (e ∈ {0, 1}) — the on-disk schema
// stores the line as a single Vector4 with `verts.x/y` the start and
// `verts.z/w` the end, so there's no array to index into. The path encoding
// is editor-only: the bulk-transform gizmo needs to anchor at one endpoint,
// so we treat each line as having two addressable sub-points.
// ---------------------------------------------------------------------------

export const aiSectionsV12SelectionCodec: SelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 2 || path[0] !== 'sections') return null;
		const sectionIndex = path[1];
		if (typeof sectionIndex !== 'number') return null;
		if (path.length === 2) return { kind: 'section', indices: [sectionIndex] };

		const list = path[2];
		if (list === 'portals' && typeof path[3] === 'number') {
			const portalIndex = path[3];
			if (path.length === 4) return { kind: 'portal', indices: [sectionIndex, portalIndex] };
			if (path[4] === 'boundaryLines' && typeof path[5] === 'number') {
				const lineIndex = path[5];
				if (
					path.length >= 8
					&& path[6] === 'endpoints'
					&& typeof path[7] === 'number'
				) {
					return {
						kind: 'boundaryLineEndpoint',
						indices: [sectionIndex, portalIndex, lineIndex, path[7]],
					};
				}
				return { kind: 'boundaryLine', indices: [sectionIndex, portalIndex, lineIndex] };
			}
			// Sub-path within a portal collapses to portal selection.
			return { kind: 'portal', indices: [sectionIndex, portalIndex] };
		}
		if (list === 'noGoLines' && typeof path[3] === 'number') {
			const lineIndex = path[3];
			if (
				path.length >= 6
				&& path[4] === 'endpoints'
				&& typeof path[5] === 'number'
			) {
				return {
					kind: 'noGoLineEndpoint',
					indices: [sectionIndex, lineIndex, path[5]],
				};
			}
			return { kind: 'noGoLine', indices: [sectionIndex, lineIndex] };
		}
		if (list === 'corners' && typeof path[3] === 'number') {
			return { kind: 'corner', indices: [sectionIndex, path[3]] };
		}
		// Anything else under a section collapses to the section itself.
		return { kind: 'section', indices: [sectionIndex] };
	},
	selectionToPath: (sel: Selection): NodePath => {
		switch (sel.kind) {
			case 'section':
				return ['sections', sel.indices[0]];
			case 'portal':
				return ['sections', sel.indices[0], 'portals', sel.indices[1]];
			case 'boundaryLine':
				return ['sections', sel.indices[0], 'portals', sel.indices[1], 'boundaryLines', sel.indices[2]];
			case 'noGoLine':
				return ['sections', sel.indices[0], 'noGoLines', sel.indices[1]];
			case 'corner':
				return ['sections', sel.indices[0], 'corners', sel.indices[1]];
			case 'boundaryLineEndpoint':
				return [
					'sections', sel.indices[0],
					'portals', sel.indices[1],
					'boundaryLines', sel.indices[2],
					'endpoints', sel.indices[3],
				];
			case 'noGoLineEndpoint':
				return [
					'sections', sel.indices[0],
					'noGoLines', sel.indices[1],
					'endpoints', sel.indices[2],
				];
		}
		return [];
	},
});

// ---------------------------------------------------------------------------
// V4/V6 codec — paths nest under the `legacy` wrapper field
// (ParsedAISectionsV4 = { kind, version, legacy: LegacyAISectionsDataV4 }):
//
//   - ['legacy', 'sections', i]
//   - ['legacy', 'sections', i, 'portals', p]
//   - ['legacy', 'sections', i, 'portals', p, 'boundaryLines', l]
//   - ['legacy', 'sections', i, 'portals', p, 'boundaryLines', l, 'endpoints', e]
//   - ['legacy', 'sections', i, 'noGoLines', l]
//   - ['legacy', 'sections', i, 'noGoLines', l, 'endpoints', e]
//   - ['legacy', 'sections', i, 'corners', c]
//
// See the V12 codec above for the `endpoints/e` (e ∈ {0, 1}) synthetic-path
// rationale. The legacy overlay doesn't yet wire these sub-entity selections
// to the bulk gizmo (issue #73 ships V12 first), but parsing them keeps the
// codec siblings in lock-step.
// ---------------------------------------------------------------------------

export const aiSectionsLegacySelectionCodec: SelectionCodec = defineSelectionCodec({
	pathToSelection: (path: NodePath): Selection | null => {
		if (path.length < 3) return null;
		if (path[0] !== 'legacy' || path[1] !== 'sections') return null;
		const sectionIndex = path[2];
		if (typeof sectionIndex !== 'number') return null;
		if (path.length === 3) return { kind: 'section', indices: [sectionIndex] };

		const list = path[3];
		if (list === 'portals' && typeof path[4] === 'number') {
			const portalIndex = path[4];
			if (path.length === 5) return { kind: 'portal', indices: [sectionIndex, portalIndex] };
			if (path[5] === 'boundaryLines' && typeof path[6] === 'number') {
				const lineIndex = path[6];
				if (
					path.length >= 9
					&& path[7] === 'endpoints'
					&& typeof path[8] === 'number'
				) {
					return {
						kind: 'boundaryLineEndpoint',
						indices: [sectionIndex, portalIndex, lineIndex, path[8]],
					};
				}
				return { kind: 'boundaryLine', indices: [sectionIndex, portalIndex, lineIndex] };
			}
			return { kind: 'portal', indices: [sectionIndex, portalIndex] };
		}
		if (list === 'noGoLines' && typeof path[4] === 'number') {
			const lineIndex = path[4];
			if (
				path.length >= 7
				&& path[5] === 'endpoints'
				&& typeof path[6] === 'number'
			) {
				return {
					kind: 'noGoLineEndpoint',
					indices: [sectionIndex, lineIndex, path[6]],
				};
			}
			return { kind: 'noGoLine', indices: [sectionIndex, lineIndex] };
		}
		if (list === 'corners' && typeof path[4] === 'number') {
			return { kind: 'corner', indices: [sectionIndex, path[4]] };
		}
		return { kind: 'section', indices: [sectionIndex] };
	},
	selectionToPath: (sel: Selection): NodePath => {
		switch (sel.kind) {
			case 'section':
				return ['legacy', 'sections', sel.indices[0]];
			case 'portal':
				return ['legacy', 'sections', sel.indices[0], 'portals', sel.indices[1]];
			case 'boundaryLine':
				return [
					'legacy', 'sections', sel.indices[0],
					'portals', sel.indices[1],
					'boundaryLines', sel.indices[2],
				];
			case 'noGoLine':
				return ['legacy', 'sections', sel.indices[0], 'noGoLines', sel.indices[1]];
			case 'corner':
				return ['legacy', 'sections', sel.indices[0], 'corners', sel.indices[1]];
			case 'boundaryLineEndpoint':
				return [
					'legacy', 'sections', sel.indices[0],
					'portals', sel.indices[1],
					'boundaryLines', sel.indices[2],
					'endpoints', sel.indices[3],
				];
			case 'noGoLineEndpoint':
				return [
					'legacy', 'sections', sel.indices[0],
					'noGoLines', sel.indices[1],
					'endpoints', sel.indices[2],
				];
		}
		return [];
	},
});
