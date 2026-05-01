// AISectionsOverlay — WorldViewport overlay for the AISections resource.
//
// Renders ~8780 sections as one batched fill+outline mesh (2 draw calls)
// with face-index → section picking. The currently-selected section gets a
// detail layer: portals as cyan spheres, boundary lines as red segments,
// noGo lines as orange segments, portal-link lines as dashed cyan, and
// edge handles for in-scene drag/duplicate ops. A translate gizmo and
// corner handles live above the selected section for in-scene editing,
// emitting through the optional `onChange` prop.
//
// Selection currency is the schema NodePath (ADR-0001). The overlay matches:
//   - ['sections', i]                                       → section
//   - ['sections', i, 'portals', p]                         → portal
//   - ['sections', i, 'portals', p, 'boundaryLines', l]     → boundary line
//   - ['sections', i, 'noGoLines', l]                       → no-go line
//
// DOM siblings of the Canvas (snap toggle, marquee rectangle, edge
// right-click context menu) ride the WorldViewport chrome's HTML slot —
// see `useWorldViewportHtmlSlot()` in `./WorldViewport.tsx`. The marquee
// pairs an inside-Canvas `<CameraBridge>` with the DOM rectangle so the
// latter can read camera state.

import { useMemo, useRef, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { Copy, Magnet } from 'lucide-react';
import { useDismissOnOutsideInteraction } from '@/hooks/useDismissOnOutsideInteraction';
import { useToggleHotkey } from '@/hooks/useToggleHotkey';
import { useResetOnChange } from '@/hooks/useResetOnChange';
import * as THREE from 'three';
import type { ParsedAISections, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';
import {
	duplicateSectionThroughEdge,
	snapCornerOffset,
	snapSectionOffset,
	translateCornerWithShared,
	translateSectionWithLinks,
} from '@/lib/core/aiSectionsOps';
import { TranslateGizmo, type GizmoOffset } from '@/components/common/three/TranslateGizmo';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { CornerHandles, type CornerDragOffset } from '@/components/aisections/CornerHandles';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';
import type { WorldOverlayComponent } from './WorldViewport.types';
import { useWorldViewportHtmlSlot } from './WorldViewport';

// ---------------------------------------------------------------------------
// Path → AISection selection (exported for tests)
// ---------------------------------------------------------------------------

export type AISectionMarker =
	| { kind: 'section'; sectionIndex: number }
	| { kind: 'portal'; sectionIndex: number; portalIndex: number }
	| { kind: 'boundaryLine'; sectionIndex: number; portalIndex: number; lineIndex: number }
	| { kind: 'noGoLine'; sectionIndex: number; lineIndex: number }
	| null;

/**
 * Decode a schema path into the AISections marker it points at, or null if
 * the path doesn't address an AI section / portal / boundary-line / no-go
 * line. Sub-paths inside a primitive (e.g. a portal's `position.x`) collapse
 * to "this portal is selected" — the inspector can drill deeper while the
 * 3D overlay still highlights the parent.
 */
export function aiSectionPathMarker(path: NodePath): AISectionMarker {
	if (path.length < 2 || path[0] !== 'sections') return null;
	const sectionIndex = path[1];
	if (typeof sectionIndex !== 'number') return null;
	if (path.length === 2) return { kind: 'section', sectionIndex };

	const list = path[2];
	if (list === 'portals' && typeof path[3] === 'number') {
		const portalIndex = path[3];
		if (path.length === 4) return { kind: 'portal', sectionIndex, portalIndex };
		if (path[4] === 'boundaryLines' && typeof path[5] === 'number') {
			return { kind: 'boundaryLine', sectionIndex, portalIndex, lineIndex: path[5] };
		}
		// Sub-path within a portal (e.g. `position.x`) collapses to portal selection.
		return { kind: 'portal', sectionIndex, portalIndex };
	}
	if (list === 'noGoLines' && typeof path[3] === 'number') {
		return { kind: 'noGoLine', sectionIndex, lineIndex: path[3] };
	}
	// Anything else under a section collapses to the section itself.
	return { kind: 'section', sectionIndex };
}

/** Build the schema path for a marker. Inverse of `aiSectionPathMarker`. */
export function aiSectionMarkerPath(m: AISectionMarker): NodePath {
	if (!m) return [];
	switch (m.kind) {
		case 'section':
			return ['sections', m.sectionIndex];
		case 'portal':
			return ['sections', m.sectionIndex, 'portals', m.portalIndex];
		case 'boundaryLine':
			return ['sections', m.sectionIndex, 'portals', m.portalIndex, 'boundaryLines', m.lineIndex];
		case 'noGoLine':
			return ['sections', m.sectionIndex, 'noGoLines', m.lineIndex];
	}
}

// ---------------------------------------------------------------------------
// Colors / shared materials
// ---------------------------------------------------------------------------

const SPEED_COLORS_RGB: Record<number, [number, number, number]> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: [0.2, 0.4, 0.8],
	[SectionSpeed.E_SECTION_SPEED_SLOW]: [0.27, 0.67, 0.53],
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: [0.53, 0.73, 0.27],
	[SectionSpeed.E_SECTION_SPEED_FAST]: [0.8, 0.53, 0.2],
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: [0.8, 0.2, 0.2],
};
const FALLBACK_RGB: [number, number, number] = [0.4, 0.4, 0.4];

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

export type BatchedAISections = {
	fillGeo: THREE.BufferGeometry;
	outlineGeo: THREE.BufferGeometry;
	/** triangle index → section index */
	faceToSection: Int32Array;
};

export function buildBatchedSections(sections: AISection[]): BatchedAISections {
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;
	for (const sec of sections) {
		const n = sec.corners.length;
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
		const n = sec.corners.length;
		if (n < 3) continue;

		const rgb = SPEED_COLORS_RGB[sec.speed] ?? FALLBACK_RGB;
		const baseVert = vOff / 3;

		for (let ci = 0; ci < n; ci++) {
			positions[vOff] = sec.corners[ci].x;
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = sec.corners[ci].y;
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
			outPositions[oOff++] = sec.corners[ci].x;
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = sec.corners[ci].y;
			outPositions[oOff++] = sec.corners[next].x;
			outPositions[oOff++] = 0.5;
			outPositions[oOff++] = sec.corners[next].y;
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
	scene: BatchedAISections;
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

function SelectionOverlay({ section, color }: { section: AISection; color: string }) {
	const geometry = useMemo(() => {
		if (section.corners.length < 3) return null;
		const shape = new THREE.Shape();
		shape.moveTo(section.corners[0].x, section.corners[0].y);
		for (let i = 1; i < section.corners.length; i++) {
			shape.lineTo(section.corners[i].x, section.corners[i].y);
		}
		shape.closePath();
		const geo = new THREE.ShapeGeometry(shape);
		// ShapeGeometry sits on XY; rotate +π/2 around X to land on the XZ
		// plane at world (x, 0, y) — matches the outline `<Line>` below.
		geo.rotateX(Math.PI / 2);
		return geo;
	}, [section.corners]);

	if (!geometry) return null;

	return (
		<>
			<mesh geometry={geometry} position={[0, 0.3, 0]}>
				<meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>
			{section.corners.length >= 3 && (
				<Line
					points={[
						...section.corners.map((c): [number, number, number] => [c.x, 0.4, c.y]),
						[section.corners[0].x, 0.4, section.corners[0].y],
					]}
					color={color}
					lineWidth={2.5}
				/>
			)}
		</>
	);
}

function SectionLabel({ section, index, color }: { section: AISection; index: number; color: string }) {
	if (section.corners.length < 4) return null;
	return (
		<Html
			position={[
				(section.corners[0].x + section.corners[2].x) / 2,
				2,
				(section.corners[0].y + section.corners[2].y) / 2,
			]}
			center
			distanceFactor={200}
			style={{ pointerEvents: 'none' }}
		>
			<div style={{
				background: 'rgba(0,0,0,0.8)', color, padding: '2px 6px',
				borderRadius: 4, fontSize: 10, whiteSpace: 'nowrap', fontFamily: 'monospace',
			}}>
				Sec {index} | 0x{(section.id >>> 0).toString(16).toUpperCase()} | {['VSLOW', 'SLOW', 'NORM', 'FAST', 'VFAST'][section.speed] ?? section.speed}
			</div>
		</Html>
	);
}

// ---------------------------------------------------------------------------
// Edge handles — visible outline + invisible hit boxes for hover + right-click
// ---------------------------------------------------------------------------

function EdgeHandles({
	section, hoveredEdge, onHoverEdge, onContextMenu,
}: {
	section: AISection;
	hoveredEdge: number | null;
	onHoverEdge: (edgeIdx: number | null) => void;
	onContextMenu: (edgeIdx: number, screenX: number, screenY: number) => void;
}) {
	const corners = section.corners;
	const N = corners.length;
	if (N < 2) return null;

	return (
		<>
			{corners.map((_, i) => {
				const A = corners[i];
				const B = corners[(i + 1) % N];
				const midX = (A.x + B.x) / 2;
				const midZ = (A.y + B.y) / 2;
				const dx = B.x - A.x;
				const dz = B.y - A.y;
				const length = Math.hypot(dx, dz);
				if (length === 0) return null;
				const angle = -Math.atan2(dz, dx);

				const isHovered = hoveredEdge === i;
				const lineColor = isHovered ? '#33ff66' : '#ffaa33';
				const lineWidth = isHovered ? 4 : 2;
				const hitWidth = Math.max(length * 0.05, 2);

				return (
					<group key={`edge-${i}`}>
						<Line
							points={[
								[A.x, 0.6, A.y],
								[B.x, 0.6, B.y],
							]}
							color={lineColor}
							lineWidth={lineWidth}
						/>
						<mesh
							position={[midX, 0.6, midZ]}
							rotation={[0, angle, 0]}
							onPointerOver={(e) => {
								e.stopPropagation();
								onHoverEdge(i);
								document.body.style.cursor = 'context-menu';
							}}
							onPointerOut={(e) => {
								e.stopPropagation();
								onHoverEdge(null);
								document.body.style.cursor = 'auto';
							}}
							onContextMenu={(e) => {
								e.stopPropagation();
								// Suppress the browser's default context menu so
								// only ours opens.
								e.nativeEvent.preventDefault();
								onContextMenu(i, e.nativeEvent.clientX, e.nativeEvent.clientY);
							}}
						>
							<boxGeometry args={[length, 1, hitWidth]} />
							<meshBasicMaterial transparent opacity={0} />
						</mesh>
						{isHovered && (
							<Html
								position={[midX, 1.5, midZ]}
								center
								distanceFactor={150}
								style={{ pointerEvents: 'none' }}
							>
								<div
									style={{
										background: 'rgba(0,0,0,0.9)',
										color: '#33ff66',
										padding: '2px 6px',
										borderRadius: 4,
										fontSize: 10,
										whiteSpace: 'nowrap',
										fontFamily: 'monospace',
									}}
								>
									Edge {i} · right-click for actions
								</div>
							</Html>
						)}
					</group>
				);
			})}
		</>
	);
}

// ---------------------------------------------------------------------------
// Edge context menu — DOM, positioned at click coords
// ---------------------------------------------------------------------------
//
// Rendered into the WorldViewport chrome's HTML slot via createPortal so it
// floats above the WebGL surface. We don't reuse shadcn's <ContextMenu>
// because that primitive binds to right-click on a DOM element; the trigger
// here is a Three.js mesh `onContextMenu`, so we need a programmatic open.

// `pointerEvents: 'auto'` is load-bearing: the WorldViewport HTML slot
// wrapper (`useWorldViewportHtmlSlot`) sets `pointer-events: none` on its
// container so empty overlay area doesn't eat canvas orbit / pick events.
// CSS inheritance carries that through to position-fixed children too, so any
// slot child that needs clicks must opt back in. Without this, the menu
// renders but the chip's onClick never fires (issue #30). Exported for the
// regression test that pins the pointer-events opt-in.
export function edgeContextMenuRootStyle(x: number, y: number): React.CSSProperties {
	return { position: 'fixed', left: x, top: y, zIndex: 1000, pointerEvents: 'auto' };
}

function EdgeContextMenu({
	x, y, edgeIdx, onDuplicate, onClose,
}: {
	x: number;
	y: number;
	edgeIdx: number;
	onDuplicate: () => void;
	onClose: () => void;
}) {
	useDismissOnOutsideInteraction(onClose);

	return (
		<div
			style={edgeContextMenuRootStyle(x, y)}
			className="bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[16rem]"
			onMouseDown={(e) => e.stopPropagation()}
			onContextMenu={(e) => e.preventDefault()}
		>
			<div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
				Edge {edgeIdx}
			</div>
			<button
				type="button"
				className="w-full text-left flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
				onClick={onDuplicate}
			>
				<Copy className="h-3.5 w-3.5" />
				Duplicate section through this edge
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Detail layer for the selected section
// ---------------------------------------------------------------------------

function SelectedSectionDetail({
	section: sec,
	data,
	sectionIndex,
	marker,
	onPickPortal,
	onPickBoundaryLine,
	onPickNoGoLine,
	hoveredEdge,
	onHoverEdge,
	onEdgeContextMenu,
}: {
	section: AISection;
	data: ParsedAISections;
	sectionIndex: number;
	marker: AISectionMarker;
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
				section={sec}
				hoveredEdge={hoveredEdge}
				onHoverEdge={onHoverEdge}
				onContextMenu={onEdgeContextMenu}
			/>

			{sec.portals.map((portal, pi) => {
				const pos: [number, number, number] = [portal.position.x, portal.position.y, portal.position.z];
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
					const start: [number, number, number] = [bl.verts.x, portal.position.y + 0.5, bl.verts.y];
					const end: [number, number, number] = [bl.verts.z, portal.position.y + 0.5, bl.verts.w];
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
							{isSel && (
								<>
									<mesh position={start}>
										<sphereGeometry args={[1.5, 8, 6]} />
										<meshStandardMaterial color="#ff4444" emissive="#441111" emissiveIntensity={0.5} />
									</mesh>
									<mesh position={end}>
										<sphereGeometry args={[1.5, 8, 6]} />
										<meshStandardMaterial color="#4444ff" emissive="#111144" emissiveIntensity={0.5} />
									</mesh>
									<Html position={start} center distanceFactor={120} style={{ pointerEvents: 'none' }}>
										<div style={{ background: 'rgba(0,0,0,0.8)', color: '#ff6666', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace' }}>
											X={bl.verts.x.toFixed(1)} Y={bl.verts.y.toFixed(1)}
										</div>
									</Html>
									<Html position={end} center distanceFactor={120} style={{ pointerEvents: 'none' }}>
										<div style={{ background: 'rgba(0,0,0,0.8)', color: '#6666ff', padding: '1px 4px', borderRadius: 3, fontSize: 9, fontFamily: 'monospace' }}>
											Z={bl.verts.z.toFixed(1)} W={bl.verts.w.toFixed(1)}
										</div>
									</Html>
								</>
							)}
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
				if (!target || target.corners.length < 4) return null;
				const from: [number, number, number] = [portal.position.x, portal.position.y + 1, portal.position.z];
				const to: [number, number, number] = [
					(target.corners[0].x + target.corners[2].x) / 2,
					portal.position.y + 1,
					(target.corners[0].y + target.corners[2].y) / 2,
				];
				return (
					<Line key={`link-${pi}`} points={[from, to]} color="#33cccc" lineWidth={1} dashed dashSize={4} gapSize={3} />
				);
			})}
			{/* Anchor for the dashed-line ref so React doesn't warn about unused 'data' */}
		</>
	);
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

// While a drag is in flight we keep the live offset in local state so the
// underlying model isn't touched until release — one drag commits as one
// undo entry. Two distinct drag flavours can be active (the gizmo translates
// the whole section; the corner handles deform the polygon), so we model it
// as a discriminated union with mutual exclusion.
type ActiveDrag =
	| { kind: 'section'; offset: GizmoOffset }
	| { kind: 'corner'; cornerIdx: number; offset: CornerDragOffset };

type Props = {
	data: ParsedAISections;
	selectedPath: NodePath;
	onSelect: (path: NodePath) => void;
	onChange?: (next: ParsedAISections) => void;
	/** True when this overlay owns the active selection — gates tool registration. */
	isActive?: boolean;
};

export const AISectionsOverlay: WorldOverlayComponent<ParsedAISections> = ({
	data, selectedPath, onSelect, onChange, isActive = true,
}: Props) => {
	const [hoverSectionIndex, setHoverSectionIndex] = useState<number | null>(null);
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);
	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);

	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();

	const marker = useMemo(() => aiSectionPathMarker(selectedPath), [selectedPath]);
	const selectedSectionIndex = marker ? marker.sectionIndex : null;

	// Snap radius scales with the scene — for a typical AI bundle (~200 units
	// radius) this lands at ~4 units which feels right when sections are
	// 10–30 units across. Recomputed when the data changes.
	const snapRadius = useMemo(() => {
		if (data.sections.length === 0) return 0.5;
		const box = new THREE.Box3();
		for (const sec of data.sections) {
			for (const c of sec.corners) box.expandByPoint(new THREE.Vector3(c.x, 0, c.y));
		}
		const sphere = new THREE.Sphere();
		box.getBoundingSphere(sphere);
		return Math.max(sphere.radius * 0.02, 0.5);
	}, [data]);

	// `S` toggles snap mode.
	useToggleHotkey('s', setSnapEnabled);

	const scene = useMemo(() => buildBatchedSections(data.sections), [data.sections]);

	const selSection = selectedSectionIndex != null ? data.sections[selectedSectionIndex] ?? null : null;
	const hovSection = hoverSectionIndex != null ? data.sections[hoverSectionIndex] ?? null : null;

	// While a drag is in flight, run the relevant op on the live offset to
	// derive a preview model. Used for the selection overlay on the source
	// AND for highlighted neighbours that the smart-cascade affects, so the
	// user sees the move in real time.
	const previewModel: ParsedAISections | null = useMemo(() => {
		if (selectedSectionIndex == null || !selSection || !drag) return null;
		if (drag.offset.x === 0 && drag.offset.z === 0) return null;
		try {
			if (drag.kind === 'section') {
				return translateSectionWithLinks(data, selectedSectionIndex, drag.offset);
			}
			return translateCornerWithShared(data, selectedSectionIndex, drag.cornerIdx, drag.offset);
		} catch {
			return null;
		}
	}, [data, selectedSectionIndex, selSection, drag]);

	const previewSection: AISection | null = useMemo(() => {
		if (!selSection) return null;
		if (!previewModel || selectedSectionIndex == null) return selSection;
		return previewModel.sections[selectedSectionIndex] ?? selSection;
	}, [selSection, previewModel, selectedSectionIndex]);

	const affectedNeighbours = useMemo(() => {
		if (!previewModel || selectedSectionIndex == null) return [];
		const out: { idx: number; section: AISection }[] = [];
		for (let i = 0; i < previewModel.sections.length; i++) {
			if (i === selectedSectionIndex) continue;
			if (previewModel.sections[i] !== data.sections[i]) {
				out.push({ idx: i, section: previewModel.sections[i] });
			}
		}
		return out;
	}, [previewModel, selectedSectionIndex, data]);

	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		if (!previewSection || previewSection.corners.length === 0) return null;
		let sx = 0, sz = 0;
		for (const c of previewSection.corners) { sx += c.x; sz += c.y; }
		const n = previewSection.corners.length;
		return [sx / n, 1.5, sz / n];
	}, [previewSection]);

	const gizmoPixelSize = 90;
	const cornerHandlePixelSize = 12;

	// Selection / pick callbacks — all funnel through onSelect with the right path.
	const handlePickSection = useCallback((sectionIndex: number) => {
		onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex }));
	}, [onSelect]);

	const handlePickPortal = useCallback((portalIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'portal', sectionIndex: selectedSectionIndex, portalIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickBoundaryLine = useCallback((portalIndex: number, lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'boundaryLine', sectionIndex: selectedSectionIndex, portalIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	const handlePickNoGoLine = useCallback((lineIndex: number) => {
		if (selectedSectionIndex == null) return;
		onSelect(aiSectionMarkerPath({ kind: 'noGoLine', sectionIndex: selectedSectionIndex, lineIndex }));
	}, [onSelect, selectedSectionIndex]);

	// Drag handlers — the gizmo translates the section, corner handles deform
	// the polygon. Both go through the smart-cascade ops on commit and emit
	// the new root via onChange. Without onChange these are no-ops.
	const handleGizmoTranslate = useCallback((offset: GizmoOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapSectionOffset(data, selectedSectionIndex, offset, snapRadius)
				: offset;
		setDrag({ kind: 'section', offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, data, snapRadius]);

	const handleGizmoCommit = useCallback((offset: GizmoOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		if (offset.x === 0 && offset.z === 0) return;
		const finalOffset = snapEnabled
			? snapSectionOffset(data, selectedSectionIndex, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		onChange(translateSectionWithLinks(data, selectedSectionIndex, finalOffset));
	}, [data, selectedSectionIndex, snapEnabled, snapRadius, onChange]);

	const handleGizmoCancel = useCallback(() => setDrag(null), []);

	const handleCornerDrag = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		const finalOffset =
			snapEnabled && selectedSectionIndex != null
				? snapCornerOffset(data, selectedSectionIndex, cornerIdx, offset, snapRadius)
				: offset;
		setDrag({ kind: 'corner', cornerIdx, offset: finalOffset });
	}, [snapEnabled, selectedSectionIndex, data, snapRadius]);

	const handleCornerCommit = useCallback((cornerIdx: number, offset: CornerDragOffset) => {
		setDrag(null);
		if (selectedSectionIndex == null || !onChange) return;
		if (offset.x === 0 && offset.z === 0) return;
		const finalOffset = snapEnabled
			? snapCornerOffset(data, selectedSectionIndex, cornerIdx, offset, snapRadius)
			: offset;
		if (finalOffset.x === 0 && finalOffset.z === 0) return;
		onChange(translateCornerWithShared(data, selectedSectionIndex, cornerIdx, finalOffset));
	}, [data, selectedSectionIndex, snapEnabled, snapRadius, onChange]);

	const handleCornerCancel = useCallback(() => setDrag(null), []);

	// Reset transient edge / drag UI when the selected section changes.
	useResetOnChange(selectedSectionIndex, () => {
		setHoveredEdge(null);
		setEdgeMenu(null);
		setDrag(null);
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
		const next = duplicateSectionThroughEdge(data, edgeMenu.sectionIndex, edgeMenu.edgeIdx);
		onChange(next);
		const dupIdx = next.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length.
		requestAnimationFrame(() => {
			onSelect(aiSectionMarkerPath({ kind: 'section', sectionIndex: dupIdx }));
		});
		setEdgeMenu(null);
	}, [data, edgeMenu, onChange, onSelect]);

	// Marquee wiring: pick AI sections whose corner-centroid is inside the
	// dragged rectangle and union/subtract their schema paths into the
	// bulk set. Sections store XY corners on the Y=0 ground plane (height
	// is implicit), so the centroid we project is (avgX, 0, avgY).
	const handleMarquee = useCallback(
		(frustum: THREE.Frustum, mode: 'add' | 'remove') => {
			if (!bulk?.onBulkApplyPaths) return;
			const hits: NodePath[] = [];
			const pt = new THREE.Vector3();
			for (let i = 0; i < data.sections.length; i++) {
				const corners = data.sections[i].corners;
				if (corners.length === 0) continue;
				let sx = 0, sy = 0;
				for (const c of corners) { sx += c.x; sy += c.y; }
				const n = corners.length;
				pt.set(sx / n, 0, sy / n);
				if (frustum.containsPoint(pt)) hits.push(['sections', i]);
			}
			if (hits.length === 0) return;
			bulk.onBulkApplyPaths(hits, mode);
		},
		[data, bulk],
	);

	return (
		<>
			<BatchedSections
				scene={scene}
				onPickSection={handlePickSection}
				onHoverSection={setHoverSectionIndex}
			/>

			{previewSection && <SelectionOverlay section={previewSection} color="#ffaa33" />}
			{hovSection && hoverSectionIndex !== selectedSectionIndex && (
				<SelectionOverlay section={hovSection} color="#66aaff" />
			)}

			{drag && affectedNeighbours.map(({ idx, section }) => (
				<SelectionOverlay key={`cascade-${idx}`} section={section} color="#ddaa66" />
			))}

			{previewSection && selectedSectionIndex != null && (
				<SectionLabel section={previewSection} index={selectedSectionIndex} color="#ffaa33" />
			)}
			{hovSection && hoverSectionIndex != null && hoverSectionIndex !== selectedSectionIndex && (
				<SectionLabel section={hovSection} index={hoverSectionIndex} color="#aaaaaa" />
			)}

			{selectedSectionIndex != null && previewSection && (
				<SelectedSectionDetail
					section={previewSection}
					sectionIndex={selectedSectionIndex}
					data={data}
					marker={marker}
					onPickPortal={handlePickPortal}
					onPickBoundaryLine={handlePickBoundaryLine}
					onPickNoGoLine={handlePickNoGoLine}
					hoveredEdge={hoveredEdge}
					onHoverEdge={setHoveredEdge}
					onEdgeContextMenu={handleEdgeContextMenu}
				/>
			)}

			{gizmoPosition && drag?.kind !== 'corner' && (
				<TranslateGizmo
					position={gizmoPosition}
					pixelSize={gizmoPixelSize}
					onTranslate={handleGizmoTranslate}
					onCommit={handleGizmoCommit}
					onCancel={handleGizmoCancel}
				/>
			)}

			{previewSection && drag?.kind !== 'section' && (
				<CornerHandles
					section={previewSection}
					pixelSize={cornerHandlePixelSize}
					onDrag={handleCornerDrag}
					onCommit={handleCornerCommit}
					onCancel={handleCornerCancel}
				/>
			)}

			{/* CameraBridge mirrors camera state out to the marquee selector
			    living in the DOM sibling slot. Lives inside Canvas so it can
			    read three-fiber's per-frame state. */}
			<CameraBridge bridge={cameraBridge} />

			{/* DOM siblings — snap toggle, marquee rectangle, edge context
			    menu — registered into the chrome's HTML slot. The slot
			    renders these outside the Canvas in React-DOM-land, avoiding
			    cross-reconciler portal quirks. */}
			<HtmlSiblings
				isActive={isActive}
				snapEnabled={snapEnabled}
				toggleSnap={() => setSnapEnabled((v) => !v)}
				cameraBridge={cameraBridge}
				onMarquee={handleMarquee}
				edgeMenu={edgeMenu}
				onDuplicateThroughEdge={handleDuplicateThroughEdge}
				onCloseEdgeMenu={() => setEdgeMenu(null)}
			/>
		</>
	);
};

// HtmlSiblings ─ encapsulates the DOM-overlay JSX so the registration deps
// can be tracked precisely. The body is one big memoised JSX node passed to
// the chrome's slot; re-registers only when the snapshot of overlay state
// it captures actually changes.
function HtmlSiblings({
	isActive,
	snapEnabled,
	toggleSnap,
	cameraBridge,
	onMarquee,
	edgeMenu,
	onDuplicateThroughEdge,
	onCloseEdgeMenu,
}: {
	isActive: boolean;
	snapEnabled: boolean;
	toggleSnap: () => void;
	cameraBridge: React.MutableRefObject<CameraBridgeData | null>;
	onMarquee: (frustum: THREE.Frustum, mode: 'add' | 'remove') => void;
	edgeMenu: { x: number; y: number; sectionIndex: number; edgeIdx: number } | null;
	onDuplicateThroughEdge: () => void;
	onCloseEdgeMenu: () => void;
}) {
	const node = useMemo(
		() => (
			<>
				<MarqueeSelector
					bridge={cameraBridge}
					far={50000}
					onMarquee={onMarquee}
					hintIdle="press B to box-select AI sections"
				/>

				<button
					type="button"
					onClick={toggleSnap}
					title={snapEnabled
						? 'Snap to edges: ON (S to toggle)'
						: 'Snap to edges: OFF (S to toggle)'}
					aria-pressed={snapEnabled}
					style={{
						position: 'absolute',
						top: 8,
						left: 8,
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						padding: '4px 8px',
						borderRadius: 6,
						fontSize: 11,
						fontFamily: 'monospace',
						border: '1px solid rgba(255,255,255,0.15)',
						background: snapEnabled ? 'rgba(80, 170, 110, 0.85)' : 'rgba(20, 22, 28, 0.85)',
						color: snapEnabled ? '#fff' : 'rgba(255,255,255,0.7)',
						cursor: 'pointer',
						userSelect: 'none',
						boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
						pointerEvents: 'auto',
					}}
				>
					<Magnet size={14} />
					<span>Snap{snapEnabled ? ' · on' : ' · off'}</span>
					<span style={{ opacity: 0.5, fontSize: 10 }}>S</span>
				</button>

				{edgeMenu && (
					<EdgeContextMenu
						x={edgeMenu.x}
						y={edgeMenu.y}
						edgeIdx={edgeMenu.edgeIdx}
						onDuplicate={onDuplicateThroughEdge}
						onClose={onCloseEdgeMenu}
					/>
				)}
			</>
		),
		[snapEnabled, toggleSnap, cameraBridge, onMarquee, edgeMenu, onDuplicateThroughEdge, onCloseEdgeMenu],
	);
	// Pass `null` when this overlay isn't the active resource so the chrome
	// drops our marquee / snap / context menu — see ADR-0007 / issue #24.
	useWorldViewportHtmlSlot(isActive ? node : null);
	return null;
}

export default AISectionsOverlay;
