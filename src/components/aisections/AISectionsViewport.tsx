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
import * as THREE from 'three';
import type { ParsedAISections, AISection } from '@/lib/core/aiSections';
import { SectionSpeed } from '@/lib/core/aiSections';

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
		geo.rotateX(-Math.PI / 2);
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
	data, sectionIndex, selected, onSelect,
}: {
	data: ParsedAISections;
	sectionIndex: number;
	selected: AISectionSelection;
	onSelect: (sel: AISectionSelection) => void;
}) {
	const sec = data.sections[sectionIndex];
	if (!sec) return null;

	return (
		<>
			{/* Portals */}
			{sec.portals.map((portal, pi) => {
				const pos: [number, number, number] = [portal.positionX, portal.positionY, portal.positionZ];
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
					const start: [number, number, number] = [bl.verts.x, portal.positionY + 0.5, bl.verts.y];
					const end: [number, number, number] = [bl.verts.z, portal.positionY + 0.5, bl.verts.w];
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
				const from: [number, number, number] = [portal.positionX, portal.positionY + 1, portal.positionZ];
				const to: [number, number, number] = [
					(target.corners[0].x + target.corners[2].x) / 2,
					portal.positionY + 1,
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
// Main viewport component
// ---------------------------------------------------------------------------

export const AISectionsViewport: React.FC<Props> = ({ data, onChange, selected, onSelect }) => {
	const [hovered, setHovered] = useState<AISectionSelection>(null);
	const { center, radius } = useMemo(() => computeBounds(data), [data]);
	const camDistance = radius * 1.5;

	const selSection = selected ? data.sections[selected.sectionIndex] : null;
	const hovSection = hovered ? data.sections[hovered.sectionIndex] : null;

	return (
		<div style={{ height: '45vh', background: '#1a1d23', borderRadius: 8, minWidth: 0 }}>
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

				{/* Selection highlight (1 section) */}
				{selSection && <SelectionOverlay section={selSection} color="#ffaa33" />}
				{hovSection && hovered?.sectionIndex !== selected?.sectionIndex && (
					<SelectionOverlay section={hovSection} color="#66aaff" />
				)}

				{/* Labels */}
				{selSection && selected && (
					<SectionLabel section={selSection} index={selected.sectionIndex} color="#ffaa33" />
				)}
				{hovSection && hovered && hovered.sectionIndex !== selected?.sectionIndex && (
					<SectionLabel section={hovSection} index={hovered.sectionIndex} color="#aaaaaa" />
				)}

				{/* Detail for selected section only */}
				{selected && (
					<SelectedSectionDetail
						data={data}
						sectionIndex={selected.sectionIndex}
						selected={selected}
						onSelect={onSelect}
					/>
				)}

				<OrbitControls
					target={[center.x, 0, center.z]}
					enableDamping
					dampingFactor={0.1}
					makeDefault
				/>
			</Canvas>
		</div>
	);
};

export default AISectionsViewport;
