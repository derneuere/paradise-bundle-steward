// AISectionsLegacyOverlay — read-only WorldViewport overlay for the V4 (and
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
// **No edit ops** — no onChange, no gizmo, no corner handles, no edge
// handles, no snap toggle, no marquee. Edit ops land incrementally in
// future "Legacy edit op:" issues. Inline copies of `BatchedSections` etc.
// are intentional: the primitive-extraction refactor that lifts these out
// of AISectionsOverlay is a separate slice; this overlay ships standalone
// so it doesn't depend on that refactor.

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type {
	ParsedAISectionsV4,
	ParsedAISectionsV6,
	LegacyAISection,
	LegacyAISectionsData,
} from '@/lib/core/aiSections';
import { LegacyDangerRating } from '@/lib/core/aiSections';
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
// Colors / shared materials
// ---------------------------------------------------------------------------

// V4/V6 use a 3-step danger rating where V12 has a 5-step speed enum. The
// palette is hand-picked to read as "fast/normal/risky" at-a-glance and to
// stay obviously distinct from V12's blue→green→orange→red speed ramp so
// a side-by-side V4-vs-V12 comparison is unambiguous.
const DANGER_COLORS_RGB: Record<number, [number, number, number]> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: [0.27, 0.67, 0.53],
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: [0.53, 0.73, 0.27],
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: [0.8, 0.27, 0.27],
};
const FALLBACK_RGB: [number, number, number] = [0.4, 0.4, 0.4];

const DANGER_SHORT: Record<number, string> = {
	[LegacyDangerRating.E_DANGER_RATING_FREEWAY]: 'FREE',
	[LegacyDangerRating.E_DANGER_RATING_NORMAL]: 'NORM',
	[LegacyDangerRating.E_DANGER_RATING_DANGEROUS]: 'DANG',
};

const fillMaterial = new THREE.MeshBasicMaterial({
	vertexColors: true,
	transparent: true,
	opacity: 0.25,
	side: THREE.DoubleSide,
	depthWrite: false,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
});
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });

const portalGeo = new THREE.SphereGeometry(3, 12, 8);
const portalMat = new THREE.MeshStandardMaterial({ color: 0x33cccc, roughness: 0.4, metalness: 0.2 });
const portalSelMat = new THREE.MeshStandardMaterial({
	color: 0xffaa33, roughness: 0.4, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.5,
});

// ---------------------------------------------------------------------------
// Batched section geometry
// ---------------------------------------------------------------------------

export type BatchedLegacyAISections = {
	fillGeo: THREE.BufferGeometry;
	outlineGeo: THREE.BufferGeometry;
	/** triangle index → section index */
	faceToSection: Int32Array;
};

/**
 * Build a single fill + outline geometry for every legacy section. V4
 * sections always have exactly four corners stored as parallel
 * cornersX[4] / cornersZ[4] arrays — defensively we still skip any section
 * whose arrays are too short, in case a synthetic test fixture ships
 * fewer corners.
 */
export function buildBatchedLegacySections(sections: LegacyAISection[]): BatchedLegacyAISections {
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;
	for (const sec of sections) {
		const n = Math.min(sec.cornersX.length, sec.cornersZ.length);
		if (n < 3) continue;
		totalFillVerts += n;
		totalFillIndices += (n - 2) * 3;
		totalOutlineVerts += n * 2;
	}

	const positions = new Float32Array(totalFillVerts * 3);
	const colors = new Float32Array(totalFillVerts * 3);
	const indices = new Uint32Array(totalFillIndices);
	const faceToSection = new Int32Array(totalFillIndices / 3);
	const outPositions = new Float32Array(totalOutlineVerts * 3);

	let vOff = 0, iOff = 0, fOff = 0, oOff = 0;
	for (let si = 0; si < sections.length; si++) {
		const sec = sections[si];
		const n = Math.min(sec.cornersX.length, sec.cornersZ.length);
		if (n < 3) continue;

		const rgb = DANGER_COLORS_RGB[sec.dangerRating] ?? FALLBACK_RGB;
		const baseVert = vOff / 3;

		for (let ci = 0; ci < n; ci++) {
			positions[vOff] = sec.cornersX[ci];
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = sec.cornersZ[ci];
			colors[vOff] = rgb[0];
			colors[vOff + 1] = rgb[1];
			colors[vOff + 2] = rgb[2];
			vOff += 3;
		}

		const numTris = n - 2;
		for (let t = 0; t < numTris; t++) {
			indices[iOff] = baseVert;
			indices[iOff + 1] = baseVert + t + 1;
			indices[iOff + 2] = baseVert + t + 2;
			iOff += 3;
			faceToSection[fOff++] = si;
		}

		for (let ci = 0; ci < n; ci++) {
			const next = (ci + 1) % n;
			outPositions[oOff++] = sec.cornersX[ci];
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = sec.cornersZ[ci];
			outPositions[oOff++] = sec.cornersX[next];
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = sec.cornersZ[next];
		}
	}

	const fillGeo = new THREE.BufferGeometry();
	fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	fillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	fillGeo.setIndex(new THREE.BufferAttribute(indices, 1));
	fillGeo.computeBoundingSphere();

	const outlineGeo = new THREE.BufferGeometry();
	outlineGeo.setAttribute('position', new THREE.BufferAttribute(outPositions.subarray(0, oOff), 3));
	outlineGeo.computeBoundingSphere();

	return { fillGeo, outlineGeo, faceToSection };
}

// ---------------------------------------------------------------------------
// Batched scene — one draw call for fills, one for outlines
// ---------------------------------------------------------------------------

function BatchedSections({
	scene, onPickSection, onHoverSection,
}: {
	scene: BatchedLegacyAISections;
	onPickSection: (sectionIndex: number) => void;
	onHoverSection: (sectionIndex: number | null) => void;
}) {
	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) return;
		const si = scene.faceToSection[e.faceIndex];
		if (si != null && si >= 0) onPickSection(si);
	}, [scene.faceToSection, onPickSection]);

	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) { onHoverSection(null); return; }
		const si = scene.faceToSection[e.faceIndex];
		if (si != null && si >= 0) {
			onHoverSection(si);
			document.body.style.cursor = 'pointer';
		}
	}, [scene.faceToSection, onHoverSection]);

	const handlePointerOut = useCallback(() => {
		onHoverSection(null);
		document.body.style.cursor = 'auto';
	}, [onHoverSection]);

	return (
		<>
			<mesh
				geometry={scene.fillGeo}
				material={fillMaterial}
				onClick={handleClick}
				onPointerMove={handlePointerMove}
				onPointerOut={handlePointerOut}
			/>
			<lineSegments geometry={scene.outlineGeo} material={outlineMaterial} />
		</>
	);
}

// ---------------------------------------------------------------------------
// Selection / hover highlight (one section, drawn brighter)
// ---------------------------------------------------------------------------

function SelectionOverlay({ section, color }: { section: LegacyAISection; color: string }) {
	const geometry = useMemo(() => {
		const n = Math.min(section.cornersX.length, section.cornersZ.length);
		if (n < 3) return null;
		const shape = new THREE.Shape();
		shape.moveTo(section.cornersX[0], section.cornersZ[0]);
		for (let i = 1; i < n; i++) {
			shape.lineTo(section.cornersX[i], section.cornersZ[i]);
		}
		shape.closePath();
		const geo = new THREE.ShapeGeometry(shape);
		// ShapeGeometry sits on XY; rotate +π/2 around X to land on the XZ
		// plane at world (x, 0, z) — matches the outline `<Line>` below.
		geo.rotateX(Math.PI / 2);
		return geo;
	}, [section.cornersX, section.cornersZ]);

	if (!geometry) return null;

	const n = Math.min(section.cornersX.length, section.cornersZ.length);
	const linePoints: [number, number, number][] = [];
	for (let i = 0; i < n; i++) {
		linePoints.push([section.cornersX[i], 0.4, section.cornersZ[i]]);
	}
	if (n >= 3) linePoints.push([section.cornersX[0], 0.4, section.cornersZ[0]]);

	return (
		<>
			<mesh geometry={geometry} position={[0, 0.3, 0]}>
				<meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>
			{linePoints.length >= 3 && <Line points={linePoints} color={color} lineWidth={2.5} />}
		</>
	);
}

function SectionLabel({ section, index, color }: { section: LegacyAISection; index: number; color: string }) {
	const n = Math.min(section.cornersX.length, section.cornersZ.length);
	if (n < 4) return null;
	return (
		<Html
			position={[
				(section.cornersX[0] + section.cornersX[2]) / 2,
				2,
				(section.cornersZ[0] + section.cornersZ[2]) / 2,
			]}
			center
			distanceFactor={200}
			style={{ pointerEvents: 'none' }}
		>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				Sec {index} | {DANGER_SHORT[section.dangerRating] ?? section.dangerRating}
			</div>
		</Html>
	);
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
				const tn = Math.min(target.cornersX.length, target.cornersZ.length);
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
};

export const AISectionsLegacyOverlay: WorldOverlayComponent<ParsedAISectionsV4 | ParsedAISectionsV6> = ({
	data, selectedPath, onSelect,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);

	const legacy = data.legacy;
	const sections = legacy.sections;

	const marker = useMemo(() => legacyAISectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	const scene = useMemo(() => buildBatchedLegacySections(sections), [sections]);

	const selSection = selectedSectionIndex != null ? sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? sections[hoverSectionIndex] ?? null : null;

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

	return (
		<>
			<BatchedSections
				scene={scene}
				onPickSection={handlePickSection}
				onHoverSection={setHoverSectionIndex}
			/>

			{selSection && <SelectionOverlay section={selSection} color="#ffaa33" />}
			{hovSection && hoverSectionIndex !== selectedSectionIndex && (
				<SelectionOverlay section={hovSection} color="#66aaff" />
			)}

			{selSection && selectedSectionIndex != null && (
				<SectionLabel section={selSection} index={selectedSectionIndex} color="#ffaa33" />
			)}
			{hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<SectionLabel section={hovSection} index={hoverSectionIndex} color="#aaaaaa" />
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
		</>
	);
};

export default AISectionsLegacyOverlay;
