// 3D viewport for AISections — renders section polygons on the XZ plane,
// portals as spheres, boundary lines as red segments, noGo lines as orange
// segments.
//
// PERFORMANCE: With ~8780 sections, individual React components per section
// are too expensive. Instead we batch all polygons into ONE merged
// BufferGeometry (2 draw calls: fills + outlines) and use face-index
// mapping for click/hover picking.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { Copy } from 'lucide-react';
import { CameraBridge, type CameraBridgeData } from '@/components/common/three/CameraBridge';
import { MarqueeSelector } from '@/components/common/three/MarqueeSelector';
import { useSchemaBulkSelection } from '@/components/schema-editor/bulkSelectionContext';
import type { NodePath } from '@/lib/schema/walk';
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
import { CornerHandles, type CornerDragOffset } from './CornerHandles';
import { Magnet } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AISectionSelection = {
	sectionIndex: number;
	sub?: { type: 'portal' | 'boundaryLine' | 'noGoLine'; portalIndex?: number; lineIndex?: number };
} | null;

type Props = {
	data: ParsedAISections;
	onChange: (next: ParsedAISections) => void;
	selected: AISectionSelection;
	onSelect: (sel: AISectionSelection) => void;
};

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const SPEED_COLORS_RGB: Record<number, [number, number, number]> = {
	[SectionSpeed.E_SECTION_SPEED_VERY_SLOW]: [0.2, 0.4, 0.8],
	[SectionSpeed.E_SECTION_SPEED_SLOW]: [0.27, 0.67, 0.53],
	[SectionSpeed.E_SECTION_SPEED_NORMAL]: [0.53, 0.73, 0.27],
	[SectionSpeed.E_SECTION_SPEED_FAST]: [0.8, 0.53, 0.2],
	[SectionSpeed.E_SECTION_SPEED_VERY_FAST]: [0.8, 0.2, 0.2],
};

const FALLBACK_RGB: [number, number, number] = [0.4, 0.4, 0.4];

// ---------------------------------------------------------------------------
// Scene bounds
// ---------------------------------------------------------------------------

function computeBounds(data: ParsedAISections): { center: THREE.Vector3; radius: number } {
	if (data.sections.length === 0) return { center: new THREE.Vector3(), radius: 100 };
	const box = new THREE.Box3();
	for (const sec of data.sections) {
		for (const c of sec.corners) {
			box.expandByPoint(new THREE.Vector3(c.x, 0, c.y));
		}
	}
	const sphere = new THREE.Sphere();
	box.getBoundingSphere(sphere);
	return { center: sphere.center, radius: Math.max(sphere.radius, 50) };
}

// ---------------------------------------------------------------------------
// Camera auto-fit
// ---------------------------------------------------------------------------

function AutoFit({ center, radius }: { center: THREE.Vector3; radius: number }) {
	const { camera } = useThree();
	const fitted = useRef(false);
	useEffect(() => {
		if (fitted.current) return;
		fitted.current = true;
		const d = radius * 1.5;
		camera.position.set(center.x, d, center.z + d * 0.3);
		camera.lookAt(center);
	}, [camera, center, radius]);
	return null;
}

// ---------------------------------------------------------------------------
// Batched section geometry builder
// ---------------------------------------------------------------------------

type BatchedResult = {
	/** Merged fill geometry with per-vertex colors */
	fillGeo: THREE.BufferGeometry;
	/** Merged outline geometry (pairs of vertices for LineSegments) */
	outlineGeo: THREE.BufferGeometry;
	/** Map face index (triangle index) → section index */
	faceToSection: Int32Array;
};

function buildBatchedSections(sections: AISection[]): BatchedResult {
	// Each section with ≥3 corners produces (corners.length - 2) triangles for fill
	// and corners.length line segments for outline.

	// Pre-count totals
	let totalFillVerts = 0;
	let totalFillIndices = 0;
	let totalOutlineVerts = 0;

	for (const sec of sections) {
		const n = sec.corners.length;
		if (n < 3) continue;
		totalFillVerts += n;
		totalFillIndices += (n - 2) * 3;
		totalOutlineVerts += n * 2; // each edge = 2 verts
	}

	const positions = new Float32Array(totalFillVerts * 3);
	const colors = new Float32Array(totalFillVerts * 3);
	const indices = new Uint32Array(totalFillIndices);
	const faceToSection = new Int32Array(totalFillIndices / 3);

	const outPositions = new Float32Array(totalOutlineVerts * 3);

	let vOff = 0;   // vertex offset (fill)
	let iOff = 0;   // index offset (fill)
	let fOff = 0;   // face offset
	let oOff = 0;   // outline vertex offset

	for (let si = 0; si < sections.length; si++) {
		const sec = sections[si];
		const n = sec.corners.length;
		if (n < 3) continue;

		const rgb = SPEED_COLORS_RGB[sec.speed] ?? FALLBACK_RGB;
		const baseVert = vOff / 3;

		// Fill vertices (on XZ plane at y=0.1)
		for (let ci = 0; ci < n; ci++) {
			positions[vOff] = sec.corners[ci].x;
			positions[vOff + 1] = 0.1;
			positions[vOff + 2] = sec.corners[ci].y;
			colors[vOff] = rgb[0];
			colors[vOff + 1] = rgb[1];
			colors[vOff + 2] = rgb[2];
			vOff += 3;
		}

		// Fill indices (fan triangulation)
		const numTris = n - 2;
		for (let t = 0; t < numTris; t++) {
			indices[iOff] = baseVert;
			indices[iOff + 1] = baseVert + t + 1;
			indices[iOff + 2] = baseVert + t + 2;
			iOff += 3;
			faceToSection[fOff++] = si;
		}

		// Outline vertices (line segments: [v0,v1], [v1,v2], ..., [vN-1,v0])
		for (let ci = 0; ci < n; ci++) {
			const next = (ci + 1) % n;
			outPositions[oOff] = sec.corners[ci].x;
			outPositions[oOff + 1] = 0.5;
			outPositions[oOff + 2] = sec.corners[ci].y;
			oOff += 3;
			outPositions[oOff] = sec.corners[next].x;
			outPositions[oOff + 1] = 0.5;
			outPositions[oOff + 2] = sec.corners[next].y;
			oOff += 3;
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
// Shared materials (created once, reused)
// ---------------------------------------------------------------------------

const fillMaterial = new THREE.MeshBasicMaterial({
	vertexColors: true,
	transparent: true,
	opacity: 0.25,
	side: THREE.DoubleSide,
	depthWrite: false,
	// Push fills back in depth so outlines always win — prevents z-fighting flicker
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
});

const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });

// ---------------------------------------------------------------------------
// Batched sections scene (2 draw calls for all 8780 sections)
// ---------------------------------------------------------------------------

function BatchedSections({
	data, selected, hovered, onSelect, onHover,
}: {
	data: ParsedAISections;
	selected: AISectionSelection;
	hovered: AISectionSelection;
	onSelect: (sel: AISectionSelection) => void;
	onHover: (sel: AISectionSelection) => void;
}) {
	const batched = useMemo(() => buildBatchedSections(data.sections), [data.sections]);

	// Face-index → section lookup on click
	const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) return;
		const si = batched.faceToSection[e.faceIndex];
		if (si != null && si >= 0) {
			onSelect({ sectionIndex: si });
		}
	}, [batched.faceToSection, onSelect]);

	// Hover via pointer move on the single mesh
	const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
		e.stopPropagation();
		if (e.faceIndex == null) { onHover(null); return; }
		const si = batched.faceToSection[e.faceIndex];
		if (si != null && si >= 0) {
			onHover({ sectionIndex: si });
			document.body.style.cursor = 'pointer';
		}
	}, [batched.faceToSection, onHover]);

	const handlePointerOut = useCallback(() => {
		onHover(null);
		document.body.style.cursor = 'auto';
	}, [onHover]);

	return (
		<>
			{/* All section fills — single draw call */}
			<mesh
				geometry={batched.fillGeo}
				material={fillMaterial}
				onClick={handleClick}
				onPointerMove={handlePointerMove}
				onPointerOut={handlePointerOut}
			/>
			{/* All section outlines — single draw call */}
			<lineSegments geometry={batched.outlineGeo} material={outlineMaterial} />
		</>
	);
}

// ---------------------------------------------------------------------------
// Selection highlight overlay (only 1 section, rendered individually)
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
		// Shape lives in 2D (x, y, 0). The corners' `y` field stores world Z,
		// so we want the rotation that lands the shape's y onto world +Z.
		// rotateX(+π/2) takes (x, y, 0) → (x, 0, y); rotateX(-π/2) flips Z
		// and the fill ends up on the opposite side of the map from the
		// outline (which uses [c.x, 0.4, c.y] directly).
		geo.rotateX(Math.PI / 2);
		return geo;
	}, [section.corners]);

	if (!geometry) return null;

	return (
		<>
			<mesh geometry={geometry} position={[0, 0.3, 0]}>
				<meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
			</mesh>
			{/* Outline highlight */}
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

// ---------------------------------------------------------------------------
// Section label (only shown for selected/hovered)
// ---------------------------------------------------------------------------

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
// Portal markers (only for selected section)
// ---------------------------------------------------------------------------

const portalGeo = new THREE.SphereGeometry(3, 12, 8);
const portalMat = new THREE.MeshStandardMaterial({ color: 0x33cccc, roughness: 0.4, metalness: 0.2 });
const portalSelMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, roughness: 0.4, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.5 });

function SelectedSectionDetail({
	section: sec, data, sectionIndex, selected, onSelect, hoveredEdge, onHoverEdge, onEdgeContextMenu,
}: {
	/** The section to render. During a translate-drag this is the previewed
	 *  (offset-applied) copy, otherwise it's `data.sections[sectionIndex]`. */
	section: AISection;
	data: ParsedAISections;
	sectionIndex: number;
	selected: AISectionSelection;
	onSelect: (sel: AISectionSelection) => void;
	hoveredEdge: number | null;
	onHoverEdge: (edgeIdx: number | null) => void;
	onEdgeContextMenu: (edgeIdx: number, screenX: number, screenY: number) => void;
}) {
	if (!sec) return null;

	return (
		<>
			{/* Edge handles — right-click to duplicate the section through an edge.
			    Drawn slightly above the polygon outline so they're easy to pick. */}
			<EdgeHandles
				section={sec}
				hoveredEdge={hoveredEdge}
				onHoverEdge={onHoverEdge}
				onContextMenu={onEdgeContextMenu}
			/>

			{/* Portals */}
			{sec.portals.map((portal, pi) => {
				const pos: [number, number, number] = [portal.position.x, portal.position.y, portal.position.z];
				const isSel = selected?.sub?.type === 'portal' && selected.sub.portalIndex === pi;
				return (
					<group key={`portal-${pi}`} position={pos}>
						<mesh
							geometry={portalGeo}
							material={isSel ? portalSelMat : portalMat}
							onClick={(e) => { e.stopPropagation(); onSelect({ sectionIndex, sub: { type: 'portal', portalIndex: pi } }); }}
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

			{/* Portal boundary lines (red) */}
			{sec.portals.map((portal, pi) =>
				portal.boundaryLines.map((bl, li) => {
					const start: [number, number, number] = [bl.verts.x, portal.position.y + 0.5, bl.verts.y];
					const end: [number, number, number] = [bl.verts.z, portal.position.y + 0.5, bl.verts.w];
					const isSel = selected?.sub?.type === 'boundaryLine' &&
						selected.sub.portalIndex === pi && selected.sub.lineIndex === li;
					return (
						<group key={`bl-${pi}-${li}`}>
							<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc3333'} lineWidth={isSel ? 3 : 2} />
							<mesh
								position={[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2]}
								onClick={(e) => {
									e.stopPropagation();
									onSelect({ sectionIndex, sub: { type: 'boundaryLine', portalIndex: pi, lineIndex: li } });
								}}
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

			{/* NoGo lines (orange) */}
			{sec.noGoLines.map((bl, li) => {
				const start: [number, number, number] = [bl.verts.x, 0.5, bl.verts.y];
				const end: [number, number, number] = [bl.verts.z, 0.5, bl.verts.w];
				const isSel = selected?.sub?.type === 'noGoLine' && selected.sub.lineIndex === li;
				return (
					<group key={`ng-${li}`}>
						<Line points={[start, end]} color={isSel ? '#ffaa33' : '#cc8833'} lineWidth={isSel ? 3 : 2} />
						<mesh
							position={[(start[0] + end[0]) / 2, 0.5, (start[2] + end[2]) / 2]}
							onClick={(e) => {
								e.stopPropagation();
								onSelect({ sectionIndex, sub: { type: 'noGoLine', lineIndex: li } });
							}}
						>
							<sphereGeometry args={[2, 6, 4]} />
							<meshBasicMaterial transparent opacity={0} />
						</mesh>
					</group>
				);
			})}

			{/* Portal link lines (dashed cyan) */}
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
		</>
	);
}

// ---------------------------------------------------------------------------
// Edge handles (only for selected section) — surface for right-click ops
// ---------------------------------------------------------------------------
//
// One thin invisible "hit box" per polygon edge plus a visible line drawn on
// top of the existing polygon outline. The hit box is a flattened
// boxGeometry oriented along the edge so it's clickable from a wide range
// of camera angles without obscuring the polygon fill underneath.

function EdgeHandles({
	section,
	hoveredEdge,
	onHoverEdge,
	onContextMenu,
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
				// Three.js rotation around Y is positive CCW looking down +Y.
				// Our edge runs from (A.x, A.y) → (B.x, B.y) on the XZ plane.
				// Negate the angle so the box's local +X aligns with the edge.
				const angle = -Math.atan2(dz, dx);

				const isHovered = hoveredEdge === i;
				const lineColor = isHovered ? '#33ff66' : '#ffaa33';
				const lineWidth = isHovered ? 4 : 2;
				// Hit-area thickness scales with the edge length so short edges
				// stay clickable but long edges don't swallow huge chunks of
				// the polygon. Floor at a few world units so very short edges
				// (e.g., near-degenerate polygons) remain pickable.
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
								// `e.nativeEvent` is the underlying DOM MouseEvent;
								// suppress the browser's default context menu so
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
// Floating context menu — DOM, positioned at click coords
// ---------------------------------------------------------------------------
//
// Rendered outside the Canvas as a `position: fixed` element so it floats
// above the WebGL surface. We don't reuse shadcn's <ContextMenu> because
// that primitive binds to right-click on a DOM element; the trigger here is
// a Three.js mesh onContextMenu, so we need a programmatic open path.

function EdgeContextMenu({
	x,
	y,
	edgeIdx,
	onDuplicate,
	onClose,
}: {
	x: number;
	y: number;
	edgeIdx: number;
	onDuplicate: () => void;
	onClose: () => void;
}) {
	useEffect(() => {
		// Defer registration by a tick so the same mousedown that opened the
		// menu doesn't immediately close it.
		const handleClick = () => onClose();
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		const handleContextMenuElsewhere = (e: MouseEvent) => {
			// Block the browser context menu on a second right-click so the
			// user gets their own menu replaced rather than two stacked menus.
			e.preventDefault();
			onClose();
		};
		const t = window.setTimeout(() => {
			window.addEventListener('mousedown', handleClick);
			window.addEventListener('keydown', handleKey);
			window.addEventListener('contextmenu', handleContextMenuElsewhere);
		}, 0);
		return () => {
			window.clearTimeout(t);
			window.removeEventListener('mousedown', handleClick);
			window.removeEventListener('keydown', handleKey);
			window.removeEventListener('contextmenu', handleContextMenuElsewhere);
		};
	}, [onClose]);

	return (
		<div
			style={{
				position: 'fixed',
				left: x,
				top: y,
				zIndex: 1000,
			}}
			className="bg-popover text-popover-foreground border rounded-md shadow-md p-1 min-w-[16rem]"
			// Stop the inner mousedown from being read as a "click outside"
			// by the dismiss handler above.
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
// Main viewport component
// ---------------------------------------------------------------------------

// While a drag is in flight we keep the live offset in local state so the
// underlying model isn't touched until release — one drag commits as one
// undo entry. Two distinct drag flavours can be active (the gizmo translates
// the whole section; the corner handles deform the polygon), so we model it
// as a discriminated union with mutual exclusion.
type ActiveDrag =
	| { kind: 'section'; offset: GizmoOffset }
	| { kind: 'corner'; cornerIdx: number; offset: CornerDragOffset };

export const AISectionsViewport: React.FC<Props> = ({ data, onChange, selected, onSelect }) => {
	const [hovered, setHovered] = useState<AISectionSelection>(null);
	const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
	const [edgeMenu, setEdgeMenu] = useState<
		{ x: number; y: number; sectionIndex: number; edgeIdx: number } | null
	>(null);
	const [drag, setDrag] = useState<ActiveDrag | null>(null);
	const [snapEnabled, setSnapEnabled] = useState(false);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);
	const camDistance = radius * 1.5;

	// Snap radius is a small fraction of the scene's bounding radius — for a
	// typical AI bundle (~200 world-unit radius) this lands at ~4 units,
	// which feels right when sections are 10–30 units across. Memoised so
	// the per-frame drag callbacks don't recompute the multiply.
	const snapRadius = useMemo(() => Math.max(radius * 0.02, 0.5), [radius]);

	// `S` toggles snap mode. Skip when an editable element is focused so
	// typing the letter into the inspector doesn't flip the toggle.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 's' && e.key !== 'S') return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			const tag = target?.tagName;
			if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
			e.preventDefault();
			setSnapEnabled((v) => !v);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const selSection = selected ? data.sections[selected.sectionIndex] : null;
	const hovSection = hovered ? data.sections[hovered.sectionIndex] : null;

	// While a drag is in flight, run the relevant op on the live offset to
	// derive a preview model. Used for the selection overlay on the source
	// AND for highlighted neighbours that the smart-cascade affects, so the
	// user sees the move in real time. We don't replace `data` in
	// BatchedSections — that would rebuild ~8000 sections of geometry every
	// frame. The per-section overlays are cheap and only touch the affected
	// sections.
	const previewModel: ParsedAISections | null = useMemo(() => {
		if (!selected || !selSection || !drag) return null;
		if (drag.offset.x === 0 && drag.offset.z === 0) return null;
		try {
			if (drag.kind === 'section') {
				return translateSectionWithLinks(data, selected.sectionIndex, drag.offset);
			}
			return translateCornerWithShared(
				data,
				selected.sectionIndex,
				drag.cornerIdx,
				drag.offset,
			);
		} catch {
			return null;
		}
	}, [data, selected, selSection, drag]);

	// The dragged section as it'll look on commit — used for the source
	// selection layer (highlight, portals, edges, label, gizmo position).
	const previewSection: AISection | null = useMemo(() => {
		if (!selSection) return null;
		if (!previewModel || !selected) return selSection;
		return previewModel.sections[selected.sectionIndex] ?? selSection;
	}, [selSection, previewModel, selected]);

	// Indices of sections (other than the source) whose geometry the active
	// op also touched. We diff the previewed model against the live `data`
	// — any section that's no longer reference-equal was modified by the
	// cascade. This works uniformly for both drag flavours: a section-drag
	// cascade affects linked neighbours, a corner-drag cascade affects any
	// section with a corner at the same world point.
	const affectedNeighbours = useMemo(() => {
		if (!previewModel || !selected) return [];
		const out: { idx: number; section: AISection }[] = [];
		for (let i = 0; i < previewModel.sections.length; i++) {
			if (i === selected.sectionIndex) continue;
			if (previewModel.sections[i] !== data.sections[i]) {
				out.push({ idx: i, section: previewModel.sections[i] });
			}
		}
		return out;
	}, [previewModel, selected, data]);

	// Gizmo origin: the section's centroid lifted slightly so the arrows
	// hover above the polygon outline. Tracks the preview, so the gizmo
	// follows the section as the user drags.
	const gizmoPosition = useMemo<[number, number, number] | null>(() => {
		if (!previewSection || previewSection.corners.length === 0) return null;
		let sx = 0, sz = 0;
		for (const c of previewSection.corners) { sx += c.x; sz += c.y; }
		const n = previewSection.corners.length;
		return [sx / n, 1.5, sz / n];
	}, [previewSection]);

	// Gizmo and corner-handle sizes are screen-pixel targets — the components
	// rescale themselves per frame against the camera distance, so zooming
	// in or out keeps them at the same on-screen size and they don't
	// occlude polygon edges when the user pulls the camera in close.
	const gizmoPixelSize = 90;
	const cornerHandlePixelSize = 12;

	const handleGizmoTranslate = useCallback(
		(offset: GizmoOffset) => {
			const finalOffset =
				snapEnabled && selected
					? snapSectionOffset(data, selected.sectionIndex, offset, snapRadius)
					: offset;
			setDrag({ kind: 'section', offset: finalOffset });
		},
		[snapEnabled, selected, data, snapRadius],
	);

	const handleGizmoCommit = useCallback(
		(offset: GizmoOffset) => {
			setDrag(null);
			if (!selected || (offset.x === 0 && offset.z === 0)) return;
			const finalOffset = snapEnabled
				? snapSectionOffset(data, selected.sectionIndex, offset, snapRadius)
				: offset;
			if (finalOffset.x === 0 && finalOffset.z === 0) return;
			// Smart move: cascades into every neighbour the source shares a
			// portal with so paired-portal connections (and the corners on the
			// shared edge) stay coherent. See translateSectionWithLinks for
			// the cascade rules.
			const next = translateSectionWithLinks(data, selected.sectionIndex, finalOffset);
			onChange(next);
		},
		[data, selected, snapEnabled, snapRadius, onChange],
	);

	const handleGizmoCancel = useCallback(() => {
		setDrag(null);
	}, []);

	const handleCornerDrag = useCallback(
		(cornerIdx: number, offset: CornerDragOffset) => {
			const finalOffset =
				snapEnabled && selected
					? snapCornerOffset(data, selected.sectionIndex, cornerIdx, offset, snapRadius)
					: offset;
			setDrag({ kind: 'corner', cornerIdx, offset: finalOffset });
		},
		[snapEnabled, selected, data, snapRadius],
	);

	const handleCornerCommit = useCallback(
		(cornerIdx: number, offset: CornerDragOffset) => {
			setDrag(null);
			if (!selected || (offset.x === 0 && offset.z === 0)) return;
			const finalOffset = snapEnabled
				? snapCornerOffset(data, selected.sectionIndex, cornerIdx, offset, snapRadius)
				: offset;
			if (finalOffset.x === 0 && finalOffset.z === 0) return;
			// Smart corner-drag: cascades into every coincident corner / BL
			// endpoint elsewhere in the model. See translateCornerWithShared.
			const next = translateCornerWithShared(
				data,
				selected.sectionIndex,
				cornerIdx,
				finalOffset,
			);
			onChange(next);
		},
		[data, selected, snapEnabled, snapRadius, onChange],
	);

	const handleCornerCancel = useCallback(() => {
		setDrag(null);
	}, []);

	// Reset transient edge / drag UI when the selected section changes —
	// otherwise stale state from the previous selection (a hover, an open
	// menu, an in-flight drag) could leak onto the new section.
	const selectedSectionIndex = selected?.sectionIndex ?? null;
	useEffect(() => {
		setHoveredEdge(null);
		setEdgeMenu(null);
		setDrag(null);
	}, [selectedSectionIndex]);

	const handleEdgeContextMenu = useCallback(
		(edgeIdx: number, screenX: number, screenY: number) => {
			if (selected == null) return;
			setEdgeMenu({
				x: screenX,
				y: screenY,
				sectionIndex: selected.sectionIndex,
				edgeIdx,
			});
		},
		[selected],
	);

	const handleDuplicateThroughEdge = useCallback(() => {
		if (!edgeMenu) return;
		const next = duplicateSectionThroughEdge(data, edgeMenu.sectionIndex, edgeMenu.edgeIdx);
		onChange(next);
		const dupIdx = next.sections.length - 1;
		// Defer selection so it lands on the post-update model — avoids a
		// brief flash where the inspector points at the new index but the
		// model still has the old length.
		requestAnimationFrame(() => {
			onSelect({ sectionIndex: dupIdx });
		});
		setEdgeMenu(null);
	}, [data, edgeMenu, onChange, onSelect]);

	// Marquee wiring: pick AI sections whose corner-centroid is inside the
	// dragged rectangle and union/subtract their schema paths into the
	// bulk set. Sections store XY corners on the Y=0 ground plane (height
	// is implicit), so the centroid we project is (avgX, 0, avgY).
	const cameraBridge = useRef<CameraBridgeData | null>(null);
	const bulk = useSchemaBulkSelection();
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
		<div
			style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0, position: 'relative' }}
			// Block the browser's default context menu inside the viewport.
			// Without this, right-clicking anywhere in the canvas — even on
			// an edge handle that already prevents-default — sometimes lets
			// the browser menu through (depends on the order React fires
			// pointer events vs. the native event). Belt-and-braces.
			onContextMenu={(e) => e.preventDefault()}
		>
			<Canvas
				camera={{
					position: [center.x, camDistance, center.z + camDistance * 0.3],
					fov: 45,
					near: 0.1,
					far: Math.max(camDistance * 20, 5000),
				}}
				gl={{ antialias: true, logarithmicDepthBuffer: true }}
				onPointerMissed={() => onSelect(null)}
			>
				<color attach="background" args={['#1a1d23']} />
				<AutoFit center={center} radius={radius} />
				<ambientLight intensity={0.6} />
				<hemisphereLight args={['#b1c8e8', '#4a3f2f', 0.3]} />
				<directionalLight position={[10, 20, 5]} intensity={0.9} />
				<directionalLight position={[-8, 15, -10]} intensity={0.4} />
				{/* Grid removed — it z-fights with the section polygons at this scale */}

				{/* All 8780 sections in 2 draw calls */}
				<BatchedSections
					data={data}
					selected={selected}
					hovered={hovered}
					onSelect={onSelect}
					onHover={setHovered}
				/>

				{/* Selection highlight (1 section). During a translate drag we
				    render the highlight at the previewed (offset) position so
				    the user sees where the section is heading; the underlying
				    batched fill stays put until commit. */}
				{previewSection && <SelectionOverlay section={previewSection} color="#ffaa33" />}
				{hovSection && hovered?.sectionIndex !== selected?.sectionIndex && (
					<SelectionOverlay section={hovSection} color="#66aaff" />
				)}

				{/* Neighbour cascade preview — every section linked to the source
				    via a portal stretches its two corners on the shared edge to
				    follow the drag. We render those previewed shapes as faint
				    overlays so the user can see the cascade before committing. */}
				{drag && affectedNeighbours.map(({ idx, section }) => (
					<SelectionOverlay key={`cascade-${idx}`} section={section} color="#ddaa66" />
				))}

				{/* Labels */}
				{previewSection && selected && (
					<SectionLabel section={previewSection} index={selected.sectionIndex} color="#ffaa33" />
				)}
				{hovSection && hovered && hovered.sectionIndex !== selected?.sectionIndex && (
					<SectionLabel section={hovSection} index={hovered.sectionIndex} color="#aaaaaa" />
				)}

				{/* Detail for selected section only — fed the previewed copy
				    so portals, boundary lines, edges and the duplicate-edge
				    handles all track the drag in lock-step with the highlight. */}
				{selected && previewSection && (
					<SelectedSectionDetail
						section={previewSection}
						sectionIndex={selected.sectionIndex}
						data={data}
						selected={selected}
						onSelect={onSelect}
						hoveredEdge={hoveredEdge}
						onHoverEdge={setHoveredEdge}
						onEdgeContextMenu={handleEdgeContextMenu}
					/>
				)}

				{/* Translate gizmo — only when a section is selected. Hidden
				    while a corner drag is active so the two gestures don't
				    visually compete. */}
				{gizmoPosition && drag?.kind !== 'corner' && (
					<TranslateGizmo
						position={gizmoPosition}
						pixelSize={gizmoPixelSize}
						onTranslate={handleGizmoTranslate}
						onCommit={handleGizmoCommit}
						onCancel={handleGizmoCancel}
					/>
				)}

				{/* Corner-drag handles — small spheres at each polygon corner.
				    Hidden while the section gizmo is active for the same
				    reason. The previewed section drives positions so each
				    handle follows the cursor during its own drag. */}
				{previewSection && drag?.kind !== 'section' && (
					<CornerHandles
						section={previewSection}
						pixelSize={cornerHandlePixelSize}
						onDrag={handleCornerDrag}
						onCommit={handleCornerCommit}
						onCancel={handleCornerCancel}
					/>
				)}

				<CameraBridge bridge={cameraBridge} />
				<OrbitControls
					target={[center.x, 0, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
			<MarqueeSelector
				bridge={cameraBridge}
				far={Math.max(camDistance * 20, 5000)}
				onMarquee={handleMarquee}
				hintIdle="press B to box-select AI sections"
			/>

			{/* Snap-to-edges toggle. Rendered as a DOM overlay outside the
			    Canvas so its hover/click events don't compete with R3F
			    pointer events. */}
			<button
				type="button"
				onClick={() => setSnapEnabled((v) => !v)}
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
					onDuplicate={handleDuplicateThroughEdge}
					onClose={() => setEdgeMenu(null)}
				/>
			)}
		</div>
	);
};

export default AISectionsViewport;
