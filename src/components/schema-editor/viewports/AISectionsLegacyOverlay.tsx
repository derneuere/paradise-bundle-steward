// AISectionsLegacyOverlay — WorldViewport overlay for the V4/V6 prototype
// AI Sections data. Reads the legacy model directly — no adapter to the V12
// shape — so the prototype's parallel cornersX[4] + cornersZ[4] storage,
// dangerRating enum, and Vector4 midPosition fields are visible to the
// rendering code without lossy translation.
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
// Edit ops: just one — `Duplicate section through this edge` from the edge
// right-click menu. No translate gizmo, no corner handles, no snap toggle,
// no marquee yet — those are follow-up slices once the V4 schema unfreezes
// further fields. The op routes through `duplicateLegacySectionThroughEdge`
// in `aiSectionsOps.ts`; see issue #44.
//
// 3D primitives (BatchedSections, SelectionOverlay, SectionLabel,
// EdgeHandles, EdgeContextMenu) live in `@/components/aisections/shared`
// so the V12 overlay consumes the same code path — bug fixes land in both
// at once. See issue #35.

import { useMemo, useState, useCallback } from 'react';
import { Html, Line } from '@react-three/drei';
import { Copy } from 'lucide-react';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import type {
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	LegacyAISection,
	LegacyAISectionsData,
} from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
import { duplicateLegacySectionThroughEdge } from '@/lib/core/aiSectionsOps';
import {
	BatchedSections,
	buildBatchedSections,
	EdgeContextMenu,
	EdgeHandles,
	SectionLabel,
	SelectionOverlay,
	portalGeo,
	portalMat,
	portalSelMat,
	type BatchedSectionsScene,
	type Corner,
	type SectionAccessor,
} from '@/components/aisections/shared';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';

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
	corners,
	onPickPortal,
	onPickBoundaryLine,
	onPickNoGoLine,
	hoveredEdge,
	onHoverEdge,
	onEdgeContextMenu,
}: {
	section: LegacyAISection;
	data: LegacyAISectionsData;
	marker: LegacyAISectionMarker;
	corners: Corner[];
	onPickPortal: (portalIndex: number) => void;
	onPickBoundaryLine: (portalIndex: number, lineIndex: number) => void;
	onPickNoGoLine: (lineIndex: number) => void;
	hoveredEdge: number | null;
	onHoverEdge: (edgeIdx: number | null) => void;
	onEdgeContextMenu: (edgeIdx: number, screenX: number, screenY: number) => void;
}) {
	if (!sec) return null;

	return (
		<>
			<EdgeHandles
				corners={corners}
				hoveredEdge={hoveredEdge}
				onHoverEdge={onHoverEdge}
				onContextMenu={onEdgeContextMenu}
			/>
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
	onChange?: (next: ParsedAISectionsV4 | ParsedAISectionsV6) => void;
	/** True when this overlay owns the active selection — gates HTML-slot
	 *  registration of the edge context menu. Defaults to `true` so single-
	 *  resource (legacy per-page) routes don't have to thread it. */
	isActive?: boolean;
};

export const AISectionsLegacyOverlay: WorldOverlayComponent<ParsedAISectionsV4 | ParsedAISectionsV6> = ({
	data, selectedPath, onSelect, onChange, isActive = true,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);

	const legacy = data.legacy;
	const sections = legacy.sections;

	const marker = useMemo(() => legacyAISectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	const scene = useMemo(() => buildBatchedSections(sections, legacyAccessor), [sections]);

	const selSection = selectedSectionIndex != null ? sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? sections[hoverSectionIndex] ?? null : null;

	const selCorners = useMemo(
		() => (selSection ? legacyCorners(selSection) : null),
		[selSection],
	);
	const hovCorners = useMemo(
		() => (hovSection ? legacyCorners(hovSection) : null),
		[hovSection],
	);

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

	// Reset transient edge UI when the selected section changes — the
	// hover / open-menu state belongs to a section, not the overlay.
	useResetOnChange(selectedSectionIndex, () => {
		setHoveredEdge(null);
		setEdgeMenu(null);
	});

	const handleEdgeContextMenu = useCallback(
		(edgeIdx: number, screenX: number, screenY: number) => {
			if (selectedSectionIndex == null) return;
			setEdgeMenu({
				x: screenX,
				y: screenY,
				sectionIndex: selectedSectionIndex,
				edgeIdx,
			});
		},
		[selectedSectionIndex],
	);

	const handleDuplicateThroughEdge = useCallback(() => {
		if (!edgeMenu || !onChange) return;
		const nextLegacy = duplicateLegacySectionThroughEdge(
			legacy,
			edgeMenu.sectionIndex,
			edgeMenu.edgeIdx,
		);
		// Re-wrap into the discriminated-union root so the page's setAtPath([])
		// receives the same shape it gave us. `version` and `kind` are
		// unchanged — the wrapper exists purely as a structural tag.
		const nextRoot = { ...data, legacy: nextLegacy } as ParsedAISectionsV4 | ParsedAISectionsV6;
		onChange(nextRoot);
		const dupIdx = nextLegacy.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length. Mirrors the V12 overlay's flow.
		requestAnimationFrame(() => {
			onSelect(legacyAISectionMarkerPath({ kind: 'section', sectionIndex: dupIdx }));
		});
		setEdgeMenu(null);
	}, [data, legacy, edgeMenu, onChange, onSelect]);

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

			{selectedSectionIndex != null && selSection && selCorners && (
				<SelectedSectionDetail
					section={selSection}
					data={legacy}
					marker={marker}
					corners={selCorners}
					onPickPortal={handlePickPortal}
					onPickBoundaryLine={handlePickBoundaryLine}
					onPickNoGoLine={handlePickNoGoLine}
					hoveredEdge={hoveredEdge}
					onHoverEdge={setHoveredEdge}
					onEdgeContextMenu={handleEdgeContextMenu}
				/>
			)}

			<HtmlSiblings
				isActive={isActive}
				edgeMenu={edgeMenu}
				canDuplicate={!!onChange}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => setEdgeMenu(null)}
			/>
		</>
	);
};

// HtmlSiblings — DOM-overlay JSX for the edge context menu, registered into
// the WorldViewport chrome's HTML slot so it floats above the WebGL surface.
// Kept as a separate component (mirroring the V12 overlay) so the slot
// re-registration deps can be tracked precisely without dragging in the
// rest of the overlay's state.
function HtmlSiblings({
	isActive,
	edgeMenu,
	canDuplicate,
	onDuplicateThroughEdge,
	onCloseEdgeMenu,
}: {
	isActive: boolean;
	edgeMenu: { x: number; y: number; sectionIndex: number; edgeIdx: number } | null;
	canDuplicate: boolean;
	onDuplicateThroughEdge: () => void;
	onCloseEdgeMenu: () => void;
}) {
	const node = useMemo(
		() => (
			<>
				{edgeMenu && (
					<EdgeContextMenu
						x={edgeMenu.x}
						y={edgeMenu.y}
						edgeIdx={edgeMenu.edgeIdx}
						onClose={onCloseEdgeMenu}
					>
						<button
							type="button"
							className="w-full text-left flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={onDuplicateThroughEdge}
							disabled={!canDuplicate}
							title={canDuplicate ? undefined : 'No edit handler wired — overlay is read-only here'}
						>
							<Copy className="h-3.5 w-3.5" />
							Duplicate section through this edge
						</button>
					</EdgeContextMenu>
				)}
			</>
		),
		[edgeMenu, canDuplicate, onDuplicateThroughEdge, onCloseEdgeMenu],
	);
	useWorldViewportHtmlSlot(isActive ? node : null);
	return null;
}

export default AISectionsLegacyOverlay;
