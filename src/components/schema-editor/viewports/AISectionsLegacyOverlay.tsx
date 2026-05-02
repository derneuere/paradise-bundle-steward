// AISectionsLegacyOverlay — WorldViewport overlay for the V4 (and
// later V6) prototype AI Sections data. Reads the legacy model directly —
// no adapter to the V12 shape — so the prototype's parallel cornersX[4] +
// cornersZ[4] storage, dangerRating enum, and Vector4 midPosition fields
// are visible to the rendering code without lossy translation.
//
// Visual conventions mirror `AISectionsOverlay` (V12) so the two overlays
// look like obvious siblings:
//   - Batched fill + outline mesh (one draw call each)
//   - Color from dangerRating (3 buckets: freeway / normal / dangerous)
//     instead of V12's speed (5 buckets)
//   - Portal spheres (cyan), boundary line segments (red),
//     no-go line segments (orange), portal-link dashed lines (cyan)
//   - Section label: `Sec {index}` — V4 has no `id` field so the label
//     is intentionally simpler than V12's `Sec i | 0xID | SPEED`.
//
// Selection currency is the schema NodePath (ADR-0001). The V4 schema nests
// the actual section list under a `legacy` wrapper field
// (ParsedAISectionsV4 = { kind, version, legacy: LegacyAISectionsDataV4 }),
// so the schema-correct paths the inspector tree generates — and that this
// overlay must match for selection round-trip to work — are:
//   - ['legacy', 'sections', i]                                       → section
//   - ['legacy', 'sections', i, 'portals', p]                         → portal
//   - ['legacy', 'sections', i, 'portals', p, 'boundaryLines', l]     → boundary line
//   - ['legacy', 'sections', i, 'noGoLines', l]                       → no-go line
//
// Corner drag edit op: selecting a section shows corner handles. Dragging
// one commits via `onChange` (if provided) using `translateLegacyCornerWithShared`,
// which cascades the move to all coincident corners and BL endpoints in the
// model (same "smart cascade" semantics as the V12 overlay). Snap is out of
// scope for this slice.
//
// 3D primitives (BatchedSections, SelectionOverlay, SectionLabel) live in
// `@/components/aisections/shared` so the V12 overlay consumes the same
// code path — bug fixes land in both at once. See issue #35.

import { useMemo, useState, useCallback } from 'react';
import { Html, Line } from '@react-three/drei';
import type {
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	LegacyAISection,
	LegacyAISectionsData,
	Vector2,
} from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
import { translateLegacyCornerWithShared } from '@/lib/core/aiSectionsOps';
import {
	BatchedSections,
	buildBatchedSections,
	SectionLabel,
	SelectionOverlay,
	portalGeo,
	portalMat,
	portalSelMat,
	type BatchedSectionsScene,
	type Corner,
	type SectionAccessor,
} from '@/components/aisections/shared';
import { CornerHandles, type CornerDragOffset } from '@/components/aisections/CornerHandles';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';

// ---------------------------------------------------------------------------
// Path → marker (exported for tests)
// ---------------------------------------------------------------------------

export type LegacyAISectionMarker =
	| { kind: 'section'; sectionIndex: number }
	| { kind: 'portal'; sectionIndex: number; portalIndex: number }
	| { kind: 'boundaryLine'; sectionIndex: number; portalIndex: number; lineIndex: number }
	| { kind: 'noGoLine'; sectionIndex: number; lineIndex: number }
	| null;

/**
 * Decode a schema path into the legacy-AI-Sections marker it points at, or
 * null if the path doesn't address a section / portal / boundary line / no-go
 * line. The V4 schema nests the section list under a `legacy` wrapper field
 * (so `legacy.sections[i]` is the path to a section), and sub-paths inside a
 * primitive (e.g. a portal's `midPosition.x`) collapse to "this portal is
 * selected" — the inspector can drill deeper while the 3D overlay still
 * highlights the parent.
 */
export function legacyAISectionPathMarker(path: NodePath): LegacyAISectionMarker {
	if (path.length < 3) return null;
	if (path[0] !== 'legacy' || path[1] !== 'sections') return null;
	const sectionIndex = path[2];
	if (typeof sectionIndex !== 'number') return null;
	if (path.length === 3) return { kind: 'section', sectionIndex };

	const list = path[3];
	if (list === 'portals' && typeof path[4] === 'number') {
		const portalIndex = path[4];
		if (path.length === 5) return { kind: 'portal', sectionIndex, portalIndex };
		if (path[5] === 'boundaryLines' && typeof path[6] === 'number') {
			return { kind: 'boundaryLine', sectionIndex, portalIndex, lineIndex: path[6] };
		}
		// Sub-path within a portal (e.g. `midPosition.x`) collapses to portal selection.
		return { kind: 'portal', sectionIndex, portalIndex };
	}
	if (list === 'noGoLines' && typeof path[4] === 'number') {
		return { kind: 'noGoLine', sectionIndex, lineIndex: path[4] };
	}
	// Anything else under a section collapses to the section itself
	// (e.g. `legacy.sections.i.cornersX.2` → just highlight section i).
	return { kind: 'section', sectionIndex };
}

/** Build the schema path for a marker. Inverse of `legacyAISectionPathMarker`. */
export function legacyAISectionMarkerPath(m: LegacyAISectionMarker): NodePath {
	if (!m) return [];
	switch (m.kind) {
		case 'section':
			return ['legacy', 'sections', m.sectionIndex];
		case 'portal':
			return ['legacy', 'sections', m.sectionIndex, 'portals', m.portalIndex];
		case 'boundaryLine':
			return ['legacy', 'sections', m.sectionIndex, 'portals', m.portalIndex, 'boundaryLines', m.lineIndex];
		case 'noGoLine':
			return ['legacy', 'sections', m.sectionIndex, 'noGoLines', m.lineIndex];
	}
}

// ---------------------------------------------------------------------------
// V4/V6 → shared adapters
// ---------------------------------------------------------------------------

// V4/V6 use a 3-step danger rating where V12 has a 5-step speed enum. The
// palette is hand-picked to read as "fast/normal/risky" at-a-glance and to
// stay obviously distinct from V12's blue→green→orange→red speed ramp so
// a side-by-side V4-vs-V12 comparison is unambiguous.
const DANGER_COLORS_RGB: Record<number, readonly [number, number, number]> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: [0.27, 0.67, 0.53],
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: [0.53, 0.73, 0.27],
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: [0.8, 0.27, 0.27],
};
const FALLBACK_RGB: readonly [number, number, number] = [0.4, 0.4, 0.4];

const DANGER_SHORT: Record<number, string> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: 'FREE',
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: 'NORM',
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: 'DANG',
};

// Defensively clamp to the shorter of cornersX / cornersZ — synthetic test
// fixtures may pass mismatched arrays even though the V4 wire format always
// stores exactly four of each.
function legacyCornerCount(s: LegacyAISection): number {
	return Math.min(s.cornersX.length, s.cornersZ.length);
}

const legacyAccessor: SectionAccessor<LegacyAISection> = {
	cornerCount: legacyCornerCount,
	cornerX: (s, i) => s.cornersX[i],
	cornerZ: (s, i) => s.cornersZ[i],
	color: (s) => DANGER_COLORS_RGB[s.dangerRating] ?? FALLBACK_RGB,
};

function legacyCorners(section: LegacyAISection): Corner[] {
	const n = legacyCornerCount(section);
	const out: Corner[] = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = { x: section.cornersX[i], z: section.cornersZ[i] };
	}
	return out;
}

/**
 * Convert a legacy section's parallel cornersX/cornersZ arrays into a
 * `Vector2[]` suitable for `CornerHandles` (which uses `{x, y}` where `y`
 * is the world Z coordinate, matching `AISection.corners`).
 */
function legacyCornersAsV2(section: LegacyAISection): Vector2[] {
	const n = legacyCornerCount(section);
	const out: Vector2[] = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = { x: section.cornersX[i], y: section.cornersZ[i] };
	}
	return out;
}

/**
 * Thin wrapper around the generic shared builder, kept for
 * `AISectionsLegacyOverlay.test.ts` which exercises V4-specific
 * cornersX/cornersZ projection + dangerRating colour buckets. The wrapper
 * just plugs the V4 accessor into the generic — no V4-specific geometry
 * code remains.
 */
export function buildBatchedLegacySections(sections: LegacyAISection[]): BatchedSectionsScene {
	return buildBatchedSections(sections, legacyAccessor);
}

// ---------------------------------------------------------------------------
// Detail layer for the selected section — read-only
// ---------------------------------------------------------------------------

function SelectedSectionDetail({
	section: sec,
	data,
	marker,
	onPickPortal,
	onPickBoundaryLine,
	onPickNoGoLine,
}: {
	section: LegacyAISection;
	data: LegacyAISectionsData;
	marker: LegacyAISectionMarker;
	onPickPortal: (portalIndex: number) => void;
	onPickBoundaryLine: (portalIndex: number, lineIndex: number) => void;
	onPickNoGoLine: (lineIndex: number) => void;
}) {
	if (!sec) return null;

	return (
		<>
			{sec.portals.map((portal, pi) => {
				// midPosition is a vpu::Vector3 on the wire (xyz + 4 bytes of
				// structural padding); the wrapper stores it as a Vector4 with
				// the 4th float preserved verbatim. For rendering we project
				// xyz only — the w component is structural padding.
				const pos: [number, number, number] = [portal.midPosition.x, portal.midPosition.y, portal.midPosition.z];
				const isSel = marker?.kind === 'portal' && marker.portalIndex === pi;
				return (
					<group key={`portal-${pi}`} position={pos}>
						<mesh
							geometry={portalGeo}
							material={isSel ? portalSelMat : portalMat}
							onClick={(e) => { e.stopPropagation(); onPickPortal(pi); }}
						/>
						<Html center distanceFactor={150} style={{ pointerEvents: 'none' }}>
							<div style={{
								background: 'rgba(0,0,0,0.75)', color: '#33cccc', padding: '2px 6px',
								borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
							}}>
								Portal {pi} → Sec {portal.linkSection}
							</div>
						</Html>
					</group>
				);
			})}

			{sec.portals.map((portal, pi) =>
				portal.boundaryLines.map((bl, li) => {
					const start: [number, number, number] = [bl.verts.x, portal.midPosition.y + 0.5, bl.verts.y];
					const end: [number, number, number] = [bl.verts.z, portal.midPosition.y + 0.5, bl.verts.w];
					const isSel = marker?.kind === 'boundaryLine' && marker.portalIndex === pi && marker.lineIndex === li;
					return (
						<group key={`bl-${pi}-${li}`}>
							<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc3333'} lineWidth={isSel ? 3 : 2} />
							<mesh
								position={[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]}
								onClick={(e) => { e.stopPropagation(); onPickBoundaryLine(pi, li); }}
							>
								<sphereGeometry args={[2, 6, 4]} />
								<meshBasicMaterial transparent opacity={0} />
							</mesh>
						</group>
					);
				}),
			)}

			{sec.noGoLines.map((bl, li) => {
				const start: [number, number, number] = [bl.verts.x, 0.5, bl.verts.y];
				const end: [number, number, number] = [bl.verts.z, 0.5, bl.verts.w];
				const isSel = marker?.kind === 'noGoLine' && marker.lineIndex === li;
				return (
					<group key={`ng-${li}`}>
						<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc8833'} lineWidth={isSel ? 3 : 2} />
						<mesh
							position={[(start[0] + end[0]) / 2, 0.5, (start[2] + end[2]) / 2]}
							onClick={(e) => { e.stopPropagation(); onPickNoGoLine(li); }}
						>
							<sphereGeometry args={[2, 6, 4]} />
							<meshBasicMaterial transparent opacity={0} />
						</mesh>
					</group>
				);
			})}

			{sec.portals.map((portal, pi) => {
				const target = data.sections[portal.linkSection];
				if (!target) return null;
				const tn = legacyCornerCount(target);
				if (tn < 4) return null;
				const from: [number, number, number] = [portal.midPosition.x, portal.midPosition.y + 1, portal.midPosition.z];
				const to: [number, number, number] = [
					(target.cornersX[0] + target.cornersX[2]) / 2,
					portal.midPosition.y + 1,
					(target.cornersZ[0] + target.cornersZ[2]) / 2,
				];
				return (
					<Line key={`link-${pi}`} points={[from, to]} color="#33cccc" lineWidth={1} dashed dashSize={4} gapSize={3} />
				);
			})}
		</>
	);
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

type Props = {
	data: ParsedAISectionsV4 | ParsedAISectionsV6;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	/**
	 * Called on pointer-up after a corner drag. Receives the full updated
	 * model with the dragged (and cascade-shared) corners moved by the drag
	 * offset. One call per committed drag — one undo entry.
	 */
	onChange?: (next: ParsedAISectionsV4 | ParsedAISectionsV6) => void;
};

export const AISectionsLegacyOverlay: WorldOverlayComponent<ParsedAISectionsV4 | ParsedAISectionsV6> = ({
	data, selectedPath, onSelect, onChange,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);
	const [drag, setDrag] = useState<{ cornerIdx: number; offset: CornerDragOffset } | null>(null);

	const legacy = data.legacy;
	const sections = legacy.sections;

	const marker = useMemo(() => legacyAISectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	const scene = useMemo(() => buildBatchedSections(sections, legacyAccessor), [sections]);

	const selSection = selectedSectionIndex != null ? sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? sections[hoverSectionIndex] ?? null : null;

	// Derive a preview legacy model while a corner drag is in flight so the
	// selection overlay and CornerHandles reflect the live offset.
	const previewLegacy: LegacyAISectionsData | null = useMemo(() => {
		if (selectedSectionIndex == null || !drag) return null;
		if (drag.offset.x === 0 && drag.offset.z === 0) return null;
		try {
			return translateLegacyCornerWithShared(legacy, selectedSectionIndex, drag.cornerIdx, drag.offset);
		} catch {
			return null;
		}
	}, [legacy, selectedSectionIndex, drag]);

	// The displayed selection section — uses preview during drag, live otherwise.
	const previewSelSection: LegacyAISection | null = useMemo(() => {
		if (!selSection) return null;
		if (!previewLegacy || selectedSectionIndex == null) return selSection;
		return previewLegacy.sections[selectedSectionIndex] ?? selSection;
	}, [selSection, previewLegacy, selectedSectionIndex]);

	const selCorners = useMemo(
		() => (previewSelSection ? legacyCorners(previewSelSection) : null),
		[previewSelSection],
	);
	const hovCorners = useMemo(
		() => (hovSection ? legacyCorners(hovSection) : null),
		[hovSection],
	);

	// Corners in Vector2 format (x,y where y=worldZ) for CornerHandles.
	const previewCornerHandleSection = useMemo(
		() => (previewSelSection ? { corners: legacyCornersAsV2(previewSelSection) } : null),
		[previewSelSection],
	);

	// Affected neighbours: sections that changed identity in the preview model.
	const affectedNeighbours = useMemo(() => {
		if (!previewLegacy || selectedSectionIndex == null) return [];
		const out: { idx: number; corners: Corner[] }[] = [];
		for (let i = 0; i < previewLegacy.sections.length; i++) {
			if (i === selectedSectionIndex) continue;
			if (previewLegacy.sections[i] !== sections[i]) {
				out.push({ idx: i, corners: legacyCorners(previewLegacy.sections[i]) });
			}
		}
		return out;
	}, [previewLegacy, selectedSectionIndex, sections]);

	const handlePickSection = useCallback((sectionIndex: number) => {
		onSelect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex }));
	}, [onSelect]);

	const handlePickPortal = useCallback((portalIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(legacyAISectionMarkerPath({ kind: 'portal', sectionIndex: selectedSectionIndex, portalIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickBoundaryLine = useCallback((portalIndex: number, lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(legacyAISectionMarkerPath({ kind: 'boundaryLine', sectionIndex: selectedSectionIndex, portalIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickNoGoLine = useCallback((lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(legacyAISectionMarkerPath({ kind: 'noGoLine', sectionIndex: selectedSectionIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	// Corner-drag handlers — update preview during drag, commit on release.
	const handleCornerDrag = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		setDrag({ cornerIdx, offset });
	}, []);

	const handleCornerCommit = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		if (offset.x === 0 && offset.z === 0) return;
		try {
			const nextLegacy = translateLegacyCornerWithShared(legacy, selectedSectionIndex, cornerIdx, offset);
			onChange({ ...data, legacy: nextLegacy });
		} catch {
			// out-of-range: ignore
		}
	}, [data, legacy, selectedSectionIndex, onChange]);

	const handleCornerCancel = useCallback(() => setDrag(null), []);

	return (
		<>
			<BatchedSections
				scene={scene}
				onPickSection={handlePickSection}
				onHoverSection={setHoverSectionIndex}
			/>

			{selCorners && <SelectionOverlay corners={selCorners} color="#ffaa33" />}
			{hovCorners && hoverSectionIndex !== selectedSectionIndex && (
				<SelectionOverlay corners={hovCorners} color="#66aaff" />
			)}

			{affectedNeighbours.map(({ idx, corners }) => (
				<SelectionOverlay key={`neighbour-${idx}`} corners={corners} color="#ffaa33" />
			))}

			{selCorners && selSection && selectedSectionIndex != null && (
				<SectionLabel corners={selCorners} color="#ffaa33">
					Sec {selectedSectionIndex} | {DANGER_SHORT[selSection.dangerRating] ?? selSection.dangerRating}
				</SectionLabel>
			)}
			{hovCorners && hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<SectionLabel corners={hovCorners} color="#aaaaaa">
					Sec {hoverSectionIndex} | {DANGER_SHORT[hovSection.dangerRating] ?? hovSection.dangerRating}
				</SectionLabel>
			)}

			{selectedSectionIndex != null && selSection && (
				<SelectedSectionDetail
					section={selSection}
					data={legacy}
					marker={marker}
					onPickPortal={handlePickPortal}
					onPickBoundaryLine={handlePickBoundaryLine}
					onPickNoGoLine={handlePickNoGoLine}
				/>
			)}

			{previewCornerHandleSection && (
				<CornerHandles
					section={previewCornerHandleSection}
					pixelSize={12}
					onDrag={handleCornerDrag}
					onCommit={handleCornerCommit}
					onCancel={handleCornerCancel}
				/>
			)}
		</>
	);
};

export default AISectionsLegacyOverlay;
