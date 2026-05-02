// Edge handles for the currently-selected section: a visible outline plus
// invisible hit boxes for hover + right-click. Used today by V12 for the
// "duplicate section through edge" context-menu trigger; V4/V6 will adopt
// it once their edit-op slices land.
//
// The hit mesh is a flat box wrapping each edge — wider than the visible
// line (5% of edge length, min 2 world units) so right-clicking near but
// not on the edge still triggers. Hover swaps the line to bright green
// and shows a 1-line tooltip; opacity-zero `meshBasicMaterial` keeps the
// hit box invisible without disabling its raycast hit.

import { Html, Line } from '@react-three/drei';
import type { Corner } from './SelectionOverlay';

export function EdgeHandles({
	corners,
	hoveredEdge,
	onHoverEdge,
	onContextMenu,
	baseY = 0,
}: {
	corners: readonly Corner[];
	hoveredEdge: number | null;
	onHoverEdge: (edgeIdx: number | null) => void;
	onContextMenu: (edgeIdx: number, screenX: number, screenY: number) => void;
	baseY?: number;
}) {
	const N = corners.length;
	if (N < 2) return null;

	return (
		<>
			{corners.map((_, i) => {
				const A = corners[i];
				const B = corners[(i + 1) % N];
				const midX = (A.x + B.x) / 2;
				const midZ = (A.z + B.z) / 2;
				const dx = B.x - A.x;
				const dz = B.z - A.z;
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
								[A.x, baseY + 0.6, A.z],
								[B.x, baseY + 0.6, B.z],
							]}
							color={lineColor}
							lineWidth={lineWidth}
						/>
						<mesh
							position={[midX, baseY + 0.6, midZ]}
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
								position={[midX, baseY + 1.5, midZ]}
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
